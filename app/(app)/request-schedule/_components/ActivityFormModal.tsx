'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, X, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/app/providers';
import { Modal } from '@/components/shared/Modal';
import { MapPicker } from '@/components/shared/MapPicker';
import type { Activity, ActivityCategory } from '@/lib/types';
import { PRIORITIES } from '@/lib/constants';

interface ProjectOption { id: string; name: string; code: string; }
interface UserOption { id: string; full_name: string; role: string; }

export function ActivityFormModal({
  open, onClose, onSaved, categories, activity, defaultProjectId,
}: {
  open: boolean; onClose: () => void; onSaved: () => void;
  categories: ActivityCategory[]; activity?: Activity | null; defaultProjectId?: string;
}) {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [form, setForm] = useState({
    project_id: '', category_id: '', title: '', customer_name: '', location_address: '',
    scheduled_date: '', start_time: '', end_time: '', priority: 'normal', notes: '',
    target_latitude: '', target_longitude: '', pic_name: '', pic_phone: '',
  });
  const [extraDates, setExtraDates] = useState<string[]>([]);
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    supabase.from('projects').select('id, name, code').eq('status', 'active').order('name').limit(200)
      .then((res: { data: ProjectOption[] | null }) => setProjects(res.data ?? []));
    supabase.from('users').select('id, full_name, role').eq('active', true).order('full_name')
      .then((res: { data: UserOption[] | null }) => setUserOptions(res.data ?? []));
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
        pic_name: activity.pic_name ?? '', pic_phone: activity.pic_phone ?? '',
      });
    } else {
      setForm({
        project_id: defaultProjectId ?? '', category_id: categories.find(c => c.active)?.id ?? '', title: '',
        customer_name: '', location_address: '', scheduled_date: new Date().toISOString().slice(0, 10),
        start_time: '', end_time: '', priority: 'normal', notes: '', target_latitude: '', target_longitude: '',
        pic_name: '', pic_phone: '',
      });
    }
    setExtraDates([]);
    setAssignedUserIds([]);
    setError(null);
  }, [open, activity, defaultProjectId, categories]);

  function toggleUser(id: string) {
    setAssignedUserIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.project_id || !form.category_id || !form.title.trim() || !form.scheduled_date) {
      setError('Project, category, title, and scheduled date are required.');
      return;
    }
    setSaving(true);
    setError(null);

    const basePayload = {
      project_id: form.project_id,
      category_id: form.category_id,
      title: form.title.trim(),
      customer_name: form.customer_name.trim() || null,
      location_address: form.location_address.trim() || null,
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
      const result = await supabase.from('activities').update({ ...basePayload, scheduled_date: form.scheduled_date }).eq('id', activity.id);
      setSaving(false);
      if (result.error) { setError(result.error.message); return; }
      onSaved();
      return;
    }

    // One activity per selected date — the "add other dates" flow creates
    // several schedule entries from a single form instead of repeating it.
    const dates = Array.from(new Set([form.scheduled_date, ...extraDates].filter(Boolean)));
    const rows = dates.map(date => ({
      ...basePayload,
      scheduled_date: date,
      request_number: `REQ-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      created_by: user?.id ?? null,
    }));

    const { data: created, error: insertErr } = await supabase.from('activities').insert(rows).select('id');
    if (insertErr) { setSaving(false); setError(insertErr.message); return; }

    const newIds = ((created as { id: string }[]) ?? []).map(r => r.id);

    if (assignedUserIds.length > 0 && newIds.length > 0) {
      const personnelRows = newIds.flatMap(activityId =>
        assignedUserIds.map(userId => {
          const u = userOptions.find(o => o.id === userId);
          return { activity_id: activityId, user_id: userId, name: u?.full_name ?? '', role: u?.role ?? null };
        }),
      );
      await supabase.from('activity_personnel').insert(personnelRows);
    }

    await Promise.all(newIds.map(activityId =>
      fetch('/api/notifications/activity-scheduled', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityId }),
      }).catch(() => {}),
    ));

    setSaving(false);
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title={activity ? 'Edit Activity' : 'New Activity'} xl>
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Schedule Info */}
          <div className="space-y-4">
            <SectionHeading>Schedule Info</SectionHeading>
            <Field label="Project" required>
              <select value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))} className={inputCls}>
                <option value="">Select project…</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
              </select>
            </Field>
            <Field label="Title" required>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={inputCls} placeholder="e.g. Instalasi Demo — Lobby TV" />
            </Field>
            <Field label="Location Address">
              <input value={form.location_address} onChange={e => setForm(f => ({ ...f, location_address: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="Notes">
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={inputCls} rows={2} placeholder="Job details…" />
            </Field>
            <Field label="Category" required>
              <div className="grid grid-cols-2 gap-1.5">
                {categories.filter(c => c.active).map(c => (
                  <button
                    key={c.id} type="button"
                    onClick={() => setForm(f => ({ ...f, category_id: c.id }))}
                    className={`rounded-control border px-2.5 py-2 text-xs font-medium text-left transition ${
                      form.category_id === c.id ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          {/* Time & Schedule */}
          <div className="space-y-4">
            <SectionHeading>Time & Schedule</SectionHeading>
            <Field label="Scheduled Date" required>
              <input type="date" value={form.scheduled_date} onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))} className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start Time">
                <input type="time" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} className={inputCls} />
              </Field>
              <Field label="End Time">
                <input type="time" value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} className={inputCls} />
              </Field>
            </div>
            <Field label="Priority">
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className={inputCls}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>

            {!activity && (
              <Field label="Add Other Dates (optional)">
                <p className="text-xs text-slate-400 mb-1.5">Creates one activity per date, all sharing these details.</p>
                <div className="space-y-1.5">
                  {extraDates.map((d, i) => (
                    <div key={i} className="flex gap-1.5">
                      <input
                        type="date" value={d}
                        onChange={e => setExtraDates(ds => ds.map((x, j) => j === i ? e.target.value : x))}
                        className={inputCls}
                      />
                      <button type="button" onClick={() => setExtraDates(ds => ds.filter((_, j) => j !== i))} className="shrink-0 text-slate-400 hover:text-red-500 px-1">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setExtraDates(ds => [...ds, new Date().toISOString().slice(0, 10)])}
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add date
                  </button>
                </div>
              </Field>
            )}
          </div>

          {/* Project Info */}
          <div className="space-y-4">
            <SectionHeading>Project Info</SectionHeading>
            <Field label="Customer">
              <input value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))} className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="PIC Name">
                <input value={form.pic_name} onChange={e => setForm(f => ({ ...f, pic_name: e.target.value }))} className={inputCls} placeholder="Site contact" />
              </Field>
              <Field label="PIC Phone">
                <input value={form.pic_phone} onChange={e => setForm(f => ({ ...f, pic_phone: e.target.value }))} className={inputCls} placeholder="08xx" />
              </Field>
            </div>

            {!activity && (
              <Field label="Assign Personnel (optional)">
                <div className="rounded-control border border-slate-200 max-h-40 overflow-y-auto divide-y divide-slate-100">
                  {userOptions.length === 0 ? (
                    <p className="text-xs text-slate-400 p-3">No active users.</p>
                  ) : userOptions.map(u => (
                    <label key={u.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                      <input type="checkbox" checked={assignedUserIds.includes(u.id)} onChange={() => toggleUser(u.id)} className="rounded border-slate-300" />
                      <span className="text-slate-700">{u.full_name}</span>
                      <span className="text-slate-400 text-xs ml-auto">{u.role}</span>
                    </label>
                  ))}
                </div>
                {assignedUserIds.length > 0 && (
                  <p className="text-xs text-slate-500 mt-1 flex items-center gap-1"><Users className="h-3 w-3" /> {assignedUserIds.length} assigned</p>
                )}
              </Field>
            )}
          </div>
        </div>

        <Field label="Target Location (optional — falls back to project's location)">
          <MapPicker
            lat={form.target_latitude ? Number(form.target_latitude) : null}
            lng={form.target_longitude ? Number(form.target_longitude) : null}
            onPick={(lat, lng) => setForm(f => ({ ...f, target_latitude: lat.toFixed(6), target_longitude: lng.toFixed(6) }))}
            height={200}
          />
        </Field>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
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

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{children}</h3>;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}{required && <span className="text-red-500"> *</span>}</label>
      {children}
    </div>
  );
}
