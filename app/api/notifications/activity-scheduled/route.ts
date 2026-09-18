import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser } from '@/lib/server-auth';
import { sendTelegramMessages } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

/**
 * Best-effort broadcast to every active installer with a linked Telegram
 * chat id when staff schedules a new activity. There's no per-activity
 * assignee at creation time (personnel get recorded during execution), so
 * this notifies the installer pool generally rather than one specific
 * person — see README for the reasoning.
 */
export async function POST(request: NextRequest) {
  const caller = await getSessionUser(request);
  if (!caller || !['admin', 'supervisor'].includes(caller.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { activityId } = await request.json();
  if (!activityId) return NextResponse.json({ error: 'activityId is required.' }, { status: 400 });

  const supabase = getAdminClient();

  const [{ data: activity }, { data: recipients }] = await Promise.all([
    supabase.from('activities')
      .select('title, scheduled_date, request_number, activity_categories(name), projects(name)')
      .eq('id', activityId)
      .single(),
    supabase.from('users').select('telegram_chat_id').eq('active', true).eq('role', 'installer').not('telegram_chat_id', 'is', null),
  ]);

  if (!activity) return NextResponse.json({ error: 'Activity not found.' }, { status: 404 });

  const category = (activity as unknown as { activity_categories: { name: string } | null }).activity_categories;
  const project = (activity as unknown as { projects: { name: string } | null }).projects;

  const text =
    `📅 <b>New Activity Scheduled</b>\n` +
    `${category?.name ?? 'Activity'}: ${activity.title}\n` +
    `Project: ${project?.name ?? '—'}\n` +
    `Date: ${activity.scheduled_date}\n` +
    `Request #: ${activity.request_number}`;

  const chatIds = ((recipients as { telegram_chat_id: string | null }[]) ?? []).map(r => r.telegram_chat_id).filter((v): v is string => !!v);
  await sendTelegramMessages(chatIds, text);

  return NextResponse.json({ sent: chatIds.length });
}
