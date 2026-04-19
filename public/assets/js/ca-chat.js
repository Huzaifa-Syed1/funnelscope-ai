/**
 * ca-chat.js — AI Chartered Accountant Chat Module
 *
 * Responsibilities:
 *  - Chat UI rendering (messages, bubbles, typing indicator)
 *  - Suggested prompt chips
 *  - POST /chat with funnel context
 *  - Limit-hit upgrade modal
 *  - Chat history (session-only, no persistence needed)
 */

// ── State ─────────────────────────────────────────────────────
let _messages     = [];         // { role: 'user'|'ai', text, ts }
let _funnelCtx    = null;       // set by dashboard-main after each analysis
let _isLoading    = false;
let _userId       = null;       // Supabase user id for rate limiting
let _onUpgrade    = null;       // callback to open upgrade modal

// Suggested prompts — shown when no analysis has run yet and after one has
const PROMPTS_NO_FUNNEL = [
  'What is a good conversion rate for SaaS?',
  'How should I structure my funnel?',
  'What metrics matter most for growth?'
];

const PROMPTS_WITH_FUNNEL = [
  'Where am I losing the most money?',
  'How do I fix the biggest drop?',
  'What should I improve first?',
  'Estimate my monthly revenue loss',
  'Give me 3 specific fixes for this week'
];

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────
export function initChat({ userId, onUpgradeClick }) {
  _userId    = userId;
  _onUpgrade = onUpgradeClick;
  _renderMessages();
  _renderPrompts();
  _bindInputEvents();
  _showWelcome();
}

export function setFunnelContext(ctx) {
  _funnelCtx = ctx;
  _renderPrompts();  // refresh prompts now that we have data
  if (ctx) {
    _addMessage('ai',
      `I've loaded your funnel data. **${ctx.stepData?.length ?? 0} steps** analysed. ` +
      `Overall conversion: **${ctx.overallConversion?.toFixed(1) ?? '?'}%** ` +
      `(health score: **${ctx.healthScore ?? '?'}/100**). ` +
      `What would you like to dig into?`
    );
  }
}

// ─────────────────────────────────────────────────────────────
// DOM helpers
// ─────────────────────────────────────────────────────────────
function qs(sel, root = document) { return root.querySelector(sel); }

function _getChatElements() {
  return {
    panel:      document.getElementById('caPanel'),
    messages:   document.getElementById('caMessages'),
    input:      document.getElementById('caInput'),
    sendBtn:    document.getElementById('caSendBtn'),
    prompts:    document.getElementById('caPrompts'),
    toggle:     document.getElementById('caPanelToggle'),
    badge:      document.getElementById('caBadge')
  };
}

// ─────────────────────────────────────────────────────────────
// Welcome message
// ─────────────────────────────────────────────────────────────
function _showWelcome() {
  if (_messages.length > 0) return;
  _addMessage('ai',
    `Hello! I'm your **AI Chartered Accountant**. I can analyse your funnel, ` +
    `identify revenue leaks, estimate financial impact, and tell you exactly what to fix. ` +
    `Run a funnel diagnosis first, then ask me anything.`
  );
}

// ─────────────────────────────────────────────────────────────
// Message management
// ─────────────────────────────────────────────────────────────
function _addMessage(role, text) {
  _messages.push({ role, text, ts: Date.now() });
  _renderMessages();
}

function _renderMessages() {
  const el = document.getElementById('caMessages');
  if (!el) return;

  el.innerHTML = _messages.map((m) => `
    <div class="ca-msg ca-msg--${m.role}">
      ${m.role === 'ai' ? '<div class="ca-msg-avatar">CA</div>' : ''}
      <div class="ca-msg-bubble">${_renderMarkdown(m.text)}</div>
    </div>
  `).join('');

  // Auto-scroll to bottom
  el.scrollTop = el.scrollHeight;
}

function _showTyping() {
  const el = document.getElementById('caMessages');
  if (!el) return;
  const indicator = document.createElement('div');
  indicator.className = 'ca-msg ca-msg--ai ca-typing';
  indicator.id        = 'caTypingIndicator';
  indicator.innerHTML = `
    <div class="ca-msg-avatar">CA</div>
    <div class="ca-msg-bubble ca-typing-bubble">
      <span></span><span></span><span></span>
    </div>`;
  el.appendChild(indicator);
  el.scrollTop = el.scrollHeight;
}

function _hideTyping() {
  document.getElementById('caTypingIndicator')?.remove();
}

