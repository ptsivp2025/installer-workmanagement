'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, RefreshCw, Check, X, MapPin, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import type { ProjectRequest } from '@/lib/types';
import { formatDate, formatDateTime, errorMessage } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { LoadingState, ErrorState, EmptyState, SkeletonList } from '@/components/shared/States';
import { ProjectRequestFormModal } from './_components/ProjectRequestFormModal';
import { ApproveRequestModal } from './_components/ApproveRequestModal';

export default function ProjectRequestsPage() {
  const { user } = useAuth();
  if (!user) return <LoadingState />;
  return user.role === 'sales' ? <SalesRequestList /> : <StaffRequestQueue />;
}

// ── Sales: submit + track own requests ─────────────────────────────────────
function SalesRequestList() {
  const { t } = useLanguage();
  const [requests, setRequests] = useState<ProjectRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('project_requests')
      .select('*, activity_categories(name)')
      .order('created_at', { ascending: false });
    if (err) setError(errorMessage(err, t('projectRequests.loadFailed')));
    else setRequests((data as ProjectRequest[]) ?? []);
    setLoading(false);
  }, [t]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t('nav.projectRequests')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('projectRequests.salesSubtitle')}</p>
        </div>
        <button onClick={() => setFormOpen(true)} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-3.5 py-2 hover:bg-brand-700">
          <Plus className="h-4 w-4" /> {t('projectRequests.newRequest')}
        </button>
      </div>

      <div className="bg-white rounded-card border border-slate-200 shadow-card overflow-hidden">
        {loading ? (
          <SkeletonList rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : requests.length === 0 ? (
          <EmptyState title={t('projectRequests.noneYet')} description={t('projectRequests.noneYetDesc')} />
        ) : (
          <div className="divide-y divide-slate-100">
            {requests.map(r => (
              <div key={r.id} className="stagger-item flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900 truncate">{r.project_name}</p>
                  <p className="text-xs text-slate-500 truncate">
                    {r.customer_name}{r.activity_categories?.name ? ` · ${r.activity_categories.name}` : ''} · {formatDate(r.created_at)}
                  </p>
                  {r.status === 'rejected' && r.rejection_reason && (
                    <p className="text-xs text-red-600 mt-0.5">{t('projectRequests.rejectionReason')}: {r.rejection_reason}</p>
                  )}
                </div>
                <StatusBadge status={r.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      <ProjectRequestFormModal open={formOpen} onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); load(); }} />
    </div>
  );
}

// ── Admin/Supervisor: decide the queue ──────────────────────────────────────
function StaffRequestQueue() {
  const { t } = useLanguage();
  const router = useRouter();
  const [requests, setRequests] = useState<ProjectRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState<ProjectRequest | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('project_requests')
      .select('*, users!project_requests_requested_by_fkey(full_name, username), sales_divisions(name), activity_categories(name)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (err) setError(errorMessage(err, t('projectRequests.loadFailed')));
    else setRequests((data as ProjectRequest[]) ?? []);
    setLoading(false);
  }, [t]);

  useEffect(() => { load(); }, [load]);

  async function handleReject(r: ProjectRequest) {
    const reason = window.prompt(t('projectRequests.rejectPrompt'));
    if (!reason || !reason.trim()) return;
    setRejecting(r.id);
    const { error: err } = await supabase.rpc('iwm_reject_project_request', { p_request_id: r.id, p_reason: reason.trim() });
    setRejecting(null);
    if (err) { setError(errorMessage(err, t('projectRequests.rejectFailed'))); return; }
    load();
  }

  const pending = requests.filter(r => r.status === 'pending');
  const decided = requests.filter(r => r.status !== 'pending');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t('nav.projectRequests')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('projectRequests.staffSubtitle')}</p>
        </div>
        <button onClick={load} className="inline-flex items-center justify-center rounded-control border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <SkeletonList rows={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : requests.length === 0 ? (
        <EmptyState title={t('projectRequests.noneYet')} description={t('projectRequests.noneYetDescStaff')} />
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-slate-700 mb-2">{t('projectRequests.pendingSection')} ({pending.length})</h2>
              <div className="space-y-2">
                {pending.map(r => (
                  <div key={r.id} className="stagger-item bg-white rounded-card border border-amber-200 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900">{r.project_name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {r.customer_name && `${r.customer_name} · `}
                        {r.sales_divisions?.name} · {t('projectRequests.requestedBy')} {r.users?.full_name ?? r.users?.username}
                      </p>
                      {r.address && (
                        <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1"><MapPin className="h-3 w-3 shrink-0" /> {r.address}</p>
                      )}
                      {r.notes && <p className="text-xs text-slate-400 mt-0.5 italic">&quot;{r.notes}&quot;</p>}
                      <p className="text-[11px] text-slate-400 mt-1">{formatDateTime(r.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleReject(r)}
                        disabled={rejecting === r.id}
                        className="inline-flex items-center gap-1 rounded-control border border-red-200 text-red-600 text-sm font-medium px-3 py-1.5 hover:bg-red-50 disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" /> {t('projectRequests.reject')}
                      </button>
                      <button
                        onClick={() => setApproving(r)}
                        className="inline-flex items-center gap-1 rounded-control bg-emerald-600 text-white text-sm font-medium px-3 py-1.5 hover:bg-emerald-700"
                      >
                        <Check className="h-3.5 w-3.5" /> {t('projectRequests.approve')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {decided.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-slate-700 mb-2">{t('projectRequests.decidedSection')}</h2>
              <div className="bg-white rounded-card border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                {decided.map(r => (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 truncate">{r.project_name}</p>
                      <p className="text-xs text-slate-400 truncate">{r.sales_divisions?.name} · {formatDate(r.created_at)}</p>
                    </div>
                    {r.status === 'approved' && r.resulting_project_id && (
                      <button
                        onClick={() => router.push(`/request-schedule?projectId=${r.resulting_project_id}`)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 shrink-0"
                      >
                        {t('projectRequests.addActivity')} <ArrowRight className="h-3 w-3" />
                      </button>
                    )}
                    <StatusBadge status={r.status} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <ApproveRequestModal
        request={approving}
        onClose={() => setApproving(null)}
        onDone={(projectId) => { setApproving(null); load(); router.push(`/request-schedule?projectId=${projectId}`); }}
      />
    </div>
  );
}
