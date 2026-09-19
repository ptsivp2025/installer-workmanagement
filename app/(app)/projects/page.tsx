'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, MapPin, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import type { Project } from '@/lib/types';
import { PROJECT_STATUSES } from '@/lib/constants';
import { formatDate, errorMessage } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { SearchInput } from '@/components/shared/SearchInput';
import { Pagination } from '@/components/shared/Pagination';
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/States';
import { ProjectFormModal } from './_components/ProjectFormModal';
import type { DictKey } from '@/lib/i18n';

const PAGE_SIZE = 15;

export default function ProjectsPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [projects, setProjects] = useState<Project[]>([]);
  const [counts, setCounts] = useState<Record<string, { total: number; completed: number }>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
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

      if (search.trim()) query = query.or(`name.ilike.%${search.trim()}%,code.ilike.%${search.trim()}%,customer_name.ilike.%${search.trim()}%`);
      if (status) query = query.eq('status', status);

      const { data, error: err, count } = await query;
      if (err) throw err;
      setProjects((data as Project[]) ?? []);
      setTotal(count ?? 0);

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
      setError(errorMessage(e, 'Failed to load projects.'));
    } finally {
      setLoading(false);
    }
  }, [page, search, status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, status]);

  const canCreate = user && ['admin', 'supervisor'].includes(user.role);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t('nav.projects')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('projects.subtitle')}</p>
        </div>
        {canCreate && (
          <button onClick={() => setFormOpen(true)} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-3.5 py-2 hover:bg-brand-700">
            <Plus className="h-4 w-4" /> {t('projects.newProject')}
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex-1"><SearchInput value={search} onChange={setSearch} placeholder={t('projects.searchPlaceholder')} /></div>
        <select value={status} onChange={e => setStatus(e.target.value)} className="rounded-control border border-slate-300 px-3 py-2 text-sm">
          <option value="">{t('common.allStatuses')}</option>
          {PROJECT_STATUSES.map(s => <option key={s} value={s}>{t(`status.${s}` as DictKey)}</option>)}
        </select>
        <button onClick={load} className="inline-flex items-center justify-center rounded-control border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <div className="bg-white rounded-card border border-slate-200 shadow-card overflow-hidden">
        {loading ? (
          <LoadingState />
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
