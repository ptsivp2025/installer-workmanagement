'use client';

import { useEffect, useState } from 'react';
import { Loader2, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/app/providers';
import { Modal } from '@/components/shared/Modal';
import { LocationPicker } from '@/components/shared/LocationPicker';
import type { Activity, ActivityCategory, AppUser } from '@/lib/types';
import { PRIORITIES } from '@/lib/constants';

interface ProjectOption { id: string; name: string; code: string; customer_name: string | null; }

export function ActivityFormModal({
  open, onClose, onSaved, categories, activity, defaultProjectId,
}: {
  open: boolean; onClose: () => void; onSaved: () => void;
  categories: ActivityCategory[]; activity?: Activity | null; defaultProjectId?: string;
}) {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [selectedPersonnel, setSelectedPersonnel] = useState<string[]>([]);
  const [form, setForm] = useState({
    project_id: '', category_id: '', title: '', location_address: '',
    scheduled_date: '', start_time: '', end_time: '', priority: 'normal', notes: '',
    target_latitude: '', target_longitude: '', pic_name: '', pic_phone: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    supabase.from('projects').select('id, name, code, customer_name').eq('status', 'active').order('name').limit(200)
      .then((res: { data: ProjectOption[] | null }) => setProjects(res.data ?? []));
    supabase.from('users').select('*').eq('active', true).order('full_name')
      .then((res: { data: AppUser[] | null }) => setUsers(res.data ?? []));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (activity) {
      setForm({
        project_id: activity.project_id, category_id: activity.category_id, title: activity.title,
        location_address: activity.location_address ?? '',
        scheduled_date: activity.scheduled_date, start_time: activity.start_time ?? '', end_time: activity.end_time ?? '',
        priority: activity.priority, notes: activity.notes ?? '',
        target_latitude: activity.target_latitude?.toString() ?? '', target_longitude: activity.target_longitude?.toString() ?? '',
        pic_name: activity.pic_name ?? '', pic_phone: activity.pic_phone ?? '',
      });
    } else {
      setForm({
        project_id: defaultProjectId ?? '', category_id: categories.find(c => c.active)?.id ?? '', title: '',
        location_address: '', scheduled_date: new Date().toISOString().slice(0, 10),
        start_time: '', end_time: '', priority: 'normal', notes: '', target_latitude: '', target_longitude: '',
        pic_name: '', pic_phone: '',
      });
    }
    setSelectedPersonnel([]);
    setError(null);
  }, [open, activity, defaultProjectId, categories]);

  function togglePersonnel(userId: string) {
    setSelectedPersonnel(sel => sel.includes(userId) ? sel.filter(id => id !== userId) : [...sel, userId]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.project_id || !form.category_id || !form.title.trim() || !form.scheduled_date) {
      setError('Project, category, title, and scheduled date are required.');
      return;
    }
    setSaving(true);
    setError(null);

    const project = projects.find(p => p.id === form.project_id);
    const payload = {
      project_id: form.project_id,
      category_id: form.category_id,
      title: form.title.trim(),
      customer_name: project?.customer_name ?? null,
      location_address: form.location_address.trim() || null,
      scheduled_date: form.scheduled_date,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      priority: form.priority,
      notes: form.notes.trim() || null,
      target_latitude: form.target_latitude ? Number(form.target_latitude) : null,
      target_longitude: form.target_longitude ? Number(form.target_longitude) : null,
      pic_name: form.pic_name.trim() || null,
      pic_phone: form.pic_phone.trim() || null,
    };

    if (activity) {
      const result = await supabase.from('activities').update(payload).eq('id', activity.id);
      setSaving(false);
      if (result.error) { setError(result.error.message); return; }
      onSaved();
      return;
    }

    const { data: created, error: insertErr } = await supabase.from('activities').insert({
      ...payload,
      request_number: `REQ-${Date.now().toString(36).toUpperCase()}`,
      created_by: user?.id ?? null,
    }).select('id').single();

    if (insertErr || !created) {
      setSaving(false);
      setError(insertErr?.message ?? 'Failed to create activity.');
      return;
    }

    if (selectedPersonnel.length > 0) {
      const rows = selectedPersonnel.map(userId => {
        const u = users.find(x => x.id === userId);
        return { activity_id: created.id, user_id: userId, name: u?.full_name ?? 'Unknown', role: u?.role ?? null };
      });
      const { error: personnelErr } = await supabase.from('activity_personnel').insert(rows);
      if (personnelErr) {
        setSaving(false);
        setError(`Activity created, but assigning the team failed: ${personnelErr.message}`);
        return;
      }
    }

    setSaving(false);
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
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={inputCls} placeholder="e.g. Instalasi Maxhub 86 inch" />
        </Field>
        <Field label="Priority">
          <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className={`${inputCls} sm:w-48`}>
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
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
        <div>
          <LocationPicker
            address={form.location_address}
            latitude={form.target_latitude}
            longitude={form.target_longitude}
            onChange={(location_address, target_latitude, target_longitude) => setForm(f => ({ ...f, location_address, target_latitude, target_longitude }))}
          />
          <p className="text-xs text-slate-400 mt-1">Leave blank to fall back to the project&apos;s location.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="PIC Name (Person In Charge)">
            <input value={form.pic_name} onChange={e => setForm(f => ({ ...f, pic_name: e.target.value }))} className={inputCls} />
          </Field>
          <Field label="PIC Phone">
            <input value={form.pic_phone} onChange={e => setForm(f => ({ ...f, pic_phone: e.target.value }))} className={inputCls} />
          </Field>
        </div>
        {!activity && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-1.5"><Users className="h-4 w-4" /> Team / Technicians</label>
            <div className="rounded-control border border-slate-300 max-h-40 overflow-y-auto divide-y divide-slate-100">
              {users.length === 0 ? (
                <p className="text-sm text-slate-400 px-3 py-2">No active users.</p>
              ) : users.map(u => (
                <label key={u.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                  <input type="checkbox" checked={selectedPersonnel.includes(u.id)} onChange={() => togglePersonnel(u.id)} className="rounded" />
                  <span className="text-slate-700">{u.full_name}</span>
                  <span className="text-xs text-slate-400">{u.role}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-1">Optional — assign who&apos;s doing this job now, or add them later from the activity page.</p>
          </div>
        )}
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
