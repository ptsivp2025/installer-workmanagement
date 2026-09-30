'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { MapPin, Calendar, Pencil, Plus, Users, Camera, Navigation, History, Package, Repeat2, UserRound, UserX } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import type { Project, Activity, ActivityPersonnel, ActivityDiscountEligibility, DemoTimelineRow } from '@/lib/types';
import { formatDate, formatDateTime, formatDistance, errorMessage } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { LoadingState, ErrorState } from '@/components/shared/States';
import { ProjectFormModal } from '../_components/ProjectFormModal';
import { BackButton } from '@/components/shared/BackButton';

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [project, setProject] = useState<Project | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [evidenceCounts, setEvidenceCounts] = useState<Record<string, number>>({});
  const [primaryByActivity, setPrimaryByActivity] = useState<Record<string, ActivityPersonnel>>({});
  const [discountByActivity, setDiscountByActivity] = useState<Record<string, ActivityDiscountEligibility>>({});
  const [demoTimeline, setDemoTimeline] = useState<DemoTimelineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: proj, error: projErr }, { data: acts, error: actErr }] = await Promise.all([
        supabase.from('projects').select('*').eq('id', id).single(),
        supabase.from('activities')
          .select('*, activity_categories(id, name, code, requires_gps, requires_evidence, requires_personnel)')
          .eq('project_id', id)
          .order('scheduled_date', { ascending: true })
          .order('created_at', { ascending: true }),
      ]);
      if (projErr) throw projErr;
      if (actErr) throw actErr;
      setProject(proj as Project);
      setActivities((acts as Activity[]) ?? []);

      const ids = ((acts as Activity[]) ?? []).map(a => a.id);
      if (ids.length > 0) {
        const [{ data: evid }, { data: pers }] = await Promise.all([
          supabase.from('activity_evidence').select('activity_id').in('activity_id', ids),
          supabase.from('activity_personnel').select('*').in('activity_id', ids).eq('is_primary', true),
        ]);
        const counts: Record<string, number> = {};
        for (const e of evid ?? []) counts[e.activity_id] = (counts[e.activity_id] ?? 0) + 1;
        setEvidenceCounts(counts);
        const primaryMap: Record<string, ActivityPersonnel> = {};
        for (const p of (pers as ActivityPersonnel[]) ?? []) primaryMap[p.activity_id] = p;
        setPrimaryByActivity(primaryMap);
      }

      // Best-effort: a not-yet-applied migration must never take down the
      // Project History timeline, only hide the "Previous Demo Found" badge.
      try {
        const { data: elig } = await supabase.from('activity_discount_eligibility').select('*').eq('project_id', id);
        const discMap: Record<string, ActivityDiscountEligibility> = {};
        for (const e of (elig as ActivityDiscountEligibility[]) ?? []) discMap[e.activity_id] = e;
        setDiscountByActivity(discMap);
      } catch {
        setDiscountByActivity({});
      }

      // Same rule: migration 029 may not have been applied yet, and that
      // must hide this panel, not break the page.
      try {
        const { data: tl } = await supabase.from('activity_demo_timeline').select('*')
          .eq('project_id', id).order('completed_at', { nullsFirst: false }).order('scheduled_date');
        setDemoTimeline((tl as DemoTimelineRow[]) ?? []);
      } catch {
        setDemoTimeline([]);
      }
    } catch (e) {
      setError(errorMessage(e, t('projects.failedToLoad')));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState />;
  if (error || !project) return <ErrorState message={error ?? t('projects.notFound')} onRetry={load} />;

  const canEdit = user && ['admin', 'supervisor'].includes(user.role);
  const completed = activities.filter(a => a.status === 'completed').length;
  const total = activities.length;
  const progressPct = total === 0 ? 0 : Math.round((completed / total) * 100);

  return (
    <div>
      <BackButton fallbackHref="/projects" />

      <div className="bg-white rounded-card border border-slate-200 shadow-bento p-5 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">{project.name}</h1>
              <span className="text-xs font-mono text-slate-400">{project.code}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
              {project.customer_name && <span>{project.customer_name}</span>}
              {project.sales_user_id && (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 border border-brand-100 px-2 py-0.5 text-[12px] text-brand-800">
                  <UserRound className="h-3.5 w-3.5" />{t('projects.sales')}: <b className="font-semibold">{project.sales_person_name ?? '—'}</b>
                </span>
              )}
              {project.address && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{project.address}</span>}
              {project.expected_completion && <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{t('projects.target')}: {formatDate(project.expected_completion)}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={project.status} />
            {canEdit && (
              <button onClick={() => setEditOpen(true)} className="inline-flex items-center gap-1 rounded-control border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                <Pencil className="h-3.5 w-3.5" /> {t('common.edit')}
              </button>
            )}
          </div>
        </div>

        {!project.sales_user_id && (
          <div className="mt-3 flex items-center gap-3 rounded-control border border-amber-200 bg-amber-50 px-3 py-2.5">
            <UserX className="h-4 w-4 text-amber-600 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-800">{t('projects.salesUnassigned')}</p>
              <p className="text-[12px] text-amber-700">{t('projects.salesUnassignedHint')}</p>
            </div>
            {canEdit && (
              <button onClick={() => setEditOpen(true)} className="shrink-0 rounded-control bg-amber-600 text-white text-[12.5px] font-semibold px-3 py-1.5 hover:bg-amber-700">
                {t('projects.assignSales')}
              </button>
            )}
          </div>
        )}

        {project.notes && <p className="text-sm text-slate-600 mt-3 bg-slate-50 rounded-control p-3">{project.notes}</p>}

        <div className="mt-4">
          <div className="flex items-center justify-between text-sm mb-1.5">
            <span className="text-slate-500">{t('projects.overallProgress')}</span>
            <span className="font-medium text-slate-700">{completed}/{total} {t('projects.activities')} · {progressPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full bg-brand-600 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      </div>

      {/* The chain this platform exists to record: which purchase came out of
          which demo, how long after, and whether it has been claimed (029). */}
      {demoTimeline.length > 0 && (
        <div className="bg-white rounded-card border border-slate-200 shadow-bento mb-4 overflow-hidden">
          <header className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100">
            <Repeat2 className="h-4 w-4 text-slate-500" />
            <h2 className="text-[11px] font-bold text-slate-700 uppercase tracking-[0.14em] flex-1">{t('timeline.title')}</h2>
            <Link href="/demo-recap" className="text-[11px] font-bold text-brand-700 hover:underline">{t('dashboard.seeAll')}</Link>
          </header>
          <ul className="divide-y divide-slate-100">
            {demoTimeline.map(r => (
              <li key={r.activity_id} className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.counts_as_demo ? 'bg-blue-500' : 'bg-emerald-600'}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-slate-800 truncate">
                    {r.title}
                    {r.room_name && <span className="ml-2 text-[11px] font-semibold text-slate-500">· {r.room_name}</span>}
                  </p>
                  <p className="text-[11.5px] text-slate-500 truncate">
                    {r.category_name} · {[r.product_brand, r.product_type, r.product_model].filter(Boolean).join(' ') || '—'}
                  </p>
                </div>
                <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                  {r.completed_at ? formatDate(r.completed_at) : formatDate(r.scheduled_date)}
                </span>
                {r.counts_as_installation && (
                  <span className={`w-full sm:w-auto text-[11px] font-semibold shrink-0 ${r.demo_activity_id ? 'text-emerald-700' : 'text-slate-400'}`}>
                    {r.demo_activity_id
                      ? t('timeline.linkedTo', { no: r.demo_request_number ?? '', days: r.days_since_demo ?? 0 })
                      : t('timeline.notLinked')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-slate-900">{t('projectProgress.activityTimeline')}</h2>
        {canEdit && (
          <Link href={`/request-schedule?projectId=${project.id}`} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-3 py-1.5 hover:bg-brand-700">
            <Plus className="h-4 w-4" /> {t('projects.addActivity')}
          </Link>
        )}
      </div>

      <div className="bg-white rounded-card border border-slate-200 shadow-bento">
        {activities.length === 0 ? (
          <p className="text-sm text-slate-400 py-10 text-center">{t('projects.noActivitiesForProject')}</p>
        ) : (
          <ol className="relative border-l border-slate-200 ml-4 py-4 pr-4">
            {activities.map(a => (
              <li key={a.id} className="mb-6 last:mb-0 ml-6">
                <span className="absolute -left-[7px] mt-1.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-brand-500" />
                <Link href={`/request-schedule/${a.id}`} className="block hover:bg-slate-50 -m-2 p-2 rounded-control transition">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <span className="text-xs font-semibold text-brand-700 uppercase tracking-wide">{a.activity_categories?.name ?? 'Activity'}</span>
                      <p className="font-medium text-slate-900">{a.title}</p>
                    </div>
                    <StatusBadge status={a.status} />
                  </div>
                  <p className="text-sm text-slate-500 mt-1">{formatDate(a.scheduled_date)} · Req# {a.request_number}</p>
                  {(a.product_brand || a.product_type) && (
                    <p className="text-xs text-slate-500 mt-1 inline-flex items-center gap-1">
                      <Package className="h-3.5 w-3.5" />{[a.product_brand, a.product_type].filter(Boolean).join(' ')}{a.product_model && ` · ${a.product_model}`}
                    </p>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-xs text-slate-500 flex-wrap">
                    {primaryByActivity[a.id] && (
                      <span className="inline-flex items-center gap-1">{t('projectProgress.primaryPicPrefix')}: {primaryByActivity[a.id].name}</span>
                    )}
                    <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{a.personnel_count} {t('projects.people')}</span>
                    <span className="inline-flex items-center gap-1"><Camera className="h-3.5 w-3.5" />{evidenceCounts[a.id] ?? 0} {t('projects.photos')}</span>
                    {a.gps_validation_status && (
                      <span className="inline-flex items-center gap-1">
                        <Navigation className="h-3.5 w-3.5" />
                        {a.gps_validation_status === 'valid' ? t('execution.gpsValid') : a.gps_validation_status.replace('_', ' ')}
                        {a.distance_from_target_m != null && ` · ${formatDistance(a.distance_from_target_m)}`}
                      </span>
                    )}
                  </div>
                  {discountByActivity[a.id] && (
                    <p className="text-xs text-amber-700 mt-1.5 flex items-center gap-1"><History className="h-3 w-3" /> {t('projectProgress.previousDemoBadge')}</p>
                  )}
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>

      <ProjectFormModal open={editOpen} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); load(); }} project={project} />
    </div>
  );
}
