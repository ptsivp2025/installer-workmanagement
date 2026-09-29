'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, KeyRound, UserRound, Hash, Mail, Smartphone, Briefcase, Building2, Shield, Send, CalendarDays,
  BadgeCheck, Download, Tag, LogOut,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import { setSession } from '@/lib/auth';
import type { AppUser } from '@/lib/types';
import { POSITIONS } from '@/lib/constants';
import type { DictKey } from '@/lib/i18n';
import { formatDate } from '@/lib/utils';
import { isNativeApp } from '@/lib/geolocation';
import { nativeAppVersion, canCheckAppUpdate, checkAppUpdate } from '@/lib/native';
import { Modal, ModalBanner, BannerBadge, BannerTile, SectionCard, InfoRow } from './Modal';
import { PasswordInput } from './PasswordInput';
import { LoadingState } from './States';

const OPEN = ['scheduled', 'in_progress'];

function greetingKey(): DictKey {
  const h = new Date().getHours();
  return h < 4 ? 'greeting.night' : h < 11 ? 'greeting.morning' : h < 15 ? 'greeting.afternoon' : h < 18 ? 'greeting.evening' : 'greeting.night';
}

/**
 * A user's own account, in the Sales Management Platform's profile layout:
 * banner with name, role and two live counts; contact details and password
 * on the left; the phone app, role and Telegram on the right.
 *
 * What a user may change about themselves is decided by the users_update_own
 * policy and the guard trigger (018), not by which fields this form shows.
 */
