import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { currentPassword, newPassword } = await request.json();
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    return NextResponse.json({ error: 'New password must be at least 8 characters.' }, { status: 400 });
  }

  const supabase = getAdminClient();
  const { data: cred } = await supabase.from('user_credentials').select('password_hash').eq('user_id', user.id).single();
  if (!cred?.password_hash || !(await bcrypt.compare(currentPassword, cred.password_hash))) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 });
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await supabase.from('user_credentials').update({ password_hash: newHash, updated_at: new Date().toISOString() }).eq('user_id', user.id);

  return NextResponse.json({ success: true });
}
