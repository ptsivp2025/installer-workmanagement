'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Upload, Loader2, Smartphone, ListChecks, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/app/providers';
import { formatDateTime, errorMessage } from '@/lib/utils';
import { APP_RELEASE_BUCKET, APP_RELEASE_FILE } from '@/lib/app-release';
import { LoadingState } from '@/components/shared/States';
import { SectionCard, InfoRow } from '@/components/shared/Modal';

interface Release {
  app_version_code: number | null;
  app_version_name: string | null;
  app_release_notes: string | null;
  app_update_required: boolean | null;
  app_file_size: number | null;
  app_uploaded_at: string | null;
  require_native_app: boolean | null;
}

const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Admin Panel → Aplikasi Android: publish a new APK and download the current
 * one. The file goes to a private bucket (migration 028), straight from the
 * browser with the admin's own login (storage RLS: admin only), so there's
 * no request-size limit of a server route in the way. Everyone else gets it
 * through /api/app/download, signed in.
 */
export function AndroidAppSection() {
  const { t } = useLanguage();
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ name: '', code: '', notes: '', required: false });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('platform_settings')
      .select('app_version_code, app_version_name, app_release_notes, app_update_required, app_file_size, app_uploaded_at, require_native_app')
      .eq('id', true).maybeSingle();
    const r = (data as Release | null) ?? null;
    setRelease(r);
    setForm(f => ({ ...f, code: String((r?.app_version_code ?? 0) + 1) }));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const current = release?.app_version_code ?? 0;
    const code = parseInt(form.code, 10);
    if (!file || !file.name.toLowerCase().endsWith('.apk') || file.size > MAX_BYTES) { setMessage({ ok: false, text: t('app.errFile') }); return; }
    if (!form.name.trim()) { setMessage({ ok: false, text: t('app.errName') }); return; }
    if (!Number.isFinite(code) || code <= current) { setMessage({ ok: false, text: t('app.errVersion', { n: current }) }); return; }

    setSaving(true);
    try {
      const { error: upErr } = await supabase.storage.from(APP_RELEASE_BUCKET)
        .upload(APP_RELEASE_FILE, file, { upsert: true, contentType: 'application/vnd.android.package-archive', cacheControl: '0' });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase.from('platform_settings').update({
        app_version_code: code,
        app_version_name: form.name.trim(),
        app_release_notes: form.notes.trim() || null,
        app_update_required: form.required,
        app_file_size: file.size,
        app_uploaded_at: new Date().toISOString(),
      }).eq('id', true);
      if (dbErr) throw dbErr;
      setMessage({ ok: true, text: t('app.uploaded') });
      setFile(null);
      setForm({ name: '', code: String(code + 1), notes: '', required: false });
      load();
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err, t('common.actionFailed')) });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState />;

  const has = Boolean(release?.app_version_code);
  const nf = '—';

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-500">{t('app.intro')}</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <SectionCard icon={Smartphone} title={t('app.current')} flush={has}
          action={has ? (
            <a href="/api/app/download" className="inline-flex items-center gap-1.5 rounded-control bg-brand-700 text-white text-[12px] font-bold px-3 py-1.5 hover:bg-brand-800">
              <Download className="h-3.5 w-3.5" /> {t('app.download')}
            </a>
          ) : undefined}>
          {has ? (
            <dl>
              <InfoRow label={t('app.versionName')} value={`v${release?.app_version_name}`} emptyText={nf} />
              <InfoRow label={t('app.versionCode')} value={release?.app_version_code} emptyText={nf} />
              <InfoRow label={t('app.size')} value={release?.app_file_size ? `${Math.round(release.app_file_size / 1024)} KB` : null} emptyText={nf} />
              <InfoRow label={t('app.uploadedAt')} value={release?.app_uploaded_at ? formatDateTime(release.app_uploaded_at) : null} emptyText={nf} />
              <InfoRow label={t('app.required')} value={release?.app_update_required ? t('app.required') : t('app.optional')} emptyText={nf} good={Boolean(release?.app_update_required)} />
              {release?.app_release_notes && (
                <p className="px-4 py-3 text-[12.5px] text-slate-600 whitespace-pre-line border-t border-slate-100">{release.app_release_notes}</p>
              )}
            </dl>
          ) : (
            <p className="text-sm text-slate-400">{t('app.none')}</p>
          )}
        </SectionCard>

        <SectionCard icon={Upload} title={t('app.upload')}>
          <form onSubmit={publish} className="flex flex-col gap-3">
            {message && (
              <div className={`rounded-control text-sm px-3 py-2 ${message.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>{message.text}</div>
            )}
            <label className="block">
              <span className="block text-[12px] font-semibold text-slate-700 mb-1">{t('app.file')}</span>
              <input type="file" accept=".apk,application/vnd.android.package-archive"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-control file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-[12px] font-semibold text-slate-700 mb-1">{t('app.versionName')}</span>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="1.5" className={inputCls} />
              </label>
              <label className="block">
                <span className="block text-[12px] font-semibold text-slate-700 mb-1">{t('app.versionCode')}</span>
                <input inputMode="numeric" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.replace(/\D/g, '') }))} className={inputCls} />
              </label>
            </div>
            <label className="block">
              <span className="block text-[12px] font-semibold text-slate-700 mb-1">{t('app.notes')}</span>
              <textarea rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={inputCls} />
            </label>
            <label className="inline-flex items-center gap-2 text-[13px] text-slate-700">
              <input type="checkbox" checked={form.required} onChange={e => setForm(f => ({ ...f, required: e.target.checked }))} className="rounded" />
              {t('app.requiredLabel')}
            </label>
            <div className="flex justify-end">
              <button type="submit" disabled={saving || !file}
                className="inline-flex items-center gap-1.5 rounded-control bg-brand-700 text-white text-sm font-semibold px-4 py-2 hover:bg-brand-800 disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {t('app.uploadBtn')}
              </button>
            </div>
          </form>
        </SectionCard>
      </div>

      <SectionCard icon={ListChecks} title={t('app.steps')}>
        <ol className="list-decimal pl-5 space-y-1.5 text-[13px] text-slate-600">
          <li>{t('app.step1')}</li>
          <li>{t('app.step2')}</li>
          <li>{t('app.step3')}</li>
          <li className="flex-wrap">
            {t('app.step4', { s: release?.require_native_app ? t('app.on') : t('app.off') })}
            {release?.require_native_app && <ShieldCheck className="inline h-4 w-4 text-emerald-600 ml-1 align-text-bottom" />}
          </li>
        </ol>
      </SectionCard>
    </div>
  );
}

const inputCls = 'w-full rounded-control border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';
