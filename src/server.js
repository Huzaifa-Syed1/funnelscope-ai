/**
 * server.js — FunnelScope with AI CA Assistant
 *
 * Static file server + single /chat API route.
 * Gemini API key stays server-side only — never exposed to frontend.
 * Usage limiting via in-memory stores (minute + daily).
 */
import 'dotenv/config';
import express    from 'express';
import path       from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const publicDir  = path.join(__dirname, '..', 'public');
const require    = createRequire(import.meta.url);

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '64kb' }));

// ── Three.js vendor bundle ──────────────────────────────────────
let threePath;
try {
  const threeCjs = require.resolve('three');
  threePath = path.join(path.dirname(threeCjs), '..', 'build', 'three.module.js');
} catch {
  console.warn('[server] three not found — run npm install');
}
if (threePath) {
  app.get('/vendor/three.module.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(threePath);
  });
}

// ════════════════════════════════════════════════════════════════
// USAGE LIMIT SYSTEM
// ════════════════════════════════════════════════════════════════

// Safe limits (below Gemini 2.5 Flash Lite free-tier hard limits)
const LIMITS = {
  minuteRequests: 12,          // hard limit 15 rpm
  minuteTokens:   200_000,     // hard limit 250k tpm
  dailyRequests:  900          // hard limit 1000 rpd
};

// In-memory stores — keyed by userId to isolate users
// Format: Map<userId, { minuteKey, requests, tokens }> and Map<userId, { date, requests }>
const minuteStore = new Map();
const dailyStore  = new Map();

function getMinuteKey() {
  // "YYYY-MM-DD-HH-MM" — changes every minute
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}-${d.getUTCMinutes()}`;
}

function getTodayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function checkAndReserve(userId) {
  const minuteKey = getMinuteKey();
  const todayKey  = getTodayKey();

  // ── Per-minute bucket ────────────────────────────────────────
  let mBucket = minuteStore.get(userId);
  if (!mBucket || mBucket.minuteKey !== minuteKey) {
    mBucket = { minuteKey, requests: 0, tokens: 0 };
    minuteStore.set(userId, mBucket);
  }

  // ── Daily bucket ─────────────────────────────────────────────
  let dBucket = dailyStore.get(userId);
  if (!dBucket || dBucket.date !== todayKey) {
    dBucket = { date: todayKey, requests: 0 };
    dailyStore.set(userId, dBucket);
  }

  // ── Checks (strict order per spec) ───────────────────────────
  if (mBucket.requests  >= LIMITS.minuteRequests) return { blocked: true, reason: 'minute_requests' };
  if (mBucket.tokens    >= LIMITS.minuteTokens)   return { blocked: true, reason: 'minute_tokens' };
  if (dBucket.requests  >= LIMITS.dailyRequests)  return { blocked: true, reason: 'daily_requests' };

  // ── Reserve a slot (increment before calling AI) ─────────────
  mBucket.requests++;
  dBucket.requests++;
  return { blocked: false, mBucket, dBucket };
}

function recordTokens(userId, tokenCount) {
  const mBucket = minuteStore.get(userId);
  if (mBucket) mBucket.tokens += tokenCount;
}

// ── Retry-after calculation (seconds until next minute window) ──
function retryAfterSeconds(reason) {
  if (reason === 'daily_requests') {
    // Seconds until midnight UTC
    const now    = new Date();
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return Math.ceil((midnight - now) / 1000);
  }
  // Seconds until next minute
  const now = new Date();
  return 60 - now.getUTCSeconds();
}

// ════════════════════════════════════════════════════════════════
// GEMINI INTEGRATION
// ════════════════════════════════════════════════════════════════

const GEMINI_MODEL = process.env.AI_MODEL || 'gemini-2.5-flash-lite';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const CA_SYSTEM_PROMPT = `You are a world-class Chartered Accountant and Business Growth Advisor embedded inside FunnelScope, an AI funnel analytics tool.

Your core expertise:
- Funnel analysis and conversion rate optimisation (CRO)
- Revenue leak identification and recovery
- Financial impact estimation from conversion data
- Growth strategy and prioritisation
- Customer acquisition and retention economics

Your behaviour rules:
1. ALWAYS reference the user's actual funnel data when it is available — never give generic advice
2. Quantify financial impact whenever possible (e.g., "fixing this step could recover ₹X/month")
3. Prioritise by impact — clearly state what should be fixed FIRST and why
4. Be concise but specific — 3-5 strong insights, not essays
5. When the user's question is vague, ask one clarifying question and still provide your best analysis
6. Speak like a trusted advisor — confident, direct, and data-driven

RESPONSE ADAPTATION (IMPORTANT):
- If the question is about funnel performance → focus on diagnosis, bottlenecks, and revenue impact
- If the question is strategic/general → respond naturally with clear business reasoning (do NOT force funnel format)
- Always align your answer to what the user actually asked
- Never continue into generic or repetitive advice after your main insights are complete

