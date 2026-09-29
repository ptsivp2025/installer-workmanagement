import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser, endOtherSessions } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

/** Admin sets a new password directly — no old-password check, unlike the
 * self-service /api/auth/change-password. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const caller = await getSessionUser(request);
  if (!caller || caller.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { password } = await request.json();
  if (!password || password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }

  const supabase = getAdminClient();
  const passwordHash = await bcrypt.hash(password, 12);
  const { error } = await supabase
    .from('user_credentials')
    .update({ password_hash: passwordHash, updated_at: new Date().toISOString() })
    .eq('user_id', params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // A reset usually means the old password is lost or known to someone
  // else. Sessions last up to a year in the Android app, so end them:
  // whoever held the old password is out now, not months from now.
  await endOtherSessions(request, params.id);
  // And the "forgot password" request that prompted this is answered.
  await supabase.from('password_reset_requests')
    .update({ status: 'resolved', resolved_by: caller.id, resolved_at: new Date().toISOString() })
    .eq('user_id', params.id).eq('status', 'pending');

  return NextResponse.json({ success: true });
}
