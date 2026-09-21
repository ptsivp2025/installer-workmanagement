'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { SessionUserProfile } from '@/lib/auth';

export interface NavBadgeCounts {
  /** Pending account registrations — admin only. */
  registrations: number;
  /** Pending Sales project requests — admin/supervisor only. */
  projectRequests: number;
  /** Completed activities waiting on Form Review — admin/supervisor/reviewer. */
  formReview: number;
  /** Completed activities waiting on the Sales Division's own rating. */
  salesReview: number;
}

const EMPTY: NavBadgeCounts = { registrations: 0, projectRequests: 0, formReview: 0, salesReview: 0 };
const POLL_MS = 30_000;

async function headCount(table: string, column: string, value: string): Promise<number> {
  const { count } = await supabase.from(table).select('*', { count: 'exact', head: true }).eq(column, value);
  return count ?? 0;
}

/**
 * Nav badge counts, polled on an interval and refreshed whenever the tab
 * regains focus — an admin approving a registration in one tab should not
 * leave a stale "3 pending" badge sitting in another. Counts only, not a
 * notification feed: each number links straight to the queue that explains
 * it (Admin Panel → Users, Project Requests, Form Review, Sales Review), so
 * there's nothing else for a feed to tell someone that the badge + the
 * queue itself don't already say.
 */
export function useNavBadges(user: SessionUserProfile | null): NavBadgeCounts {
  const [badges, setBadges] = useState<NavBadgeCounts>(EMPTY);

  useEffect(() => {
    if (!user) { setBadges(EMPTY); return; }
    let cancelled = false;

    async function load() {
      const next: NavBadgeCounts = { ...EMPTY };
      const tasks: Promise<void>[] = [];

      if (user!.role === 'admin') {
        tasks.push(headCount('users', 'approval_status', 'pending').then(n => { next.registrations = n; }));
      }
      if (user!.role === 'admin' || user!.role === 'supervisor') {
        tasks.push(headCount('project_requests', 'status', 'pending').then(n => { next.projectRequests = n; }));
      }
      if (['admin', 'supervisor', 'reviewer'].includes(user!.role)) {
        tasks.push(headCount('form_reviews', 'status', 'pending').then(n => { next.formReview = n; }));
      }
      if (user!.role === 'sales') {
        // RLS already scopes sales_reviews to this account's own division.
        tasks.push(headCount('sales_reviews', 'status', 'pending').then(n => { next.salesReview = n; }));
      }

      await Promise.all(tasks);
      if (!cancelled) setBadges(next);
    }

    load();
    const interval = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('focus', onFocus); };
    // Keyed on id/role, not the whole user object — a profile edit
    // (full_name, phone, …) shouldn't restart the poll interval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role]);

  return badges;
}
