'use client';

import { useCallback, useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Plus, RefreshCw, FileSpreadsheet, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage, useSettings } from '@/app/providers';
import type { Activity, ActivityCategory } from '@/lib/types';
import type { DictKey } from '@/lib/i18n';
import { ACTIVITY_STATUSES } from '@/lib/constants';
import { formatDate, errorMessage, ilikeAny, localDateKey } from '@/lib/utils';
import { useSessionState, useDebouncedValue } from '@/lib/useListState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { SearchInput } from '@/components/shared/SearchInput';
import { Pagination } from '@/components/shared/Pagination';
import { LoadingState, SkeletonList, ErrorState, EmptyState } from '@/components/shared/States';
import { ActivityFormModal } from './_components/ActivityFormModal';
import { exportActivities, type Filterable } from './_components/exportActivities';
import { SearchableSelect } from '@/components/shared/SearchableSelect';
import { MiniDonut, STATUS_COLOR } from '@/components/shared/MiniDonut';
import { DeleteButton } from '@/components/shared/DeleteButton';


// Date quick-filters: "what's on today / this week / what slipped" was the
// question people opened this list with, and answering it meant paging
// through every activity ever scheduled, newest first.
const RANGES = ['all', 'today', 'week', 'overdue'] as const;
type Range = typeof RANGES[number];

