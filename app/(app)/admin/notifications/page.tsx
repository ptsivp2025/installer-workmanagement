'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/app/providers';
import type { NotificationSettings } from '@/lib/types';
import { LoadingState, ErrorState } from '@/components/shared/States';
import { AdminTabs } from '@/components/shared/AdminTabs';

export default function AdminNotificationsPage() {
  const { user, loading: authLoading } = useAuth();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [form, setForm] = useState({ telegram_bot_token: '', telegram_chat_id: '', notify_on_completion: false, notify_on_review_decision: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.from('notification_settings').select('*').eq('id', true).single();
    if (err) setError(err.message);
    else {
      const s = data as NotificationSettings;
      setSettings(s);
      setForm({
        telegram_bot_token: s.telegram_bot_token ?? '',
        telegram_chat_id: s.telegram_chat_id ?? '',
        notify_on_completion: s.notify_on_completion,
        notify_on_review_decision: s.notify_on_review_decision,
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    const { error: err } = await supabase.from('notification_settings').update({
      telegram_bot_token: form.telegram_bot_token.trim() || null,
      telegram_chat_id: form.telegram_chat_id.trim() || null,
      notify_on_completion: form.notify_on_completion,
      notify_on_review_decision: form.notify_on_review_decision,
      updated_by: user?.id ?? null,
    }).eq('id', true);
    setSaving(false);
    if (err) { setError(err.message); return; }
    setSaved(true);
    load();
  }

  if (authLoading) return <LoadingState />;
  if (!user || user.role !== 'admin') return <ErrorState message="Only admins can access this page." />;

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Admin Panel</h1>
      <AdminTabs />
      <p className="text-sm text-slate-500 mb-6">
        Optional Telegram alerts on activity completion and Form Review decisions. Leave the bot token blank to disable — nothing is sent unless both a bot token and chat ID are set.
      </p>

      {loading ? <LoadingState /> : error && !settings ? <ErrorState message={error} onRetry={load} /> : (
        <form onSubmit={handleSave} className="bg-white rounded-card border border-slate-200 shadow-card p-5 max-w-lg space-y-4">
          {error && <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
          {saved && <div className="rounded-control bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-3 py-2">Settings saved.</div>}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Telegram Bot Token</label>
            <input
              value={form.telegram_bot_token}
              onChange={e => setForm(f => ({ ...f, telegram_bot_token: e.target.value }))}
              className={inputCls}
              placeholder="123456789:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              autoComplete="off"
            />
            <p className="text-xs text-slate-400 mt-1">From @BotFather on Telegram.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Chat ID</label>
            <input
              value={form.telegram_chat_id}
              onChange={e => setForm(f => ({ ...f, telegram_chat_id: e.target.value }))}
              className={inputCls}
              placeholder="-1001234567890"
            />
            <p className="text-xs text-slate-400 mt-1">The group/channel/user chat ID that receives alerts.</p>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100">
            <Toggle label="Notify on activity completion" checked={form.notify_on_completion} onChange={v => setForm(f => ({ ...f, notify_on_completion: v }))} />
            <Toggle label="Notify on Form Review decision" checked={form.notify_on_review_decision} onChange={v => setForm(f => ({ ...f, notify_on_review_decision: v }))} />
          </div>

          <div className="flex justify-end pt-2">
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-4 py-2 hover:bg-brand-700 disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Save Settings
            </button>
          </div>
        </form>
      )}
    </div>
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
