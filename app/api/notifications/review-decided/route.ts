import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser } from '@/lib/server-auth';
import { sendTelegramMessages } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

/** Notifies the activity's linked personnel (activity_personnel.user_id)
 * once a review is approved or rejected. Personnel added as free text
 * (no linked account) simply don't receive one — there's no chat id to
 * send to. */
export async function POST(request: NextRequest) {
  const caller = await getSessionUser(request);
  if (!caller || !['admin', 'supervisor', 'reviewer'].includes(caller.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { reviewId } = await request.json();
  if (!reviewId) return NextResponse.json({ error: 'reviewId is required.' }, { status: 400 });

  const supabase = getAdminClient();

  const { data: review } = await supabase
    .from('form_reviews')
    .select('status, notes, activities(id, title, request_number)')
    .eq('id', reviewId)
    .single();
  if (!review) return NextResponse.json({ error: 'Review not found.' }, { status: 404 });

  const activity = (review as unknown as { activities: { id: string; title: string; request_number: string } | null }).activities;
  if (!activity) return NextResponse.json({ sent: 0 });

  const { data: personnel } = await supabase
    .from('activity_personnel')
    .select('users(telegram_chat_id)')
    .eq('activity_id', activity.id)
    .not('user_id', 'is', null);

  const chatIds = ((personnel ?? []) as unknown as { users: { telegram_chat_id: string | null } | null }[])
    .map(p => p.users?.telegram_chat_id)
    .filter((v): v is string => !!v);

  const icon = review.status === 'approved' ? '✅' : '❌';
  const text =
    `${icon} <b>Form Review ${review.status === 'approved' ? 'Approved' : 'Rejected'}</b>\n` +
    `${activity.title} (${activity.request_number})` +
    (review.notes ? `\nNote: ${review.notes}` : '');

  await sendTelegramMessages(chatIds, text);
  return NextResponse.json({ sent: chatIds.length });
}
