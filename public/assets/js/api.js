/**
 * api.js — Supabase data layer
 *
 * Replaces all backend fetch() calls with direct Supabase queries.
 * The server is now a static file server — no API endpoints exist.
 *
 * Supabase table required:
 *   create table if not exists funnels (
 *     id          uuid default gen_random_uuid() primary key,
 *     user_id     uuid references auth.users not null,
 *     steps       jsonb not null,
 *     metrics     jsonb,
 *     insights    text,
 *     industry    text,
 *     period      text,
 *     created_at  timestamptz default now()
 *   );
 *
 * If you created the table without insights/industry/period, run:
 *   alter table funnels add column if not exists insights text;
 *   alter table funnels add column if not exists industry text;
 *   alter table funnels add column if not exists period   text;
 *
 * Enable Row Level Security:
 *   alter table funnels enable row level security;
 *   create policy "Users see own funnels" on funnels
 *     for all using (auth.uid() = user_id);
 */
import { supabase, getCurrentUser } from './supabase-client.js';
import { computeDiagnosis }         from './funnel-diagnosis.js';

// ─────────────────────────────────────────────────────────────
// Auth helpers (mirrors old api.register / api.login interface)
// ─────────────────────────────────────────────────────────────
async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw Object.assign(new Error('Not authenticated.'), { status: 401 });
  return user;
}

// ─────────────────────────────────────────────────────────────
// me() — returns user info + usage stub in the same shape the
//        dashboard-main.js expects
// ─────────────────────────────────────────────────────────────
async function me() {
  const user = await requireUser();
  const plan = user.user_metadata?.plan ?? 'free';
  return {
    success: true,
    user: {
      id:    user.id,
      name:  user.user_metadata?.name ?? user.email?.split('@')[0] ?? 'User',
      email: user.email,
      plan,
      isPro: plan === 'pro'
    },
    // Usage limits are tracked in Supabase (see below) or disabled for now
    usageToday:     0,
    usageLimit:     5,
    usageRemaining: 5
  };
}

// ─────────────────────────────────────────────────────────────
// analyze() — pure local computation, saves result to Supabase
// ─────────────────────────────────────────────────────────────
async function analyze({ steps, industry = 'SaaS', period = 'Last 30 days' }) {
  const user = await requireUser();

  // Local diagnosis (no OpenAI, no backend)
  const rawSteps = steps.map((s) => ({
    label: String(s.label ?? 'Step').trim(),
    value: Number(s.value) || 0
  }));

  const diag    = computeDiagnosis(rawSteps);
  const maxVal  = Math.max(...rawSteps.map((s) => s.value), 1);

  const stepMetrics = rawSteps.map((s, i) => ({
    label: s.label,
    value: s.value,
    conversionFromTop:       maxVal ? (s.value / maxVal) * 100 : 0,
    dropPercentFromPrevious: i === 0 ? 0 : ((rawSteps[i - 1].value - s.value) / (rawSteps[i - 1].value || 1)) * 100,
    isBiggestDrop:           s.label === diag?.biggestDropStep?.label
  }));

  // Save to Supabase
  let savedId = null;
  if (supabase) {
    const record = {
      user_id:  user.id,
      steps:    rawSteps,
      metrics: {
        conversionRate: diag?.overallConversion ?? 0,
        biggestDrop:    diag?.biggestDropStep?.dropPct ?? 0,
        worstStep:      diag?.biggestDropStep?.label ?? '',
        topOfFunnel:    rawSteps[0]?.value ?? 0,
        bottomOfFunnel: rawSteps[rawSteps.length - 1]?.value ?? 0,
        overallConversion: diag?.overallConversion ?? 0,
        biggestLeak: diag?.biggestDropStep
          ? { dropPercent: diag.biggestDropStep.dropPct, to: diag.biggestDropStep.label }
          : null
      },
      insights: diag?.diagnosisSummary ?? '',
      industry,
      period
    };

    const { data, error } = await supabase.from('funnels').insert([record]).select('id').single();
    if (error) {
      // Surface schema issues clearly — most common: missing column
      if (error.message?.includes('column') || error.code === '42703') {
        console.error('[Supabase] Schema mismatch — run this migration in your Supabase SQL editor:\n\n' +
          'alter table funnels add column if not exists insights text;\n' +
          'alter table funnels add column if not exists industry text;\n' +
          'alter table funnels add column if not exists period text;');
      } else {
        console.error('[Supabase] save funnel error:', error.code, error.message);
      }
    } else {
      savedId = data?.id ?? null;
    }
  }

  return {
    success:    true,
    ok:         true,
    funnel: {
      industry,
      period,
      steps:   stepMetrics,
      metrics: {
        topOfFunnel:       rawSteps[0]?.value ?? 0,
        bottomOfFunnel:    rawSteps[rawSteps.length - 1]?.value ?? 0,
        overallConversion: diag?.overallConversion ?? 0,
        biggestLeak:       diag?.biggestDropStep
          ? { dropPercent: diag.biggestDropStep.dropPct, to: diag.biggestDropStep.label }
          : null
      }
    },
    analysis: {
      criticalLeak:     diag?.diagnosisSummary ?? '',
      whatNumbersTellUs: diag?.stepData?.[0]?.rootCause ?? '',
      fixes:            diag?.topFixes ?? [],
      redFlags:         diag?.stepData
        ?.filter((s) => s.severity === 'critical' || s.severity === 'worst')
        ?.map((s) => `${s.label}: ${s.dropPct.toFixed(1)}% drop`) ?? [],
      metricToWatch:    diag?.biggestDropStep
        ? `Watch conversion at "${diag.biggestDropStep.label}" step`
        : 'Track overall conversion rate',
      model:            'local-rules-v1'
    },
    saved:          !!savedId,
    analysisId:     savedId,
    timestamp:      new Date().toISOString(),
    plan:           'free',
    isPro:          false,
    usageRemaining: 5
  };
}

