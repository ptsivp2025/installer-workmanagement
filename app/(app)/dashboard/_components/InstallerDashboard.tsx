'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, ClipboardList, PlayCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import type { Activity } from '@/lib/types';
import { formatDate } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { SkeletonCards, SkeletonList, ErrorState } from '@/components/shared/States';

/**
 * A field installer's whole job on this app: see what's assigned to them,
 * open it, do it. No KPI grid, no charts, no admin numbers — those belong
 * to the staff dashboard (page.tsx), not here (spec: simpler navigation/UI
 * for a non-technical field user).
 */
export function InstallerDashboard() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [tasks, setTasks] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('activities')
        .select('*, activity_categories(name), projects(name, code), activity_personnel!inner(user_id)')
        .eq('activity_personnel.user_id', user.id)
        .in('status', ['scheduled', 'in_progress'])
        .order('scheduled_date');
      if (err) throw err;
      const rows = (data as Activity[]) ?? [];
      // in_progress first (unfinished work always leads), then soonest-scheduled.
      rows.sort((a, b) => (a.status === b.status ? 0 : a.status === 'in_progress' ? -1 : 1));
      setTasks(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dashboard.installerFailedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [user, t]);

  useEffect(() => { load(); }, [load]);

  const inProgressCount = tasks.filter(a => a.status === 'in_progress').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t('dashboard.welcomeBack')}{user?.full_name ? `, ${user.full_name}` : ''}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('dashboard.installerSubtitle')}</p>
        </div>
        <button onClick={load} className="inline-flex items-center justify-center rounded-control border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 shrink-0">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <div className="space-y-6">
          <SkeletonCards count={2} />
          <div className="bg-white rounded-card border border-slate-200"><SkeletonList rows={4} /></div>
        </div>
      ) : error ? <ErrorState message={error} onRetry={load} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 mb-6 animate-slide-up">
            <div className="bg-white rounded-card border border-slate-200 shadow-card p-4 flex items-center gap-3">
              <span className="h-10 w-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0"><ClipboardList className="h-5 w-5" /></span>
              <div>
                <p className="text-2xl font-semibold text-slate-900">{tasks.length}</p>
                <p className="text-xs text-slate-500">{t('dashboard.yourTasks')}</p>
              </div>
            </div>
            <div className="bg-white rounded-card border border-slate-200 shadow-card p-4 flex items-center gap-3">
              <span className="h-10 w-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><PlayCircle className="h-5 w-5" /></span>
              <div>
                <p className="text-2xl font-semibold text-slate-900">{inProgressCount}</p>
                <p className="text-xs text-slate-500">{t('dashboard.inProgress')}</p>
              </div>
            </div>
          </div>

          <h2 className="font-semibold text-slate-900 mb-3 animate-slide-up anim-d80">{t('dashboard.yourTasks')}</h2>
          {tasks.length === 0 ? (
            <div className="bg-white rounded-card border border-slate-200 shadow-card p-8 text-center animate-zoom-in">
              <ClipboardList className="h-10 w-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">{t('dashboard.noTasksForYou')}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {tasks.map(a => (
                <Link
                  key={a.id}
                  href={`/request-schedule/${a.id}`}
                  className="stagger-item block bg-white rounded-card border border-slate-200 shadow-card p-4 hover:shadow-modal transition active:scale-[0.99]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-brand-700 uppercase tracking-wide">{a.activity_categories?.name}</span>
                      <p className="font-medium text-slate-900 truncate">{a.title}</p>
                      <p className="text-sm text-slate-500 truncate">{a.projects?.name}</p>
                    </div>
                    <StatusBadge status={a.status} />
                  </div>
                  <p className="text-xs text-slate-400 mt-2">{formatDate(a.scheduled_date)}{a.start_time ? ` · ${a.start_time.slice(0, 5)}` : ''}</p>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
