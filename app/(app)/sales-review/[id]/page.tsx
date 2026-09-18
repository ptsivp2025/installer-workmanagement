'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Star, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import type { SalesReview } from '@/lib/types';
import { formatDate, formatDateTime } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { LoadingState, ErrorState } from '@/components/shared/States';

export default function SalesReviewDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [review, setReview] = useState<SalesReview | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('sales_reviews')
        .select('*, activities(*, projects(id, name, code), activity_categories(name))')
        .eq('id', id)
        .single();
      if (err) throw err;
      const rev = data as unknown as SalesReview;
      setReview(rev);
      setRating(rev.rating ?? 0);
      setComment(rev.comment ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('salesReview.notFound'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => { load(); }, [load]);

  async function handleSubmit() {
    if (rating < 1) { setSubmitError(t('salesReview.pickRating')); return; }
    setSubmitting(true);
    setSubmitError(null);
    const { error: err } = await supabase.from('sales_reviews').update({
      rating, comment: comment.trim() || null, status: 'submitted', reviewer_id: user?.id ?? null, reviewed_at: new Date().toISOString(),
    }).eq('id', id);
    setSubmitting(false);
    if (err) { setSubmitError(err.message); return; }
    await load();
  }

  if (loading) return <LoadingState />;
  if (error || !review) return <ErrorState message={error ?? t('salesReview.notFound')} onRetry={load} />;

  const activity = review.activities!;
  const canSubmit = user?.role === 'sales' && review.status === 'pending';

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => router.push('/sales-review')} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft className="h-4 w-4" /> {t('nav.salesReview')}
      </button>

      <div className="bg-white rounded-card border border-slate-200 shadow-card p-5 mb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="text-xs font-semibold text-brand-700 uppercase">{activity.activity_categories?.name}</span>
            <h1 className="text-lg font-semibold text-slate-900">{activity.title}</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              <Link href={`/projects/${activity.project_id}`} className="text-brand-600 hover:underline">{activity.projects?.name}</Link>
              {' · '}{formatDate(activity.scheduled_date)}
            </p>
          </div>
          <StatusBadge status={review.status} />
        </div>
        <p className="text-sm text-slate-500 mt-3">{t('formReview.completed')} {formatDateTime(activity.completed_at)}</p>
      </div>

      {review.status === 'submitted' && (
        <div className="bg-white rounded-card border border-slate-200 shadow-card p-5 mb-4">
          <p className="text-sm text-slate-500 mb-2">{t('salesReview.submittedRating')}</p>
          <div className="flex items-center gap-1 mb-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star key={i} className={`h-5 w-5 ${i < (review.rating ?? 0) ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}`} />
            ))}
          </div>
          {review.comment && <p className="text-slate-700 text-sm">{review.comment}</p>}
          <p className="text-xs text-slate-400 mt-2">{formatDateTime(review.reviewed_at)}</p>
        </div>
      )}

      {canSubmit && (
        <div className="bg-white rounded-card border border-slate-200 shadow-card p-5">
          <label className="block text-sm font-medium text-slate-700 mb-2">{t('salesReview.rating')}</label>
          <div className="flex items-center gap-1 mb-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <button key={i} type="button" onClick={() => setRating(i + 1)} className="p-0.5">
                <Star className={`h-7 w-7 ${i < rating ? 'fill-amber-400 text-amber-400' : 'text-slate-200 hover:text-amber-200'}`} />
              </button>
            ))}
          </div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('salesReview.comments')}</label>
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} className="w-full rounded-control border border-slate-300 px-3 py-2 text-sm mb-4" placeholder={t('salesReview.commentsPlaceholder')} />
          {submitError && <p className="text-sm text-red-600 mb-3">{submitError}</p>}
          <button onClick={handleSubmit} disabled={submitting} className="w-full inline-flex items-center justify-center gap-2 rounded-control bg-brand-600 text-white font-medium py-2.5 hover:bg-brand-700 disabled:opacity-60">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />} {t('salesReview.submitReview')}
          </button>
        </div>
      )}
    </div>
  );
}
