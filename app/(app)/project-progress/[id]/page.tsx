'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Users, Camera, Navigation, CheckCircle2, Clock, CalendarClock, ListTodo, AlertTriangle, History } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/app/providers';
import type { Project, Activity, ActivityPersonnel, ActivityEvidence, ActivityDiscountEligibility } from '@/lib/types';
import { formatDate, formatDateTime, formatDistance } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { LoadingState, ErrorState } from '@/components/shared/States';
import { useSignedUrls } from '@/lib/useSignedUrls';

export default function ProjectProgressDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useLanguage();
  const [project, setProject] = useState<Project | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [personnel, setPersonnel] = useState<ActivityPersonnel[]>([]);
  const [recentEvidence, setRecentEvidence] = useState<ActivityEvidence[]>([]);
  const [discountByActivity, setDiscountByActivity] = useState<Record<string, ActivityDiscountEligibility>>({});
  const { urls: thumbs, error: thumbsError, retry: retryThumbs } = useSignedUrls(recentEvidence.map(e => e.thumbnail_path ?? e.storage_path));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: proj, error: projErr }, { data: acts, error: actErr }] = await Promise.all([
        supabase.from('projects').select('*').eq('id', id).single(),
        supabase.from('activities')
          .select('*, activity_categories(id, name, code)')
          .eq('project_id', id)
          .order('scheduled_date', { ascending: true }),
      ]);
      if (projErr) throw projErr;
      if (actErr) throw actErr;
      setProject(proj as Project);
      setActivities((acts as Activity[]) ?? []);

      const ids = ((acts as Activity[]) ?? []).map(a => a.id);
      if (ids.length > 0) {
        const [{ data: pers }, { data: evid }] = await Promise.all([
          supabase.from('activity_personnel').select('*').in('activity_id', ids),
          supabase.from('activity_evidence').select('*').in('activity_id', ids).order('uploaded_at', { ascending: false }).limit(8),
        ]);
        setPersonnel((pers as ActivityPersonnel[]) ?? []);
        setRecentEvidence((evid as ActivityEvidence[]) ?? []);
      }

      const { data: elig } = await supabase.from('activity_discount_eligibility').select('*').eq('project_id', id);
      const map: Record<string, ActivityDiscountEligibility> = {};
      for (const e of (elig as ActivityDiscountEligibility[]) ?? []) map[e.activity_id] = e;
      setDiscountByActivity(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('projectProgress.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState />;
  if (error || !project) return <ErrorState message={error ?? t('projectProgress.notFound')} onRetry={load} />;

  const total = activities.length;
  const completed = activities.filter(a => a.status === 'completed').length;
  const inProgress = activities.filter(a => a.status === 'in_progress').length;
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = activities.filter(a => a.status === 'scheduled' && a.scheduled_date >= today).length;
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  const uniquePersonnel = Array.from(new Map(personnel.map(p => [p.name.toLowerCase(), p])).values());
  const primaryByActivity: Record<string, ActivityPersonnel> = {};
  for (const p of personnel) if (p.is_primary) primaryByActivity[p.activity_id] = p;
  const latestActivity = [...activities].sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1))[0];
  const latestGpsActivity = [...activities].filter(a => a.gps_captured_at).sort((a, b) => (a.gps_captured_at! < b.gps_captured_at! ? 1 : -1))[0];

  return (
    <div>
      <button onClick={() => router.push('/project-progress')} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft className="h-4 w-4" /> {t('projectProgress.backToProjectProgress')}
      </button>

      <div className="bg-white rounded-card border border-slate-200 shadow-card p-5 mb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">{project.name}</h1>
              <span className="text-xs font-mono text-slate-400">{project.code}</span>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">{project.customer_name}</p>
          </div>
          <StatusBadge status={project.status} />
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between text-sm mb-1.5">
            <span className="text-slate-500">{t('projects.overallProgress')}</span>
            <span className="font-medium text-slate-700">{pct}%</span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full bg-brand-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatTile icon={ListTodo} label={t('projectProgress.totalActivities')} value={total} />
        <StatTile icon={CheckCircle2} label={t('projectProgress.completed')} value={completed} accent="text-emerald-600" />
        <StatTile icon={Clock} label={t('projectProgress.inProgress')} value={inProgress} accent="text-blue-600" />
        <StatTile icon={CalendarClock} label={t('projectProgress.upcoming')} value={upcoming} accent="text-amber-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-card border border-slate-200 shadow-card p-5">
          <h2 className="font-semibold text-slate-900 mb-3">{t('projectProgress.activityTimeline')}</h2>
          <ol className="relative border-l border-slate-200 ml-3">
            {activities.map(a => (
              <li key={a.id} className="mb-5 last:mb-0 ml-5">
                <span className="absolute -left-[7px] mt-1.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-brand-500" />
                <Link href={`/request-schedule/${a.id}`} className="block hover:bg-slate-50 -m-2 p-2 rounded-control">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800">{a.activity_categories?.name}: {a.title}</span>
                    <StatusBadge status={a.status} />
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {formatDate(a.scheduled_date)}
                    {primaryByActivity[a.id] && ` · ${t('projectProgress.primaryPicPrefix')}: ${primaryByActivity[a.id].name}`}
                  </p>
                  {discountByActivity[a.id] && (
                    <p className="text-xs text-amber-700 mt-1 flex items-center gap-1"><History className="h-3 w-3" /> {t('projectProgress.previousDemoBadge')}</p>
                  )}
                </Link>
              </li>
            ))}
          </ol>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-card border border-slate-200 shadow-card p-5">
            <h3 className="font-semibold text-slate-900 mb-2 flex items-center gap-2"><Users className="h-4 w-4" /> {t('projectProgress.personnelInvolved')}</h3>
            {uniquePersonnel.length === 0 ? <p className="text-sm text-slate-400">{t('projectProgress.noneYet')}</p> : (
              <ul className="text-sm text-slate-600 space-y-1">{uniquePersonnel.slice(0, 10).map(p => <li key={p.id}>{p.name}</li>)}</ul>
            )}
          </div>

          <div className="bg-white rounded-card border border-slate-200 shadow-card p-5">
            <h3 className="font-semibold text-slate-900 mb-2 flex items-center gap-2"><Navigation className="h-4 w-4" /> {t('projectProgress.latestGpsExecution')}</h3>
            {latestGpsActivity ? (
              <div className="text-sm text-slate-600">
                <p>{latestGpsActivity.title}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {latestGpsActivity.gps_validation_status === 'valid' ? t('projectProgress.valid') : latestGpsActivity.gps_validation_status?.replace('_', ' ')}
                  {latestGpsActivity.distance_from_target_m != null && ` · ${formatDistance(latestGpsActivity.distance_from_target_m)}`}
                  {' · '}{formatDateTime(latestGpsActivity.gps_captured_at)}
                </p>
              </div>
            ) : <p className="text-sm text-slate-400">{t('projectProgress.noGpsCaptures')}</p>}
          </div>

          <div className="bg-white rounded-card border border-slate-200 shadow-card p-5">
            <h3 className="font-semibold text-slate-900 mb-2 flex items-center gap-2"><Camera className="h-4 w-4" /> {t('projectProgress.recentEvidence')}</h3>
            {thumbsError && (
              <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-control px-3 py-1.5 mb-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">{t('evidence.couldNotLoadPreviews')}</span>
                <button onClick={retryThumbs} className="font-medium underline">{t('evidence.retry')}</button>
              </div>
            )}
            {recentEvidence.length === 0 ? <p className="text-sm text-slate-400">{t('projectProgress.noPhotosYet')}</p> : (
              <div className="grid grid-cols-4 gap-1.5">
                {recentEvidence.map(e => (
                  <div key={e.id} className="aspect-square rounded-control overflow-hidden bg-slate-100">
                    {thumbs[e.thumbnail_path ?? e.storage_path] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbs[e.thumbnail_path ?? e.storage_path]} alt="Evidence" className="h-full w-full object-cover" loading="lazy" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {latestActivity && (
            <div className="bg-white rounded-card border border-slate-200 shadow-card p-5">
              <h3 className="font-semibold text-slate-900 mb-2">{t('projectProgress.latestActivity')}</h3>
              <p className="text-sm text-slate-600">{latestActivity.title}</p>
              <p className="text-xs text-slate-400 mt-0.5">{formatDateTime(latestActivity.updated_at)}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({ icon: Icon, label, value, accent }: { icon: React.ElementType; label: string; value: number; accent?: string }) {
  return (
    <div className="bg-white rounded-card border border-slate-200 shadow-card p-4">
      <Icon className={`h-4 w-4 mb-2 ${accent ?? 'text-slate-400'}`} />
      <p className={`text-2xl font-semibold ${accent ?? 'text-slate-900'}`}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