// ─────────────────────────────────────────────────────────────
// history() — load saved funnels for this user
// ─────────────────────────────────────────────────────────────
async function history(limit = 20) {
  const user = await requireUser();

  if (!supabase) return { items: [] };

  // Select without 'insights' first — if schema has it Supabase returns it,
  // if not we catch the error and retry with minimal columns.
  let data, error;

  ({ data, error } = await supabase
    .from('funnels')
    .select('id, steps, metrics, insights, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit));

  // If 'insights' column doesn't exist yet, fall back to minimal columns
  if (error && error.message?.includes('insights')) {
    console.warn('[Supabase] insights column missing — run migration. Fetching without it.');
    ({ data, error } = await supabase
      .from('funnels')
      .select('id, steps, metrics, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit));
  }

  if (error) {
    console.error('[Supabase] history error:', error.message);
    return { items: [] };
  }

  const items = (data ?? []).map((row) => ({
    id:         row.id,
    steps:      row.steps ?? [],
    metrics:    row.metrics ?? {},
    insights:   row.insights ?? '',
    createdAt:  row.created_at
  }));

  return { items };
}

// ─────────────────────────────────────────────────────────────
// deleteOne / deleteAll
// ─────────────────────────────────────────────────────────────
async function deleteOne(id) {
  const user = await requireUser();
  if (!supabase) return { success: true };

  const { error } = await supabase
    .from('funnels')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);   // ownership check

  if (error) {
    console.error('[Supabase] deleteOne error:', error.message);
    throw new Error(error.message);
  }
  return { success: true };
}

async function deleteAll() {
  const user = await requireUser();
  if (!supabase) return { success: true };

  const { error } = await supabase
    .from('funnels')
    .delete()
    .eq('user_id', user.id);

  if (error) {
    console.error('[Supabase] deleteAll error:', error.message);
    throw new Error(error.message);
  }
  return { success: true };
}

// ─────────────────────────────────────────────────────────────
// compare() — local computation against a saved funnel
// ─────────────────────────────────────────────────────────────
async function compare({ currentSteps, previousId }) {
  const user = await requireUser();

  if (!supabase) throw new Error('Supabase not initialised.');

  const { data, error } = await supabase
    .from('funnels')
    .select('id, steps, metrics, created_at')
    .eq('id', previousId)
    .eq('user_id', user.id)
    .single();

  if (error || !data) throw new Error(error?.message ?? 'Previous analysis not found.');

  const prev    = data;
  const prevSteps = prev.steps ?? [];
  const currSteps = currentSteps.map((s) => ({ label: s.label, value: Number(s.value) || 0 }));

  const prevTopVal = (prevSteps[0]?.value) || 1;
  const currTopVal = (currSteps[0]?.value) || 1;
  const prevConv   = ((prevSteps[prevSteps.length - 1]?.value ?? 0) / prevTopVal) * 100;
  const currConv   = ((currSteps[currSteps.length - 1]?.value ?? 0) / currTopVal) * 100;
  const delta      = currConv - prevConv;

  const stepChanges = currSteps.map((cs, i) => {
    const ps = prevSteps[i];
    const pv = ps?.value ?? 0;
    const cv = cs.value;
    const diff = cv - pv;
    return {
      label:         cs.label,
      currentValue:  cv,
      previousValue: pv,
      absoluteChange: diff,
      relativeChange: pv > 0 ? (diff / pv) * 100 : null,
      direction:     diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'
    };
  });

  return {
    current:  { steps: currSteps, metrics: { conversionRate: currConv }, createdAt: new Date().toISOString() },
    previous: { steps: prevSteps, metrics: prev.metrics ?? {}, createdAt: prev.created_at },
    comparison: {
      summary:   `Conversion ${delta > 0 ? 'improved' : delta < 0 ? 'declined' : 'unchanged'} by ${Math.abs(delta).toFixed(1)}pp.`,
      direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
      conversionChange: {
        current:  currConv,
        previous: prevConv,
        points:   delta,
        relativeChange: prevConv > 0 ? (delta / prevConv) * 100 : null
      },
      stepChanges
    }
  };
}

// ─────────────────────────────────────────────────────────────
// logout
// ─────────────────────────────────────────────────────────────
async function logout() {
  if (supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) console.error('[Supabase] signOut error:', error.message);
  }
  localStorage.removeItem('fs_user');
}

// ─────────────────────────────────────────────────────────────
// Stub payment endpoints (not used without backend)
// ─────────────────────────────────────────────────────────────
function notImplemented(name) {
  return async () => { throw Object.assign(new Error(`${name} not available in Supabase-only mode.`), { status: 501 }); };
}

export const api = {
  me,
  analyze,
  history,
  deleteOne,
  deleteAll,
  compare,
  logout,
  register:      notImplemented('register'),     // handled by auth-main.js directly
  login:         notImplemented('login'),         // handled by auth-main.js directly
  createOrder:   notImplemented('createOrder'),
  verifyPayment: notImplemented('verifyPayment'),
  paymentStatus: notImplemented('paymentStatus')
};
