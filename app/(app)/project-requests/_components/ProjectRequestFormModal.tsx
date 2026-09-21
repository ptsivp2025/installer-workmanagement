'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import { Modal } from '@/components/shared/Modal';
import { LocationPicker } from '@/components/shared/LocationPicker';
import type { ActivityCategory } from '@/lib/types';
import { errorMessage } from '@/lib/utils';

/**
 * A Sales/customer account's own request for new work — the "guest" side of
 * the flow: they describe what's needed, an admin or supervisor decides
 * (ProjectRequestQueue) and, on approval, turns it into a real Project.
 * INSERT is the only thing RLS lets a Sales account do to this table
 * (020_project_requests_and_notifications.sql) — there's no edit/withdraw
 * once sent, same as the rest of the platform never lets history quietly
 * change after the fact.
 */
export function ProjectRequestFormModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [categories, setCategories] = useState<ActivityCategory[]>([]);
  const [salesDivisionId, setSalesDivisionId] = useState<string | null>(null);
  const [form, setForm] = useState({
    project_name: '', customer_name: '', customer_phone: '', address: '', latitude: '', longitude: '',
    category_id: '', requested_date: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !user) return;
    setForm({ project_name: '', customer_name: '', customer_phone: '', address: '', latitude: '', longitude: '', category_id: '', requested_date: '', notes: '' });
    setError(null);
    supabase.from('activity_categories').select('*').eq('active', true).order('sort_order')
      .then((res: { data: ActivityCategory[] | null }) => setCategories(res.data ?? []));
    // A request must land in the requester's own division (the insert
    // policy checks it), so this is read fresh rather than trusted from the
    // cached session profile.
    supabase.from('users').select('sales_division_id').eq('id', user.id).single()
      .then((res: { data: { sales_division_id: string | null } | null }) => setSalesDivisionId(res.data?.sales_division_id ?? null));
  }, [open, user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.project_name.trim()) { setError(t('projectRequests.nameRequired')); return; }
    if (!salesDivisionId) { setError(t('projectRequests.noDivision')); return; }
    setSaving(true);
    setError(null);

    const { error: err } = await supabase.from('project_requests').insert({
      requested_by: user!.id,
      sales_division_id: salesDivisionId,
      project_name: form.project_name.trim(),
      customer_name: form.customer_name.trim() || null,
      customer_phone: form.customer_phone.trim() || null,
      address: form.address.trim() || null,
      latitude: form.latitude ? Number(form.latitude) : null,
      longitude: form.longitude ? Number(form.longitude) : null,
      category_id: form.category_id || null,
      requested_date: form.requested_date || null,
      notes: form.notes.trim() || null,
      status: 'pending',
    });

    setSaving(false);
    if (err) { setError(errorMessage(err, t('projectRequests.saveFailed'))); return; }
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title={t('projectRequests.newRequest')} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 animate-fade-in">{error}</div>}
        <p className="text-sm text-slate-500 -mt-1">{t('projectRequests.formIntro')}</p>

        <Field label={t('projectRequests.projectName')} required>
          <input value={form.project_name} onChange={e => setForm(f => ({ ...f, project_name: e.target.value }))} className={inputCls} placeholder="e.g. ABC Hotel — Lobby" />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('projectRequests.customerName')}>
            <input value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))} className={inputCls} />
          </Field>
          <Field label={t('projectRequests.customerPhone')}>
            <input value={form.customer_phone} onChange={e => setForm(f => ({ ...f, customer_phone: e.target.value }))} className={inputCls} />
          </Field>
        </div>

        <LocationPicker
          address={form.address}
          latitude={form.latitude}
          longitude={form.longitude}
          onChange={(address, latitude, longitude) => setForm(f => ({ ...f, address, latitude, longitude }))}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('projectRequests.desiredCategory')}>
            <select value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))} className={inputCls}>
              <option value="">{t('projectRequests.notSure')}</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label={t('projectRequests.requestedDate')}>
            <input type="date" value={form.requested_date} onChange={e => setForm(f => ({ ...f, requested_date: e.target.value }))} className={inputCls} />
          </Field>
        </div>

        <Field label={t('common.notes')}>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={inputCls} rows={3} placeholder={t('projectRequests.notesPlaceholder')} />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-control px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">{t('common.cancel')}</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-4 py-2 hover:bg-brand-700 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {t('projectRequests.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const inputCls = 'w-full rounded-control border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}{required && <span className="text-red-500"> *</span>}</label>
      {children}
    </div>
  );
}
