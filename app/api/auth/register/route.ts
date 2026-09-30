import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAdminClient } from '@/lib/supabase-admin';
import { SELF_REGISTER_ROLES, accountTypeOf, isSalesRole, type AccountType } from '@/lib/constants';
import { getServerSetting } from '@/lib/server-settings';
import type { PositionOption } from '@/lib/settings';

export const dynamic = 'force-dynamic';

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

/**
 * Public self-registration, and never a live account: the row lands
 * active = false + approval_status = 'pending', which every RLS policy
 * already reads as "no access" (018), so an unapproved signup can
 * authenticate against nothing until the app admin approves it.
 *
 * The role is checked against a fixed list that never includes 'admin', and
 * against the account types the admin opened in Aturan Sistem: accepting
 * any client-supplied role here is how sign-up turns into self-promotion.
 */
export async function POST(request: NextRequest) {
  const supabase = getAdminClient();
  const ip = getClientIp(request);

  try {
    const body = await request.json();
    const username = String(body.username ?? '').trim().toLowerCase();
    const full_name = String(body.full_name ?? '').trim();
    const email = String(body.email ?? '').trim();
    const phone = String(body.phone ?? '').trim();
    const position = String(body.position ?? '').trim();
    const role = String(body.role ?? 'sales');
    const sales_division_id = isSalesRole(role) && body.sales_division_id ? String(body.sales_division_id) : null;
    const password = String(body.password ?? '');

    if (!(await getServerSetting<boolean>('register.enabled'))) {
      return NextResponse.json({ error: 'Self sign-up is closed.' }, { status: 403 });
    }
    const allowedTypes = await getServerSetting<AccountType[]>('register.account_types');
    if (!(SELF_REGISTER_ROLES as readonly string[]).includes(role) || !allowedTypes.includes(accountTypeOf(role))) {
      return NextResponse.json({ error: 'This account type cannot sign up here.' }, { status: 400 });
    }
    if (!username || !full_name || !email || !phone || !position || (isSalesRole(role) && !sales_division_id)) {
      return NextResponse.json({ error: 'All fields are required.' }, { status: 400 });
    }
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      return NextResponse.json({ error: 'Username must be 3–32 characters: letters, numbers, dot, dash or underscore.' }, { status: 400 });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
    }
    const positions = await getServerSetting<PositionOption[]>('master.positions');
    if (!positions.some(p => p.value === position)) {
      return NextResponse.json({ error: 'Invalid position.' }, { status: 400 });
    }

    // Rate limit by IP, reusing the login_attempts window — a registration
    // form is otherwise a free way to enumerate taken usernames.
    if (ip !== 'unknown') {
      const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await supabase.from('login_attempts').select('*', { count: 'exact', head: true })
        .eq('ip_address', ip).eq('username', '__register__').gte('attempted_at', windowStart);
      if ((count ?? 0) >= 10) {
        return NextResponse.json({ error: 'Too many registration attempts. Try again later.' }, { status: 429 });
      }
      await supabase.from('login_attempts').insert({ username: '__register__', ip_address: ip, success: true });
    }

    if (sales_division_id) {
      const { data: division } = await supabase.from('sales_divisions').select('id').eq('id', sales_division_id).eq('active', true).maybeSingle();
      if (!division) {
        return NextResponse.json({ error: 'Choose a valid Sales Division.' }, { status: 400 });
      }
    }

    const { data: existing } = await supabase.from('users').select('id').eq('username', username).maybeSingle();
    if (existing) {
      return NextResponse.json({ error: 'That username is already taken.' }, { status: 409 });
    }

    const { data: user, error: userErr } = await supabase
      .from('users')
      .insert({
        username, full_name, email, phone, position,
        role,
        sales_division_id,
        active: false,
        approval_status: 'pending',
        registered_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (userErr || !user) {
      return NextResponse.json({ error: userErr?.message ?? 'Registration failed.' }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const { error: credErr } = await supabase.from('user_credentials').insert({ user_id: user.id, password_hash: passwordHash });
    if (credErr) {
      // No credentials row means an account nobody can ever sign into and
      // an admin would approve blindly — drop it rather than leave it.
      await supabase.from('users').delete().eq('id', user.id);
      return NextResponse.json({ error: credErr.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Registration failed.' }, { status: 500 });
  }
}
