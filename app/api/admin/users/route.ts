import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser } from '@/lib/server-auth';
import { ROLES } from '@/lib/constants';

export const dynamic = 'force-dynamic';

// users has no client INSERT policy (004_rls.sql — "accounts are
// provisioned via SQL"); this route is the in-app replacement for that SQL
// step, gated on the caller actually being admin (checked here, not just
// left to RLS, since the service-role client bypasses RLS entirely).
export async function POST(request: NextRequest) {
  const requester = await getSessionUser(request);
  if (!requester || requester.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { username, full_name, role, phone, email, position, password, sales_division_id } = await request.json();
  if (!username?.trim() || !full_name?.trim() || !password || password.length < 8) {
    return NextResponse.json({ error: 'Username, full name, and a password of at least 8 characters are required.' }, { status: 400 });
  }
  if (!ROLES.includes(role)) {
    return NextResponse.json({ error: 'Invalid role.' }, { status: 400 });
  }
  if (role === 'sales' && !sales_division_id) {
    return NextResponse.json({ error: 'A Sales Division user needs a division assigned.' }, { status: 400 });
  }

  const supabase = getAdminClient();
  const { data: user, error: userErr } = await supabase
    .from('users')
    .insert({
      username: username.trim(), full_name: full_name.trim(), role,
      phone: phone?.trim() || null, email: email?.trim() || null, position: position?.trim() || null,
      sales_division_id: role === 'sales' ? sales_division_id : null,
    })
    .select()
    .single();
  if (userErr) return NextResponse.json({ error: userErr.message }, { status: 400 });

  const passwordHash = await bcrypt.hash(password, 12);
  const { error: credErr } = await supabase.from('user_credentials').insert({ user_id: user.id, password_hash: passwordHash });
  if (credErr) {
    await supabase.from('users').delete().eq('id', user.id);
    return NextResponse.json({ error: credErr.message }, { status: 400 });
  }

  return NextResponse.json({ user });
}
