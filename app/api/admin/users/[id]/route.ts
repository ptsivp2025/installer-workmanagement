import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser } from '@/lib/server-auth';
import { ROLES } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const requester = await getSessionUser(request);
  if (!requester || requester.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { full_name, role, phone, active, new_password, sales_division_id } = await request.json();
  const supabase = getAdminClient();

  const updates: Record<string, unknown> = {};
  if (full_name !== undefined) updates.full_name = String(full_name).trim();
  if (phone !== undefined) updates.phone = phone ? String(phone).trim() : null;
  if (active !== undefined) updates.active = Boolean(active);
  if (role !== undefined) {
    if (!ROLES.includes(role)) return NextResponse.json({ error: 'Invalid role.' }, { status: 400 });
    if (params.id === requester.id && role !== 'admin') {
      return NextResponse.json({ error: 'You cannot remove your own admin role.' }, { status: 400 });
    }
    if (role === 'sales' && !sales_division_id) {
      return NextResponse.json({ error: 'A Sales Division user needs a division assigned.' }, { status: 400 });
    }
    updates.role = role;
    updates.sales_division_id = role === 'sales' ? sales_division_id : null;
  }
  if (active === false && params.id === requester.id) {
    return NextResponse.json({ error: 'You cannot deactivate your own account.' }, { status: 400 });
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase.from('users').update(updates).eq('id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (new_password) {
    if (new_password.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
    const passwordHash = await bcrypt.hash(new_password, 12);
    const { error } = await supabase.from('user_credentials').update({ password_hash: passwordHash, updated_at: new Date().toISOString() }).eq('user_id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
