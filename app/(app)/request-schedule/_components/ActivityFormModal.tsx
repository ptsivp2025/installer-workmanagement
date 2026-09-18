'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/app/providers';
import { Modal } from '@/components/shared/Modal';
import type { Activity, ActivityCategory } from '@/lib/types';
import { PRIORITIES } from '@/lib/constants';

interface ProjectOption { id: string; name: string; code: string; }

export function ActivityFormModal({
  open, onClose, onSaved, categories, activity, defaultProjectId,
}: {
  open: boolean; onClose: () => void; onSaved: () => void;
  categories: ActivityCategory[]; activity?: Activity | null; defaultProjectId?: string;
}) {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [form, setForm] = useState({
    project_id: '', category_id: '', title: '', customer_name: '', location_address: '',
    scheduled_date: '', start_time: '', end_time: '', priority: 'normal', notes: '',
    target_latitude: '', target_longitude: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    supabase.from('projects').select('id, name, code').eq('status', 'active').order('name').limit(200)
      .then((res: { data: ProjectOption[] | null }) => setProjects(res.data ?? []));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (activity) {
      setForm({
        project_id: activity.project_id, category_id: activity.category_id, title: activity.title,
        customer_name: activity.customer_name ?? '', location_address: activity.location_address ?? '',
        scheduled_date: activity.scheduled_date, start_time: activity.start_time ?? '', end_time: activity.end_time ?? '',
        priority: activity.priority, notes: activity.notes ?? '',
        target_latitude: activity.target_latitude?.toString() ?? '', target_longitude: activity.target_longitude?.toString() ?? '',
      });
    } else {
      setForm({
        project_id: defaultProjectId ?? '', category_id: categories.find(c => c.active)?.id ?? '', title: '',
        customer_name: '', location_address: '', scheduled_date: new Date().toISOString().slice(0, 10),
        start_time: '', end_time: '', priority: 'normal', notes: '', target_latitude: '', target_longitude: '',
      });
    }
    setError(null);
  }, [open, activity, defaultProjectId, categories]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.project_id || !form.category_id || !form.title.trim() || !form.scheduled_date) {
      setError('Project, category, title, and scheduled date are required.');
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      project_id: form.project_id,
      category_id: form.category_id,
      title: form.title.trim(),
      customer_name: form.customer_name.trim() || null,
      location_address: form.location_address.trim() || null,
      scheduled_date: form.scheduled_date,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      priority: form.priority,
      notes: form.notes.trim() || null,
      target_latitude: form.target_latitude ? Number(form.target_latitude) : null,
      target_longitude: form.target_longitude ? Number(form.target_longitude) : null,
    };

    const result = activity
      ? await supabase.from('activities').update(payload).eq('id', activity.id)
      : await supabase.from('activities').insert({
          ...payload,
          request_number: `REQ-${Date.now().toString(36).toUpperCase()}`,
          created_by: user?.id ?? null,
        });

    setSaving(false);
    if (result.error) { setError(result.error.message); return; }
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title={activity ? 'Edit Activity' : 'New Activity'} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Project" required>
            <select value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))} className={inputCls}>
              <option value="">Select project…</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
            </select>
          </Field>
          <Field label="Activity Category" required>
            <select value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))} className={inputCls}>
              <option value="">Select category…</option>
              {categories.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Title" required>
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={inputCls} placeholder="e.g. Instalasi Demo — Lobby TV" />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Customer">
            <input value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))} className={inputCls} />
          </Field>
          <Field label="Priority">
            <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className={inputCls}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Location Address">
          <input value={form.location_address} onChange={e => setForm(f => ({ ...f, location_address: e.target.value }))} className={inputCls} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Scheduled Date" required>
            <input type="date" value={form.scheduled_date} onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))} className={inputCls} />
          </Field>
          <Field label="Start Time">
            <input type="time" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} className={inputCls} />
          </Field>
          <Field label="End Time">
            <input type="time" value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} className={inputCls} />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Target Latitude (optional — falls back to project)">
            <input value={form.target_latitude} onChange={e => setForm(f => ({ ...f, target_latitude: e.target.value }))} className={inputCls} />
          </Field>
          <Field label="Target Longitude (optional — falls back to project)">
            <input value={form.target_longitude} onChange={e => setForm(f => ({ ...f, target_longitude: e.target.value }))} className={inputCls} />
          </Field>
        </div>
        <Field label="Notes">
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={inputCls} rows={3} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-control px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-4 py-2 hover:bg-brand-700 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save Activity
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
