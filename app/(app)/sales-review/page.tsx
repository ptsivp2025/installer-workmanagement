'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Star } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useLanguage, useSettings } from '@/app/providers';
import type { SalesReview } from '@/lib/types';
import { formatDateTime, errorMessage, ilikeAny } from '@/lib/utils';
import { useSessionState, useDebouncedValue } from '@/lib/useListState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { SearchInput } from '@/components/shared/SearchInput';
import type { DictKey } from '@/lib/i18n';
import { MiniDonut, STATUS_COLOR } from '@/components/shared/MiniDonut';
import { Pagination } from '@/components/shared/Pagination';
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/States';


export default function SalesReviewPage() {
  const { t } = useLanguage();
  // Admin Panel → Aturan Sistem → Tampilan & Notifikasi.
  const PAGE_SIZE = useSettings().get<number>('list.page_size');
  const [reviews, setReviews] = useState<SalesReview[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useSessionState('salesReview.page', 1);
  const [search, setSearch] = useSessionState('salesReview.search', '');
  const [status, setStatus] = useSessionState('salesReview.status', 'pending');
  const debouncedSearch = useDebouncedValue(search);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('sales_reviews')
        .select('*, activities!inner(id, title, request_number, scheduled_date, project_id, projects(name), activity_categories(name))', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

      if (status) query = query.eq('status', status);
      // activities!inner above is what makes this narrow the review rows
      // themselves; with a plain embed it only blanked out the non-matching
      // activities and still listed every review.
      const searchFilter = ilikeAny(['title', 'request_number'], debouncedSearch);
      if (searchFilter) query = query.or(searchFilter, { foreignTable: 'activities' });

      const { data, error: err, count } = await query;
      if (err) throw err;
      // The donut: every status under the same search, not just this page.
      const counts = await Promise.all((['pending', 'submitted'] as const).map(s => {
        let q = supabase.from('sales_reviews').select('id, activities!inner(id)', { count: 'exact', head: true }).eq('status', s);
        if (searchFilter) q = q.or(searchFilter, { foreignTable: 'activities' });
        return q.then(({ count: n }: { count: number | null }) => [s, n ?? 0] as const);
      }));
      setStatusCounts(Object.fromEntries(counts));
      setReviews((data as unknown as SalesReview[]) ?? []);
      setTotal(count ?? 0);
      if (page > 1 && (data ?? []).length === 0 && (count ?? 0) > 0) setPage(1);
    } catch (e) {
      setError(errorMessage(e, t('common.failedToLoad')));
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, status, t, setPage, PAGE_SIZE]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="mb-4 gap-3 flex-wrap">
        <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">{t('salesReview.title')}</h1>
        <p className="text-[12.5px] text-slate-500 mt-0.5">{t('salesReview.subtitle')}</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex-1"><SearchInput value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder={t('activity.searchPlaceholder')} /></div>
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className="rounded-control border border-slate-300 px-3 py-2 text-sm">
          <option value="">{t('common.allStatuses')}</option>
          <option value="pending">{t('status.pending')}</option>
          <option value="submitted">{t('status.submitted')}</option>
        </select>
        <button onClick={load} title={t('common.refresh')} aria-label={t('common.refresh')} className="inline-flex items-center justify-center rounded-control border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <MiniDonut
        className="mb-4"
        title={t('salesReview.title')}
        active={status}
        onPick={k => { setStatus(status === k ? '' : k); setPage(1); }}
        items={(['pending', 'submitted'] as const).map(s => ({ key: s, label: t(`status.${s}` as DictKey), count: statusCounts[s] ?? 0, color: STATUS_COLOR[s] }))}
      />

      <div className="bg-white rounded-card border border-slate-200 shadow-bento overflow-hidden">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : reviews.length === 0 ? (
          <EmptyState title={t('salesReview.nothingToReview')} description={t('salesReview.emptyDescription')} />
        ) : (
          <>
            <div className="divide-y divide-slate-100">
              {reviews.map(r => (
                <Link key={r.id} href={`/sales-review/${r.id}`} className="flex items-center gap-4 px-4 py-3.5 hover:bg-slate-50 transition">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-brand-700 uppercase">{r.activities?.activity_categories?.name}</span>
                      <span className="text-xs text-slate-400 font-mono">{r.activities?.request_number}</span>
                    </div>
                    <p className="font-medium text-slate-900 truncate">{r.activities?.title}</p>
                    <p className="text-xs text-slate-500 truncate">{r.activities?.projects?.name}</p>
                  </div>
                  {r.status === 'submitted' && r.rating != null && (
                    <div className="hidden sm:flex items-center gap-0.5 shrink-0">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} className={`h-3.5 w-3.5 ${i < r.rating! ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}`} />
                      ))}
                    </div>
                  )}
                  <div className="hidden sm:block text-sm text-slate-400 w-40 shrink-0">{formatDateTime(r.created_at)}</div>
                  <StatusBadge status={r.status} />
                </Link>
              ))}
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
