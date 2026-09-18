'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, MapPin, Calendar, Pencil, Plus, Users, Camera, Navigation } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/app/providers';
import type { Project, Activity } from '@/lib/types';
import { formatDate, formatDateTime, formatDistance } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { LoadingState, ErrorState } from '@/components/shared/States';
import { ProjectFormModal } from '../_components/ProjectFormModal';

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [evidenceCounts, setEvidenceCounts] = useState<Record<string, number>>({});
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
        const { data: evid } = await supabase.from('activity_evidence').select('activity_id').in('activity_id', ids);
        const counts: Record<string, number> = {};
        for (const e of evid ?? []) counts[e.activity_id] = (counts[e.activity_id] ?? 0) + 1;
        setEvidenceCounts(counts);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load project.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState />;
  if (error || !project) return <ErrorState message={error ?? 'Project not found.'} onRetry={load} />;

  const canEdit = user && ['admin', 'supervisor'].includes(user.role);
  const completed = activities.filter(a => a.status === 'completed').length;
  const total = activities.length;
  const progressPct = total === 0 ? 0 : Math.round((completed / total) * 100);

  return (
    <div>
      <button onClick={() => router.push('/projects')} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft className="h-4 w-4" /> Back to Projects
      </button>

      <div className="bg-white rounded-card border border-slate-200 shadow-card p-5 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">{project.name}</h1>
              <span className="text-xs font-mono text-slate-400">{project.code}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
              {project.customer_name && <span>{project.customer_name}</span>}
              {project.address && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{project.address}</span>}
              {project.expected_completion && <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />Target: {formatDate(project.expected_completion)}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={project.status} />
            {canEdit && (
              <button onClick={() => setEditOpen(true)} className="inline-flex items-center gap-1 rounded-control border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
            )}
          </div>
        </div>

        {project.notes && <p className="text-sm text-slate-600 mt-3 bg-slate-50 rounded-control p-3">{project.notes}</p>}

        <div className="mt-4">
          <div className="flex items-center justify-between text-sm mb-1.5">
            <span className="text-slate-500">Overall progress</span>
            <span className="font-medium text-slate-700">{completed}/{total} activities · {progressPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full bg-brand-600 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-slate-900">Activity Timeline</h2>
        {canEdit && (
          <Link href={`/request-schedule?projectId=${project.id}`} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-3 py-1.5 hover:bg-brand-700">
            <Plus className="h-4 w-4" /> Add Activity
          </Link>
        )}
      </div>

      <div className="bg-white rounded-card border border-slate-200 shadow-card">
        {activities.length === 0 ? (
          <p className="text-sm text-slate-400 py-10 text-center">No activities yet for this project.</p>
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
                  <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{a.personnel_count} people</span>
                    <span className="inline-flex items-center gap-1"><Camera className="h-3.5 w-3.5" />{evidenceCounts[a.id] ?? 0} photos</span>
                    {a.gps_validation_status && (
                      <span className="inline-flex items-center gap-1">
                        <Navigation className="h-3.5 w-3.5" />
                        {a.gps_validation_status === 'valid' ? 'GPS valid' : a.gps_validation_status.replace('_', ' ')}
                        {a.distance_from_target_m != null && ` · ${formatDistance(a.distance_from_target_m)}`}
                      </span>
                    )}
                  </div>
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
