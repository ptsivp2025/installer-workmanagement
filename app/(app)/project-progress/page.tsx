'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/app/providers';
import type { Project } from '@/lib/types';
import { formatDate, errorMessage, ilikeAny, fetchAllRows } from '@/lib/utils';
import { useSessionState, useDebouncedValue } from '@/lib/useListState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { SearchInput } from '@/components/shared/SearchInput';
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/States';

export default function ProjectProgressListPage() {
  const { t } = useLanguage();
  const [projects, setProjects] = useState<Project[]>([]);
  const [counts, setCounts] = useState<Record<string, { total: number; completed: number; inProgress: number }>>({});
  const [search, setSearch] = useSessionState('projectProgress.search', '');
  const debouncedSearch = useDebouncedValue(search);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase.from('projects').select('*').in('status', ['active', 'on_hold']).order('created_at', { ascending: false }).limit(100);
      const searchFilter = ilikeAny(['name', 'code', 'customer_name'], debouncedSearch);
      if (searchFilter) query = query.or(searchFilter);
      const { data, error: err } = await query;
      if (err) throw err;
      setProjects((data as Project[]) ?? []);

      const ids = ((data as Project[]) ?? []).map(p => p.id);
      if (ids.length > 0) {
        // Up to 100 projects' activities can pass the API's 1,000-row cap.
        const acts = await fetchAllRows<{ project_id: string; status: string }>((from, to) => supabase.from('activities')
          .select('id, project_id, status').in('project_id', ids).order('id').range(from, to));
        const next: Record<string, { total: number; completed: number; inProgress: number }> = {};
        for (const a of acts) {
          next[a.project_id] ??= { total: 0, completed: 0, inProgress: 0 };
          next[a.project_id].total++;
          if (a.status === 'completed') next[a.project_id].completed++;
          if (a.status === 'in_progress') next[a.project_id].inProgress++;
        }
        setCounts(next);
      } else {
        setCounts({});
      }
    } catch (e) {
      setError(errorMessage(e, t('projectProgress.failedToLoad')));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, t]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">{t('nav.projectProgress')}</h1>
          <p className="text-[12.5px] text-slate-500 mt-0.5">{t('projectProgress.subtitle')}</p>
        </div>
        <button onClick={load} title={t('common.refresh')} aria-label={t('common.refresh')} className="inline-flex items-center justify-center rounded-control border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-4"><SearchInput value={search} onChange={setSearch} placeholder={t('projectProgress.searchPlaceholder')} /></div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : projects.length === 0 ? (
        <EmptyState title={t('projectProgress.noActiveProjects')} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(p => {
            const c = counts[p.id] ?? { total: 0, completed: 0, inProgress: 0 };
            const pct = c.total === 0 ? 0 : Math.round((c.completed / c.total) * 100);
            return (
              <Link key={p.id} href={`/project-progress/${p.id}`} className="bg-white rounded-card border border-slate-200 shadow-bento p-4 hover:shadow-modal transition">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">{p.name}</p>
                    <p className="text-xs text-slate-400 font-mono">{p.code}</p>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mb-2">
                  <div className="h-full bg-brand-600 rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>{t('projectProgress.completedInProgress', { completed: c.completed, total: c.total, inProgress: c.inProgress })}</span>
                  <span>{pct}%</span>
                </div>
                {p.expected_completion && <p className="text-xs text-slate-400 mt-2">{t('projects.target')}: {formatDate(p.expected_completion)}</p>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
