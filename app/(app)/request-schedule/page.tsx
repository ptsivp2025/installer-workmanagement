'use client';

import { useCallback, useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Plus, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import type { Activity, ActivityCategory } from '@/lib/types';
import type { DictKey } from '@/lib/i18n';
import { ACTIVITY_STATUSES } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { SearchInput } from '@/components/shared/SearchInput';
import { Pagination } from '@/components/shared/Pagination';
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/States';
import { ActivityFormModal } from './_components/ActivityFormModal';

const PAGE_SIZE = 15;

function RequestScheduleContent() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [categories, setCategories] = useState<ActivityCategory[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const preselectedProjectId = searchParams.get('projectId') ?? undefined;

  useEffect(() => {
    supabase.from('activity_categories').select('*').order('sort_order').then((res: { data: ActivityCategory[] | null }) => setCategories(res.data ?? []));
  }, []);

  useEffect(() => {
    if (preselectedProjectId) setFormOpen(true);
  }, [preselectedProjectId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('activities')
        .select('*, activity_categories(id, name, code), projects(id, name, code)', { count: 'exact' })
        .order('scheduled_date', { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

      if (search.trim()) query = query.or(`title.ilike.%${search.trim()}%,request_number.ilike.%${search.trim()}%,customer_name.ilike.%${search.trim()}%`);
      if (status) query = query.eq('status', status);
      if (categoryId) query = query.eq('category_id', categoryId);

      const { data, error: err, count } = await query;
      if (err) throw err;
      setActivities((data as Activity[]) ?? []);
      setTotal(count ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('activity.failedToLoadList'));
    } finally {
      setLoading(false);
    }
  }, [page, search, status, categoryId, t]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, status, categoryId]);

  const canCreate = user && ['admin', 'supervisor'].includes(user.role);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t('nav.requestSchedule')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('activity.subtitleList')}</p>
        </div>
        {canCreate && (
          <button onClick={() => setFormOpen(true)} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-3.5 py-2 hover:bg-brand-700">
            <Plus className="h-4 w-4" /> {t('activity.newActivity')}
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex-1"><SearchInput value={search} onChange={setSearch} placeholder={t('activity.searchPlaceholderList')} /></div>
        <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className="rounded-control border border-slate-300 px-3 py-2 text-sm">
          <option value="">{t('activity.allCategories')}</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} className="rounded-control border border-slate-300 px-3 py-2 text-sm">
          <option value="">{t('common.allStatuses')}</option>
          {ACTIVITY_STATUSES.map(s => <option key={s} value={s}>{t(`status.${s}` as DictKey)}</option>)}
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
        ) : activities.length === 0 ? (
          <EmptyState title={t('activity.noneFound')} description={t('activity.tryAdjusting')} />
        ) : (
          <>
            <div className="divide-y divide-slate-100">
              {activities.map(a => (
                <Link key={a.id} href={`/request-schedule/${a.id}`} className="flex items-center gap-4 px-4 py-3.5 hover:bg-slate-50 transition">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-brand-700 uppercase">{a.activity_categories?.name}</span>
                      <span className="text-xs text-slate-400 font-mono">{a.request_number}</span>
                    </div>
                    <p className="font-medium text-slate-900 truncate">{a.title}</p>
                    <p className="text-xs text-slate-500 truncate">{a.projects?.name}{a.customer_name ? ` · ${a.customer_name}` : ''}</p>
                  </div>
                  <div className="hidden sm:block text-sm text-slate-500 w-28 shrink-0">{formatDate(a.scheduled_date)}</div>
                  <div className="hidden sm:block text-sm text-slate-500 w-24 shrink-0">{a.personnel_count} {t('activity.people')}</div>
                  <StatusBadge status={a.status} />
                </Link>
              ))}
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </>
        )}
      </div>

      <ActivityFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); load(); }}
        categories={categories}
        defaultProjectId={preselectedProjectId}
      />
    </div>
  );
}

export default function RequestSchedulePage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <RequestScheduleContent />
    </Suspense>
  );
}
