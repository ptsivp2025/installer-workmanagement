'use client';

import { useState } from 'react';
import { Users, Plus, Trash2, Loader2, Star } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { ActivityPersonnel } from '@/lib/types';
import { useLanguage } from '@/app/providers';

export function PersonnelPanel({
  activityId, personnel, locked, canEdit, isStaff, onChanged,
}: { activityId: string; personnel: ActivityPersonnel[]; locked: boolean; canEdit: boolean; isStaff: boolean; onChanged: () => void }) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [asPrimary, setAsPrimary] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingPrimary, setSettingPrimary] = useState<string | null>(null);

  const hasPrimary = personnel.some(p => p.is_primary);
  const primary = personnel.find(p => p.is_primary) ?? null;
  const support = personnel.filter(p => !p.is_primary);

  async function addPersonnel(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.from('activity_personnel').insert({
      activity_id: activityId, name: name.trim(), role: role.trim() || null, is_primary: asPrimary && !hasPrimary,
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    setName(''); setRole(''); setAsPrimary(false);
    onChanged();
  }

  async function removePersonnel(id: string) {
    const { error: err } = await supabase.from('activity_personnel').delete().eq('id', id);
    if (!err) onChanged();
  }

  async function setPrimary(id: string) {
    setSettingPrimary(id);
    setError(null);
    const { error: err } = await supabase.rpc('iwm_set_primary_personnel', { p_activity_id: activityId, p_personnel_id: id });
    setSettingPrimary(null);
    if (err) { setError(err.message); return; }
    onChanged();
  }

  return (
    <div className="bg-white rounded-card border border-slate-200 shadow-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2"><Users className="h-4 w-4" /> {t('personnel.title')}</h3>
        <span className="text-sm font-medium text-slate-500">{personnel.length} {personnel.length === 1 ? t('personnel.person') : t('personnel.peopleCount')}</span>
      </div>

      {personnel.length === 0 ? (
        <p className="text-sm text-slate-400 py-3">{t('personnel.noneRecorded')}</p>
      ) : (
        <div className="mb-3 space-y-3">
          <div>
            <p className="text-xs font-medium text-slate-400 mb-1">{t('personnel.primaryPic')}</p>
            {primary ? (
              <div className="flex items-center justify-between py-1 text-sm">
                <span className="inline-flex items-center gap-1.5 text-slate-800 font-medium">
                  <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
                  {primary.name}{primary.role && <span className="text-slate-400 font-normal"> — {primary.role}</span>}
                </span>
                {isStaff && (
                  <button onClick={() => removePersonnel(primary.id)} className="text-slate-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                )}
              </div>
            ) : <p className="text-sm text-slate-400">{t('personnel.noPrimaryYet')}</p>}
          </div>
          {support.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-400 mb-1">{t('personnel.support')}</p>
              <ul className="divide-y divide-slate-100">
                {support.map(p => (
                  <li key={p.id} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-slate-700">{p.name}{p.role && <span className="text-slate-400"> — {p.role}</span>}</span>
                    <span className="flex items-center gap-2">
                      {isStaff && (
                        <button onClick={() => setPrimary(p.id)} disabled={settingPrimary === p.id} className="text-xs text-slate-400 hover:text-brand-600 disabled:opacity-50">
                          {settingPrimary === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('personnel.setAsPrimary')}
                        </button>
                      )}
                      {(isStaff || (canEdit && !locked)) && (
                        <button onClick={() => removePersonnel(p.id)} className="text-slate-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {(!locked || isStaff) && (
        <form onSubmit={addPersonnel} className="space-y-2">
          {locked && isStaff && <p className="text-xs text-amber-600">{t('personnel.addingCorrection')}</p>}
          <div className="flex flex-col sm:flex-row gap-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder={t('personnel.namePlaceholder')} className="flex-1 rounded-control border border-slate-300 px-3 py-2 text-sm" />
            <input value={role} onChange={e => setRole(e.target.value)} placeholder={t('personnel.rolePlaceholder')} className="flex-1 rounded-control border border-slate-300 px-3 py-2 text-sm" />
            <button type="submit" disabled={saving || !name.trim()} className="inline-flex items-center justify-center gap-1 rounded-control bg-slate-900 text-white text-sm font-medium px-3 py-2 disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {t('personnel.add')}
            </button>
          </div>
          {!hasPrimary && (
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
              <input type="checkbox" checked={asPrimary} onChange={e => setAsPrimary(e.target.checked)} className="rounded" />
              {t('personnel.addAsPrimary')}
            </label>
          )}
        </form>
      )}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}
