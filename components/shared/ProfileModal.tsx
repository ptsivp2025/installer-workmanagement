'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save, KeyRound, Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import { setSession } from '@/lib/auth';
import type { AppUser } from '@/lib/types';
import { POSITIONS } from '@/lib/constants';
import type { DictKey } from '@/lib/i18n';
import { Modal } from './Modal';
import { LoadingState } from './States';

/**
 * A user's own record: what they can edit themselves (name, contact,
 * position, Telegram id) and what only an admin can (username, role,
 * division) shown read-only. The self-update goes straight through
 * PostgREST — the users_update_own policy plus the guard trigger from 018
 * are what decide which columns actually move, not this form.
 */
export function ProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, setUserProfile } = useAuth();
  const { t } = useLanguage();
  const [profile, setProfile] = useState<AppUser | null>(null);
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', position: '', telegram_chat_id: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [showPw, setShowPw] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('users')
      .select('*, sales_divisions(id, name, code)')
      .eq('id', user.id)
      .single();
    if (err) setError(err.message);
    else {
      const u = data as AppUser;
      setProfile(u);
      setForm({
        full_name: u.full_name ?? '', email: u.email ?? '', phone: u.phone ?? '',
        position: u.position ?? '', telegram_chat_id: u.telegram_chat_id ?? '',
      });
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { if (open) { load(); setSaved(false); setPwMessage(null); } }, [open, load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const { error: err } = await supabase.from('users').update({
      full_name: form.full_name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      position: form.position || null,
      telegram_chat_id: form.telegram_chat_id.trim() || null,
    }).eq('id', user.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    setSaved(true);
    // The sidebar reads the name from the cached session profile, not the
    // users table — update both, or the header keeps the old name until the
    // next login.
    const nextProfile = { ...user, full_name: form.full_name.trim() };
    setSession(nextProfile);
    setUserProfile(nextProfile);
    load();
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwMessage(null);
    if (pw.next.length < 8) { setPwMessage({ ok: false, text: t('adminUsers.minChars') }); return; }
    if (pw.next !== pw.confirm) { setPwMessage({ ok: false, text: t('register.passwordMismatch') }); return; }
    setPwSaving(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: pw.current, newPassword: pw.next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setPwMessage({ ok: false, text: data.error ?? 'Failed.' }); return; }
      setPwMessage({ ok: true, text: t('profile.passwordChanged') });
      setPw({ current: '', next: '', confirm: '' });
    } catch {
      setPwMessage({ ok: false, text: t('login.networkError') });
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('profile.title')} wide>
      {loading ? <LoadingState /> : (
        <div className="space-y-5">
          {error && <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}

          {/* Read-only account facts */}
          <div className="rounded-control bg-slate-50 border border-slate-200 p-3.5">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">{t('profile.accountInfo')}</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-400">{t('adminUsers.username')}</p>
                <p className="text-slate-700 font-mono text-xs mt-0.5">{profile?.username}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">{t('adminUsers.role')}</p>
                <p className="text-slate-700 mt-0.5">{profile ? t(`role.${profile.role}` as DictKey) : '—'}</p>
              </div>
              {profile?.sales_divisions && (
                <div>
                  <p className="text-xs text-slate-400">{t('adminUsers.salesDivision')}</p>
                  <p className="text-slate-700 mt-0.5">{profile.sales_divisions.name}</p>
                </div>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-2.5">{t('profile.readOnlyHint')}</p>
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            <p className="text-sm font-semibold text-slate-700">{t('profile.details')}</p>
            {saved && <div className="rounded-control bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-3 py-2 animate-fade-in">{t('common.saved')}</div>}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('adminUsers.fullName')}</label>
              <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} className={inputCls} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t('adminUsers.email')}</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t('common.phone')}</label>
                <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('adminUsers.position')}</label>
              <select value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} className={inputCls}>
                <option value="">{t('register.selectPosition')}</option>
                {POSITIONS.map(p => <option key={p} value={p}>{t(`position.${p}` as DictKey)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('profile.telegramChatId')}</label>
              <input value={form.telegram_chat_id} onChange={e => setForm(f => ({ ...f, telegram_chat_id: e.target.value }))} className={inputCls} placeholder="123456789" />
              <p className="text-xs text-slate-400 mt-1">{t('profile.telegramHint')}</p>
            </div>

            <div className="flex justify-end">
              <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-4 py-2 hover:bg-brand-700 disabled:opacity-60">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t('profile.saveChanges')}
              </button>
            </div>
          </form>

          <form onSubmit={handlePasswordChange} className="space-y-4 pt-5 border-t border-slate-100">
            <p className="text-sm font-semibold text-slate-700 flex items-center gap-1.5"><KeyRound className="h-4 w-4" /> {t('profile.changePassword')}</p>
            {pwMessage && (
              <div className={`rounded-control text-sm px-3 py-2 animate-fade-in ${pwMessage.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                {pwMessage.text}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('profile.currentPassword')}</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} value={pw.current} onChange={e => setPw(p => ({ ...p, current: e.target.value }))} className={`${inputCls} pr-10`} />
                <button
                  type="button" tabIndex={-1} onClick={() => setShowPw(v => !v)}
                  aria-label={showPw ? t('login.hidePassword') : t('login.showPassword')}
                  className="absolute right-0 top-0 h-full px-3 text-slate-400 hover:text-slate-600"
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t('profile.newPassword')}</label>
                <input type={showPw ? 'text' : 'password'} value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t('profile.confirmNewPassword')}</label>
                <input type={showPw ? 'text' : 'password'} value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div className="flex justify-end">
              <button type="submit" disabled={pwSaving || !pw.current || !pw.next} className="inline-flex items-center gap-1.5 rounded-control border border-slate-300 text-slate-700 text-sm font-medium px-4 py-2 hover:bg-slate-50 disabled:opacity-50">
                {pwSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} {t('profile.changePassword')}
              </button>
            </div>
          </form>
        </div>
      )}
    </Modal>
  );
}

const inputCls = 'w-full rounded-control border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';