export function ProfileModal({ open, onClose, onSignOut }: { open: boolean; onClose: () => void; onSignOut?: () => void }) {
  const { user, setUserProfile } = useAuth();
  const { t } = useLanguage();
  const [profile, setProfile] = useState<AppUser | null>(null);
  const [counts, setCounts] = useState({ open: 0, done: 0 });
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', position: '', telegram_chat_id: '' });
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const mine = () => supabase.from('activities').select('id, activity_personnel!inner(user_id)', { count: 'exact', head: true })
      .eq('activity_personnel.user_id', user.id);
    const [{ data, error: err }, openRes, doneRes] = await Promise.all([
      supabase.from('users').select('*, sales_divisions(id, name, code)').eq('id', user.id).single(),
      mine().in('status', OPEN),
      mine().eq('status', 'completed').gte('completed_at', since),
    ]);
    if (err) setError(err.message);
    else {
      const u = data as AppUser;
      setProfile(u);
      setForm({
        full_name: u.full_name ?? '', email: u.email ?? '', phone: u.phone ?? '',
        position: u.position ?? '', telegram_chat_id: u.telegram_chat_id ?? '',
      });
    }
    setCounts({ open: openRes.count ?? 0, done: doneRes.count ?? 0 });
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (!open) return;
    load();
    setEditing(false);
    setPwMessage(null);
    setAppVersion(isNativeApp() ? nativeAppVersion() : null);
  }, [open, load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.from('users').update({
      full_name: form.full_name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      position: form.position || null,
      telegram_chat_id: form.telegram_chat_id.trim() || null,
    }).eq('id', user.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    // The shell reads the name from the cached session profile, not the
    // users table: update both, or the header keeps the old name.
    const nextProfile = { ...user, full_name: form.full_name.trim() };
    setSession(nextProfile);
    setUserProfile(nextProfile);
    setEditing(false);
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

  const role = profile?.role ?? user?.role ?? '';
  const inactive = profile?.active === false;
  const nf = t('profile.notFilled');

  return (
    <Modal open={open} onClose={onClose} title={t('profile.title')} size="full" bare>
      <ModalBanner
        onClose={onClose}
        eyebrow={<>{t(greetingKey())} · <span className="normal-case tracking-normal font-semibold">@{user?.username}</span></>}
        title={profile?.full_name || user?.full_name || user?.username || ''}
        aside={<><BannerTile value={counts.open} label={t('profile.tileOpen')} /><BannerTile value={counts.done} label={t('profile.tileDone')} amber /></>}
      >
        <BannerBadge><Shield className="h-3 w-3" /> {role ? t(`role.${role}` as DictKey) : '—'}</BannerBadge>
        <BannerBadge tone={inactive ? 'red' : 'glass'}>
          <span className={`w-1.5 h-1.5 rounded-full ${inactive ? 'bg-white' : 'bg-emerald-300'}`} />
          {inactive ? t('profile.inactive') : t('profile.active')}
        </BannerBadge>
      </ModalBanner>

      <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50 px-4 sm:px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {loading ? <LoadingState /> : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* ══ Left ══ */}
            <div className="lg:col-span-7 flex flex-col gap-4">
              {error && <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}

              <SectionCard icon={UserRound} title={t('profile.info')} flush={!editing}
                action={!editing && (
                  <button type="button" onClick={() => setEditing(true)} className="text-[11px] font-bold text-brand-700 hover:underline underline-offset-2">
                    {t('profile.edit')}
                  </button>
                )}>
                {editing ? (
                  <form onSubmit={handleSave} className="flex flex-col gap-3">
                    <Field label={t('adminUsers.fullName')}>
                      <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} className={inputCls} required />
                    </Field>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Field label={t('adminUsers.email')}>
                        <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={inputCls} placeholder="nama@perusahaan.co.id" />
                      </Field>
                      <Field label={t('common.phone')}>
                        <input type="tel" inputMode="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className={inputCls} placeholder="08xxxxxxxxxx" />
                      </Field>
                    </div>
                    <Field label={t('adminUsers.position')}>
                      <select value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} className={inputCls}>
                        <option value="">{t('register.selectPosition')}</option>
                        {POSITIONS.map(p => <option key={p} value={p}>{t(`position.${p}` as DictKey)}</option>)}
                      </select>
                    </Field>
                    <Field label={t('profile.telegramChatId')} hint={t('profile.telegramHint')}>
                      <input inputMode="numeric" value={form.telegram_chat_id} onChange={e => setForm(f => ({ ...f, telegram_chat_id: e.target.value }))} className={inputCls} placeholder="123456789" />
                    </Field>
                    <p className="text-[11px] text-slate-400">{t('profile.readOnlyHint')}</p>
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setEditing(false)} className="rounded-control px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">{t('common.cancel')}</button>
                      <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-control bg-brand-700 text-white text-sm font-semibold px-4 py-2 hover:bg-brand-800 disabled:opacity-60">
                        {saving && <Loader2 className="h-4 w-4 animate-spin" />} {t('profile.saveChanges')}
                      </button>
                    </div>
                  </form>
                ) : (
                  <dl>
                    <InfoRow icon={Hash} label={t('adminUsers.username')} value={profile?.username ? `@${profile.username}` : null} emptyText={nf} />
                    <InfoRow icon={UserRound} label={t('adminUsers.fullName')} value={profile?.full_name} emptyText={nf} />
                    <InfoRow icon={Mail} label={t('adminUsers.email')} value={profile?.email} emptyText={nf} />
                    <InfoRow icon={Smartphone} label={t('common.phone')} value={profile?.phone} emptyText={nf} />
                    <InfoRow icon={Briefcase} label={t('adminUsers.position')} value={profile?.position ? t(`position.${profile.position}` as DictKey) : null} emptyText={nf} />
                    {(role === 'sales' || profile?.sales_divisions) && (
                      <InfoRow icon={Building2} label={t('adminUsers.salesDivision')} value={profile?.sales_divisions?.name} emptyText={nf} />
                    )}
                    <InfoRow icon={Shield} label={t('adminUsers.role')} value={role ? t(`role.${role}` as DictKey) : null} emptyText={nf} />
                    <InfoRow icon={CalendarDays} label={t('profile.joined')} value={profile?.created_at ? formatDate(profile.created_at) : null} emptyText={nf} />
                    <InfoRow icon={BadgeCheck} label={t('profile.accountStatus')} value={inactive ? t('profile.statusInactive') : t('profile.statusActive')} emptyText={nf} good={!inactive} />
                  </dl>
                )}
              </SectionCard>

              <SectionCard icon={KeyRound} title={t('profile.security')}>
                <form onSubmit={handlePasswordChange} className="flex flex-col gap-3">
                  {pwMessage && (
                    <div className={`rounded-control text-sm px-3 py-2 animate-fade-in ${pwMessage.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                      {pwMessage.text}
                    </div>
                  )}
                  <Field label={t('profile.currentPassword')}>
                    <PasswordInput value={pw.current} onChange={v => setPw(p => ({ ...p, current: v }))} className={inputCls} autoComplete="current-password" />
                  </Field>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label={t('profile.newPassword')}>
                      <PasswordInput value={pw.next} onChange={v => setPw(p => ({ ...p, next: v }))} className={inputCls} placeholder={t('adminUsers.minChars')} />
                    </Field>
                    <Field label={t('profile.confirmNewPassword')}>
                      <PasswordInput value={pw.confirm} onChange={v => setPw(p => ({ ...p, confirm: v }))} className={inputCls} />
                    </Field>
                  </div>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-[11px] text-slate-400">{t('profile.passwordHint')}</p>
                    <button type="submit" disabled={pwSaving || !pw.current || !pw.next}
                      className="inline-flex items-center gap-1.5 rounded-control border border-slate-300 bg-white text-slate-700 text-sm font-semibold px-4 py-2 hover:bg-slate-50 disabled:opacity-50">
                      {pwSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} {t('profile.changePassword')}
                    </button>
                  </div>
                </form>
              </SectionCard>
            </div>

            {/* ══ Right ══ */}
            <div className="lg:col-span-5 flex flex-col gap-4">
              <SectionCard icon={Smartphone} title={t('profile.appTitle')}>
                <p className="text-[13px] text-slate-600 leading-relaxed">{t('profile.appBody')}</p>
                {appVersion ? (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-control bg-emerald-50 border border-emerald-200 px-3 py-2.5">
                    <p className="text-[13px] font-semibold text-emerald-800">{t('profile.appInstalled', { v: appVersion })}</p>
                    {canCheckAppUpdate() && (
                      <button type="button" onClick={checkAppUpdate} className="text-[12px] font-bold text-emerald-800 underline underline-offset-2 shrink-0">
                        {t('app.checkUpdate')}
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <a href="/api/app/download"
                      className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-control bg-gradient-to-r from-brand-700 to-brand-500 text-white text-sm font-bold px-4 py-3 shadow-bento hover:from-brand-800 hover:to-brand-600">
                      <Download className="h-4 w-4" /> {t('profile.appDownload')}
                    </a>
                    <ol className="mt-3 space-y-1 text-[12px] text-slate-500 list-decimal pl-4">
                      <li>{t('profile.appStep1')}</li>
                      <li>{t('profile.appStep2')}</li>
                      <li>{t('profile.appStep3')}</li>
                    </ol>
                  </>
                )}
              </SectionCard>

              <SectionCard icon={Tag} title={t('profile.roleTitle')}>
                {role && (
                  <>
                    <span className="inline-flex rounded-chip border border-brand-200 bg-brand-50 text-brand-800 px-3 py-1 text-[13px] font-bold">
                      {t(`role.${role}` as DictKey)}
                    </span>
                    <p className="text-[10.5px] font-bold text-slate-500 uppercase tracking-[0.12em] mt-3.5">{t('profile.accessLevel')}</p>
                    <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-chip bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1 text-[13px] font-bold">
                      <Shield className="h-3.5 w-3.5" /> {t(`profile.level.${role}` as DictKey)}
                    </span>
                    <p className="text-[12.5px] text-slate-600 mt-2.5">{t(`profile.roleDesc.${role}` as DictKey)}</p>
                  </>
                )}
              </SectionCard>

              <SectionCard icon={Send} title={t('profile.telegramTitle')}>
                <p className={`text-[13px] ${profile?.telegram_chat_id ? 'text-emerald-700 font-semibold' : 'text-slate-500'}`}>
                  {profile?.telegram_chat_id ? t('profile.telegramOn') : t('profile.telegramOff')}
                </p>
              </SectionCard>

              {onSignOut && (
                <button type="button" onClick={onSignOut}
                  className="inline-flex items-center justify-center gap-2 rounded-control border border-slate-200 bg-white text-slate-600 text-sm font-semibold px-4 py-2.5 hover:bg-red-50 hover:text-red-600 hover:border-red-200">
                  <LogOut className="h-4 w-4" /> {t('common.signOut')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[12px] font-semibold text-slate-700 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-400 mt-1">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full rounded-control border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';
