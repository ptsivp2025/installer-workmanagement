'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { FormReview } from '@/lib/types';
import { REVIEW_STATUSES } from '@/lib/constants';
import { formatDateTime } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { SearchInput } from '@/components/shared/SearchInput';
import { Pagination } from '@/components/shared/Pagination';
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/States';

const PAGE_SIZE = 15;

export default function FormReviewPage() {
  const [reviews, setReviews] = useState<FormReview[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('form_reviews')
        .select('*, activities(id, title, request_number, scheduled_date, project_id, projects(name), activity_categories(name))', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

      if (status) query = query.eq('status', status);
      if (search.trim()) {
        query = query.or(`title.ilike.%${search.trim()}%,request_number.ilike.%${search.trim()}%`, { foreignTable: 'activities' });
      }

      const { data, error: err, count } = await query;
      if (err) throw err;
      setReviews((data as unknown as FormReview[]) ?? []);
      setTotal(count ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reviews.');
    } finally {
      setLoading(false);
    }
  }, [page, search, status]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, status]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Form Review</h1>
        <p className="text-sm text-slate-500 mt-0.5">Every completed activity opens a review here.</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex-1"><SearchInput value={search} onChange={setSearch} placeholder="Search title or request #…" /></div>
        <select value={status} onChange={e => setStatus(e.target.value)} className="rounded-control border border-slate-300 px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {REVIEW_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
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
        ) : reviews.length === 0 ? (
          <EmptyState title="Nothing to review" description="Completed activities will show up here automatically." />
        ) : (
          <>
            <div className="divide-y divide-slate-100">
              {reviews.map(r => (
                <Link key={r.id} href={`/form-review/${r.id}`} className="flex items-center gap-4 px-4 py-3.5 hover:bg-slate-50 transition">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-brand-700 uppercase">{r.activities?.activity_categories?.name}</span>
                      <span className="text-xs text-slate-400 font-mono">{r.activities?.request_number}</span>
                    </div>
                    <p className="font-medium text-slate-900 truncate">{r.activities?.title}</p>
                    <p className="text-xs text-slate-500 truncate">{r.activities?.projects?.name}</p>
                  </div>
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
