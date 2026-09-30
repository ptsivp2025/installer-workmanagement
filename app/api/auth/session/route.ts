import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAdminClient } from '@/lib/supabase-admin';
import { issueDbToken } from '@/lib/db-token';
import { appSessionHours, isNativeAppRequest, setSessionCookie } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 3600 * 1000;

export async function GET(request: NextRequest) {
  const token = request.cookies.get('iwm_session')?.value;
  if (!token) return NextResponse.json({ user: null }, { status: 401 });

  const supabase = getAdminClient();
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const { data: session, error: sessionErr } = await supabase
    .from('user_sessions')
    .select('user_id, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  // The database not answering says nothing about the login. 401 here would
  // send someone with a perfectly good session to the login screen every
  // time the connection hiccups; 503 lets the app show "no connection" and
  // retry instead (app/providers.tsx).
  if (sessionErr) return NextResponse.json({ error: 'Session check unavailable.' }, { status: 503 });
  if (!session) return NextResponse.json({ user: null }, { status: 401 });

  if (new Date(session.expires_at) < new Date()) {
    await supabase.from('user_sessions').delete().eq('token_hash', tokenHash);
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('id, username, full_name, role, active')
    .eq('id', session.user_id)
    .maybeSingle();

  if (userErr) return NextResponse.json({ error: 'Session check unavailable.' }, { status: 503 });
  if (!user || !user.active) return NextResponse.json({ user: null }, { status: 401 });

  const profile = { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
  const response = NextResponse.json({ user: profile, db_token: issueDbToken(profile) });

  // Android app: slide the session forward on use (at most one write a day),
  // so it only ever ends by an explicit logout or a deactivated account.
  // This also lifts sessions created before the app got its longer lifetime.
  if (isNativeAppRequest(request)) {
    const appHours = await appSessionHours();
    const renewedUntil = Date.now() + appHours * 3600 * 1000;
    if (renewedUntil - new Date(session.expires_at).getTime() > DAY_MS) {
      const { error } = await supabase.from('user_sessions')
        .update({ expires_at: new Date(renewedUntil).toISOString() })
        .eq('token_hash', tokenHash);
      if (!error) setSessionCookie(response, token, appHours);
    }
  }

  return response;
}
