/**
 * dashboard-main.js — FunnelScope AI Funnel Doctor
 *
 * Architecture:
 * - Auth checked first, preloader second (no flash)
 * - All DOM access inside boot() / after DOMContentLoaded
 * - 3D and diagnosis modules lazy-imported (WebGL failure ≠ app crash)
 * - el() / on() helpers prevent null-ref crashes from killing event listeners
 */
import { bootstrapSession, hasSession, getUser, clearSession } from './auth-session.js';
import { api } from './api.js';
import { initChat, setFunnelContext, markChatSeen, clearLimitOverlay } from './ca-chat.js';

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
const state = {
  history:      [],
  latestResult: null,
  funnel3d:     null,
  welcomeScene: null,
  diagnosis:    null,
  chatInited:   false
};

const DEFAULT_STEPS = [
  { label: 'Visitors',  value: '18000' },
  { label: 'Sign-ups',  value: '3400'  },
  { label: 'Activated', value: '1420'  },
  { label: 'Paid',      value: '280'   },
  { label: 'Retained',  value: '160'   }
];

// ─────────────────────────────────────────────────────────────────────────────
// Safe DOM helpers
// ─────────────────────────────────────────────────────────────────────────────
function el(id) {
  const node = document.getElementById(id);
  if (!node) console.warn(`[FS] #${id} not found`);
  return node;
}
function on(elem, event, fn, opts) {
  if (!elem) return;
  elem.addEventListener(event, fn, opts);
}

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────
async function boot() {
  console.log('[FS] boot()');

  // ── Auth guard: redirect BEFORE any DOM work ──────────────────────────────
  const ok = await bootstrapSession().catch(() => false);
  if (!ok) {
    // bootstrapSession() only returns true if Supabase confirms a live session.
    // Don't fall back to stale localStorage cache — that causes infinite loops
    // when the Supabase session has expired but fs_user still exists.
    console.warn('[FS] No valid Supabase session — redirecting to auth');
    window.location.replace('/auth.html');
    return; // stop execution completely
  }

  // Preloader
  let preloader = null;
  try {
    const { createPreloader } = await import('./scene-preloader.js');
    preloader = createPreloader(() => {});
  } catch (e) { console.warn('[FS] preloader:', e.message); }

  // Navbar
  const user = getUser();
  if (user) {
    const set = (id, v) => { const e = el(id); if (e) e.textContent = v; };
    set('userAvatar', initials(user.name));
    set('userName',   user.name);
    set('ddName',     user.name);
    set('ddEmail',    user.email);
    updatePlanBadge(user);
  }

  // Render step inputs
  renderStepInputs(DEFAULT_STEPS.map((s) => ({ ...s })));

  // Welcome 3D scene
  try {
    const { mountLandingScene } = await import('./scene-landing.js');
    state.welcomeScene = mountLandingScene('welcome3d');
  } catch (e) { console.warn('[FS] welcome3d:', e.message); }

  await Promise.allSettled([loadUsage(), loadHistory()]);

  bindEvents();
  _initChatPanel();
  console.log('[FS] ready');
  preloader?.complete();
}

