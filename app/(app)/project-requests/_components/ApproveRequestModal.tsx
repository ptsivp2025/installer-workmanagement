'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/app/providers';
import { Modal } from '@/components/shared/Modal';
import type { ProjectRequest } from '@/lib/types';
import { errorMessage } from '@/lib/utils';

/**
 * Approving is never a raw client UPDATE — it goes through
 * iwm_approve_project_request() (020), which creates the real Project and
 * flips the request to 'approved' atomically. This modal only collects the
 * one thing Sales doesn't set: the internal project code.
 */
export function ApproveRequestModal({
  request, onClose, onDone,
}: { request: ProjectRequest | null; onClose: () => void; onDone: (projectId: string) => void }) {
  const { t } = useLanguage();
  const [code, setCode] = useState('');
  const [expectedCompletion, setExpectedCompletion] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (request) {
      setCode(`PRJ-${Date.now().toString(36).toUpperCase()}`);
      setExpectedCompletion('');
      setError(null);
    }
  }, [request]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!request) return;
    if (!code.trim()) { setError(t('projects.codeNameRequired')); return; }
    setSaving(true);
    setError(null);

    const { data, error: err } = await supabase.rpc('iwm_approve_project_request', {
      p_request_id: request.id,
      p_code: code.trim(),
      p_expected_completion: expectedCompletion || null,
    });

    setSaving(false);
    if (err) { setError(errorMessage(err, t('projectRequests.approveFailed'))); return; }
    onDone((data as { project_id: string }).project_id);
  }

  return (
    <Modal open={!!request} onClose={onClose} title={t('projectRequests.approveTitle')}>
      {request && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 animate-fade-in">{error}</div>}
          <div className="rounded-control bg-slate-50 border border-slate-200 p-3">
            <p className="font-medium text-slate-900 text-sm">{request.project_name}</p>
            {request.customer_name && <p className="text-xs text-slate-500 mt-0.5">{request.customer_name}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('projects.projectCode')}<span className="text-red-500"> *</span></label>
            <input value={code} onChange={e => setCode(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('projects.expectedCompletion')}</label>
            <input type="date" value={expectedCompletion} onChange={e => setExpectedCompletion(e.target.value)} className={inputCls} />
          </div>
          <p className="text-xs text-slate-400">{t('projectRequests.approveHint')}</p>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-control px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">{t('common.cancel')}</button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-control bg-emerald-600 text-white text-sm font-medium px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} {t('projectRequests.approveAndCreate')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

const inputCls = 'w-full rounded-control border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';
