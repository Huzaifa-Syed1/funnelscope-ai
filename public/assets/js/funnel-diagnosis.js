/**
 * funnel-diagnosis.js
 * Pure logic module — computes all AI diagnosis data from raw funnel steps.
 * No DOM, no Three.js. Returns structured diagnosis object consumed by UI.
 */

// ── Revenue estimation constants ────────────────────────────────
const AVG_REVENUE_PER_USER = 49;   // USD — override via step.revenuePerUser
const WORKING_DAYS_PER_MONTH = 22;

// ── Severity thresholds ─────────────────────────────────────────
function severity(dropPct) {
  if (dropPct >= 60) return 'critical';
  if (dropPct >= 35) return 'warning';
  return 'healthy';
}

function severityLabel(sev) {
  return sev === 'critical' ? 'Critical' : sev === 'warning' ? 'Warning' : 'Good';
}

// ── Health score 0-100 ──────────────────────────────────────────
function computeHealthScore(steps) {
  if (!steps?.length) return 0;
  const topVal = steps[0].value || 1;
  const botVal = steps[steps.length - 1].value || 0;
  const overallConv = (botVal / topVal) * 100;

  const maxDrop = steps.slice(1).reduce((max, s, i) => {
    const prev = steps[i].value || 1;
    const drop = ((prev - s.value) / prev) * 100;
    return Math.max(max, drop);
  }, 0);

  // Score formula: conversion rate weight 60%, max drop penalty 40%
  const score = Math.round((overallConv * 0.6) + ((100 - maxDrop) * 0.4));
  return Math.max(0, Math.min(100, score));
}

function healthLabel(score) {
  if (score >= 70) return 'Good';
  if (score >= 40) return 'Warning';
  return 'Critical';
}

// ── Root cause reasoning by step label pattern ──────────────────
const CAUSE_MAP = [
  {
    pattern: /visitor|traffic|view|land/i,
    causes: [
      'Traffic quality mismatch — ads or SEO attracting wrong audience segment.',
      'Low brand recognition causing immediate bounce before engagement begins.',
      'Page load speed above 3s causing pre-engagement drop in mobile users.'
    ]
  },
  {
    pattern: /sign.?up|register|creat|account|join/i,
    causes: [
      'Friction at signup — too many form fields or mandatory phone/credit card.',
      'Trust deficit — no testimonials, security badges, or social proof visible.',
      'Unclear value proposition — users don\'t see what they get before committing.'
    ]
  },
  {
    pattern: /activ|onboard|setup|start|begin|first/i,
    causes: [
      'Aha moment too far — users give up before reaching first value.',
      'Onboarding complexity overwhelming — too many steps before quick win.',
      'Empty state problem — blank dashboard with no demo data demotivates users.'
    ]
  },
  {
    pattern: /paid|purchas|checkout|subscri|plan|upgrade/i,
    causes: [
      'Price-value gap — users not convinced the feature delta justifies cost.',
      'Payment friction — no monthly option, limited payment methods, no trial.',
      'Timing mismatch — upgrade prompt appears before user has seen core value.'
    ]
  },
  {
    pattern: /retain|renew|active|engage|return|loyal/i,
    causes: [
      'Habit loop not formed — product used once then forgotten without re-engagement.',
      'No lifecycle emails or usage nudges to bring dormant users back.',
      'Feature discovery gap — users never find features that would lock them in.'
    ]
  }
];

function getRootCause(label, dropPct) {
  const entry = CAUSE_MAP.find((c) => c.pattern.test(label));
  if (entry) {
    const idx = dropPct > 60 ? 0 : dropPct > 35 ? 1 : 2;
    return entry.causes[idx] ?? entry.causes[0];
  }
  // Generic fallback
  if (dropPct > 60) return `Severe ${dropPct.toFixed(0)}% loss at "${label}" suggests a fundamental UX or trust barrier.`;
  if (dropPct > 35) return `Moderate drop at "${label}" — likely friction, unclear value, or wrong audience.`;
  return `Minor attrition at "${label}" is within normal range for SaaS funnels.`;
}

// ── Specific actionable fixes ───────────────────────────────────
const FIX_MAP = [
  {
    pattern: /visitor|traffic|view|land/i,
    fixes: [
      'Add qualifying copy above the fold — filter out wrong-fit visitors early.',
      'A/B test headlines to match the specific pain points of your target ICP.',
      'Reduce initial page weight — compress images, defer non-critical JS.',
      'Add a 60-second explainer video — increases time-on-page by 2-3x.'
    ]
  },
  {
    pattern: /sign.?up|register|creat|account|join/i,
    fixes: [
      'Cut signup form to email + password only — collect other data post-activation.',
      'Add "Join 12,400 teams already using FunnelScope" social proof near CTA.',
      'Offer Google/GitHub OAuth — reduces signup friction by 40-60%.',
      'Show 3 concise bullet benefits on the signup page, not a wall of text.',
      'Add a progress indicator if multi-step — users abandon unknown-length flows.'
    ]
  },
  {
    pattern: /activ|onboard|setup|start|begin|first/i,
    fixes: [
      'Add pre-filled demo data so users see value without importing their own first.',
      'Limit onboarding to 3 steps max — defer advanced setup to later.',
      'Send an activation email at 2h and 24h post-signup with a single CTA.',
      'Add a "Quick win" checklist with checkboxes — completion drives dopamine.',
      'Trigger an in-app tooltip highlighting the single most-used feature.'
    ]
  },
  {
    pattern: /paid|purchas|checkout|subscri|plan|upgrade/i,
    fixes: [
      'Offer a 7-day or 14-day free trial — removes payment commitment barrier.',
      'Add monthly billing alongside annual — some users won\'t pay annually upfront.',
      'Place upgrade prompt immediately after a user completes a key action.',
      'Show ROI calculator: "You\'ve analyzed 5 funnels — Pro saves 3h/week."',
      'Add a comparison table: Free vs Pro feature by feature, concisely.'
    ]
  },
  {
    pattern: /retain|renew|active|engage|return|loyal/i,
    fixes: [
      'Build a weekly digest email showing their funnel trend vs previous week.',
      'Add in-app milestones: "You\'ve improved conversion by 12% this month!"',
      'Trigger a win-back campaign at 7 days of inactivity with a specific hook.',
      'Surface unexplored features via tooltip tour after 3rd session.',
      'Create a community channel (Slack/Discord) — community drives retention.'
    ]
  }
];

