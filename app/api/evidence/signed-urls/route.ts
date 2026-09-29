import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAdminClient, noStoreFetch } from '@/lib/supabase-admin';
import { getSessionUser } from '@/lib/server-auth';
import { issueDbToken } from '@/lib/db-token';

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

  // Signing uses the service role, which sees every file. So first narrow
  // the request to paths belonging to evidence rows this user may read, by
  // asking PostgREST *as them* so activity_evidence_select (RLS) decides.
  // Before this, any logged-in account, a Sales guest included, could get
  // a working link to any photo whose path it knew.
  const token = issueDbToken(user);
  if (!token) return NextResponse.json({ error: 'Server auth is not configured.' }, { status: 500 });
  const asUser = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: noStoreFetch },
  });
  // Paths are "<activity_id>/<file>.jpg" (lib/evidence.ts), so look rows up
  // by activity: a short query even for a 100-photo progress page.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const activityIds = Array.from(new Set(
    (paths as unknown[]).filter((p): p is string => typeof p === 'string').map(p => p.split('/')[0]).filter(id => UUID.test(id)),
  ));
  if (activityIds.length === 0) return NextResponse.json({ urls: {} });
  const { data: rows, error: rowsErr } = await asUser
    .from('activity_evidence')
    .select('storage_path, thumbnail_path')
    .in('activity_id', activityIds);
  if (rowsErr) return NextResponse.json({ error: rowsErr.message }, { status: 500 });

  const visible = new Set<string>();
  for (const r of (rows ?? []) as { storage_path: string; thumbnail_path: string | null }[]) {
    visible.add(r.storage_path);
    if (r.thumbnail_path) visible.add(r.thumbnail_path);
  }
  const allowed = (paths as string[]).filter(p => visible.has(p));
  if (allowed.length === 0) return NextResponse.json({ urls: {} });

  const supabase = getAdminClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(allowed, SIGNED_URL_TTL_SECONDS);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const urls: Record<string, string> = {};
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) urls[entry.path] = entry.signedUrl;
  }
  return NextResponse.json({ urls });
}
