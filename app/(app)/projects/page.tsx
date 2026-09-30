'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, MapPin, RefreshCw, UserRound, UserX } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import type { Project } from '@/lib/types';
import { PROJECT_STATUSES } from '@/lib/constants';
import { formatDate, errorMessage, ilikeAny } from '@/lib/utils';
import { useSessionState, useDebouncedValue } from '@/lib/useListState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { SearchInput } from '@/components/shared/SearchInput';
import { Pagination } from '@/components/shared/Pagination';
import { SkeletonList, ErrorState, EmptyState } from '@/components/shared/States';
import { ProjectFormModal } from './_components/ProjectFormModal';
import type { DictKey } from '@/lib/i18n';

const PAGE_SIZE = 15;

export default function ProjectsPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [projects, setProjects] = useState<Project[]>([]);
  const [counts, setCounts] = useState<Record<string, { total: number; completed: number }>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useSessionState('projects.page', 1);
  const [search, setSearch] = useSessionState('projects.search', '');
  const [status, setStatus] = useSessionState('projects.status', '');
  const debouncedSearch = useDebouncedValue(search);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('projects')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

      const searchFilter = ilikeAny(['name', 'code', 'customer_name'], debouncedSearch);
      if (searchFilter) query = query.or(searchFilter);
      if (status) query = query.eq('status', status);

      const { data, error: err, count } = await query;
      if (err) throw err;
      setProjects((data as Project[]) ?? []);
      setTotal(count ?? 0);
      if (page > 1 && (data ?? []).length === 0 && (count ?? 0) > 0) setPage(1);

      const ids = ((data as Project[]) ?? []).map(p => p.id);
      if (ids.length > 0) {
        const { data: acts } = await supabase.from('activities').select('project_id, status').in('project_id', ids);
        const next: Record<string, { total: number; completed: number }> = {};
        for (const a of acts ?? []) {
          next[a.project_id] ??= { total: 0, completed: 0 };
          next[a.project_id].total++;
          if (a.status === 'completed') next[a.project_id].completed++;
        }
        setCounts(next);
      } else {
        setCounts({});
      }
    } catch (e) {
      setError(errorMessage(e, t('common.failedToLoad')));
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, status, t, setPage]);

  useEffect(() => { load(); }, [load]);

  const canCreate = user && ['admin', 'supervisor'].includes(user.role);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">{t('nav.projects')}</h1>
          <p className="text-[12.5px] text-slate-500 mt-0.5">{t('projects.subtitle')}</p>
        </div>
        {canCreate && (
          <button onClick={() => setFormOpen(true)} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-3.5 py-2 hover:bg-brand-700">
            <Plus className="h-4 w-4" /> {t('projects.newProject')}
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex-1"><SearchInput value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder={t('projects.searchPlaceholder')} /></div>
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className="rounded-control border border-slate-300 px-3 py-2 text-sm">
          <option value="">{t('common.allStatuses')}</option>
          {PROJECT_STATUSES.map(s => <option key={s} value={s}>{t(`status.${s}` as DictKey)}</option>)}
        </select>
        <button onClick={load} title={t('common.refresh')} aria-label={t('common.refresh')} className="inline-flex items-center justify-center rounded-control border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <div className="bg-white rounded-card border border-slate-200 shadow-bento overflow-hidden">
        {loading ? (
          <SkeletonList rows={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : projects.length === 0 ? (
          <EmptyState title={t('projects.noProjectsYet')} description={t('projects.noProjectsDescription')} />
        ) : (
          <>
            <div className="divide-y divide-slate-100">
              {projects.map(p => {
                const c = counts[p.id] ?? { total: 0, completed: 0 };
                return (
                  <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center gap-4 px-4 py-3.5 hover:bg-slate-50 transition">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-slate-900 truncate">{p.name}</p>
                        <span className="text-xs text-slate-400 font-mono">{p.code}</span>
                      </div>
                      <p className="text-sm text-slate-500 truncate flex items-center gap-1 mt-0.5">
                        {p.address && <><MapPin className="h-3 w-3" />{p.address}</>}
                        {p.customer_name && <span className="ml-1">· {p.customer_name}</span>}
                      </p>
                      {/* Whose project it is, on every row: a missing Sales is a job for the admin. */}
                      {p.sales_user_id ? (
                        <p className="text-[12px] text-slate-500 mt-1 inline-flex items-center gap-1">
                          <UserRound className="h-3 w-3 text-brand-600" />{t('projects.sales')}: <span className="font-semibold text-slate-700">{p.sales_person_name ?? '—'}</span>
                        </p>
                      ) : (
                        <p className="mt-1">
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                            <UserX className="h-3 w-3" />{t('projects.salesUnassigned')}
                          </span>
                        </p>
                      )}
                    </div>
                    <div className="hidden sm:block text-sm text-slate-500 w-32 shrink-0">
                      {c.completed}/{c.total} {t('projects.activities')}
                    </div>
                    <div className="hidden sm:block text-sm text-slate-400 w-28 shrink-0">{formatDate(p.expected_completion)}</div>
                    <StatusBadge status={p.status} />
                  </Link>
                );
              })}
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </>
        )}
      </div>

      <ProjectFormModal open={formOpen} onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); load(); }} />
    </div>
  );
}