function RequestScheduleContent() {
  const { user } = useAuth();
  const { t } = useLanguage();
  // Admin Panel → Aturan Sistem → Tampilan & Notifikasi.
  const PAGE_SIZE = useSettings().get<number>('list.page_size');
  const searchParams = useSearchParams();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [categories, setCategories] = useState<ActivityCategory[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useSessionState('activities.page', 1);
  const [search, setSearch] = useSessionState('activities.search', '');
  const [status, setStatus] = useSessionState('activities.status', '');
  const [categoryId, setCategoryId] = useSessionState('activities.category', '');
  const [range, setRange] = useSessionState<Range>('activities.range', 'all');
  const debouncedSearch = useDebouncedValue(search);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});

  const preselectedProjectId = searchParams.get('projectId') ?? undefined;

  useEffect(() => {
    supabase.from('activity_categories').select('*').order('sort_order').then((res: { data: ActivityCategory[] | null }) => setCategories(res.data ?? []));
  }, []);

  useEffect(() => {
    if (preselectedProjectId) setFormOpen(true);
  }, [preselectedProjectId]);

  // The list's filters, shared with the Excel export so the file always
  // matches what's on screen (just without the paging).
  const applyFilters = useCallback(<Q extends Filterable<Q>>(query: Q, withStatus = true): Q => {
    const today = localDateKey();
    if (range === 'today') query = query.eq('scheduled_date', today);
    if (range === 'week') {
      const end = new Date(); end.setDate(end.getDate() + 6);
      query = query.gte('scheduled_date', today).lte('scheduled_date', localDateKey(end));
    }
    if (range === 'overdue') query = query.lt('scheduled_date', today).in('status', ['scheduled', 'in_progress']);
    const searchFilter = ilikeAny(['title', 'request_number', 'customer_name'], debouncedSearch);
    if (searchFilter) query = query.or(searchFilter);
    if (status && withStatus) query = query.eq('status', status);
    if (categoryId) query = query.eq('category_id', categoryId);
    return query;
  }, [range, debouncedSearch, status, categoryId]);

  const [exporting, setExporting] = useState(false);
  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      // Page by page: a single request stops at the API's 1,000-row cap.
      await exportActivities((from, to) => applyFilters(
        supabase.from('activities')
          .select('id, request_number, title, scheduled_date, start_time, status, started_at, start_distance_m, completed_at, distance_from_target_m, gps_validation_status, gps_risk_flags, start_gps_flags, activity_categories(name), projects(name, code, customer_name), activity_personnel(name, is_primary), form_reviews(status, created_at)')
          .order('scheduled_date', { ascending: true })
          .order('id'),
      ).range(from, to), t);
    } catch (e) {
      setError(errorMessage(e, t('export.failed')));
    } finally {
      setExporting(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('activities')
        .select('*, activity_categories(id, name, code), projects(id, name, code)', { count: 'exact' })
        // A date window reads soonest-first; the full history newest-first.
        .order('scheduled_date', { ascending: range !== 'all' })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

      query = applyFilters(query);

      const { data, error: err, count } = await query;
      if (err) throw err;
      setActivities((data as Activity[]) ?? []);
      setTotal(count ?? 0);
      // The donut: every status under the same filters, not just this page.
      const counts = await Promise.all(ACTIVITY_STATUSES.map(s =>
        applyFilters(supabase.from('activities').select('id', { count: 'exact', head: true }), false).eq('status', s)
          .then(({ count: n }: { count: number | null }) => [s, n ?? 0] as const)));
      setStatusCounts(Object.fromEntries(counts));
      if (page > 1 && (data ?? []).length === 0 && (count ?? 0) > 0) setPage(1);
    } catch (e) {
      setError(errorMessage(e, t('activity.failedToLoadList')));
    } finally {
      setLoading(false);
    }
  }, [page, range, applyFilters, t, setPage, PAGE_SIZE]);

  useEffect(() => { load(); }, [load]);

  const canCreate = user && ['admin', 'supervisor'].includes(user.role);
  const canExport = user && ['admin', 'supervisor', 'reviewer'].includes(user.role);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">{t('nav.requestSchedule')}</h1>
          <p className="text-[12.5px] text-slate-500 mt-0.5">{t('activity.subtitleList')}</p>
        </div>
        {canExport && (
          <button onClick={handleExport} disabled={exporting} title={t('export.hint')} className="inline-flex items-center gap-1.5 rounded-control border border-slate-300 bg-white text-slate-700 text-sm font-medium px-3.5 py-2 hover:bg-slate-50 disabled:opacity-60 ml-auto mr-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            <span className="hidden sm:inline">{t('export.button')}</span>
          </button>
        )}
        {canCreate && (
          <button onClick={() => setFormOpen(true)} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-3.5 py-2 hover:bg-brand-700">
            <Plus className="h-4 w-4" /> {t('activity.newActivity')}
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-3 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        {RANGES.map(r => (
          <button
            key={r}
            onClick={() => { setRange(r); setPage(1); }}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
              range === r
                ? (r === 'overdue' ? 'bg-red-600 border-red-600 text-white' : 'bg-brand-600 border-brand-600 text-white')
                : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t(`activity.range.${r}` as DictKey)}
          </button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex-1"><SearchInput value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder={t('activity.searchPlaceholderList')} /></div>
        <SearchableSelect
          value={categoryId}
          onChange={v => { setCategoryId(v); setPage(1); }}
          options={[{ value: '', label: t('activity.allCategories') }, ...categories.map(c => ({ value: c.id, label: c.name }))]}
          placeholder={t('activity.allCategories')}
          className="sm:w-52"
        />
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className="rounded-control border border-slate-300 px-3 py-2 text-sm">
          <option value="">{t('common.allStatuses')}</option>
          {ACTIVITY_STATUSES.map(s => <option key={s} value={s}>{t(`status.${s}` as DictKey)}</option>)}
        </select>
        <button onClick={load} title={t('common.refresh')} aria-label={t('common.refresh')} className="inline-flex items-center justify-center rounded-control border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <MiniDonut
        className="mb-4"
        title={t('nav.requestSchedule')}
        active={status}
        onPick={k => { setStatus(status === k ? '' : k); setPage(1); }}
        items={ACTIVITY_STATUSES.map(s => ({ key: s, label: t(`status.${s}` as DictKey), count: statusCounts[s] ?? 0, color: STATUS_COLOR[s] }))}
      />

      <div className="bg-white rounded-card border border-slate-200 shadow-bento overflow-hidden">
        {loading ? (
          <SkeletonList rows={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : activities.length === 0 ? (
          <EmptyState title={t('activity.noneFound')} description={t('activity.tryAdjusting')} />
        ) : (
          <>
            <div className="divide-y divide-slate-100">
              {activities.map(a => (
                <Link key={a.id} href={`/request-schedule/${a.id}`} className="stagger-item flex items-center gap-4 px-4 py-3.5 hover:bg-slate-50 transition">
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
                  <DeleteButton kind="activity" id={a.id} name={a.title} onDeleted={load} />
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
