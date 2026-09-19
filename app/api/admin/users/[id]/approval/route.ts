import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

/**
 * Approve or reject a self-registered account. Admin-only, and checked here
 * rather than left to RLS — this route uses the service-role client, which
 * bypasses RLS entirely.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const requester = await getSessionUser(request);
  if (!requester || requester.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { decision, rejection_reason } = await request.json();
  if (decision !== 'approved' && decision !== 'rejected') {
    return NextResponse.json({ error: 'Decision must be approved or rejected.' }, { status: 400 });
  }

  const supabase = getAdminClient();
  const { data: target } = await supabase.from('users').select('id, approval_status').eq('id', params.id).maybeSingle();
  if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  if (target.approval_status !== 'pending') {
    return NextResponse.json({ error: 'This registration was already decided.' }, { status: 400 });
  }

  const { error } = await supabase.from('users').update({
    approval_status: decision,
    // Approval is what makes the account usable at all; a rejection leaves
    // it inactive so the row stays as a record instead of being deleted.
    active: decision === 'approved',
    approved_by: requester.id,
    approved_at: new Date().toISOString(),
    rejection_reason: decision === 'rejected' ? (rejection_reason?.trim() || null) : null,
  }).eq('id', params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
