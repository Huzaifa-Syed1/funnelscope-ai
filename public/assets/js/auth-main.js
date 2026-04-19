/**
 * auth-main.js — Login / Register page (Supabase-backed)
 *
 * Sign up:  supabase.auth.signUp()
 * Log in:   supabase.auth.signInWithPassword()
 * Session:  supabase.auth.getSession() + autoRefreshToken
 *
 * No backend calls. Supabase handles everything.
 */
import { supabase }         from './supabase-client.js';
import { bootstrapSession } from './auth-session.js';

// ── Helpers ───────────────────────────────────────────────────
function setMsg(id, text, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className   = `form-msg ${type}`;
}
function clearMsgs() {
  ['loginMsg', 'registerMsg'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.className = 'form-msg'; }
  });
}
function setLoading(btn, on) {
  if (!btn) return;
  btn.classList.toggle('loading', on);
  btn.disabled = on;
}

// ── Tab switching ─────────────────────────────────────────────
function showTab(targetId) {
  document.querySelectorAll('.auth-tab').forEach((t) => {
    const active = t.dataset.target === targetId;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });
  ['loginForm', 'registerForm'].forEach((fid) => {
    const form = document.getElementById(fid);
    if (form) form.hidden = fid !== targetId;
  });
  clearMsgs();
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  console.log('[Auth] init() — checking Supabase config');

  // ── Guard: Supabase must be configured ───────────────────
  if (!supabase) {
    const msg = 'Supabase not configured. Add <meta name="supabase-url"> and <meta name="supabase-key"> to auth.html.';
    console.error('[Auth]', msg);
    setMsg('loginMsg',    msg, 'error');
    setMsg('registerMsg', msg, 'error');
    return; // stop — forms won't work without Supabase
  }

  // ── Redirect if already signed in ────────────────────────
  // Use Supabase directly (not fs_user cache) to avoid stale-token loops.
  try {
    const { data } = await supabase.auth.getSession();
    console.log('[Auth] existing session:', data.session ? 'found' : 'none');
    if (data.session) {
      console.log('[Auth] Already signed in — redirecting to dashboard');
      window.location.replace('/index.html');
      return;
    }
  } catch (e) {
    console.warn('[Auth] getSession check failed:', e.message);
    // Non-fatal — continue showing the login form
  }

  // ── 3D background (lazy — auth works without it) ─────────
  try {
    const { mountAuthScene } = await import('./scene-auth.js');
    const canvas = document.getElementById('auth-canvas');
    if (canvas) {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      mountAuthScene('auth-canvas');
    }
  } catch (e) { console.warn('[Auth] 3D scene:', e.message); }

  // Tab from URL
  const mode = new URLSearchParams(location.search).get('mode') ?? 'login';
  showTab(mode === 'register' ? 'registerForm' : 'loginForm');

  // Tab clicks
  document.querySelectorAll('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => showTab(tab.dataset.target));
  });

  // Password toggles
  document.querySelectorAll('.pw-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.for);
      if (!input) return;
      input.type      = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? '👁' : '🙈';
    });
  });

  // ── Login form ────────────────────────────────────────────
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      console.log('[Auth] Login submitted');

      const btn      = document.getElementById('loginBtn');
      const email    = document.getElementById('loginEmail')?.value?.trim();
      const password = document.getElementById('loginPassword')?.value;

      if (!email)    return setMsg('loginMsg', 'Email is required.', 'error');
      if (!password) return setMsg('loginMsg', 'Password is required.', 'error');

      setLoading(btn, true);
      setMsg('loginMsg', '', '');

      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        console.log('[Auth] signInWithPassword result:', { session: !!data?.session, error: error?.message });

        if (error) throw error;
        if (!data.session) throw new Error('No session returned — check your Supabase email confirmation settings.');

        // Cache user profile so dashboard can display it immediately
        const u = data.session.user;
        const profile = {
          id:    u.id,
          name:  u.user_metadata?.name ?? u.email?.split('@')[0] ?? 'User',
          email: u.email,
          plan:  u.user_metadata?.plan ?? 'free',
          isPro: (u.user_metadata?.plan ?? 'free') === 'pro'
        };
        localStorage.setItem('fs_user', JSON.stringify(profile));

        setMsg('loginMsg', '✓ Signed in! Redirecting…', 'success');
        console.log('[Auth] Login success — redirecting to /index.html');
        setTimeout(() => window.location.replace('/index.html'), 600);

      } catch (err) {
        console.error('[Auth] login error:', err.message);
        setMsg('loginMsg', err.message ?? 'Login failed. Check your credentials.', 'error');
      } finally {
        setLoading(btn, false);
      }
    });
  }

  // ── Register form ─────────────────────────────────────────
  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      console.log('[Auth] Register submitted');

      const btn      = document.getElementById('registerBtn');
      const name     = document.getElementById('regName')?.value?.trim();
      const email    = document.getElementById('regEmail')?.value?.trim();
      const password = document.getElementById('regPassword')?.value;

      if (!name)               return setMsg('registerMsg', 'Name is required.', 'error');
      if (!email)              return setMsg('registerMsg', 'Email is required.', 'error');
      if (!password)           return setMsg('registerMsg', 'Password is required.', 'error');
      if (password.length < 8) return setMsg('registerMsg', 'Password must be at least 8 characters.', 'error');

      setLoading(btn, true);
      setMsg('registerMsg', '', '');

      try {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name, plan: 'free' }   // stored in user_metadata
          }
        });
        console.log('[Auth] signUp result:', { session: !!data?.session, user: !!data?.user, error: error?.message });

        if (error) throw error;

        if (data.session) {
          // Email confirmation disabled in Supabase project — session returned immediately
          const u = data.session.user;
          const profile = {
            id:    u.id,
            name:  u.user_metadata?.name ?? name,
            email: u.email,
            plan:  'free',
            isPro: false
          };
          localStorage.setItem('fs_user', JSON.stringify(profile));

          setMsg('registerMsg', '✓ Account created! Redirecting…', 'success');
          console.log('[Auth] Signup success (auto-confirm) — redirecting to /index.html');
          setTimeout(() => window.location.replace('/index.html'), 600);
        } else {
          // Email confirmation required (Supabase default)
          setMsg('registerMsg',
            '✓ Account created! Check your email to confirm your address, then log in.',
            'success');
          console.log('[Auth] Signup success — email confirmation required');
        }
      } catch (err) {
        console.error('[Auth] register error:', err.message);
        setMsg('registerMsg', err.message ?? 'Registration failed. Please try again.', 'error');
      } finally {
        setLoading(btn, false);
      }
    });
  }
}

// ── Entry point ───────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => init().catch(console.error));
} else {
  init().catch(console.error);
}



