import { getAdminClient } from './supabase-admin';

/**
 * Best-effort Telegram notification — optional feature (spec: "Telegram
 * notifications (optional)"). Never throws: a misconfigured or unreachable
 * bot must not block the activity/review flow that triggered it.
 */
export async function sendTelegramNotification(message: string): Promise<void> {
  try {
    const supabase = getAdminClient();
    const { data: settings } = await supabase
      .from('notification_settings')
      .select('telegram_bot_token, telegram_chat_id')
      .eq('id', true)
      .single();

    if (!settings?.telegram_bot_token || !settings?.telegram_chat_id) return;

    await fetch(`https://api.telegram.org/bot${settings.telegram_bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: settings.telegram_chat_id, text: message, parse_mode: 'HTML' }),
    });
  } catch {
    // Optional feature — swallow errors so notification delivery never
    // breaks the caller's main flow (activity completion, review decision).
  }
}
