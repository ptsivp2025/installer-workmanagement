import type { NextRequest } from 'next/server';
import crypto from 'crypto';
import { getAdminClient } from './supabase-admin';

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
