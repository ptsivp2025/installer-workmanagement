'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/app/providers';
import { Modal } from '@/components/shared/Modal';
import type { Activity } from '@/lib/types';
import { PRIORITIES } from '@/lib/constants';
import type { DictKey } from '@/lib/i18n';
import { errorMessage } from '@/lib/utils';

/**
 * The Sales-side counterpart to ActivityFormModal — deliberately a
 * different, smaller component rather than that one reused with fields
 * hidden. Only what Sales is allowed to touch (021_sales_reschedule.sql:
 * date/time/priority/notes) is on this form at all, so there's no field
 * here whose value could ever disagree with what the server-side guard
 * trigger allows — reusing the staff form and hiding category/PIC/product
 * inputs would still submit their unchanged values, and any accidental
 * mismatch there turns into a confusing "insufficient_privilege" error
 * instead of a form that's honest about what it can do.
 */
export function SalesRescheduleModal({
  open, onClose, onSaved, activity,
}: { open: boolean; onClose: () => void; onSaved: () => void; activity: Activity | null }) {
  const { t } = useLanguage();
  const [form, setForm] = useState({ scheduled_date: '', start_time: '', end_time: '', priority: 'normal', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !activity) return;
    setForm({
      scheduled_date: activity.scheduled_date, start_time: activity.start_time ?? '',
      end_time: activity.end_time ?? '', priority: activity.priority, notes: activity.notes ?? '',
    });
    setError(null);
  }, [open, activity]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activity || !form.scheduled_date) return;
    setSaving(true);
    setError(null);

    const { error: err } = await supabase.from('activities').update({
      scheduled_date: form.scheduled_date,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      priority: form.priority,
      notes: form.notes.trim() || null,
    }).eq('id', activity.id);

    setSaving(false);
    if (err) { setError(errorMessage(err, t('activity.rescheduleFailed'))); return; }
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title={t('activity.reschedule')}>
      {activity && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 animate-fade-in">{error}</div>}
          <p className="text-sm text-slate-500 -mt-1">{t('activity.rescheduleHint')}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t('activity.priority')}>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className={inputCls}>
                {PRIORITIES.map(p => <option key={p} value={p}>{t(`priority.${p}` as DictKey)}</option>)}
              </select>
            </Field>
            <Field label={t('activity.scheduledDate')} required>
              <input type="date" value={form.scheduled_date} onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))} className={inputCls} required />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t('activity.startTime')}>
              <input type="time" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} className={inputCls} />
            </Field>
            <Field label={t('activity.endTime')}>
              <input type="time" value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} className={inputCls} />
            </Field>
          </div>

          <Field label={t('common.notes')}>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={inputCls} rows={3} />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-control px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">{t('common.cancel')}</button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-4 py-2 hover:bg-brand-700 disabled:opacity-60">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} {t('common.save')}
            </button>
          </div>
        </form>
      )}
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
