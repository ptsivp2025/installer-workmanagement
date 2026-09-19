import { createClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client. This platform does not use Supabase Auth — a
 * custom bcrypt + httpOnly session cookie handles login (lib/auth.ts), so
 * auth.uid() inside RLS policies is always NULL. Instead, login issues a
 * short-lived JWT (lib/db-token.ts) carrying the user's identity as custom
 * claims; every PostgREST request below attaches it as a Bearer token so
 * RLS policies can read request.jwt.claims instead of USING (true).
 */
const TOKEN_KEY = 'iwm_db_token';

let dbToken: string | null =
  typeof window !== 'undefined' ? window.sessionStorage.getItem(TOKEN_KEY) : null;

export function setDbToken(token: string | null): void {
  dbToken = token;
  if (typeof window === 'undefined') return;
  if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
  else window.sessionStorage.removeItem(TOKEN_KEY);
}

export function getDbToken(): string | null {
  return dbToken;
}

/** Token expiry (epoch ms) read from the `exp` claim, for the refresh monitor. */
export function dbTokenExpiryMs(): number | null {
  if (!dbToken) return null;
  try {
    const payload = dbToken.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

let refreshInFlight: Promise<void> | null = null;

/** Re-issue the PostgREST token from the still-valid session cookie. */
export function refreshDbToken(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch('/api/auth/session', { credentials: 'include' });
      if (res.status === 401) {
        // The session cookie itself is gone or expired — nothing here can
        // recover that. Bounce to login instead of leaving the user on a
        // shell that will never load data and never say why.
        setDbToken(null);
        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
          window.location.replace('/login');
        }
        return;
      }
      if (!res.ok) return;
      const { db_token } = await res.json();
      if (db_token) setDbToken(db_token);
    } catch {
      /* offline — next scheduled check retries */
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

const fetchWithToken: typeof fetch = async (input, init) => {
  const send = () => {
    const headers = new Headers(init?.headers);
    if (dbToken) headers.set('Authorization', `Bearer ${dbToken}`);
    return fetch(input, { ...init, headers });
  };

  if (dbToken) {
    const exp = dbTokenExpiryMs();
    if (exp !== null && exp - Date.now() < 60_000) await refreshDbToken();
  } else {
    // The token lives in sessionStorage, which is per-tab: open the app in a
    // second tab, restore a closed one, or let the browser clear it, and the
    // session cookie is still perfectly valid while the PostgREST token is
    // gone. Without this, every query then goes out with only the anon key,
    // RLS matches nothing, and the app renders as an empty shell — logged in,
    // no data, no error anywhere to explain it. Mint one from the cookie.
    await refreshDbToken();
  }

  const res = await send();

  // An expired/rejected token is recoverable as long as the session cookie
  // is alive, so re-mint once and retry rather than surfacing a 401 the user
  // can do nothing with. refreshDbToken() de-dupes, so parallel requests
  // hitting this together share a single /api/auth/session call.
  if (res.status === 401 && dbToken) {
    const before = dbToken;
    await refreshDbToken();
    if (dbToken && dbToken !== before) return send();
  }

  return res;
};

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { global: { fetch: fetchWithToken }, auth: { persistSession: false } },
);
