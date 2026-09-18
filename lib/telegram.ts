import { getAdminClient } from './supabase-admin';

/**
 * Best-effort Telegram notification — optional feature. Never throws: a
 * misconfigured or unreachable bot must not block the activity/review flow
 * that triggered it. Sends to every active notification_groups row whose
 * relevant toggle is on (one bot, many chat destinations).
 */
export async function sendTelegramNotification(
  message: string,
  event: 'completion' | 'review_decision'
): Promise<void> {
  try {
    const supabase = getAdminClient();
    const toggleColumn = event === 'completion' ? 'notify_on_completion' : 'notify_on_review_decision';

    const [{ data: settings }, { data: groups }] = await Promise.all([
      supabase.from('notification_settings').select('telegram_bot_token').eq('id', true).single(),
      supabase.from('notification_groups').select('telegram_chat_id').eq('active', true).eq(toggleColumn, true),
    ]);

    const token = settings?.telegram_bot_token;
    if (!token || !groups?.length) return;

    await Promise.all(groups.map((g: { telegram_chat_id: string }) =>
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: g.telegram_chat_id, text: message, parse_mode: 'HTML' }),
      }).catch(() => {})
    ));
  } catch {
    // Optional feature — swallow errors so notification delivery never
    // breaks the caller's main flow (activity completion, review decision).
  }
}
