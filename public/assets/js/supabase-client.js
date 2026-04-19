/**
 * supabase-client.js
 *
 * Initialises the Supabase JS client from config stored in a
 * <meta name="supabase-url"> and <meta name="supabase-key"> tag
 * in the HTML head — keeps secrets out of source code while
 * allowing the user to configure their project without a build step.
 *
 * HOW TO CONFIGURE (add to <head> of index.html and auth.html):
 *   <meta name="supabase-url" content="https://xxxx.supabase.co">
 *   <meta name="supabase-key" content="your-anon-public-key">
 *
 * The anon/public key is safe to expose in client-side code.
 * Never put your service_role key here.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

function readMeta(name) {
  return document.querySelector(`meta[name="${name}"]`)?.content?.trim() ?? '';
}

const SUPABASE_URL = readMeta('supabase-url');
const SUPABASE_KEY = readMeta('supabase-key');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    '[Supabase] Missing configuration. Add to your HTML <head>:\n' +
    '  <meta name="supabase-url" content="https://xxxx.supabase.co">\n' +
    '  <meta name="supabase-key" content="your-anon-public-key">'
  );
}

export const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession:    true,
        autoRefreshToken:  true,
        detectSessionInUrl: true
      }
    })
  : null;

/**
 * Returns the currently signed-in user, or null.
 * Always uses getUser() (server-verified) not just the local session.
 */
export async function getCurrentUser() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    console.error('[Supabase] getUser error:', error.message);
    return null;
  }
  return data.user ?? null;
}

/**
 * Returns the current session, or null.
 */
export async function getSession() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('[Supabase] getSession error:', error.message);
    return null;
  }
  return data.session ?? null;
}