function getActionableFixes(label, dropPct) {
  const entry = FIX_MAP.find((c) => c.pattern.test(label));
  if (entry) return entry.fixes.slice(0, 4);
  return [
    `Analyze drop-off recording at the "${label}" step using session replay.`,
    'Run a 5-question exit survey at this step to identify the primary barrier.',
    'A/B test two alternative paths through this step — measure 2 weeks each.',
    'Benchmark this conversion rate against your industry vertical average.'
  ];
}

// ── Main diagnosis function ─────────────────────────────────────
export function computeDiagnosis(rawSteps) {
  if (!rawSteps?.length) return null;

  const steps = rawSteps.map((s) => ({
    label: String(s.label ?? `Step ${rawSteps.indexOf(s) + 1}`),
    value: Number(s.value) || 0
  }));

  const topVal = steps[0].value || 1;
  const botVal = steps[steps.length - 1].value || 0;
  const overallConversion = (botVal / topVal) * 100;
  const healthScore = computeHealthScore(steps);
  const health = healthLabel(healthScore);

  // Per-step metrics
  let biggestDropStep = null;
  let biggestDropPct  = 0;

  const stepData = steps.map((step, i) => {
    const prev       = i > 0 ? steps[i - 1] : null;
    const prevVal    = prev?.value || topVal;
    const dropPct    = i === 0 ? 0 : ((prevVal - step.value) / prevVal) * 100;
    const convPct    = (step.value / topVal) * 100;
    const convFromPrev = i === 0 ? 100 : (step.value / prevVal) * 100;
    const usersLost  = i === 0 ? 0 : (prevVal - step.value);
    const sev        = i === 0 ? 'healthy' : severity(dropPct);
    const rootCause  = i === 0 ? null : getRootCause(step.label, dropPct);
    const fixes      = i === 0 ? [] : getActionableFixes(step.label, dropPct);

    if (dropPct > biggestDropPct) {
      biggestDropPct  = dropPct;
      biggestDropStep = { ...step, dropPct, index: i, fromLabel: prev?.label };
    }

    return {
      label:        step.label,
      value:        step.value,
      dropPct:      Math.max(0, dropPct),
      convPct,
      convFromPrev: Math.max(0, convFromPrev),
      usersLost,
      severity:     sev,
      severityLabel: severityLabel(sev),
      rootCause,
      fixes,
      isBiggestDrop: false   // will set below
    };
  });

  // Mark biggest drop
  if (biggestDropStep) {
    const idx = stepData.findIndex((s) => s.label === biggestDropStep.label);
    if (idx !== -1) stepData[idx].isBiggestDrop = true;
  }

  // Revenue impact
  const revenuePerUser = AVG_REVENUE_PER_USER;
  const potentialMonthlyLoss = Math.round(
    stepData.reduce((sum, s) => sum + s.usersLost, 0) * revenuePerUser * 0.1
  ); // 10% conversion assumption on lost users

  // Top 5 actionable fixes across worst steps
  const worstSteps = [...stepData]
    .filter((s) => s.severity !== 'healthy' && s.fixes.length)
    .sort((a, b) => b.dropPct - a.dropPct)
    .slice(0, 2);

  const topFixes = worstSteps.flatMap((s) => s.fixes).slice(0, 5);

  // Diagnosis summary text
  const diagnosisSummary = biggestDropStep
    ? `Biggest leak: ${biggestDropStep.fromLabel ?? steps[0].label} → ${biggestDropStep.label} (${biggestDropPct.toFixed(1)}% drop). Funnel health is ${health.toLowerCase()} at ${healthScore}/100.`
    : `Overall conversion is ${overallConversion.toFixed(1)}%. Funnel appears ${health.toLowerCase()}.`;

  return {
    diagnosisSummary,
    overallConversion,
    healthScore,
    health,
    biggestDropStep: biggestDropStep ? {
      ...biggestDropStep,
      fromLabel: biggestDropStep.fromLabel ?? steps[0].label
    } : null,
    potentialMonthlyLoss,
    revenuePerUser,
    stepData,
    topFixes
  };
}

// ── Format helpers (used by UI) ─────────────────────────────────
export function fmt(v)  { return Number(v ?? 0).toLocaleString(); }
export function pct(v)  { return Number(v ?? 0).toFixed(1) + '%'; }
export function money(v){ return '$' + Number(v ?? 0).toLocaleString(); }
