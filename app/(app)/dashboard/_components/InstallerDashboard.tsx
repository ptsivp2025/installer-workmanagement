'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, ClipboardList, ChevronRight, MapPin } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import type { Activity } from '@/lib/types';
import { formatDate, errorMessage, localDateKey } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { SkeletonCards, SkeletonList, ErrorState } from '@/components/shared/States';
import { BentoGrid, BentoCard, BigNumber, Gauge, Meter } from '@/components/shared/Bento';
import { notifyAppReady } from '@/lib/native';
import type { DictKey } from '@/lib/i18n';

function greetingKey(): DictKey {
  const h = new Date().getHours();
  return h < 4 ? 'greeting.night' : h < 11 ? 'greeting.morning' : h < 15 ? 'greeting.afternoon' : h < 18 ? 'greeting.evening' : 'greeting.night';
}

/**
 * A field installer's whole job on this app: see what's assigned to them,
 * open it, do it. Two numbers that matter (today's progress, what's still
 * open) and the task list; no admin charts.
 */
export function InstallerDashboard() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [tasks, setTasks] = useState<Activity[]>([]);
  const [today, setToday] = useState({ total: 0, done: 0 });
  const [done30, setDone30] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const todayKey = localDateKey();
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const mine = () => supabase.from('activities').select('id, activity_personnel!inner(user_id)', { count: 'exact', head: true })
        .eq('activity_personnel.user_id', user.id);
      const [{ data, error: err }, totalRes, doneRes, monthRes] = await Promise.all([
        supabase
          .from('activities')
          .select('*, activity_categories(name), projects(name, code, address), activity_personnel!inner(user_id)')
          .eq('activity_personnel.user_id', user.id)
          .in('status', ['scheduled', 'in_progress'])
          .order('scheduled_date'),
        mine().eq('scheduled_date', todayKey).neq('status', 'cancelled'),
        mine().eq('scheduled_date', todayKey).eq('status', 'completed'),
        mine().eq('status', 'completed').gte('completed_at', since),
      ]);
      if (err) throw err;
      const rows = (data as Activity[]) ?? [];
      // in_progress first (unfinished work always leads), then soonest-scheduled.
      rows.sort((a, b) => (a.status === b.status ? 0 : a.status === 'in_progress' ? -1 : 1));
      setTasks(rows);
      setToday({ total: totalRes.count ?? 0, done: doneRes.count ?? 0 });
      setDone30(monthRes.count ?? 0);
    } catch (e) {
      setError(errorMessage(e, t('dashboard.installerFailedToLoad')));
    } finally {
      setLoading(false);
      notifyAppReady(); // Android app: first data is in, drop the loading screen
    }
  }, [user, t]);

  useEffect(() => { load(); }, [load]);

  const inProgressCount = tasks.filter(a => a.status === 'in_progress').length;
  const todayKey = localDateKey();
  const firstName = user?.full_name?.split(' ')[0];

  return (
    <div>
      <div className="flex items-end justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">{t(greetingKey())}{firstName ? `, ${firstName}` : ''}</h1>
          <p className="text-[12.5px] text-slate-500 mt-0.5">{t('dashboard.installerSubtitle')}</p>
        </div>
        <button onClick={load} title={t('common.refresh')} aria-label={t('common.refresh')}
          className="inline-flex items-center justify-center rounded-control border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 shrink-0">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading && tasks.length === 0 ? (
        <div className="space-y-4">
          <SkeletonCards count={2} />
          <div className="bg-white rounded-card border border-slate-200"><SkeletonList rows={4} /></div>
        </div>
      ) : error ? <ErrorState message={error} onRetry={load} /> : (
        <>
          <BentoGrid className="mb-5">
            <BentoCard span={6} tone="accent" title={t('dashboard.todayTasks')} minH>
              <div className="flex-1 flex flex-col items-center justify-center gap-2">
                <Gauge done={today.done} total={today.total} caption={t('dashboard.installerGaugeOf', { done: today.done, total: today.total })} />
                <p className="text-[12.5px] text-white/85 text-center">{t('dashboard.installerHint')}</p>
              </div>
            </BentoCard>
            <BentoCard span={6} title={t('dashboard.yourTasks')} minH>
              <BigNumber value={tasks.length} caption={t('dashboard.openTasksCaption')} />
              <div className="mt-auto pt-4 space-y-3">
                <Meter value={inProgressCount} max={Math.max(tasks.length, 1)} label={t('dashboard.inProgress')} color="#2a78d6" />
                <div className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="font-semibold text-slate-500">{t('dashboard.doneThisMonth')}</span>
                  <span className="font-black text-slate-800 tabular-nums">{done30}</span>
                </div>
              </div>
            </BentoCard>
          </BentoGrid>

          <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2.5">{t('dashboard.yourTasks')}</h2>
          {tasks.length === 0 ? (
            <div className="bg-white rounded-card border border-slate-200 shadow-bento p-8 text-center animate-zoom-in">
              <ClipboardList className="h-10 w-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">{t('dashboard.noTasksForYou')}</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {tasks.map(a => {
                const late = a.scheduled_date < todayKey;
                const isToday = a.scheduled_date === todayKey;
                const stripe = a.status === 'in_progress' ? '#2a78d6' : late ? '#e34948' : isToday ? '#1d4ed8' : '#94a3b8';
                return (
                  <Link key={a.id} href={`/request-schedule/${a.id}`}
                    className="stagger-item flex items-stretch gap-3 bg-white rounded-card border border-slate-200/80 shadow-bento p-3.5 pr-3 hover:border-brand-200 transition active:scale-[0.99]">
                    <span className="w-1 rounded-full shrink-0" style={{ background: stripe }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[10.5px] font-bold text-brand-700 uppercase tracking-wider truncate">{a.activity_categories?.name}</span>
                        <StatusBadge status={a.status} />
                      </div>
                      <p className="text-[15px] font-bold text-slate-900 leading-snug mt-0.5">{a.title}</p>
                      <p className="text-[12.5px] text-slate-500 truncate flex items-center gap-1 mt-0.5">
                        <MapPin className="h-3 w-3 shrink-0" /> {a.projects?.name}
                      </p>
                      <p className="text-[11.5px] text-slate-400 mt-2 flex items-center gap-2 flex-wrap">
                        {/* At a glance, which of these is today's and which slipped past its date. */}
                        {late && a.status === 'scheduled' && (
                          <span className="rounded-full bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 font-bold">{t('dashboard.overdue')}</span>
                        )}
                        {isToday && (
                          <span className="rounded-full bg-brand-50 text-brand-700 border border-brand-200 px-2 py-0.5 font-bold">{t('dashboard.today')}</span>
                        )}
                        <span className="tabular-nums">{formatDate(a.scheduled_date)}{a.start_time ? ` · ${a.start_time.slice(0, 5)}` : ''}</span>
                      </p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-slate-300 self-center shrink-0" />
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
