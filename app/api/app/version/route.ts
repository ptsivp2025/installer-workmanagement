import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/**
 * Which Android app version is current (Admin Panel → Aplikasi Android).
 * Public on purpose: the app's updater asks before anyone may be signed in,
 * and nothing here is secret. The APK itself is behind /api/app/download.
 */
export async function GET() {
  const { data } = await getAdminClient()
    .from('platform_settings')
    .select('app_version_code, app_version_name, app_release_notes, app_update_required, app_file_size, app_uploaded_at')
    .eq('id', true)
    .maybeSingle();
  if (!data?.app_version_code) return NextResponse.json({ error: 'No app release published yet.' }, { status: 404 });
  return NextResponse.json({
    versionCode: data.app_version_code,
    versionName: data.app_version_name ?? String(data.app_version_code),
    notes: data.app_release_notes ?? '',
    required: Boolean(data.app_update_required),
    size: data.app_file_size,
    uploadedAt: data.app_uploaded_at,
    apk: '/api/app/download',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
