import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser } from '@/lib/server-auth';
import { sendTelegramNotification } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

// Fire-and-forget, called by the client right after iwm_review_activity()
// succeeds.
export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { reviewId } = await request.json();
  if (!reviewId) return NextResponse.json({ error: 'reviewId is required.' }, { status: 400 });

  const supabase = getAdminClient();
  const { data: settings } = await supabase.from('notification_settings').select('notify_on_review_decision').eq('id', true).single();
  if (!settings?.notify_on_review_decision) return NextResponse.json({ sent: false });

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
    `${activity?.activity_categories?.name ?? ''}: ${activity?.title ?? ''}\n` +
    `Project: ${activity?.projects?.name ?? ''} (${activity?.projects?.code ?? ''})\n` +
    `By: ${user.full_name ?? user.username}` +
    (review.notes ? `\nNotes: ${review.notes}` : '')
  );

  return NextResponse.json({ sent: true });
}
