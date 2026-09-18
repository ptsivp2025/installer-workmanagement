import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser } from '@/lib/server-auth';
import { sendTelegramNotification } from '@/lib/telegram';

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
  const { data: settings } = await supabase.from('notification_settings').select('notify_on_completion').eq('id', true).single();
  if (!settings?.notify_on_completion) return NextResponse.json({ sent: false });

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
    `${category?.name ?? ''}: ${activity.title}\n` +
    `Project: ${project?.name ?? ''} (${project?.code ?? ''})\n` +
    `By: ${user.full_name ?? user.username}`
  );

  return NextResponse.json({ sent: true });
}
