/**
 * Minimal Telegram Bot API wrapper — server-only (needs TELEGRAM_BOT_TOKEN).
 * Best-effort: a failed send never throws, since a notification going out
 * should never block or fail the business action that triggered it.
 */
const API_BASE = 'https://api.telegram.org';

export async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return false;

  try {
    const res = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendTelegramMessages(chatIds: string[], text: string): Promise<void> {
  const unique = Array.from(new Set(chatIds.filter(Boolean)));
  await Promise.all(unique.map(id => sendTelegramMessage(id, text)));
}
