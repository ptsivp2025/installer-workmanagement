'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save, RotateCcw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import type { PlatformSettings } from '@/lib/types';
import { LoadingState, ErrorState } from '@/components/shared/States';
import { applyThemeColor, DEFAULT_PRIMARY, DEFAULT_SECONDARY } from '@/lib/theme';

const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];

const emptyForm = {
  platform_name: '', company_name: '', logo_url: '', timezone: '', date_format: 'DD/MM/YYYY', show_dashboard_category_breakdown: true,
  primary_color: DEFAULT_PRIMARY, secondary_color: DEFAULT_SECONDARY,
  login_bg_url: '', login_headline: '', login_subheadline: '',
};

export function SettingsSection() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.from('platform_settings').select('*').eq('id', true).single();
    if (err) setError(err.message);
    else {
      const s = data as PlatformSettings;
      setSettings(s);
      setForm({
        platform_name: s.platform_name, company_name: s.company_name, logo_url: s.logo_url ?? '', timezone: s.timezone, date_format: s.date_format,
        show_dashboard_category_breakdown: s.show_dashboard_category_breakdown,
        primary_color: s.primary_color ?? DEFAULT_PRIMARY, secondary_color: s.secondary_color ?? DEFAULT_SECONDARY,
        login_bg_url: s.login_bg_url ?? '', login_headline: s.login_headline ?? '', login_subheadline: s.login_subheadline ?? '',
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.platform_name.trim()) { setError(t('adminSettings.platformNameRequired')); return; }
    setSaving(true);
    setError(null);
    setSaved(false);
    const { error: err } = await supabase.from('platform_settings').update({
      platform_name: form.platform_name.trim(),
      company_name: form.company_name.trim(),
      logo_url: form.logo_url.trim() || null,
      timezone: form.timezone.trim() || 'Asia/Jakarta',
      date_format: form.date_format,
      show_dashboard_category_breakdown: form.show_dashboard_category_breakdown,
      primary_color: form.primary_color,
      secondary_color: form.secondary_color,
      login_bg_url: form.login_bg_url.trim() || null,
      login_headline: form.login_headline.trim() || null,
      login_subheadline: form.login_subheadline.trim() || null,
      updated_by: user?.id ?? null,
    }).eq('id', true);
    setSaving(false);
    if (err) { setError(err.message); return; }
    applyThemeColor(form.primary_color);
    try { window.sessionStorage.setItem('iwm_theme_primary', form.primary_color); } catch { /* ignore */ }
    setSaved(true);
    load();
  }

  return (
    <div>
      <p className="text-sm text-slate-500 mb-6">{t('adminSettings.subtitle')}</p>

      {loading ? <LoadingState /> : error && !settings ? <ErrorState message={error} onRetry={load} /> : (
        <form onSubmit={handleSave} className="max-w-2xl space-y-4">
          {error && <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
          {saved && <div className="rounded-control bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-3 py-2">{t('common.saved')}</div>}

          {/* Live preview — same markup/classes as the real sidebar header
              (AppShell.tsx), so what admin sees here is what everyone else
              will see, not a stylized mockup. */}
          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">{t('adminSettings.preview')}</p>
            <div className="bg-white rounded-card border border-slate-200 shadow-card p-4">
              <div className="flex items-center gap-2.5">
                {form.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.logo_url} alt="" className="h-9 w-9 rounded-lg object-contain shrink-0" />
                ) : (
                  <div className="h-9 w-9 rounded-lg text-white flex items-center justify-center text-sm font-bold shrink-0" style={{ background: form.primary_color }}>
                    {(form.platform_name || 'IW').slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 text-sm leading-tight truncate">{form.platform_name || t('adminSettings.platformName')}</p>
                  <p className="text-[11px] text-slate-400 leading-tight truncate">{form.company_name}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-card border border-slate-200 shadow-card p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('adminSettings.platformName')}</label>
              <input value={form.platform_name} onChange={e => setForm(f => ({ ...f, platform_name: e.target.value }))} className={inputCls} />
              <p className="text-xs text-slate-400 mt-1">{t('adminSettings.platformNameHint')}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('adminSettings.companyName')}</label>
              <input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('adminSettings.logoUrl')}</label>
              <input value={form.logo_url} onChange={e => setForm(f => ({ ...f, logo_url: e.target.value }))} className={inputCls} placeholder="https://…/logo.png" />
              <p className="text-xs text-slate-400 mt-1">{t('adminSettings.logoHint')}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t('adminSettings.timezone')}</label>
                <input value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))} className={inputCls} placeholder="Asia/Jakarta" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t('adminSettings.dateFormat')}</label>
                <select value={form.date_format} onChange={e => setForm(f => ({ ...f, date_format: e.target.value }))} className={inputCls}>
                  {DATE_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-card border border-slate-200 shadow-card p-5 space-y-4">
            <p className="text-sm font-medium text-slate-700">{t('adminSettings.themeSection')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t('adminSettings.primaryColor')}</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={form.primary_color} onChange={e => setForm(f => ({ ...f, primary_color: e.target.value }))} className="h-9 w-12 rounded-control border border-slate-300 cursor-pointer" />
                  <input value={form.primary_color} onChange={e => setForm(f => ({ ...f, primary_color: e.target.value }))} className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t('adminSettings.secondaryColor')}</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={form.secondary_color} onChange={e => setForm(f => ({ ...f, secondary_color: e.target.value }))} className="h-9 w-12 rounded-control border border-slate-300 cursor-pointer" />
                  <input value={form.secondary_color} onChange={e => setForm(f => ({ ...f, secondary_color: e.target.value }))} className={inputCls} />
                </div>
              </div>
            </div>
            <div className="h-12 rounded-control" style={{ background: `linear-gradient(135deg, ${form.primary_color}, ${form.secondary_color})` }} />
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400">{t('adminSettings.themeHint')}</p>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, primary_color: DEFAULT_PRIMARY, secondary_color: DEFAULT_SECONDARY }))}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 shrink-0"
              >
                <RotateCcw className="h-3 w-3" /> {t('adminSettings.resetToDefault')}
              </button>
            </div>

            <div className="pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-slate-700">{t('adminSettings.loginBgUrl')}</label>
                {form.login_bg_url && (
                  <button type="button" onClick={() => setForm(f => ({ ...f, login_bg_url: '' }))} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
                    <RotateCcw className="h-3 w-3" /> {t('adminSettings.resetToDefault')}
                  </button>
                )}
              </div>
              <input value={form.login_bg_url} onChange={e => setForm(f => ({ ...f, login_bg_url: e.target.value }))} className={inputCls} placeholder="https://…/background.jpg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('adminSettings.loginHeadline')}</label>
              <input value={form.login_headline} onChange={e => setForm(f => ({ ...f, login_headline: e.target.value }))} className={inputCls} placeholder={t('login.tagline')} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('adminSettings.loginSubheadline')}</label>
              <textarea value={form.login_subheadline} onChange={e => setForm(f => ({ ...f, login_subheadline: e.target.value }))} className={inputCls} rows={2} placeholder={t('login.description')} />
            </div>
          </div>

          <div className="bg-white rounded-card border border-slate-200 shadow-card p-5">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm text-slate-700">{t('adminSettings.showCategoryBreakdown')}</span>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, show_dashboard_category_breakdown: !f.show_dashboard_category_breakdown }))}
                className={`relative h-5 w-9 rounded-full transition ${form.show_dashboard_category_breakdown ? 'bg-brand-600' : 'bg-slate-200'}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${form.show_dashboard_category_breakdown ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </label>
          </div>

          <div className="flex justify-end pt-2">
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-4 py-2 hover:bg-brand-700 disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t('adminSettings.saveSettings')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

const inputCls = 'w-full rounded-control border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';
