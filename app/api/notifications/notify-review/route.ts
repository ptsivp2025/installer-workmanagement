import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser } from '@/lib/server-auth';
import { sendTelegramNotification, esc } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

// Fire-and-forget, called by the client right after iwm_review_activity()
// succeeds.
export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { reviewId } = await request.json();
  if (!reviewId) return NextResponse.json({ error: 'reviewId is required.' }, { status: 400 });

  const supabase = getAdminClient();
  const { data: review } = await supabase
    .from('form_reviews')
    .select('status, notes, activities(title, projects(name, code), activity_categories(name))')
    .eq('id', reviewId)
    .single();

  if (!review || review.status === 'pending') return NextResponse.json({ sent: false });

  const activity = review.activities as unknown as { title: string; projects: { name: string; code: string } | null; activity_categories: { name: string } | null } | null;
  const icon = review.status === 'approved' ? '👍' : '👎';

  await sendTelegramNotification(
    `${icon} <b>Form Review ${review.status === 'approved' ? 'Approved' : 'Rejected'}</b>\n` +
    `${esc(activity?.activity_categories?.name)}: ${esc(activity?.title)}\n` +
    `Project: ${esc(activity?.projects?.name)} (${esc(activity?.projects?.code)})\n` +
    `By: ${esc(user.full_name ?? user.username)}` +
    (review.notes ? `\nNotes: ${esc(review.notes)}` : ''),
    'review_decision'
  );

  return NextResponse.json({ sent: true });
}