// ─────────────────────────────────────────────────────────────────────────────
// Navbar
// ─────────────────────────────────────────────────────────────────────────────
function initials(name) {
  return (name ?? '?').trim().split(/\s+/).map((w) => w[0].toUpperCase()).slice(0, 2).join('');
}
function updatePlanBadge(user) {
  const e = el('ddPlan');
  if (!e) return;
  e.textContent = user?.isPro ? '⚡ Pro' : 'Free';
  e.className   = user?.isPro ? 'badge badge-pro' : 'badge badge-free';
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage pill
// ─────────────────────────────────────────────────────────────────────────────
async function loadUsage() {
  try {
    const data = await api.me();
    const user = getUser();
    if (user) { user.isPro = data.user.isPro; updatePlanBadge(user); }
    const pill = el('usagePill');
    if (!pill) return;
    if (data.user.isPro) {
      pill.innerHTML = '<span class="badge badge-pro">⚡ Pro — Unlimited</span>';
    } else {
      const used = data.usageLimit - data.usageRemaining;
      const pct  = Math.round((used / data.usageLimit) * 100);
      const cls  = pct >= 100 ? 'full' : pct >= 80 ? 'warn' : 'ok';
      pill.innerHTML = `
        <span>${data.usageRemaining}/${data.usageLimit} left</span>
        <div class="usage-track"><div class="usage-fill ${cls}" style="width:${pct}%"></div></div>`;
      if (data.usageRemaining <= 1) {
        const lt = el('limitText');
        const lb = el('limitBanner');
        if (lt) lt.textContent = data.usageRemaining === 0 ? 'Daily limit reached.' : '1 analysis remaining.';
        if (lb) lb.hidden = false;
      }
    }
  } catch (e) { console.warn('[FS] loadUsage:', e.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step inputs
// ─────────────────────────────────────────────────────────────────────────────
function renderStepInputs(steps) {
  const rows = el('stepRows');
  if (!rows) return;
  rows.innerHTML = steps.map((s, i) => `
    <div class="step-row" data-idx="${i}">
      <input type="text"   class="step-label" placeholder="Step name" value="${esc(s.label ?? '')}">
      <input type="number" class="step-value" placeholder="Users"     value="${esc(s.value ?? '')}" min="0">
      <button type="button" class="remove-step" data-idx="${i}" title="Remove">×</button>
    </div>`).join('');
}
function collectSteps() {
  const rows = el('stepRows');
  if (!rows) return [];
  return [...rows.querySelectorAll('.step-row')].map((row) => ({
    label: row.querySelector('.step-label')?.value?.trim() || 'Step',
    value: row.querySelector('.step-value')?.value?.trim() || '0'
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// History
// ─────────────────────────────────────────────────────────────────────────────
async function loadHistory() {
  try {
    const data = await api.history(20);
    state.history = data.items ?? [];
  } catch { state.history = []; }
  renderHistory();
}
function renderHistory() {
  const empty = el('historyEmpty');
  const count = el('historyCount');
  const list  = el('historyList');
  const items = state.history;
  if (empty) empty.hidden = items.length > 0;
  if (count) count.textContent = items.length > 0 ? `${items.length} analyses` : 'Recent analyses';
  if (!list)  return;
  list.innerHTML = items.map((item) => `
    <div class="history-item" data-id="${esc(item.id ?? '')}">
      <div class="history-item-title">${esc(item.steps?.[0]?.label ?? 'Funnel')} → ${esc(item.steps?.at(-1)?.label ?? '')}</div>
      <div class="history-item-meta">Conv: ${item.metrics?.conversionRate?.toFixed(1) ?? '?'}% · ${fmtDate(item.createdAt)}</div>
      <div class="history-item-actions">
        <button class="btn btn-ghost btn-sm" data-action="load"    data-id="${esc(item.id ?? '')}">Load</button>
        <button class="btn btn-ghost btn-sm" data-action="compare" data-id="${esc(item.id ?? '')}">Compare</button>
        <button class="btn btn-danger btn-sm" data-action="delete" data-id="${esc(item.id ?? '')}">Del</button>
      </div>
    </div>`).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Analyze + Diagnosis
// ─────────────────────────────────────────────────────────────────────────────
async function runAnalyze() {
  const steps = collectSteps();
  if (steps.length < 2) return setNotice('Need at least 2 steps.', 'err');

  const btn = el('analyzeBtn');
  setBtnLoading(btn, true);
  setNotice('');

  try {
    const payload = {
      steps,
      industry: el('industryInput')?.value?.trim() || 'SaaS',
      period:   el('periodInput')?.value?.trim()   || 'Last 30 days'
    };
    const result = await api.analyze(payload);
    state.latestResult = result;

    // Compute local diagnosis from step data
    const { computeDiagnosis } = await import('./funnel-diagnosis.js');
    const rawSteps = (result.funnel?.steps ?? steps).map((s) => ({
      label: s.label,
      value: Number(s.value ?? s.value) || 0
    }));
    state.diagnosis = computeDiagnosis(rawSteps);

    // Merge server metrics into diagnosis step data
    if (state.diagnosis && result.funnel?.steps) {
      const serverSteps = result.funnel.steps;
      const maxVal      = Math.max(...serverSteps.map((s) => s.value), 1);
      state.diagnosis.stepData = state.diagnosis.stepData.map((sd, i) => ({
        ...sd,
        convFromPrev: i === 0 ? 100 : ((serverSteps[i]?.value ?? 0) / (serverSteps[i - 1]?.value || 1)) * 100,
        conversionFromTop: serverSteps[i] ? (serverSteps[i].value / maxVal) * 100 : 0
      }));
    }

    // Merge AI text insights
    const aiAnalysis = result.analysis ?? {};
    if (state.diagnosis) {
      state.diagnosis.aiInsights = aiAnalysis;
    }

    renderDiagnosis(state.diagnosis, result);
    await renderViz(state.diagnosis.stepData);
    // Push funnel context to CA chat
    setFunnelContext(state.diagnosis);
    _updateChatContextBar(true);
    await loadHistory();
    updateUsageAfter(result);
    setNotice('Diagnosis complete ✓', 'ok');

  } catch (err) {
    console.error('[FS] runAnalyze:', err);
    if (err.status === 429) openUpgradeModal();
    else setNotice(err.message ?? 'Analysis failed. Please retry.', 'err');
  } finally {
    setBtnLoading(btn, false);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Render diagnosis panel
// ─────────────────────────────────────────────────────────────────────────────
function renderDiagnosis(diag, result) {
  if (!diag) return;
  // fmt / pct / money are defined as module-level functions below — use them directly

  // Show panel
  const panel = el('diagnosisPanel');
  if (panel) panel.hidden = false;

  // Summary header
  const icons = { Good: '🟢', Warning: '🟡', Critical: '🔴' };
  const icon  = el('diagHealthIcon');
  const badge = el('healthBadge');
  if (icon)  icon.textContent  = icons[diag.health] ?? '🔴';
  if (badge) { badge.textContent = diag.health; badge.className = `health-badge ${diag.health}`; }

  const summary = el('diagSummaryText');
  if (summary) summary.textContent = diag.diagnosisSummary;

  const setEl = (id, v) => { const e = el(id); if (e) e.textContent = v; };
  setEl('diagConv',  Number(diag.overallConversion ?? 0).toFixed(1) + '%');
  setEl('diagScore', (diag.healthScore ?? 0) + '/100');
  setEl('diagLoss',  '$' + Number(diag.potentialMonthlyLoss ?? 0).toLocaleString() + '/mo');

  // Step breakdown
  const breakdown = el('stepBreakdown');
  if (breakdown) {
    breakdown.innerHTML = diag.stepData.map((s, i) => {
      const sev     = s.severity;
      const convCls = sev === 'healthy' ? 'good' : sev === 'warning' ? 'med' : 'bad';
      const dropLbl = i === 0 ? '' : `↓ ${s.dropPct.toFixed(1)}%`;
      return `
        <div class="sb-row ${sev}">
          <div>
            <div class="sb-name">${esc(s.label)}</div>
            ${i > 0 && s.rootCause
              ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;line-height:1.4">${esc(s.rootCause.slice(0, 80))}…</div>`
              : ''}
          </div>
          <span class="sb-users">${Number(s.value).toLocaleString()}</span>
          <span class="sb-conv ${convCls}">${s.convFromPrev?.toFixed(1) ?? 100}%</span>
          <span class="sb-drop ${s.isBiggestDrop ? 'big-drop' : ''}">${dropLbl}</span>
          <span class="sb-indicator ${sev}"></span>
        </div>`;
    }).join('');
  }

  // Root cause analysis — worst 3 non-healthy steps
  const worstSteps = diag.stepData.filter((s) => s.severity !== 'healthy' && s.rootCause);
  const rcSection  = el('rootCauseSection');
  const rcContainer = el('rootCauses');
  if (rcSection && rcContainer) {
    rcSection.hidden = worstSteps.length === 0;
    rcContainer.innerHTML = worstSteps.slice(0, 3).map((s) => `
      <div class="rc-item">
        <span class="rc-step">${esc(s.label)}</span>
        <span class="rc-text">${esc(s.rootCause)}</span>
      </div>`).join('');
  }

  // AI-enhanced root cause (if server returned markdown)
  if (result?.analysis?.criticalLeak && rcContainer) {
    rcContainer.innerHTML += `
      <div class="rc-item" style="border-color:rgba(108,71,255,.35);background:rgba(108,71,255,.06)">
        <span class="rc-step">AI</span>
        <span class="rc-text">${renderMd(result.analysis.criticalLeak)}</span>
      </div>`;
  }

  // Actionable fixes
  const fixSection   = el('fixesSection');
  const fixContainer = el('fixesDiag');
  const allFixes     = diag.topFixes ?? [];

  // Append AI fixes if available
  if (result?.analysis?.fixes) {
    const aiFixes = Array.isArray(result.analysis.fixes)
      ? result.analysis.fixes
      : String(result.analysis.fixes).split('\n').filter(Boolean);
    aiFixes.slice(0, 3).forEach((f) => {
      if (!allFixes.includes(f)) allFixes.push(f);
    });
  }

  if (fixSection && fixContainer) {
    fixSection.hidden = allFixes.length === 0;
    fixContainer.innerHTML = allFixes.slice(0, 5).map((f) => `<li>${esc(f)}</li>`).join('');
  }

  // Hide welcome, scroll to viz
  const ws = el('welcomeState');
  if (ws) ws.hidden = true;
  const vp = el('vizPanel');
  if (vp) vp.hidden = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3D Visualisation
// ─────────────────────────────────────────────────────────────────────────────
async function renderViz(stepData) {
  try {
    const { Funnel3D } = await import('./scene-funnel3d.js');
    if (!state.funnel3d) state.funnel3d = new Funnel3D('funnel3dContainer');
    state.funnel3d.render(stepData);

    // Dismiss welcome scene
    if (state.welcomeScene) { try { state.welcomeScene(); } catch {} state.welcomeScene = null; }

    const vp = el('vizPanel');
    if (vp) vp.hidden = false;
    const vm = el('vizMeta');
    if (vm) vm.textContent = `${stepData.length} steps · ${new Date().toLocaleTimeString()}`;

  } catch (err) {
    console.warn('[FS] renderViz:', err.message);
    // Graceful fallback table
    const c = el('funnel3dContainer');
    if (c) {
      c.innerHTML = `<div style="padding:20px">
        ${(stepData ?? []).map((s) => `
          <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
            <span>${esc(s.label)}</span>
            <span>${Number(s.value).toLocaleString()}</span>
          </div>`).join('')}
      </div>`;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Compare
// ─────────────────────────────────────────────────────────────────────────────
async function runCompare(previousId, currentSteps) {
  try {
    const data = await api.compare({ currentSteps, previousId });
    renderComparison(data);
    const cs = el('compareSection');
    if (cs) { cs.hidden = false; cs.scrollIntoView({ behavior: 'smooth' }); }
  } catch (err) { setNotice('Comparison failed: ' + err.message, 'err'); }
}

function renderComparison(data) {
  const c  = data.comparison ?? {};
  const cc = c.conversionChange ?? {};
  const cs = el('compareStatus');
  if (cs) cs.textContent = c.direction === 'up' ? '↑ Improved' : c.direction === 'down' ? '↓ Declined' : '→ Flat';
  const cards = el('compareCards');
  if (cards) {
    cards.innerHTML = `
      <div class="compare-card glass"><div class="c-label">Previous</div><div class="c-value">${pct(cc.previous)}</div><div class="c-sub">${fmtDate(data.previous?.createdAt)}</div></div>
      <div class="compare-card glass"><div class="c-label">Current</div><div class="c-value">${pct(cc.current)}</div><div class="c-sub">Now</div></div>
      <div class="compare-card glass"><div class="c-label">Delta</div><div class="c-value" style="color:${
        c.direction === 'up' ? 'var(--success)' : c.direction === 'down' ? 'var(--danger)' : 'var(--text)'}">${
        cc.points > 0 ? '+' : ''}${pct(cc.points)}</div><div class="c-sub">${esc(c.summary ?? '')}</div></div>`;
  }
  const sc = el('stepChanges');
  if (sc) sc.innerHTML = (c.stepChanges ?? []).map((s) => `
    <div class="step-change-card glass">
      <div class="sc-label">${esc(s.label)}</div>
      <div class="sc-value">${fmt(s.currentValue)}</div>
      <div class="sc-delta ${s.direction}">${s.direction === 'up' ? '↑' : s.direction === 'down' ? '↓' : '→'} ${s.relativeChange != null ? Math.abs(s.relativeChange).toFixed(1) + '%' : '—'}</div>
    </div>`).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Upgrade modal
// ─────────────────────────────────────────────────────────────────────────────
function openUpgradeModal() {
  const m = el('upgradeModal');
  if (!m) return;
  m.removeAttribute('hidden');      // clear HTML hidden attr if present
  m.classList.add('is-open');       // trigger CSS display:flex
  document.body.style.overflow = 'hidden'; // prevent scroll behind modal
}
function closeUpgradeModal() {
  const m = el('upgradeModal');
  if (!m) return;
  m.classList.remove('is-open');
  document.body.style.overflow = '';
}

function openCheckout(_plan) {
  closeUpgradeModal();
  showToast('Payment integration coming soon. Contact support to upgrade.', 'info');
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat panel wiring
// ─────────────────────────────────────────────────────────────────────────────
function _initChatPanel() {
  if (state.chatInited) return;
  state.chatInited = true;

  const user   = getUser();
  const toggle = el('caPanelToggle');
  const close  = el('caCloseBtn');
  const panel  = el('caPanel');

  // Init chat module
  initChat({
    userId:        user?.id ?? 'anonymous',
    onUpgradeClick: openUpgradeModal
  });

  // Toggle open/close
  function openPanel() {
    panel?.classList.add('ca-panel--open');
    toggle?.classList.add('is-open');
    markChatSeen();
  }
  function closePanel() {
    panel?.classList.remove('ca-panel--open');
    toggle?.classList.remove('is-open');
  }

  on(toggle, 'click', () => {
    const isOpen = panel?.classList.contains('ca-panel--open');
    isOpen ? closePanel() : openPanel();
  });
  on(close, 'click', closePanel);

  // Limit overlay buttons
  on(el('caLimitUpgradeBtn'), 'click', () => {
    clearLimitOverlay();
    openUpgradeModal();
  });
  on(el('caLimitDismiss'), 'click', () => {
    clearLimitOverlay();
  });
}

function _updateChatContextBar(hasContext) {
  const bar  = el('caCtxBar');
  const text = el('caCtxText');
  if (!bar || !text) return;
  if (hasContext) {
    bar.classList.remove('no-ctx');
    text.textContent = 'Funnel loaded — ask your CA anything';
  } else {
    bar.classList.add('no-ctx');
    text.textContent = 'No funnel loaded — run a diagnosis first';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Event binding
// ─────────────────────────────────────────────────────────────────────────────
function bindEvents() {
  on(el('addStepBtn'), 'click', () => {
    const steps = collectSteps();
    if (steps.length >= 8) return showToast('Max 8 steps.', 'error');
    steps.push({ label: '', value: '' });
    renderStepInputs(steps);
  });

  on(el('stepRows'), 'click', (e) => {
    if (!e.target.matches('.remove-step')) return;
    const steps = collectSteps();
    if (steps.length <= 2) return showToast('Min 2 steps required.', 'error');
    steps.splice(Number(e.target.dataset.idx), 1);
    renderStepInputs(steps);
  });

  on(el('funnelForm'), 'submit', (e) => { e.preventDefault(); runAnalyze(); });

  on(el('historyList'), 'click', async (e) => {
    const btn    = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action, id = btn.dataset.id;
    if (!action || !id) return;
    if (action === 'delete') {
      if (!confirm('Delete this analysis?')) return;
      try { await api.deleteOne(id); await loadHistory(); } catch (err) { showToast(err.message, 'error'); }
    }
    if (action === 'load') {
      const item = state.history.find((h) => h.id === id);
      if (item?.steps) { renderStepInputs(item.steps.map((s) => ({ label: s.label, value: String(s.value) }))); showToast('Steps loaded.', 'info'); }
    }
    if (action === 'compare') {
      const steps = collectSteps();
      if (steps.length < 2) return showToast('Build a funnel first.', 'error');
      await runCompare(id, steps);
    }
  });

  on(el('refreshBtn'),   'click', loadHistory);
  on(el('deleteAllBtn'), 'click', async () => {
    if (!confirm('Delete ALL history?')) return;
    try { await api.deleteAll(); await loadHistory(); showToast('History cleared.', 'info'); }
    catch (err) { showToast(err.message, 'error'); }
  });

  on(el('userBtn'), 'click', (e) => {
    e.stopPropagation();
    const d = el('userDropdown');
    if (!d) return;
    d.hidden = !d.hidden;
    el('userBtn')?.setAttribute('aria-expanded', String(!d.hidden));
  });
  document.addEventListener('click', () => { const d = el('userDropdown'); if (d) d.hidden = true; });

  on(el('logoutBtn'), 'click', async () => {
    try { await api.logout(); } catch (e) { console.warn('[FS] logout:', e.message); }
    clearSession(); window.location.replace('/auth.html');
  });

  on(el('upgradeBtn'),      'click', openUpgradeModal);
  on(el('limitUpgradeBtn'), 'click', openUpgradeModal);

  // Close via × button (by id)
  on(el('modalClose'), 'click', closeUpgradeModal);

  // Close via × button (by class — fallback in case id not set)
  document.querySelector('.modal-close')?.addEventListener('click', closeUpgradeModal);

  // Close by clicking outside the modal card (backdrop click)
  on(el('upgradeModal'), 'click', (e) => {
    if (e.target === el('upgradeModal') || e.target.classList.contains('modal-overlay')) {
      closeUpgradeModal();
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeUpgradeModal();
  });
  el('upgradeModal')?.querySelectorAll('[data-plan]').forEach((btn) => {
    btn.addEventListener('click', () => openCheckout(btn.dataset.plan));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────────────────
function updateUsageAfter(result) {
  if (result.isPro) return;
  const lb = el('limitBanner'), lt = el('limitText');
  if (!lb || !lt) return;
  if ((result.usageRemaining ?? 1) <= 0) { lt.textContent = 'Daily limit reached.'; lb.hidden = false; }
  else if ((result.usageRemaining ?? 1) <= 1) { lt.textContent = '1 analysis remaining.'; lb.hidden = false; }
}
function setNotice(msg, type = '') {
  const n = el('formNotice'); if (!n) return;
  n.textContent = msg; n.className = `form-notice${type ? ' ' + type : ''}`;
}
function setBtnLoading(btn, on) {
  if (!btn) return; btn.classList.toggle('loading', on); btn.disabled = on;
}
function esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmt(v)    { return Number(v ?? 0).toLocaleString(); }
function pct(v)    { return Number(v ?? 0).toFixed(1) + '%'; }
function fmtDate(v){ return v ? new Date(v).toLocaleDateString() : ''; }
function renderMd(text) {
  return esc(text ?? '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
}
function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────
function start() {
  boot().catch((err) => {
    console.error('[FS] BOOT FAILED:', err);
    const n = document.getElementById('formNotice');
    if (n) { n.textContent = 'Startup error: ' + err.message; n.className = 'form-notice err'; }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
