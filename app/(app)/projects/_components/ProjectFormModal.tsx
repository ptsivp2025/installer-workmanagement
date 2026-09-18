'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import { Modal } from '@/components/shared/Modal';
import { LocationPicker } from '@/components/shared/LocationPicker';
import type { Project, SalesDivision } from '@/lib/types';
import type { DictKey } from '@/lib/i18n';
import { Loader2 } from 'lucide-react';

export function ProjectFormModal({
  open, onClose, onSaved, project,
}: { open: boolean; onClose: () => void; onSaved: () => void; project?: Project | null }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [divisions, setDivisions] = useState<SalesDivision[]>([]);
  const [form, setForm] = useState({
    code: '', name: '', address: '', latitude: '', longitude: '',
    expected_completion: '', notes: '', status: 'active', sales_division_id: '', sales_person_name: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    supabase.from('sales_divisions').select('*').eq('active', true).order('sort_order')
      .then((res: { data: SalesDivision[] | null }) => setDivisions(res.data ?? []));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (project) {
      setForm({
        code: project.code, name: project.name,
        address: project.address ?? '', latitude: project.latitude?.toString() ?? '',
        longitude: project.longitude?.toString() ?? '', expected_completion: project.expected_completion ?? '',
        notes: project.notes ?? '', status: project.status, sales_division_id: project.sales_division_id ?? '',
        sales_person_name: project.sales_person_name ?? '',
      });
    } else {
      setForm({ code: `PRJ-${Date.now().toString(36).toUpperCase()}`, name: '', address: '', latitude: '', longitude: '', expected_completion: '', notes: '', status: 'active', sales_division_id: '', sales_person_name: '' });
    }
    setError(null);
  }, [open, project]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.code.trim()) { setError(t('projects.codeNameRequired')); return; }
    if (!form.sales_division_id) { setError(t('projects.divisionRequired')); return; }
    setSaving(true);
    setError(null);

    const division = divisions.find(d => d.id === form.sales_division_id);
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      customer_name: division?.name ?? null,
      address: form.address.trim() || null,
      latitude: form.latitude ? Number(form.latitude) : null,
      longitude: form.longitude ? Number(form.longitude) : null,
      expected_completion: form.expected_completion || null,
      notes: form.notes.trim() || null,
      status: form.status,
      sales_division_id: form.sales_division_id,
      sales_person_name: form.sales_person_name.trim() || null,
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
              {(['active', 'on_hold', 'completed', 'cancelled'] as const).map(s => <option key={s} value={s}>{t(`status.${s}` as DictKey)}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t('projects.projectName')} required>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} placeholder="e.g. ABC Hotel" />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('projects.customerCompany')} required>
            <select value={form.sales_division_id} onChange={e => setForm(f => ({ ...f, sales_division_id: e.target.value }))} className={inputCls}>
              <option value="">{t('projects.selectCustomer')}</option>
              {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label={t('projects.salesPersonName')}>
            <input value={form.sales_person_name} onChange={e => setForm(f => ({ ...f, sales_person_name: e.target.value }))} className={inputCls} placeholder="e.g. Budi" />
          </Field>
        </div>
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
