'use client';

import { setDbToken, dbTokenExpiryMs, refreshDbToken } from './supabase';
import { SESSION_DURATION_MS } from './constants';

/**
 * Client-side session helpers.
 *
 * - AUTH token: httpOnly cookie set by /api/auth/login (never readable by JS).
 * - User PROFILE: sessionStorage (cleared on tab close — shorter exposure
 *   than localStorage, and naturally scoped to one browser tab).
 */
const SS_USER = 'iwm_user';
const SS_TIME = 'iwm_login_time';

export interface SessionUserProfile {
  id: string;
  username: string;
  full_name: string | null;
  role: string;
}

export function setSession(userData: SessionUserProfile): void {
  sessionStorage.setItem(SS_USER, JSON.stringify(userData));
  sessionStorage.setItem(SS_TIME, String(Date.now()));
}

export function clearSession(): void {
  sessionStorage.removeItem(SS_USER);
  sessionStorage.removeItem(SS_TIME);
  setDbToken(null);
  fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
}

export function getSession(): SessionUserProfile | null {
  try {
    const saved = sessionStorage.getItem(SS_USER);
    const savedTime = sessionStorage.getItem(SS_TIME);
    if (!saved) return null;
    if (savedTime && Date.now() - parseInt(savedTime, 10) > SESSION_DURATION_MS) {
      clearSession();
      return null;
    }
    return JSON.parse(saved) as SessionUserProfile;
  } catch {
    return null;
  }
}

/** Used on app load when sessionStorage is empty (page refresh / new tab). */
export async function verifySessionFromCookie(): Promise<SessionUserProfile | null> {
  try {
    const res = await fetch('/api/auth/session', { credentials: 'include' });
    if (!res.ok) return null;
    const { user, db_token } = await res.json();
    if (user) {
      setSession(user);
      setDbToken(db_token ?? null);
    }
    return user ?? null;
  } catch {
    return null;
  }
}

/** Refresh the PostgREST token if it's about to expire. Call periodically from a layout effect. */
export async function refreshDbTokenIfNeeded(thresholdMinutes = 15): Promise<void> {
  const exp = dbTokenExpiryMs();
  if (exp === null) return;
  if (exp - Date.now() < thresholdMinutes * 60 * 1000) await refreshDbToken();
}
