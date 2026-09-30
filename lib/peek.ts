'use client';

import { supabase } from './supabase';
import { localDateKey, formatDate } from './utils';
import type { SessionUserProfile } from './auth';

/**
 * The items behind the header's info boxes and the bell: real rows, each
 * leading to its own record, not a summary sentence that sends someone off
 * to search a list. Fetched when a panel opens, never on every page load.
 */
export interface PeekItem {
  id: string;
  title: string;
  subtitle: string;
  /** Right-hand detail: a time, a date, a count. */
  right?: string;
  color: string;
  href?: string;
  /** Opens the Admin Panel instead of navigating (account requests). */
  admin?: true;
}

const OPEN = ['scheduled', 'in_progress'];
// Items per panel: Admin Panel → Aturan Sistem → Tampilan & Notifikasi
// (set by AppShell from the settings; 12 until they load).
let LIMIT = 12;
export function setPeekLimit(n: number): void { if (Number.isFinite(n) && n > 0) LIMIT = n; }
const STATUS_COLOR: Record<string, string> = { scheduled: '#64748b', in_progress: '#2a78d6' };

interface ActRow {
  id: string; title: string; status: string; scheduled_date: string; start_time: string | null;
  projects: { name: string } | null; activity_categories: { name: string } | null;
}
const ACT = 'id, title, status, scheduled_date, start_time, projects(name), activity_categories(name)';

function activityItems(rows: ActRow[] | null, overdue: boolean): PeekItem[] {
  return (rows ?? []).map(a => ({
    id: a.id,
    title: a.title,
    subtitle: [a.activity_categories?.name, a.projects?.name].filter(Boolean).join(' · '),
    right: overdue ? formatDate(a.scheduled_date) : (a.start_time?.slice(0, 5) ?? undefined),
    color: overdue ? '#e34948' : (STATUS_COLOR[a.status] ?? '#64748b'),
    href: `/request-schedule/${a.id}`,
  }));
}

/** Today's open jobs: an installer's own, everyone else's all. */
export async function peekToday(user: SessionUserProfile): Promise<PeekItem[]> {
  const select = user.role === 'installer' ? `${ACT}, activity_personnel!inner(user_id)` : ACT;
  let q = supabase.from('activities').select(select).eq('scheduled_date', localDateKey()).in('status', OPEN);
  if (user.role === 'installer') q = q.eq('activity_personnel.user_id', user.id);
  const { data } = await q.order('start_time', { ascending: true, nullsFirst: false }).limit(LIMIT);
  return activityItems(data as unknown as ActRow[], false);
}

/** Open jobs whose date has passed, oldest first. */
export async function peekOverdue(): Promise<PeekItem[]> {
  const { data } = await supabase.from('activities').select(ACT)
    .lt('scheduled_date', localDateKey()).in('status', OPEN).order('scheduled_date').limit(LIMIT);
  return activityItems(data as unknown as ActRow[], true);
}

/** Completed jobs waiting for Form Review. */
export async function peekFormReview(): Promise<PeekItem[]> {
  const { data } = await supabase.from('form_reviews')
    .select('id, created_at, activities(title, projects(name), activity_categories(name))')
    .eq('status', 'pending').order('created_at').limit(LIMIT);
  return ((data ?? []) as unknown as { id: string; created_at: string; activities: { title: string; projects: { name: string } | null; activity_categories: { name: string } | null } | null }[])
    .map(r => ({
      id: r.id,
      title: r.activities?.title ?? '—',
      subtitle: [r.activities?.activity_categories?.name, r.activities?.projects?.name].filter(Boolean).join(' · '),
      right: formatDate(r.created_at),
      color: '#eda100',
      href: `/form-review/${r.id}`,
    }));
}

/** Project requests from Sales, waiting for a decision. */
export async function peekProjectRequests(): Promise<PeekItem[]> {
  const { data } = await supabase.from('project_requests')
    .select('id, project_name, customer_name, requested_date, created_at, sales_divisions(name)')
    .eq('status', 'pending').order('created_at').limit(LIMIT);
  return ((data ?? []) as unknown as { id: string; project_name: string; customer_name: string | null; requested_date: string | null; created_at: string; sales_divisions: { name: string } | null }[])
    .map(r => ({
      id: r.id,
      title: r.project_name,
      subtitle: [r.customer_name, r.sales_divisions?.name].filter(Boolean).join(' · '),
      right: formatDate(r.requested_date ?? r.created_at),
      color: '#1d4ed8',
      href: '/project-requests',
    }));
}

/** Finished work waiting for this Sales division's rating. */
export async function peekSalesReview(): Promise<PeekItem[]> {
  const { data } = await supabase.from('sales_reviews')
    .select('id, created_at, activities(title, projects(name))')
    .eq('status', 'pending').order('created_at').limit(LIMIT);
  return ((data ?? []) as unknown as { id: string; created_at: string; activities: { title: string; projects: { name: string } | null } | null }[])
    .map(r => ({
      id: r.id,
      title: r.activities?.title ?? '—',
      subtitle: r.activities?.projects?.name ?? '',
      right: formatDate(r.created_at),
      color: '#eda100',
      href: `/sales-review/${r.id}`,
    }));
}

/** Sign-ups to approve and "forgot password" requests: both handled in Admin Panel → Users. */
export async function peekAccounts(labels: { signup: string; reset: string }): Promise<PeekItem[]> {
  const [{ data: users }, { data: resets }] = await Promise.all([
    supabase.from('users').select('id, full_name, username, registered_at').eq('approval_status', 'pending').order('registered_at').limit(LIMIT),
    supabase.from('password_reset_requests').select('id, username, created_at').eq('status', 'pending').order('created_at').limit(LIMIT),
  ]);
  return [
    ...((users ?? []) as { id: string; full_name: string; username: string; registered_at: string | null }[]).map(u => ({
      id: `u-${u.id}`, title: u.full_name || u.username, subtitle: labels.signup,
      right: u.registered_at ? formatDate(u.registered_at) : undefined, color: '#7c3aed', admin: true as const,
    })),
    ...((resets ?? []) as { id: string; username: string; created_at: string }[]).map(r => ({
      id: `r-${r.id}`, title: `@${r.username}`, subtitle: labels.reset,
      right: formatDate(r.created_at), color: '#e34948', admin: true as const,
    })),
  ];
}
