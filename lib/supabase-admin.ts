import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role client — server-only (API routes). Bypasses RLS, so every
 * caller of getAdminClient() is responsible for its own authorization
 * check before reading/writing. Never import this file from a Client
 * Component; the service role key must never reach the browser bundle.
 */
let cached: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase admin client misconfigured: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }
  cached = createClient(url, key, { auth: { persistSession: false }, global: { fetch: noStoreFetch } });
  return cached;
}

/**
 * Next.js 14 caches fetch() GETs made on the server (its Data Cache, which on
 * Vercel even outlives a redeploy), and supabase-js reads over GET. Left
 * alone, a session lookup, a password hash or a failed-login count could be
 * answered from that cache: a revoked session or deactivated account still
 * let in, a reset password not taking effect. Every server-side Supabase
 * call must see the database as it is now.
 */
export const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store' });
