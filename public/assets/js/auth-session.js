/**
 * auth-session.js — Supabase-backed session manager
 *
 * Replaces the previous dual-JWT implementation.
 * Supabase handles token storage, refresh, and persistence automatically.
 * This module is a thin wrapper so the rest of the app (dashboard-main.js)
 * doesn't need to change its call sites.
 */
import { supabase, getCurrentUser, getSession } from './supabase-client.js';

// ── Simple in-memory user cache ───────────────────────────────
let _cachedUser = null;

export function getUser() {
  // Try memory cache first, then localStorage fallback
  if (_cachedUser) return _cachedUser;
  try {
    return JSON.parse(localStorage.getItem('fs_user') ?? 'null');
  } catch {
    return null;
  }
}

export function getAccessToken() {
  // Supabase stores the token internally; callers that need it
  // can use getSession() from supabase-client.js directly.
  // Return null here — the api.js layer reads it from Supabase.
  return null;
}

export function clearSession() {
  _cachedUser = null;
  localStorage.removeItem('fs_user');
  if (supabase) supabase.auth.signOut().catch(() => {});
}

export function hasSession() {
  return !!getUser();
}

export function localIsPro() {
  return getUser()?.isPro === true;
}

export function saveSession({ user } = {}) {
  if (user) {
    _cachedUser = user;
    localStorage.setItem('fs_user', JSON.stringify(user));
  }
}

/**
 * bootstrapSession — called on every page load.
 * Restores the Supabase session (auto-refresh handled by SDK).
 * Returns true if a valid user session exists.
 */
export async function bootstrapSession() {
  if (!supabase) {
    console.error('[Auth] Supabase not initialised — add meta tags to HTML');
    return false;
  }

  const session = await getSession();
  if (!session) return false;

  const user = await getCurrentUser();
  if (!user) return false;

  _cachedUser = {
    id:    user.id,
    name:  user.user_metadata?.name ?? user.email?.split('@')[0] ?? 'User',
    email: user.email,
    plan:  user.user_metadata?.plan ?? 'free',
    isPro: (user.user_metadata?.plan ?? 'free') === 'pro'
  };
  localStorage.setItem('fs_user', JSON.stringify(_cachedUser));
  return true;
}
