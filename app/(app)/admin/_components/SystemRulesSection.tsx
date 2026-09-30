'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save, RotateCcw, Plus, Trash2, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import { LoadingState, ErrorState } from '@/components/shared/States';
import {
  SETTINGS, SETTING_GROUPS, SETTING_GROUP_LABELS, GPS_FLAGS, readSetting, toValues,
  type SettingDef, type SettingGroup, type SettingValues, type PositionOption,
} from '@/lib/settings';
import { ACCOUNT_TYPES } from '@/lib/constants';
import type { DictKey } from '@/lib/i18n';

/**
 * Admin Panel → Aturan Sistem: every business rule that used to be a number
 * in the code, grouped by what it's about. Each group saves on its own; a
 * field shows its default and can go back to it (which just deletes the
 * saved row, so a later change of default reaches it too).
 */
export function SystemRulesSection() {
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const [saved, setSaved] = useState<SettingValues>({});
  const [draft, setDraft] = useState<SettingValues>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<SettingGroup | null>(null);
  const [done, setDone] = useState<SettingGroup | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.from('app_settings').select('key, value');
    if (err) setError(err.message);
    else {
      const v = toValues(data as { key: string; value: unknown }[]);
      setSaved(v);
      setDraft(Object.fromEntries(SETTINGS.map(s => [s.key, readSetting(v, s.key)])));
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const L = (x: { id: string; en: string }) => (lang === 'en' ? x.en : x.id);
  const set = (key: string, value: unknown) => { setDraft(d => ({ ...d, [key]: value })); setDone(null); };

  async function saveGroup(group: SettingGroup) {
    setBusy(group);
    setError(null);
    const defs = SETTINGS.filter(s => s.group === group);
    for (const def of defs) {
      const v = draft[def.key];
      if (def.type === 'number' && (typeof v !== 'number' || !Number.isFinite(v) || (def.min != null && v < def.min) || (def.max != null && v > def.max))) {
        setError(`${L(def.label)}: ${t('rules.outOfRange', { min: def.min ?? '-', max: def.max ?? '-' })}`);
        setBusy(null);
        return;
      }
      if (def.type === 'options' && (!Array.isArray(v) || v.length === 0 || (v as PositionOption[]).some(o => !o.label.trim()))) {
        setError(`${L(def.label)}: ${t('rules.listRequired')}`);
        setBusy(null);
        return;
      }
    }
    const rows = defs.map(def => ({ key: def.key, value: draft[def.key] as never, updated_by: user?.id ?? null }));
    const { error: err } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' });
    setBusy(null);
    if (err) { setError(err.message); return; }
    setDone(group);
    window.dispatchEvent(new Event('iwm:settings-changed'));
    load();
  }

  async function resetField(def: SettingDef) {
    await supabase.from('app_settings').delete().eq('key', def.key);
    window.dispatchEvent(new Event('iwm:settings-changed'));
    load();
  }

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">{t('rules.subtitle')}</p>
      {error && <ErrorState message={error} onRetry={load} />}

      {SETTING_GROUPS.map(group => {
        const defs = SETTINGS.filter(s => s.group === group);
        const g = SETTING_GROUP_LABELS[group];
        return (
          <section key={group} className="bg-white rounded-card border border-slate-200 shadow-bento">
            <header className="px-5 py-3.5 border-b border-slate-100 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-slate-900">{L(g)}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{L(g.hint)}</p>
              </div>
              <button onClick={() => saveGroup(group)} disabled={busy === group}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-3.5 py-2 hover:bg-brand-700 disabled:opacity-60">
                {busy === group ? <Loader2 className="h-4 w-4 animate-spin" /> : done === group ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                {done === group ? t('rules.saved') : t('common.save')}
              </button>
            </header>
            <div className="divide-y divide-slate-100">
              {defs.map(def => (
                <div key={def.key} className="px-5 py-3.5 grid grid-cols-1 md:grid-cols-[1fr_minmax(0,300px)] gap-2 md:gap-6 items-start">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{L(def.label)}</p>
                    {def.help && <p className="text-xs text-slate-500 mt-0.5">{L(def.help)}</p>}
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {t('rules.default')}: {describe(def.default, def, t)}
                      {saved[def.key] !== undefined && (
                        <button onClick={() => resetField(def)} className="ml-2 inline-flex items-center gap-0.5 text-brand-600 hover:text-brand-700">
                          <RotateCcw className="h-3 w-3" /> {t('rules.reset')}
                        </button>
                      )}
                    </p>
                  </div>
                  <Field def={def} value={draft[def.key]} onChange={v => set(def.key, v)} />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function describe(v: unknown, def: SettingDef, t: (k: DictKey) => string): string {
  if (def.type === 'number') return `${v}${def.unit ? ` ${def.unit}` : ''}`;
  if (def.type === 'boolean') return v ? t('rules.on') : t('rules.off');
  if (Array.isArray(v)) return `${v.length}`;
  return String(v);
}

function Field({ def, value, onChange }: { def: SettingDef; value: unknown; onChange: (v: unknown) => void }) {
  const { t } = useLanguage();
  if (def.type === 'number') {
    return (
      <div className="flex items-center gap-2">
        <input type="number" value={Number.isFinite(value as number) ? (value as number) : ''} min={def.min} max={def.max} step={def.step ?? 1}
          onChange={e => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
          className="w-32 rounded-control border border-slate-300 px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500" />
        {def.unit && <span className="text-sm text-slate-500">{def.unit}</span>}
      </div>
    );
  }
  if (def.type === 'boolean') {
    const on = !!value;
    return (
      <button type="button" onClick={() => onChange(!on)} aria-pressed={on}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${on ? 'bg-brand-600' : 'bg-slate-300'}`}>
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    );
  }
  if (def.type === 'flags' || def.type === 'account_types') {
    const all: readonly string[] = def.type === 'flags' ? GPS_FLAGS : ACCOUNT_TYPES.filter(x => x !== 'admin');
    const list = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto pr-1">
        {all.map(k => (
          <label key={k} className="flex items-start gap-2 text-[12.5px] text-slate-700 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={list.includes(k)}
              onChange={e => onChange(e.target.checked ? [...list, k] : list.filter(x => x !== k))} />
            <span>{def.type === 'flags' ? t(`gpsRisk.${k}` as DictKey) : t(`account.${k}` as DictKey)}</span>
          </label>
        ))}
      </div>
    );
  }
  if (def.type === 'options') {
    const list = Array.isArray(value) ? (value as PositionOption[]) : [];
    const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `opsi_${Date.now().toString(36)}`;
    return (
      <div className="space-y-1.5">
        {list.map((o, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input value={o.label} onChange={e => onChange(list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              className="flex-1 rounded-control border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            <button type="button" onClick={() => onChange(list.filter((_, j) => j !== i))} disabled={list.length <= 1}
              className="text-slate-400 hover:text-red-600 disabled:opacity-30 p-1"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <button type="button" onClick={() => {
          const label = t('rules.newOption');
          onChange([...list, { value: slug(`${label} ${list.length + 1}`), label }]);
        }} className="inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
          <Plus className="h-4 w-4" /> {t('rules.addOption')}
        </button>
      </div>
    );
  }
  return null;
}
