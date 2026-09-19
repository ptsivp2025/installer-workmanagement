import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getAdminClient } from '@/lib/supabase-admin';
import { issueDbToken } from '@/lib/db-token';

export const dynamic = 'force-dynamic';

const SESSION_HOURS = 8;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

export async function POST(request: NextRequest) {
  const supabase = getAdminClient();
  const ip = getClientIp(request);

  try {
    const { username, password } = await request.json();
    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required.' }, { status: 400 });
    }

    // Brute-force lockout: strict per-username threshold, looser per-IP
    // threshold (an office typically shares one public IP via NAT).
    const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const [byUser, byIp] = await Promise.all([
      supabase.from('login_attempts').select('*', { count: 'exact', head: true })
        .eq('success', false).eq('username', username).gte('attempted_at', windowStart),
      ip !== 'unknown'
        ? supabase.from('login_attempts').select('*', { count: 'exact', head: true })
            .eq('success', false).eq('ip_address', ip).gte('attempted_at', windowStart)
        : Promise.resolve({ count: 0 } as { count: number | null }),
    ]);
    if ((byUser.count ?? 0) >= 5 || (byIp.count ?? 0) >= 30) {
      return NextResponse.json({ error: 'Too many failed attempts. Try again in 15 minutes.' }, { status: 429 });
    }

    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, username, full_name, role, active, approval_status, rejection_reason')
      .eq('username', username)
      .single();

    if (userErr || !user) {
      await supabase.from('login_attempts').insert({ username, ip_address: ip, success: false });
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 });
    }

    const { data: cred } = await supabase
      .from('user_credentials')
      .select('password_hash')
      .eq('user_id', user.id)
      .single();

    if (!cred?.password_hash || !(await bcrypt.compare(password, cred.password_hash))) {
      await supabase.from('login_attempts').insert({ username, ip_address: ip, success: false });
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 });
    }

    // Only AFTER the password checks out do we say anything specific about
    // the account's state — telling an anonymous caller "this one is pending
    // approval" before that would confirm the username exists to anyone
    // guessing. Someone who just registered knows their own password, so
    // they get the real reason; an attacker still only ever sees the
    // generic message above.
    if (user.approval_status === 'pending') {
      await supabase.from('login_attempts').insert({ username, ip_address: ip, success: false });
      return NextResponse.json({ error: 'PENDING_APPROVAL' }, { status: 403 });
    }
    if (user.approval_status === 'rejected') {
      await supabase.from('login_attempts').insert({ username, ip_address: ip, success: false });
      return NextResponse.json({ error: 'REGISTRATION_REJECTED', reason: user.rejection_reason ?? null }, { status: 403 });
    }
    if (!user.active) {
      await supabase.from('login_attempts').insert({ username, ip_address: ip, success: false });
      return NextResponse.json({ error: 'ACCOUNT_INACTIVE' }, { status: 403 });
    }

    await supabase.from('login_attempts').insert({ username, ip_address: ip, success: true });
    supabase.from('user_sessions').delete().lt('expires_at', new Date().toISOString()).then(() => {});

    const sessionToken = crypto.randomUUID() + '-' + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();

    await supabase.from('user_sessions').insert({
      user_id: user.id,
      token_hash: hashToken(sessionToken),
      ip_address: ip,
      user_agent: request.headers.get('user-agent') ?? '',
      expires_at: expiresAt,
    });

    const profile = { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
    const response = NextResponse.json({ user: profile, db_token: issueDbToken(profile) });
    response.cookies.set('iwm_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_HOURS * 3600,
      path: '/',
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'Login failed. Please try again.' }, { status: 500 });
  }
}
