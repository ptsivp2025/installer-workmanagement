import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAdminClient } from '@/lib/supabase-admin';
import { issueDbToken } from '@/lib/db-token';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const token = request.cookies.get('iwm_session')?.value;
  if (!token) return NextResponse.json({ user: null }, { status: 401 });

  const supabase = getAdminClient();
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const { data: session } = await supabase
    .from('user_sessions')
    .select('user_id, expires_at')
    .eq('token_hash', tokenHash)
    .single();

  if (!session) return NextResponse.json({ user: null }, { status: 401 });

  if (new Date(session.expires_at) < new Date()) {
    await supabase.from('user_sessions').delete().eq('token_hash', tokenHash);
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const { data: user } = await supabase
    .from('users')
    .select('id, username, full_name, role, active')
    .eq('id', session.user_id)
    .single();

  if (!user || !user.active) return NextResponse.json({ user: null }, { status: 401 });

  const profile = { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
  return NextResponse.json({ user: profile, db_token: issueDbToken(profile) });
}
