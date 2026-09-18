import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

/** Creates a user account — needs the service-role key (user_credentials has
 * no client INSERT policy by design) and bcrypt, so this can't be done from
 * the browser via RLS the way most of this app's writes are. */
export async function POST(request: NextRequest) {
  const caller = await getSessionUser(request);
  if (!caller || caller.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { username, full_name, role, phone, password, sales_division } = await request.json();
  if (!username?.trim() || !full_name?.trim() || !password || password.length < 8) {
    return NextResponse.json({ error: 'Username, full name, and a password of at least 8 characters are required.' }, { status: 400 });
  }
  if (!['admin', 'supervisor', 'installer', 'reviewer'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role.' }, { status: 400 });
  }

  const supabase = getAdminClient();

  const { data: user, error: userErr } = await supabase
    .from('users')
    .insert({
      username: username.trim().toLowerCase(), full_name: full_name.trim(), role,
      phone: phone?.trim() || null, sales_division: sales_division?.trim() || null,
    })
    .select('id, username, full_name, role, phone, active, telegram_chat_id, sales_division, created_at')
    .single();

  if (userErr) {
    const message = userErr.code === '23505' ? 'That username is already taken.' : userErr.message;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const { error: credErr } = await supabase.from('user_credentials').insert({ user_id: user.id, password_hash: passwordHash });
  if (credErr) {
    await supabase.from('users').delete().eq('id', user.id);
    return NextResponse.json({ error: credErr.message }, { status: 500 });
  }

  return NextResponse.json({ user });
}
