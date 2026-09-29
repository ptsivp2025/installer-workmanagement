import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser } from '@/lib/server-auth';
import { sendTelegramMessages, esc } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

/**
 * Best-effort Telegram notice when staff schedules a new activity. Goes to
 * the technicians assigned to it: the create form links them by account
 * (iwm_create_activity, 015). Only when nobody linked was assigned does it
 * fall back to the whole installer pool, so the job isn't silently missed.
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
    supabase.from('activity_personnel').select('user_id').eq('activity_id', activityId).not('user_id', 'is', null),
  ]);

  const assignedIds = ((recipients as { user_id: string }[]) ?? []).map(r => r.user_id);
  let userQuery = supabase.from('users').select('telegram_chat_id').eq('active', true).not('telegram_chat_id', 'is', null);
  userQuery = assignedIds.length > 0 ? userQuery.in('id', assignedIds) : userQuery.eq('role', 'installer');
  const { data: users } = await userQuery;

  if (!activity) return NextResponse.json({ error: 'Activity not found.' }, { status: 404 });

  const category = (activity as unknown as { activity_categories: { name: string } | null }).activity_categories;
  const project = (activity as unknown as { projects: { name: string } | null }).projects;

  const text =
    `📅 <b>New Activity Scheduled</b>\n` +
    `${esc(category?.name ?? 'Activity')}: ${esc(activity.title)}\n` +
    `Project: ${esc(project?.name ?? '—')}\n` +
    `Date: ${activity.scheduled_date}\n` +
    `Request #: ${esc(activity.request_number)}`;

  const chatIds = ((users as { telegram_chat_id: string | null }[]) ?? []).map(r => r.telegram_chat_id).filter((v): v is string => !!v);
  await sendTelegramMessages(chatIds, text);

  return NextResponse.json({ sent: chatIds.length });
}
