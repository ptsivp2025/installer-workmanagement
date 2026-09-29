import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getAdminClient } from '@/lib/supabase-admin';
import { issueDbToken } from '@/lib/db-token';
import { sessionHoursFor, setSessionCookie } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

const USER_COLUMNS = 'id, username, full_name, role, active, approval_status, rejection_reason';
interface LoginUser {
  id: string; username: string; full_name: string | null; role: string; active: boolean;
  approval_status: string | null; rejection_reason: string | null;
}

/**
 * Exact username first. Failing that, the same name in any letter case:
 * self-registration stores usernames lowercased but an admin-created account
 * keeps whatever was typed, and nobody remembers which. Only used when
 * exactly one account matches, so "Budi" and "budi" existing side by side
 * never log into the wrong one.
 */
async function findUser(username: string): Promise<LoginUser | null> {
  const supabase = getAdminClient();
  const { data: exact } = await supabase.from('users').select(USER_COLUMNS).eq('username', username).maybeSingle();
  if (exact) return exact as LoginUser;
  if (!/^[A-Za-z0-9._@-]+$/.test(username)) return null;
  const { data: rows } = await supabase.from('users').select(USER_COLUMNS)
    .ilike('username', username.replace(/_/g, '\\_')).limit(5);
  const matches = ((rows ?? []) as LoginUser[]).filter(u => u.username.toLowerCase() === username.toLowerCase());
  return matches.length === 1 ? matches[0] : null;
}

export async function POST(request: NextRequest) {
  const supabase = getAdminClient();
  const ip = getClientIp(request);

  try {
    const body = await request.json();
    // Phone keyboards capitalise the first letter and add a space after a
    // suggested word. Neither should make a correct login fail.
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = body.password;
    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required.' }, { status: 400 });
    }
    // One lockout counter per account, whatever case it was typed in.
    const attemptKey = username.toLowerCase();

    // Brute-force lockout: strict per-username threshold, looser per-IP
    // threshold (an office typically shares one public IP via NAT).
    const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const [byUser, byIp] = await Promise.all([
      supabase.from('login_attempts').select('*', { count: 'exact', head: true })
        .eq('success', false).eq('username', attemptKey).gte('attempted_at', windowStart),
      ip !== 'unknown'
        ? supabase.from('login_attempts').select('*', { count: 'exact', head: true })
            .eq('success', false).eq('ip_address', ip).gte('attempted_at', windowStart)
        : Promise.resolve({ count: 0 } as { count: number | null }),
    ]);
    if ((byUser.count ?? 0) >= 5 || (byIp.count ?? 0) >= 30) {
      return NextResponse.json({ error: 'Too many failed attempts. Try again in 15 minutes.' }, { status: 429 });
    }

    const user = await findUser(username);

    if (!user) {
      await supabase.from('login_attempts').insert({ username: attemptKey, ip_address: ip, success: false });
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 });
    }

    const { data: cred } = await supabase
      .from('user_credentials')
      .select('password_hash')
      .eq('user_id', user.id)
      .single();

    if (!cred?.password_hash || !(await bcrypt.compare(password, cred.password_hash))) {
      await supabase.from('login_attempts').insert({ username: attemptKey, ip_address: ip, success: false });
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 });
    }

    // Only AFTER the password checks out do we say anything specific about
    // the account's state — telling an anonymous caller "this one is pending
    // approval" before that would confirm the username exists to anyone
    // guessing. Someone who just registered knows their own password, so
    // they get the real reason; an attacker still only ever sees the
    // generic message above.
    if (user.approval_status === 'pending') {
      await supabase.from('login_attempts').insert({ username: attemptKey, ip_address: ip, success: false });
      return NextResponse.json({ error: 'PENDING_APPROVAL' }, { status: 403 });
    }
    if (user.approval_status === 'rejected') {
      await supabase.from('login_attempts').insert({ username: attemptKey, ip_address: ip, success: false });
      return NextResponse.json({ error: 'REGISTRATION_REJECTED', reason: user.rejection_reason ?? null }, { status: 403 });
    }
    if (!user.active) {
      await supabase.from('login_attempts').insert({ username: attemptKey, ip_address: ip, success: false });
      return NextResponse.json({ error: 'ACCOUNT_INACTIVE' }, { status: 403 });
    }

    await supabase.from('login_attempts').insert({ username: attemptKey, ip_address: ip, success: true });
    supabase.from('user_sessions').delete().lt('expires_at', new Date().toISOString()).then(() => {});

    const sessionHours = sessionHoursFor(request);
    const sessionToken = crypto.randomUUID() + '-' + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + sessionHours * 3600 * 1000).toISOString();

    await supabase.from('user_sessions').insert({
      user_id: user.id,
      token_hash: hashToken(sessionToken),
      ip_address: ip,
      user_agent: request.headers.get('user-agent') ?? '',
      expires_at: expiresAt,
    });

    const profile = { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
    const response = NextResponse.json({ user: profile, db_token: issueDbToken(profile) });
    setSessionCookie(response, sessionToken, sessionHours);
    return response;
  } catch {
    return NextResponse.json({ error: 'Login failed. Please try again.' }, { status: 500 });
  }
}
