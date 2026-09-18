'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import type { PlatformSettings } from '@/lib/types';
import { LoadingState, ErrorState } from '@/components/shared/States';
import { AdminTabs } from '@/components/shared/AdminTabs';

const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];

export default function AdminSettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [form, setForm] = useState({ company_name: '', logo_url: '', timezone: '', date_format: 'DD/MM/YYYY', show_dashboard_category_breakdown: true });
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
      setForm({ company_name: s.company_name, logo_url: s.logo_url ?? '', timezone: s.timezone, date_format: s.date_format, show_dashboard_category_breakdown: s.show_dashboard_category_breakdown });
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.company_name.trim()) { setError(t('adminSettings.companyNameRequired')); return; }
    setSaving(true);
    setError(null);
    setSaved(false);
    const { error: err } = await supabase.from('platform_settings').update({
      company_name: form.company_name.trim(),
      logo_url: form.logo_url.trim() || null,
      timezone: form.timezone.trim() || 'Asia/Jakarta',
      date_format: form.date_format,
      show_dashboard_category_breakdown: form.show_dashboard_category_breakdown,
      updated_by: user?.id ?? null,
    }).eq('id', true);
    setSaving(false);
    if (err) { setError(err.message); return; }
    setSaved(true);
    load();
  }

  if (authLoading) return <LoadingState />;
  if (!user || user.role !== 'admin') return <ErrorState message={t('admin.onlyAdmins')} />;

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">{t('admin.panel')}</h1>
      <AdminTabs />
      <p className="text-sm text-slate-500 mb-6">{t('adminSettings.subtitle')}</p>

      {loading ? <LoadingState /> : error && !settings ? <ErrorState message={error} onRetry={load} /> : (
        <form onSubmit={handleSave} className="bg-white rounded-card border border-slate-200 shadow-card p-5 max-w-lg space-y-4">
          {error && <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
          {saved && <div className="rounded-control bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-3 py-2">{t('common.saved')}</div>}

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

          <div className="pt-2 border-t border-slate-100">
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
