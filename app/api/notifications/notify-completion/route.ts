import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser } from '@/lib/server-auth';
import { sendTelegramNotification, esc } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

// Fire-and-forget, called by the client right after iwm_complete_activity()
// succeeds. Re-checks the activity is actually completed server-side rather
// than trusting the caller's claim — never used for authorization, just so
// a stray/duplicate call can't send a false "completed" message.
export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { activityId } = await request.json();
  if (!activityId) return NextResponse.json({ error: 'activityId is required.' }, { status: 400 });

  const supabase = getAdminClient();
  const { data: activity } = await supabase
    .from('activities')
    .select('title, status, scheduled_date, projects(name, code), activity_categories(name)')
    .eq('id', activityId)
    .single();

  if (!activity || activity.status !== 'completed') return NextResponse.json({ sent: false });

  const project = activity.projects as unknown as { name: string; code: string } | null;
  const category = activity.activity_categories as unknown as { name: string } | null;

  await sendTelegramNotification(
    `✅ <b>Activity Completed</b>\n` +
    `${esc(category?.name)}: ${esc(activity.title)}\n` +
    `Project: ${esc(project?.name)} (${esc(project?.code)})\n` +
    `By: ${esc(user.full_name ?? user.username)}`,
    'completion'
  );

  return NextResponse.json({ sent: true });
}
