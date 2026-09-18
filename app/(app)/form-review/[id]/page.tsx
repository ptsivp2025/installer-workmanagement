'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, XCircle, Loader2, Users, Camera, Navigation, RotateCcw, AlertTriangle, BadgePercent } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/app/providers';
import type { FormReview, ActivityPersonnel, ActivityEvidence, ActivityDiscountEligibility } from '@/lib/types';
import { formatDate, formatDateTime, formatDistance } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { LoadingState, ErrorState } from '@/components/shared/States';
import { useSignedUrls } from '@/lib/useSignedUrls';

export default function FormReviewDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [review, setReview] = useState<FormReview | null>(null);
  const [personnel, setPersonnel] = useState<ActivityPersonnel[]>([]);
  const [evidence, setEvidence] = useState<ActivityEvidence[]>([]);
  const { urls: photos, error: photosError, retry: retryPhotos } = useSignedUrls(evidence.map(e => e.thumbnail_path ?? e.storage_path));
  const [discount, setDiscount] = useState<ActivityDiscountEligibility | null>(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<'approved' | 'rejected' | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: rev, error: err } = await supabase
        .from('form_reviews')
        .select('*, activities(*, projects(id, name, code), activity_categories(name))')
        .eq('id', id)
        .single();
      if (err) throw err;
      setReview(rev as unknown as FormReview);
      setNotes(rev.notes ?? '');

      const activityId = rev.activity_id;
      const [{ data: pers }, { data: evid }] = await Promise.all([
        supabase.from('activity_personnel').select('*').eq('activity_id', activityId),
        supabase.from('activity_evidence').select('*').eq('activity_id', activityId).order('uploaded_at'),
      ]);
      setPersonnel((pers as ActivityPersonnel[]) ?? []);
      setEvidence((evid as ActivityEvidence[]) ?? []);

      // Best-effort — see the same note in request-schedule/[id]/page.tsx.
      try {
        const { data: cat } = await supabase
          .from('activity_categories').select('counts_as_installation').eq('id', rev.activities.category_id).single();
        if (cat?.counts_as_installation) {
          const { data: elig } = await supabase.from('activity_discount_eligibility').select('*').eq('activity_id', activityId).maybeSingle();
          setDiscount((elig as ActivityDiscountEligibility) ?? null);
        } else {
          setDiscount(null);
        }
      } catch {
        setDiscount(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load review.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleDecision(decision: 'approved' | 'rejected') {
    setDeciding(decision);
    setDecisionError(null);
    const { data, error: err } = await supabase.rpc('iwm_review_activity', { p_review_id: id, p_decision: decision, p_notes: notes.trim() || null });
    setDeciding(null);
    if (err) { setDecisionError(err.message); return; }
    if (data?.status !== decision) { setDecisionError('Decision did not apply as expected. Please refresh and try again.'); return; }
    fetch('/api/notifications/notify-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewId: id }),
    }).catch(() => {});
    await load();
  }

  async function handleReopen() {
    if (!confirm('Reopen this activity for correction? It will go back to "in progress" and a new review will be created once resubmitted.')) return;
    setReopening(true);
    setDecisionError(null);
    const { error: err } = await supabase.rpc('iwm_reopen_activity', { p_activity_id: review!.activity_id });
    setReopening(false);
    if (err) { setDecisionError(err.message); return; }
    router.push(`/request-schedule/${review!.activity_id}`);
  }

  if (loading) return <LoadingState />;
  if (error || !review) return <ErrorState message={error ?? 'Review not found.'} onRetry={load} />;

  const activity = review.activities!;
  const canDecide = user && ['admin', 'supervisor', 'reviewer'].includes(user.role) && review.status === 'pending';
  const canReopen = user && ['admin', 'supervisor'].includes(user.role) && review.status === 'rejected';

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => router.push('/form-review')} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft className="h-4 w-4" /> Back to Form Review
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

        <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
          <div className="flex items-center gap-1.5 text-slate-600"><Users className="h-4 w-4 text-slate-400" />{personnel.length} people</div>
          <div className="flex items-center gap-1.5 text-slate-600"><Camera className="h-4 w-4 text-slate-400" />{evidence.length} photos</div>
          <div className="flex items-center gap-1.5 text-slate-600 col-span-2">
            <Navigation className="h-4 w-4 text-slate-400" />
            {activity.gps_validation_status ? (
              <>GPS {activity.gps_validation_status === 'valid' ? 'valid' : activity.gps_validation_status.replace('_', ' ')}
                {activity.distance_from_target_m != null && ` · ${formatDistance(activity.distance_from_target_m)} from target`}</>
            ) : 'GPS not required'}
          </div>
          <div className="text-slate-500 col-span-2">Completed {formatDateTime(activity.completed_at)}</div>
        </div>

        {discount && (
          <div className="mt-4 flex items-start gap-2 rounded-control bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2.5">
            <BadgePercent className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Eligible for demo discount — a Demo on this project completed {discount.days_since_demo} days earlier
              ({formatDate(discount.demo_completed_at)}).
            </span>
          </div>
        )}

        {personnel.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-slate-400 mb-1.5">PERSONNEL</p>
            <ul className="text-sm text-slate-700 space-y-0.5">
              {personnel.map((p, i) => <li key={p.id}>{i + 1}. {p.name}{p.role && <span className="text-slate-400"> — {p.role}</span>}</li>)}
            </ul>
          </div>
        )}

        {evidence.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-slate-400 mb-1.5">EVIDENCE</p>
            {photosError && (
              <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-control px-3 py-1.5 mb-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">Could not load photo previews.</span>
                <button onClick={retryPhotos} className="font-medium underline">Retry</button>
              </div>
            )}
            <div className="grid grid-cols-4 gap-2">
              {evidence.map(e => (
                <a key={e.id} href={photos[e.storage_path] ?? photos[e.thumbnail_path ?? '']} target="_blank" rel="noreferrer" className="aspect-square rounded-control overflow-hidden bg-slate-100 block">
                  {photos[e.thumbnail_path ?? e.storage_path] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photos[e.thumbnail_path ?? e.storage_path]} alt="Evidence" className="h-full w-full object-cover" loading="lazy" />
                  ) : <div className="h-full w-full animate-pulse bg-slate-100" />}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {review.status !== 'pending' && (
        <div className="bg-white rounded-card border border-slate-200 shadow-card p-5 mb-4 text-sm">
          <p className="text-slate-500">Decision: <StatusBadge status={review.status} /></p>
          {review.notes && <p className="text-slate-700 mt-2">{review.notes}</p>}
          <p className="text-slate-400 mt-2">{formatDateTime(review.reviewed_at)}</p>
          {decisionError && <p className="text-sm text-red-600 mt-3">{decisionError}</p>}
          {canReopen && (
            <button onClick={handleReopen} disabled={reopening} className="mt-3 inline-flex items-center gap-1.5 rounded-control border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">
              {reopening ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Reopen for Correction
            </button>
          )}
        </div>
      )}

      {canDecide && (
        <div className="bg-white rounded-card border border-slate-200 shadow-card p-5">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Review Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="w-full rounded-control border border-slate-300 px-3 py-2 text-sm mb-4" placeholder="Optional notes for the field team…" />
          {decisionError && <p className="text-sm text-red-600 mb-3">{decisionError}</p>}
          <div className="flex gap-2">
            <button onClick={() => handleDecision('rejected')} disabled={!!deciding} className="flex-1 inline-flex items-center justify-center gap-2 rounded-control border border-red-200 text-red-600 font-medium py-2.5 hover:bg-red-50 disabled:opacity-60">
              {deciding === 'rejected' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Reject
            </button>
            <button onClick={() => handleDecision('approved')} disabled={!!deciding} className="flex-1 inline-flex items-center justify-center gap-2 rounded-control bg-emerald-600 text-white font-medium py-2.5 hover:bg-emerald-700 disabled:opacity-60">
              {deciding === 'approved' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
