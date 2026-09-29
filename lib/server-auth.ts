import type { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAdminClient } from './supabase-admin';

// Browser: 30 days from login, so office staff don't sign in every morning.
// Android app: a year, renewed on every launch by /api/auth/session — an
// installer who keeps using the app is never sent back to the login screen
// (a surprise logout reads as "the app is broken" to someone not at home
// with phones). Deactivating the account still ends access on the very next
// request: getSessionUser, /api/auth/session and every RLS policy re-check
// users.active live.
export const WEB_SESSION_HOURS = 24 * 30;
export const APP_SESSION_HOURS = 24 * 365;

/** The Android app appends " IWMApp/<version>" to the WebView user agent (android/…/MainActivity.java). */
export function isNativeAppRequest(request: NextRequest): boolean {
  return (request.headers.get('user-agent') ?? '').includes(' IWMApp/');
}

export function sessionHoursFor(request: NextRequest): number {
  return isNativeAppRequest(request) ? APP_SESSION_HOURS : WEB_SESSION_HOURS;
}

/**
 * Ends every login of a user after a password change or reset, since a new
 * password is often a reaction to someone else knowing the old one. The
 * caller's own current login is kept, so changing your own password doesn't
 * sign you out of the page you did it on.
 */
export async function endOtherSessions(request: NextRequest, userId: string): Promise<void> {
  const token = request.cookies.get('iwm_session')?.value;
  let query = getAdminClient().from('user_sessions').delete().eq('user_id', userId);
  if (token) query = query.neq('token_hash', crypto.createHash('sha256').update(token).digest('hex'));
  await query;
}

export function setSessionCookie(response: NextResponse, token: string, hours: number): void {
  response.cookies.set('iwm_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: hours * 3600,
    path: '/',
  });
}

/**
 * Verifies the httpOnly session cookie server-side. Used by API routes that
 * need to know WHO is calling (not just "has a cookie") so they can check
 * role/ownership before mutating data — RLS is the last line of defense,
 * not the only one (spec §21).
 */
export interface SessionUser {
  id: string;
  username: string;
  full_name: string | null;
  role: string;
}

export async function getSessionUser(request: NextRequest): Promise<SessionUser | null> {
  const token = request.cookies.get('iwm_session')?.value;
  if (!token) return null;

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const supabase = getAdminClient();

  const { data: session } = await supabase
    .from('user_sessions')
    .select('user_id, expires_at')
    .eq('token_hash', tokenHash)
    .single();

  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) return null;

  const { data: user } = await supabase
    .from('users')
    .select('id, username, full_name, role')
    .eq('id', session.user_id)
    .eq('active', true)
    .single();

  return (user as SessionUser) ?? null;
}
