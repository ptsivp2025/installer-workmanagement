import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const token = request.cookies.get('iwm_session')?.value;
  if (token) {
    const supabase = getAdminClient();
    await supabase.from('user_sessions').delete().eq('token_hash', crypto.createHash('sha256').update(token).digest('hex'));
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set('iwm_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}