// ─────────────────────────────────────────────────────────────
// Suggested prompts
// ─────────────────────────────────────────────────────────────
function _renderPrompts() {
  const el = document.getElementById('caPrompts');
  if (!el) return;
  const prompts = _funnelCtx ? PROMPTS_WITH_FUNNEL : PROMPTS_NO_FUNNEL;
  el.innerHTML = prompts.map((p) => `
    <button class="ca-prompt-chip" data-prompt="${_esc(p)}">${_esc(p)}</button>
  `).join('');

  el.querySelectorAll('.ca-prompt-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const input = document.getElementById('caInput');
      if (input) { input.value = chip.dataset.prompt; input.focus(); }
      _send(chip.dataset.prompt);
    });
  });
}

// ─────────────────────────────────────────────────────────────
// Input events
// ─────────────────────────────────────────────────────────────
function _bindInputEvents() {
  const { input, sendBtn } = _getChatElements();

  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        _send(input.value);
      }
    });
    // Auto-resize textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      const input = document.getElementById('caInput');
      _send(input?.value ?? '');
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Send message
// ─────────────────────────────────────────────────────────────
async function _send(rawText) {
  const text  = rawText?.trim();
  if (!text || _isLoading) return;

  const input = document.getElementById('caInput');
  if (input) { input.value = ''; input.style.height = 'auto'; }

  _addMessage('user', text);
  _setLoading(true);
  _showTyping();

  try {
    const res = await fetch('/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        message:      text,
        funnelContext: _funnelCtx,
        userId:        _userId ?? 'anonymous'
      })
    });

    const data = await res.json();

    _hideTyping();

    // ── Limit hit ────────────────────────────────────────────
    if (res.status === 429 || data.limitReached) {
      _showLimitModal(data.retryAfter ?? 3600);
      return;
    }

    // ── API error ─────────────────────────────────────────────
    if (!res.ok) {
      _addMessage('ai', `⚠️ ${data.error ?? 'Something went wrong. Please try again.'}`);
      return;
    }

    // ── Success ───────────────────────────────────────────────
    _addMessage('ai', data.reply);
    _updateBadge();

  } catch (err) {
    _hideTyping();
    console.error('[CA Chat] fetch error:', err.message);
    _addMessage('ai', '⚠️ Network error. Please check your connection and try again.');
  } finally {
    _setLoading(false);
  }
}

// ─────────────────────────────────────────────────────────────
// Loading state
// ─────────────────────────────────────────────────────────────
function _setLoading(on) {
  _isLoading = on;
  const sendBtn = document.getElementById('caSendBtn');
  const input   = document.getElementById('caInput');
  if (sendBtn) { sendBtn.disabled = on; sendBtn.classList.toggle('loading', on); }
  if (input)   { input.disabled   = on; }
}

// ─────────────────────────────────────────────────────────────
// Limit hit modal
// ─────────────────────────────────────────────────────────────
function _showLimitModal(retryAfterSec) {
  // Blur the chat panel
  const msgs = document.getElementById('caMessages');
  if (msgs) msgs.classList.add('ca-blurred');

  // Show the dedicated limit overlay
  const overlay = document.getElementById('caLimitOverlay');
  if (overlay) {
    overlay.hidden = false;
    const hours = Math.ceil(retryAfterSec / 3600);
    const el    = overlay.querySelector('.ca-limit-hours');
    if (el) el.textContent = hours <= 1 ? 'about an hour' : `${hours} hours`;
  }

  // Also trigger the main upgrade modal if callback set
  if (_onUpgrade) {
    setTimeout(_onUpgrade, 400);
  }
}

export function clearLimitOverlay() {
  const msgs    = document.getElementById('caMessages');
  const overlay = document.getElementById('caLimitOverlay');
  if (msgs)    msgs.classList.remove('ca-blurred');
  if (overlay) overlay.hidden = true;
}

// ─────────────────────────────────────────────────────────────
// Badge (new message indicator when panel is closed)
// ─────────────────────────────────────────────────────────────
let _lastSeenCount = 0;

function _updateBadge() {
  const badge  = document.getElementById('caBadge');
  const panel  = document.getElementById('caPanel');
  const isOpen = panel && !panel.classList.contains('ca-panel--collapsed');
  if (isOpen) { _lastSeenCount = _messages.length; if (badge) badge.hidden = true; return; }
  const unseen = _messages.length - _lastSeenCount;
  if (badge) { badge.hidden = unseen <= 0; badge.textContent = unseen; }
}

export function markChatSeen() {
  _lastSeenCount = _messages.length;
  const badge = document.getElementById('caBadge');
  if (badge) badge.hidden = true;
}

// ─────────────────────────────────────────────────────────────
// Markdown renderer (minimal — bold, newlines, numbered lists)
// ─────────────────────────────────────────────────────────────
function _renderMarkdown(text) {
  return _esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/`(.+?)`/g,       '<code>$1</code>')
    .replace(/^\d+\.\s/gm,     (m) => `<span class="ca-list-num">${m}</span>`)
    .replace(/\n/g,            '<br>');
}

function _esc(v) {
  return String(v ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
