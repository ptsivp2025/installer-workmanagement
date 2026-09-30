import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-admin';
import { getSessionUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

/**
 * Admin-only permanent delete, for every list in the app. GET tells the
 * confirm dialog what would go with it (counts); POST does it.
 *
 * Runs with the service role on purpose: the "locked once completed"
 * guards (003) exist to stop field accounts rewriting history, and an admin
 * deleting a whole record — with its photos, GPS and reviews — is exactly
 * the thing they must not stand in the way of. The foreign keys cascade
 * (002/014/020/029); the photo files are removed from Storage here, since
 * the database can't. Every delete is written to the activity log.
 */
type Kind = 'project' | 'activity' | 'project_request' | 'user' | 'category' | 'division';
const KINDS: Kind[] = ['project', 'activity', 'project_request', 'user', 'category', 'division'];
const BUCKET = process.env.NEXT_PUBLIC_EVIDENCE_BUCKET || 'activity-evidence';

async function guard(request: NextRequest) {
  const me = await getSessionUser(request);
  if (!me || me.role !== 'admin') return { error: NextResponse.json({ error: 'Only the app admin may delete.' }, { status: 403 }) };
  return { me };
}

function parse(kind: unknown, id: unknown): { kind: Kind; id: string } | null {
  if (typeof kind !== 'string' || !KINDS.includes(kind as Kind)) return null;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { kind: kind as Kind, id };
}

/** The activities a delete takes with it. */
async function activityIds(kind: Kind, id: string): Promise<string[]> {
  const db = getAdminClient();
  if (kind === 'activity') return [id];
  const column = kind === 'project' ? 'project_id' : kind === 'category' ? 'category_id' : null;
  if (!column) return [];
  const { data } = await db.from('activities').select('id').eq(column, id);
  return (data ?? []).map((r: { id: string }) => r.id);
}

async function count(table: string, column: string, values: string[]): Promise<number> {
  if (values.length === 0) return 0;
  const { count: n } = await getAdminClient().from(table).select('*', { count: 'exact', head: true }).in(column, values);
  return n ?? 0;
}

async function impact(kind: Kind, id: string) {
  const db = getAdminClient();
  const acts = await activityIds(kind, id);
  const out: Record<string, number> = {};
  if (acts.length) {
    out.activities = acts.length;
    out.photos = await count('activity_evidence', 'activity_id', acts);
    out.reviews = (await count('form_reviews', 'activity_id', acts)) + (await count('sales_reviews', 'activity_id', acts));
    out.demoLinks = (await count('activity_demo_links', 'purchase_activity_id', acts)) + (await count('activity_demo_links', 'demo_activity_id', acts));
  }
  if (kind === 'user') {
    out.ownedProjects = await count('projects', 'sales_user_id', [id]);
    out.requests = await count('project_requests', 'requested_by', [id]);
    out.assignments = await count('activity_personnel', 'user_id', [id]);
  }
  if (kind === 'division') {
    out.users = await count('users', 'sales_division_id', [id]);
    out.projects = await count('projects', 'sales_division_id', [id]);
    out.requests = await count('project_requests', 'sales_division_id', [id]);
  }
  const names: Record<Kind, [string, string]> = {
    project: ['projects', 'name'], activity: ['activities', 'title'], project_request: ['project_requests', 'project_name'],
    user: ['users', 'full_name'], category: ['activity_categories', 'name'], division: ['sales_divisions', 'name'],
  };
  const [table, col] = names[kind];
  const { data } = await db.from(table).select(col).eq('id', id).maybeSingle();
  return { name: (data as Record<string, string> | null)?.[col] ?? null, counts: out, activityIds: acts };
}

export async function GET(request: NextRequest) {
  const g = await guard(request);
  if (g.error) return g.error;
  const p = parse(request.nextUrl.searchParams.get('kind'), request.nextUrl.searchParams.get('id'));
  if (!p) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  const { name, counts } = await impact(p.kind, p.id);
  if (name === null) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ name, counts });
}

export async function POST(request: NextRequest) {
  const g = await guard(request);
  if (g.error) return g.error;
  const body = await request.json().catch(() => ({}));
  const p = parse(body.kind, body.id);
  if (!p) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  if (p.kind === 'user' && p.id === g.me!.id) return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 });

  const db = getAdminClient();
  const { name, counts, activityIds: acts } = await impact(p.kind, p.id);
  if (name === null) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  // Photo files to remove after the rows are gone.
  const paths: string[] = [];
  for (let i = 0; i < acts.length; i += 200) {
    const { data } = await db.from('activity_evidence').select('storage_path, thumbnail_path').in('activity_id', acts.slice(i, i + 200));
    for (const r of (data ?? []) as { storage_path: string; thumbnail_path: string | null }[]) {
      paths.push(r.storage_path);
      if (r.thumbnail_path) paths.push(r.thumbnail_path);
    }
  }

  // A category is RESTRICTed by its activities: take them first.
  if (p.kind === 'category' && acts.length) {
    for (let i = 0; i < acts.length; i += 200) {
      const { error } = await db.from('activities').delete().in('id', acts.slice(i, i + 200));
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  const table = { project: 'projects', activity: 'activities', project_request: 'project_requests', user: 'users', category: 'activity_categories', division: 'sales_divisions' }[p.kind];
  const { error } = await db.from(table).delete().eq('id', p.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (acts.length) {
    for (let i = 0; i < acts.length; i += 200) await db.from('audit_logs').delete().in('entity_id', acts.slice(i, i + 200));
  }
  for (let i = 0; i < paths.length; i += 100) {
    await db.storage.from(BUCKET).remove(paths.slice(i, i + 100)).catch(() => {});
  }
  await db.from('audit_logs').insert({
    actor_id: g.me!.id, action: 'record.deleted', entity_type: p.kind, entity_id: p.id,
    meta: { name, ...counts },
  });
  return NextResponse.json({ ok: true, name, counts });
}
