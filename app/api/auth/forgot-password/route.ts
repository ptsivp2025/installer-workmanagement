import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { sendTelegramNotification, esc } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

/**
 * "Lupa password?" from the login page. There's no email service, so this
 * doesn't reset anything itself. It files a request for an admin (Admin
 * Panel → Users, plus a Telegram notice), and the admin sets a new password.
 *
 * Always answers the same way whether or not the username exists, so the
 * form can't be used to find out which accounts exist. One pending request
 * per username per hour, so it can't be used to spam the admins.
 */
export async function POST(request: NextRequest) {
  let body: { username?: unknown; contact?: unknown };
  try { body = await request.json(); } catch { body = {}; }
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase().slice(0, 64) : '';
  const contact = typeof body.contact === 'string' ? body.contact.trim().slice(0, 120) : '';
  if (!username) return NextResponse.json({ error: 'Username is required.' }, { status: 400 });

  const ok = NextResponse.json({ ok: true });
  const supabase = getAdminClient();

  const since = new Date(Date.now() - 3600 * 1000).toISOString();
  const { count } = await supabase.from('password_reset_requests')
    .select('*', { count: 'exact', head: true })
    .eq('username', username).eq('status', 'pending').gte('created_at', since);
  if ((count ?? 0) > 0) return ok;

  const { data: user } = await supabase.from('users').select('id, full_name').ilike('username', username).maybeSingle();

  const { error } = await supabase.from('password_reset_requests').insert({
    user_id: user?.id ?? null, username, contact: contact || null,
  });
  if (error) return NextResponse.json({ error: 'Could not send the request. Try again later.' }, { status: 500 });

  if (user) {
    await sendTelegramNotification(
      `🔑 <b>Permintaan reset password</b>\nUser: ${esc(user.full_name ?? username)} (${esc(username)})` +
      (contact ? `\nKontak: ${esc(contact)}` : '') + `\nBuka Panel Admin → Pengguna untuk mengatur password baru.`,
      'admin',
    );
  }
  return ok;
}
