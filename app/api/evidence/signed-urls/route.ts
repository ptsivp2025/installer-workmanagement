import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

const BUCKET = process.env.NEXT_PUBLIC_EVIDENCE_BUCKET || 'activity-evidence';
const SIGNED_URL_TTL_SECONDS = 300;

/**
 * Batches signed-URL creation for a set of storage paths so a list view can
 * render N thumbnails with one request instead of N — avoids downloading
 * full-size historical photos and avoids N round trips (spec §12, §22).
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { paths } = await request.json();
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 100) {
    return NextResponse.json({ error: 'paths must be a non-empty array of at most 100 entries.' }, { status: 400 });
  }

  const supabase = getAdminClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const urls: Record<string, string> = {};
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) urls[entry.path] = entry.signedUrl;
  }
  return NextResponse.json({ urls });
}
