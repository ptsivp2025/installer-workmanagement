import { getAdminClient } from './supabase-admin';

async function getBotToken(): Promise<string | null> {
  const supabase = getAdminClient();
  const { data } = await supabase.from('notification_settings').select('telegram_bot_token').eq('id', true).single();
  return data?.telegram_bot_token ?? null;
}

/**
 * Send the same message to an arbitrary list of chat ids, using the one
 * shared bot token (notification_settings). Used for per-user broadcasts
 * (e.g. every installer, or an activity's linked personnel) where the
 * destinations come from users.telegram_chat_id rather than an admin-
 * configured notification_groups row.
 */
export async function sendTelegramMessages(chatIds: string[], text: string): Promise<void> {
  if (!chatIds.length) return;
  try {
    const token = await getBotToken();
    if (!token) return;
    await Promise.all(chatIds.map(chatId =>
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
      }).catch(() => {})
    ));
  } catch {
    // Optional feature — never blocks the caller's main flow.
  }
}

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
