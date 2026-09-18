'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Send, Plus, Pencil, Power } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/app/providers';
import type { NotificationSettings, NotificationGroup } from '@/lib/types';
import { LoadingState, ErrorState } from '@/components/shared/States';
import { AdminTabs } from '@/components/shared/AdminTabs';
import { Modal } from '@/components/shared/Modal';

export default function AdminNotificationsPage() {
  const { user, loading: authLoading } = useAuth();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [groups, setGroups] = useState<NotificationGroup[]>([]);
  const [botToken, setBotToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<NotificationGroup | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [{ data: s, error: sErr }, { data: g, error: gErr }] = await Promise.all([
      supabase.from('notification_settings').select('*').eq('id', true).single(),
      supabase.from('notification_groups').select('*').order('created_at'),
    ]);
    if (sErr) setError(sErr.message);
    else if (gErr) setError(gErr.message);
    else {
      setSettings(s as NotificationSettings);
      setBotToken((s as NotificationSettings).telegram_bot_token ?? '');
      setGroups((g as NotificationGroup[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSaveToken(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    const { error: err } = await supabase.from('notification_settings')
      .update({ telegram_bot_token: botToken.trim() || null, updated_by: user?.id ?? null })
      .eq('id', true);
    setSaving(false);
    if (err) { setError(err.message); return; }
    setSaved(true);
    load();
  }

  async function toggleActive(g: NotificationGroup) {
    await supabase.from('notification_groups').update({ active: !g.active }).eq('id', g.id);
    load();
  }

  if (authLoading) return <LoadingState />;
  if (!user || user.role !== 'admin') return <ErrorState message="Only admins can access this page." />;

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Admin Panel</h1>
      <AdminTabs />

      {loading ? <LoadingState /> : error && !settings ? <ErrorState message={error} onRetry={load} /> : (
        <div className="space-y-6 max-w-2xl">
          <form onSubmit={handleSaveToken} className="bg-white rounded-card border border-slate-200 shadow-card p-5 space-y-4">
            <div>
              <h2 className="font-semibold text-slate-900">Telegram Bot Token</h2>
              <p className="text-sm text-slate-500 mt-0.5">One bot, shared by every group below. Leave blank to disable Telegram entirely.</p>
            </div>
            {error && <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
            {saved && <div className="rounded-control bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-3 py-2">Saved.</div>}
            <input
              value={botToken}
              onChange={e => setBotToken(e.target.value)}
              className={inputCls}
              placeholder="123456789:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              autoComplete="off"
            />
            <div className="flex justify-end">
              <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-4 py-2 hover:bg-brand-700 disabled:opacity-60">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Save Token
              </button>
            </div>
          </form>

          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="font-semibold text-slate-900">Notification Groups</h2>
                <p className="text-sm text-slate-500 mt-0.5">Each group is a Telegram chat that gets alerted on the events you pick.</p>
              </div>
              <button onClick={() => { setEditing(null); setFormOpen(true); }} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-3.5 py-2 hover:bg-brand-700">
                <Plus className="h-4 w-4" /> New Group
              </button>
            </div>

            <div className="bg-white rounded-card border border-slate-200 shadow-card overflow-hidden">
              {groups.length === 0 ? (
                <p className="text-sm text-slate-400 p-5">No groups yet — nothing will be sent until one exists.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
                    <tr>
                      <th className="px-4 py-2.5">Name</th>
                      <th className="px-4 py-2.5">Chat ID</th>
                      <th className="px-4 py-2.5">Events</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {groups.map(g => (
                      <tr key={g.id} className={g.active ? '' : 'opacity-50'}>
                        <td className="px-4 py-3 font-medium text-slate-800">{g.name}</td>
                        <td className="px-4 py-3 text-slate-500 font-mono text-xs">{g.telegram_chat_id}</td>
                        <td className="px-4 py-3 text-xs text-slate-500 space-x-1">
                          {g.notify_on_completion && <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5">Completion</span>}
                          {g.notify_on_review_decision && <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5">Review Decision</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium ${g.active ? 'text-emerald-600' : 'text-slate-400'}`}>{g.active ? 'Active' : 'Inactive'}</span>
                        </td>
                        <td className="px-4 py-3 text-right space-x-2">
                          <button onClick={() => { setEditing(g); setFormOpen(true); }} className="text-slate-400 hover:text-slate-700 inline-flex"><Pencil className="h-4 w-4" /></button>
                          <button onClick={() => toggleActive(g)} title={g.active ? 'Deactivate' : 'Activate'} className="text-slate-400 hover:text-slate-700 inline-flex"><Power className="h-4 w-4" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      <GroupFormModal open={formOpen} onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); load(); }} group={editing} />
    </div>
  );
}

function GroupFormModal({
  open, onClose, onSaved, group,
}: { open: boolean; onClose: () => void; onSaved: () => void; group: NotificationGroup | null }) {
  const [form, setForm] = useState({ name: '', telegram_chat_id: '', notify_on_completion: false, notify_on_review_decision: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(group
      ? { name: group.name, telegram_chat_id: group.telegram_chat_id, notify_on_completion: group.notify_on_completion, notify_on_review_decision: group.notify_on_review_decision }
      : { name: '', telegram_chat_id: '', notify_on_completion: false, notify_on_review_decision: false });
    setError(null);
  }, [open, group]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.telegram_chat_id.trim()) { setError('Name and Chat ID are required.'); return; }
    setSaving(true);
    setError(null);
    const payload = { name: form.name.trim(), telegram_chat_id: form.telegram_chat_id.trim(), notify_on_completion: form.notify_on_completion, notify_on_review_decision: form.notify_on_review_decision };
    const result = group
      ? await supabase.from('notification_groups').update(payload).eq('id', group.id)
      : await supabase.from('notification_groups').insert(payload);
    setSaving(false);
    if (result.error) { setError(result.error.message); return; }
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title={group ? 'Edit Group' : 'New Notification Group'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} placeholder="e.g. Ops Team" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Telegram Chat ID</label>
          <input value={form.telegram_chat_id} onChange={e => setForm(f => ({ ...f, telegram_chat_id: e.target.value }))} className={inputCls} placeholder="-1001234567890" />
        </div>
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <Toggle label="Notify on activity completion" checked={form.notify_on_completion} onChange={v => setForm(f => ({ ...f, notify_on_completion: v }))} />
          <Toggle label="Notify on Form Review decision" checked={form.notify_on_review_decision} onChange={v => setForm(f => ({ ...f, notify_on_review_decision: v }))} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-control px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-4 py-2 hover:bg-brand-700 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-sm text-slate-700">{label}</span>
      <button type="button" onClick={() => onChange(!checked)} className={`relative h-5 w-9 rounded-full transition ${checked ? 'bg-brand-600' : 'bg-slate-200'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
    </label>
  );
}

const inputCls = 'w-full rounded-control border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';
