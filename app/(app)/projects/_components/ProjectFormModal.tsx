'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import { Modal } from '@/components/shared/Modal';
import { LocationPicker } from '@/components/shared/LocationPicker';
import type { Project } from '@/lib/types';
import type { DictKey } from '@/lib/i18n';
import { Loader2, Building2 } from 'lucide-react';
import { SearchableSelect } from '@/components/shared/SearchableSelect';
import { PROJECT_STATUSES } from '@/lib/constants';

interface SalesChoice { id: string; full_name: string; username: string; sales_division_id: string | null; division_name: string | null }

export function ProjectFormModal({
  open, onClose, onSaved, project,
}: { open: boolean; onClose: () => void; onSaved: () => void; project?: Project | null }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [salesUsers, setSalesUsers] = useState<SalesChoice[]>([]);
  const [form, setForm] = useState({
    code: '', name: '', address: '', latitude: '', longitude: '',
    expected_completion: '', notes: '', status: 'active', sales_user_id: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // The Sales Proyek decides who on the vendor side sees the project, and
    // its division is the project's division: nothing to pick twice (030).
    supabase.rpc('iwm_sales_choices')
      .then((res: { data: SalesChoice[] | null }) => setSalesUsers(res.data ?? []));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (project) {
      setForm({
        code: project.code, name: project.name,
        address: project.address ?? '', latitude: project.latitude?.toString() ?? '',
        longitude: project.longitude?.toString() ?? '', expected_completion: project.expected_completion ?? '',
        notes: project.notes ?? '', status: project.status, sales_user_id: project.sales_user_id ?? '',
      });
    } else {
      setForm({ code: `PRJ-${Date.now().toString(36).toUpperCase()}`, name: '', address: '', latitude: '', longitude: '', expected_completion: '', notes: '', status: 'active', sales_user_id: '' });
    }
    setError(null);
  }, [open, project]);

  const owner = salesUsers.find(u => u.id === form.sales_user_id) ?? null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.code.trim()) { setError(t('projects.codeNameRequired')); return; }
    if (!form.sales_user_id || !owner) { setError(t('projects.salesRequired')); return; }
    setSaving(true);
    setError(null);

    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      // The vendor company is the Sales Proyek's division. The database sets
      // the division and the Sales name from the account as well (030).
      customer_name: owner.division_name,
      sales_division_id: owner.sales_division_id,
      sales_user_id: owner.id,
      sales_person_name: owner.full_name,
      address: form.address.trim() || null,
      latitude: form.latitude ? Number(form.latitude) : null,
      longitude: form.longitude ? Number(form.longitude) : null,
      expected_completion: form.expected_completion || null,
      notes: form.notes.trim() || null,
      status: form.status,
    };

    const result = project
      ? await supabase.from('projects').update(payload).eq('id', project.id)
      : await supabase.from('projects').insert({ ...payload, created_by: user?.id ?? null });

    setSaving(false);
    if (result.error) { setError(result.error.message); return; }
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title={project ? t('projects.editProject') : t('projects.newProject')} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('projects.projectCode')} required>
            <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} className={inputCls} />
          </Field>
          <Field label={t('common.status')}>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={inputCls}>
              {PROJECT_STATUSES.map(s => <option key={s} value={s}>{t(`status.${s}` as DictKey)}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t('projects.projectName')} required>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} placeholder="e.g. ABC Hotel" />
        </Field>
        <Field label={t('projects.salesOwner')} required>
          <SearchableSelect
            value={form.sales_user_id}
            onChange={v => setForm(f => ({ ...f, sales_user_id: v }))}
            options={salesUsers.map(u => ({ value: u.id, label: u.full_name || u.username, hint: [u.division_name, `@${u.username}`].filter(Boolean).join(' · ') }))}
            placeholder={t('projects.selectSalesOwner')}
          />
          {owner ? (
            <p className="text-[12px] text-slate-600 mt-1.5 inline-flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-brand-600" />
              {t('projects.divisionFromSales')}: <b className="font-semibold">{owner.division_name ?? '—'}</b>
            </p>
          ) : (
            <p className={`text-[11px] mt-1 ${salesUsers.length === 0 ? 'text-amber-600 font-medium' : 'text-slate-400'}`}>
              {salesUsers.length === 0 ? t('projects.noSalesAccounts') : t('projects.salesOwnerHint')}
            </p>
          )}
        </Field>
        <LocationPicker
          address={form.address}
          latitude={form.latitude}
          longitude={form.longitude}
          onChange={(address, latitude, longitude) => setForm(f => ({ ...f, address, latitude, longitude }))}
        />
        <Field label={t('projects.expectedCompletion')}>
          <input type="date" value={form.expected_completion} onChange={e => setForm(f => ({ ...f, expected_completion: e.target.value }))} className={inputCls} />
        </Field>
        <Field label={t('common.notes')}>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={inputCls} rows={3} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-control px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">{t('common.cancel')}</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-4 py-2 hover:bg-brand-700 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {t('projects.saveProject')}
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
