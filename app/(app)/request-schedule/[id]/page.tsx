'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Pencil, Calendar, MapPin, Ban, ClipboardCheck, History, UserRound, Package, Star, ChevronDown } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import type { Activity, ActivityPersonnel, ActivityEvidence, ActivityCategory, FormReview, ActivityDiscountEligibility } from '@/lib/types';
import { formatDate, formatDateTime, errorMessage } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { LoadingState, ErrorState } from '@/components/shared/States';
import { ActivityFormModal } from '../_components/ActivityFormModal';
import { SalesRescheduleModal } from '../_components/SalesRescheduleModal';
import { PersonnelPanel } from './_components/PersonnelPanel';
import { EvidencePanel } from './_components/EvidencePanel';
import { ExecutionPanel } from './_components/ExecutionPanel';
import type { DictKey } from '@/lib/i18n';

export default function ActivityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [projectLatLng, setProjectLatLng] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const [personnel, setPersonnel] = useState<ActivityPersonnel[]>([]);
  const [evidence, setEvidence] = useState<ActivityEvidence[]>([]);
  const [review, setReview] = useState<FormReview | null>(null);
  const [categories, setCategories] = useState<ActivityCategory[]>([]);
  const [discount, setDiscount] = useState<ActivityDiscountEligibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Core fields only — must never fail because of an optional/newer
      // column (counts_as_demo, etc.) that a not-yet-applied migration
      // hasn't added on this database yet (spec: never let an optional
      // feature take down the whole activity page).
      const { data: act, error: actErr } = await supabase
        .from('activities')
        .select('*, activity_categories(id, name, code, requires_gps, requires_evidence, requires_personnel, evidence_min_count, gps_radius_m), projects(id, name, code, latitude, longitude)')
        .eq('id', id)
        .single();
      if (actErr) throw actErr;
      const activityData = act as Activity;
      setActivity(activityData);
      const proj = (act as unknown as { projects: { latitude: number | null; longitude: number | null } }).projects;
      setProjectLatLng({ lat: proj?.latitude ?? null, lng: proj?.longitude ?? null });

      const [{ data: pers }, { data: evid }, { data: rev }, { data: cats }] = await Promise.all([
        supabase.from('activity_personnel').select('*').eq('activity_id', id).order('created_at'),
        supabase.from('activity_evidence').select('*').eq('activity_id', id).order('uploaded_at', { ascending: false }),
        supabase.from('form_reviews').select('*').eq('activity_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('activity_categories').select('*').order('sort_order'),
      ]);
      setPersonnel((pers as ActivityPersonnel[]) ?? []);
      setEvidence((evid as ActivityEvidence[]) ?? []);
      setReview((rev as FormReview) ?? null);
      setCategories((cats as ActivityCategory[]) ?? []);

      // Best-effort: discount-eligibility badge. Wrapped separately so a
      // missing counts_as_installation column or activity_discount_eligibility
      // view (migration 009 not applied yet) just hides the badge instead of
      // failing the whole page load.
      try {
        const { data: cat } = await supabase
          .from('activity_categories').select('counts_as_installation').eq('id', activityData.category_id).single();
        if (cat?.counts_as_installation) {
          const { data: elig } = await supabase.from('activity_discount_eligibility').select('*').eq('activity_id', id).maybeSingle();
          setDiscount((elig as ActivityDiscountEligibility) ?? null);
        } else {
          setDiscount(null);
        }
      } catch {
        setDiscount(null);
      }
    } catch (e) {
      setError(errorMessage(e, t('activity.failedToLoad')));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => { load(); }, [load]);

  async function handleCancel() {
    if (!confirm(t('activity.cancelConfirm'))) return;
    const { error: err } = await supabase.rpc('iwm_set_activity_status', { p_activity_id: id, p_status: 'cancelled' });
    if (!err) load();
  }

  if (loading) return <LoadingState />;
  if (error || !activity) return <ErrorState message={error ?? t('activity.notFound')} onRetry={load} />;

  const canEditSchedule = user && ['admin', 'supervisor'].includes(user.role);
  // If this page loaded for a Sales account at all, RLS (activities_select,
  // 014) already means the activity's project is their own division — no
  // extra division check needed client-side. Scoped to date/time/priority/
  // notes only; everything else the server-side guard trigger refuses
  // (021_sales_reschedule.sql), so the UI never even offers it.
  const canReschedule = user?.role === 'sales';
  const targetLat = activity.target_latitude ?? projectLatLng.lat;
  const targetLng = activity.target_longitude ?? projectLatLng.lng;
  const locked = activity.status === 'completed' || activity.status === 'cancelled';
  const primaryPersonnel = personnel.find(p => p.is_primary) ?? null;

  return (
    <div className="max-w-3xl mx-auto">
      <button onClick={() => router.push('/request-schedule')} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft className="h-4 w-4" /> {t('activity.backToRequestSchedule')}
      </button>

      <div className="bg-white rounded-card border border-slate-200 shadow-card p-5 mb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="text-xs font-semibold text-brand-700 uppercase tracking-wide">{activity.activity_categories?.name}</span>
            <h1 className="text-lg font-semibold text-slate-900">{activity.title}</h1>
            <p className="text-xs text-slate-400 font-mono mt-0.5">{activity.request_number}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={activity.status} />
            {(canEditSchedule || canReschedule) && !locked && (
              <button onClick={() => setEditOpen(true)} title={canEditSchedule ? t('activity.editActivity') : t('activity.reschedule')} className="text-slate-400 hover:text-slate-600"><Pencil className="h-4 w-4" /></button>
            )}
          </div>
        </div>

        {/* Only the who/what/when/where an installer needs at a glance —
            everything else is one tap away under "More details" so the
            action panels below aren't pushed off-screen (spec: simpler UI
            for a non-technical field user). */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 text-sm">
          <InfoRow label={t('activity.project')}>
            <Link href={`/projects/${activity.project_id}`} className="text-brand-600 hover:underline">{activity.projects?.name}</Link>
          </InfoRow>
          <InfoRow label={t('activity.scheduled')}><span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{formatDate(activity.scheduled_date)}{activity.start_time ? ` · ${activity.start_time.slice(0, 5)}` : ''}</span></InfoRow>
          <InfoRow label={t('activity.location')}><span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{activity.location_address || '—'}</span></InfoRow>
          {(activity.product_brand || activity.product_type) && (
            <InfoRow label={t('activity.productLabel')}>
              <span className="inline-flex items-center gap-1"><Package className="h-3.5 w-3.5" />{[activity.product_brand, activity.product_type].filter(Boolean).join(' ')}{activity.product_model && ` · ${activity.product_model}`}</span>
            </InfoRow>
          )}
        </div>

        {discount && (
          <Link href={`/request-schedule/${discount.demo_activity_id}`} className="mt-3 flex items-start gap-2 rounded-control bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2.5 hover:bg-amber-100 transition">
            <History className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              {t('activity.previousDemoFound', { product: [discount.demo_product_brand, discount.demo_product_type].filter(Boolean).join(' '), date: formatDate(discount.demo_completed_at) })}
              <span className="block text-xs text-amber-700/80 mt-0.5">{t('activity.previousDemoHint')}</span>
            </span>
          </Link>
        )}

        {(activity.customer_name || activity.priority !== 'normal' || activity.completed_at || primaryPersonnel || activity.pic_name || activity.pic_phone || activity.notes || review) && (
          <details className="mt-3 group">
            <summary className="flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700 cursor-pointer list-none">
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /> {t('activity.moreDetails')}
            </summary>
            <div className="mt-3 space-y-2.5 pl-5 border-l-2 border-slate-100">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                {activity.customer_name && <InfoRow label={t('activity.customer')}>{activity.customer_name}</InfoRow>}
                <InfoRow label={t('activity.priority')}><span className="capitalize">{t(`priority.${activity.priority}` as DictKey)}</span></InfoRow>
                {activity.completed_at && <InfoRow label={t('activity.completed')}>{formatDateTime(activity.completed_at)}</InfoRow>}
              </div>

              {primaryPersonnel && (
                <div className="flex items-center gap-1.5 text-sm text-slate-600">
                  <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
                  {t('activity.primaryPicLabel')}: {primaryPersonnel.name}
                </div>
              )}

              {(activity.pic_name || activity.pic_phone) && (
                <div className="flex items-center gap-1.5 text-sm text-slate-600">
                  <UserRound className="h-3.5 w-3.5 text-slate-400" />
                  {t('activity.picLabel')}: {activity.pic_name || '—'}{activity.pic_phone && ` · ${activity.pic_phone}`}
                </div>
              )}

              {activity.notes && <p className="text-sm text-slate-600 bg-slate-50 rounded-control p-3">{activity.notes}</p>}

              {review && (
                <div className="flex items-center gap-2 text-sm">
                  <ClipboardCheck className="h-4 w-4 text-slate-400" />
                  <span className="text-slate-500">{t('activity.formReview')}:</span>
                  <StatusBadge status={review.status} />
                </div>
              )}
            </div>
          </details>
        )}

        {canEditSchedule && !locked && (
          <button onClick={handleCancel} className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-700">
            <Ban className="h-3.5 w-3.5" /> {t('activity.cancelActivity')}
          </button>
        )}
      </div>

      <div className="space-y-4">
        <ExecutionPanel activity={activity} targetLat={targetLat} targetLng={targetLng} canAct={!!user} onChanged={load} />
        <PersonnelPanel activityId={activity.id} personnel={personnel} locked={locked} canEdit={!!user} isStaff={!!canEditSchedule} onChanged={load} />
        <EvidencePanel
          activityId={activity.id}
          projectId={activity.project_id}
          evidence={evidence}
          locked={locked}
          minRequired={activity.activity_categories?.requires_evidence ? (activity.activity_categories?.evidence_min_count ?? 1) : 0}
          onChanged={load}
        />
      </div>

      {canEditSchedule ? (
        <ActivityFormModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); load(); }}
          categories={categories}
          activity={activity}
        />
      ) : (
        <SalesRescheduleModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); load(); }}
          activity={activity}
        />
      )}
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-slate-700 mt-0.5">{children}</p>
    </div>
  );
}
