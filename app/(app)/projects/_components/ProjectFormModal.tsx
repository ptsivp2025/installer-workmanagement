'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/app/providers';
import { Modal } from '@/components/shared/Modal';
import { MapPicker } from '@/components/shared/MapPicker';
import type { Project, SalesDivision } from '@/lib/types';
import { Loader2 } from 'lucide-react';

export function ProjectFormModal({
  open, onClose, onSaved, project,
}: { open: boolean; onClose: () => void; onSaved: () => void; project?: Project | null }) {
  const { user } = useAuth();
  const [divisions, setDivisions] = useState<SalesDivision[]>([]);
  const [form, setForm] = useState({
    code: '', name: '', customer_name: '', address: '', latitude: '', longitude: '',
    expected_completion: '', notes: '', status: 'active', sales_division: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    supabase.from('sales_divisions').select('*').order('sort_order').order('name')
      .then((res: { data: SalesDivision[] | null }) => setDivisions(res.data ?? []));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (project) {
      setForm({
        code: project.code, name: project.name, customer_name: project.customer_name ?? '',
        address: project.address ?? '', latitude: project.latitude?.toString() ?? '',
        longitude: project.longitude?.toString() ?? '', expected_completion: project.expected_completion ?? '',
        notes: project.notes ?? '', status: project.status, sales_division: project.sales_division ?? '',
      });
    } else {
      setForm({ code: `PRJ-${Date.now().toString(36).toUpperCase()}`, name: '', customer_name: '', address: '', latitude: '', longitude: '', expected_completion: '', notes: '', status: 'active', sales_division: '' });
    }
    setError(null);
  }, [open, project]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.code.trim()) { setError('Code and name are required.'); return; }
    setSaving(true);
    setError(null);

    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      customer_name: form.customer_name.trim() || null,
      address: form.address.trim() || null,
      latitude: form.latitude ? Number(form.latitude) : null,
      longitude: form.longitude ? Number(form.longitude) : null,
      expected_completion: form.expected_completion || null,
      notes: form.notes.trim() || null,
      status: form.status,
      sales_division: form.sales_division || null,
    };

    const result = project
      ? await supabase.from('projects').update(payload).eq('id', project.id)
      : await supabase.from('projects').insert({ ...payload, created_by: user?.id ?? null });

    setSaving(false);
    if (result.error) { setError(result.error.message); return; }
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title={project ? 'Edit Project' : 'New Project'} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Project Code" required>
            <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} className={inputCls} />
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={inputCls}>
              {['active', 'on_hold', 'completed', 'cancelled'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Project Name" required>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} placeholder="e.g. ABC Hotel" />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Customer / Company">
            <input value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))} className={inputCls} />
          </Field>
          <Field label="Sales Division">
            <select value={form.sales_division} onChange={e => setForm(f => ({ ...f, sales_division: e.target.value }))} className={inputCls}>
              <option value="">—</option>
              {divisions.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Address">
          <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className={inputCls} />
        </Field>
        <Field label="Location">
          <MapPicker
            lat={form.latitude ? Number(form.latitude) : null}
            lng={form.longitude ? Number(form.longitude) : null}
            onPick={(lat, lng) => setForm(f => ({ ...f, latitude: lat.toFixed(6), longitude: lng.toFixed(6) }))}
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Target Latitude">
            <input value={form.latitude} onChange={e => setForm(f => ({ ...f, latitude: e.target.value }))} className={inputCls} placeholder="-6.200000" />
          </Field>
          <Field label="Target Longitude">
            <input value={form.longitude} onChange={e => setForm(f => ({ ...f, longitude: e.target.value }))} className={inputCls} placeholder="106.816666" />
          </Field>
        </div>
        <Field label="Expected Completion">
          <input type="date" value={form.expected_completion} onChange={e => setForm(f => ({ ...f, expected_completion: e.target.value }))} className={inputCls} />
        </Field>
        <Field label="Notes">
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={inputCls} rows={3} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-control px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-4 py-2 hover:bg-brand-700 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save Project
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
