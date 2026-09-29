import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser } from '@/lib/server-auth';
import { APP_RELEASE_BUCKET, APP_RELEASE_FILE } from '@/lib/app-release';

export const dynamic = 'force-dynamic';

/**
 * The Android app, for signed-in users only: it carries the GPS signing key
 * (migration 026), so it isn't handed to the whole internet. Redirects to a
 * 5-minute signed link in the private bucket (migration 028).
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.redirect(new URL('/login?next=/dashboard', request.url));

  const supabase = getAdminClient();
  const { data: s } = await supabase.from('platform_settings').select('app_version_name').eq('id', true).maybeSingle();
  const fileName = `installer-wm-${s?.app_version_name ?? 'latest'}.apk`;
  const { data, error } = await supabase.storage.from(APP_RELEASE_BUCKET).createSignedUrl(APP_RELEASE_FILE, 300, { download: fileName });
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: 'The Android app is not available for download yet. Ask an admin.' }, { status: 404 });
  }
  return NextResponse.redirect(data.signedUrl);
}