Format rules:
- Use **bold** for key numbers, percentages, and step names
- Use short numbered lists for action steps
- Keep total response under 250 words unless detail is explicitly requested
- End the response cleanly after delivering insights (no filler, no repetition)
- Never say "As an AI" or "I cannot" — you are a CA advisor, you always have an opinion`;

function buildGeminiPayload(userMessage, funnelContext) {
  const contextBlock = funnelContext
    ? `\n\n--- USER'S CURRENT FUNNEL DATA ---\nIndustry: ${funnelContext.industry || 'Not specified'}\nPeriod: ${funnelContext.period || 'Not specified'}\nOverall Conversion: ${funnelContext.overallConversion?.toFixed(2) ?? '?'}%\nHealth Score: ${funnelContext.healthScore ?? '?'}/100\nBiggest Leak: ${funnelContext.biggestDropStep?.label ?? 'None identified'} (${funnelContext.biggestDropStep?.dropPct?.toFixed(1) ?? '?'}% drop)\nEstimated Monthly Revenue Loss: $${funnelContext.potentialMonthlyLoss?.toLocaleString() ?? '?'}\n\nStep-by-step breakdown:\n${(funnelContext.stepData ?? []).map((s, i) =>
        `${i + 1}. ${s.label}: ${s.value?.toLocaleString()} users | Conv from top: ${s.convPct?.toFixed(1)}% | Drop from prev: ${s.dropPct?.toFixed(1)}% | Severity: ${s.severity}`
      ).join('\n')}\n--- END FUNNEL DATA ---`
    : '\n\n[No funnel data loaded yet — user has not run an analysis]';

  return {
    system_instruction: {
      parts: [{ text: CA_SYSTEM_PROMPT + contextBlock }]
    },
    contents: [
      { role: 'user', parts: [{ text: userMessage }] }
    ],
    generationConfig: {
      temperature:     0.7,
      topP:            0.9,
      maxOutputTokens: 600,
      responseMimeType: 'text/plain'
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
    ]
  };
}

// ════════════════════════════════════════════════════════════════
// /chat ROUTE
// ════════════════════════════════════════════════════════════════
app.post('/chat', async (req, res) => {
  try {
    const { message, funnelContext, userId } = req.body;

    // ── Input validation ─────────────────────────────────────────
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required.' });
    }
    if (message.length > 2000) {
      return res.status(400).json({ error: 'Message too long (max 2000 chars).' });
    }
    // userId from frontend (Supabase user ID) — used for per-user rate limiting
    const uid = typeof userId === 'string' ? userId.slice(0, 64) : 'anonymous';

    // ── STEP 1: Check limits BEFORE calling AI ────────────────────
    const limitCheck = checkAndReserve(uid);
    if (limitCheck.blocked) {
      return res.status(429).json({
        limitReached:  true,
        retryAfter:    retryAfterSeconds(limitCheck.reason)
      });
    }

    // ── STEP 2: Verify Gemini API key exists ──────────────────────
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      console.error('[chat] GEMINI_API_KEY not set in environment');
      return res.status(500).json({ error: 'AI service not configured. Set GEMINI_API_KEY.' });
    }

    // ── STEP 3: Call Gemini 2.5 Flash Lite ───────────────────────
    const payload = buildGeminiPayload(message.trim(), funnelContext);

    const geminiRes = await fetch(
      `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload)
      }
    );

    if (!geminiRes.ok) {
      const errBody = await geminiRes.text().catch(() => '');
      console.error('[chat] Gemini error:', geminiRes.status, errBody.slice(0, 300));
      // Release the reserved slot on API failure
      const mBucket = minuteStore.get(uid);
      const dBucket = dailyStore.get(uid);
      if (mBucket) mBucket.requests = Math.max(0, mBucket.requests - 1);
      if (dBucket) dBucket.requests = Math.max(0, dBucket.requests - 1);
      return res.status(502).json({ error: 'AI service temporarily unavailable. Please try again.' });
    }

    const geminiData = await geminiRes.json();

    // ── STEP 4: Extract response text ─────────────────────────────
    const candidate = geminiData.candidates?.[0];
    const text      = candidate?.content?.parts?.[0]?.text ?? '';

    if (!text) {
      console.error('[chat] Empty response from Gemini:', JSON.stringify(geminiData).slice(0, 300));
      return res.status(502).json({ error: 'AI returned an empty response. Please rephrase your question.' });
    }

    // ── STEP 5: Record token usage ─────────────────────────────────
    const tokensUsed = (geminiData.usageMetadata?.totalTokenCount) ?? 0;
    recordTokens(uid, tokensUsed);

    // ── STEP 6: Return response ────────────────────────────────────
    return res.json({
      reply:       text.trim(),
      tokensUsed,
      model:       GEMINI_MODEL
    });

  } catch (err) {
    console.error('[chat] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ════════════════════════════════════════════════════════════════
// STATIC FILES + SPA FALLBACK
// ════════════════════════════════════════════════════════════════
app.use(express.static(publicDir));
app.get('*', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅  FunnelScope CA running → http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️  GEMINI_API_KEY not set — /chat route will return 500');
  }
});

process.on('unhandledRejection', (err) => console.error('[server] unhandled rejection:', err));
