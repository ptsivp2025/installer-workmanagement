import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser } from '@/lib/server-auth';
import { sendTelegramNotification, esc } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

/** Tells the admin Telegram group a Sales account just asked for a project. */
export async function POST(request: NextRequest) {
  const caller = await getSessionUser(request);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { requestId } = await request.json().catch(() => ({}));
  if (!requestId) return NextResponse.json({ error: 'requestId is required.' }, { status: 400 });

  const supabase = getAdminClient();
  const { data: req } = await supabase.from('project_requests')
    .select('requested_by, project_name, customer_name, requested_date, status, sales_divisions(name)')
    .eq('id', requestId).single();
  // Only the person who filed it can trigger the notice, and only once it's real.
  if (!req || req.requested_by !== caller.id || req.status !== 'pending') {
    return NextResponse.json({ sent: false });
  }

  const division = (req as unknown as { sales_divisions: { name: string } | null }).sales_divisions;
  await sendTelegramNotification(
    `📥 <b>Permintaan Proyek baru</b>\n${esc(req.project_name)}` +
    (req.customer_name ? `\nPelanggan: ${esc(req.customer_name)}` : '') +
    `\nDivisi: ${esc(division?.name ?? '—')} · oleh ${esc(caller.full_name ?? caller.username)}` +
    (req.requested_date ? `\nTanggal diminta: ${req.requested_date}` : '') +
    `\nBuka menu Permintaan Proyek untuk menyetujui.`,
    'admin',
  );
  return NextResponse.json({ sent: true });
}
