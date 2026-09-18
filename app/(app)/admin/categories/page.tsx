'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, ArrowUp, ArrowDown, Pencil, Power, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import type { ActivityCategory } from '@/lib/types';
import { LoadingState, ErrorState } from '@/components/shared/States';
import { Modal } from '@/components/shared/Modal';
import { AdminTabs } from '@/components/shared/AdminTabs';

export default function AdminCategoriesPage() {
  const { user, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const [categories, setCategories] = useState<ActivityCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ActivityCategory | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.from('activity_categories').select('*').order('sort_order');
    if (err) setError(err.message);
    else setCategories((data as ActivityCategory[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleActive(c: ActivityCategory) {
    await supabase.from('activity_categories').update({ active: !c.active }).eq('id', c.id);
    load();
  }

  async function move(c: ActivityCategory, direction: -1 | 1) {
    const idx = categories.findIndex(x => x.id === c.id);
    const swapWith = categories[idx + direction];
    if (!swapWith) return;
    await Promise.all([
      supabase.from('activity_categories').update({ sort_order: swapWith.sort_order }).eq('id', c.id),
      supabase.from('activity_categories').update({ sort_order: c.sort_order }).eq('id', swapWith.id),
    ]);
    load();
  }

  if (authLoading) return <LoadingState />;
  if (!user || user.role !== 'admin') {
    return <ErrorState message={t('admin.onlyAdmins')} />;
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">{t('admin.panel')}</h1>
      <AdminTabs />
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm text-slate-500 mt-0.5">{t('adminCategories.subtitle')}</p>
        </div>
        <button onClick={() => { setEditing(null); setFormOpen(true); }} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-3.5 py-2 hover:bg-brand-700">
          <Plus className="h-4 w-4" /> {t('adminCategories.newCategory')}
        </button>
      </div>

      <div className="bg-white rounded-card border border-slate-200 shadow-card overflow-hidden">
        {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={load} /> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2.5 w-16">{t('adminCategories.order')}</th>
                <th className="px-4 py-2.5">{t('common.name')}</th>
                <th className="px-4 py-2.5">{t('adminCategories.requires')}</th>
                <th className="px-4 py-2.5">{t('adminCategories.radius')}</th>
                <th className="px-4 py-2.5">{t('common.status')}</th>
                <th className="px-4 py-2.5 text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {categories.map((c, i) => (
                <tr key={c.id} className={c.active ? '' : 'opacity-50'}>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => move(c, -1)} disabled={i === 0} className="text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                      <button onClick={() => move(c, 1)} disabled={i === categories.length - 1} className="text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{c.name}</p>
                    <p className="text-xs text-slate-400 font-mono">{c.code}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 space-x-1">
                    {c.requires_gps && <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5">{t('adminCategories.gps')}</span>}
                    {c.requires_evidence && <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5">{t('adminCategories.evidenceCount', { count: c.evidence_min_count })}</span>}
                    {c.requires_personnel && <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5">{t('adminCategories.personnel')}</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{c.requires_gps ? `${c.gps_radius_m}m` : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${c.active ? 'text-emerald-600' : 'text-slate-400'}`}>{c.active ? t('common.active') : t('common.inactive')}</span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button onClick={() => { setEditing(c); setFormOpen(true); }} className="text-slate-400 hover:text-slate-700 inline-flex"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => toggleActive(c)} title={c.active ? t('common.deactivate') : t('common.activate')} className="text-slate-400 hover:text-slate-700 inline-flex"><Power className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CategoryFormModal open={formOpen} onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); load(); }} category={editing} nextSortOrder={categories.length} />
    </div>
  );
}

function CategoryFormModal({
  open, onClose, onSaved, category, nextSortOrder,
}: { open: boolean; onClose: () => void; onSaved: () => void; category: ActivityCategory | null; nextSortOrder: number }) {
  const { t } = useLanguage();
  const [form, setForm] = useState({
    code: '', name: '', requires_gps: true, requires_evidence: true, requires_personnel: true,
    evidence_min_count: 1, gps_radius_m: 100, gps_accuracy_threshold_m: 100,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (category) {
      setForm({
        code: category.code, name: category.name, requires_gps: category.requires_gps,
        requires_evidence: category.requires_evidence, requires_personnel: category.requires_personnel,
        evidence_min_count: category.evidence_min_count, gps_radius_m: category.gps_radius_m,
        gps_accuracy_threshold_m: category.gps_accuracy_threshold_m,
      });
    } else {
      setForm({ code: '', name: '', requires_gps: true, requires_evidence: true, requires_personnel: true, evidence_min_count: 1, gps_radius_m: 100, gps_accuracy_threshold_m: 100 });
    }
    setError(null);
  }, [open, category]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) { setError(t('projects.codeNameRequired')); return; }
    setSaving(true);
    setError(null);
    const payload = { ...form, code: form.code.trim().toLowerCase().replace(/\s+/g, '_'), name: form.name.trim() };
    const result = category
      ? await supabase.from('activity_categories').update(payload).eq('id', category.id)
      : await supabase.from('activity_categories').insert({ ...payload, sort_order: nextSortOrder });
    setSaving(false);
    if (result.error) { setError(result.error.message); return; }
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title={category ? t('adminCategories.editCategory') : t('adminCategories.newCategory')}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{t('common.name')}</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} placeholder={t('adminCategories.namePlaceholder')} />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{t('adminCategories.code')}</label>
          <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} className={inputCls} placeholder="instalasi_demo" disabled={!!category} />
        </div>
        <div className="space-y-2">
          <Toggle label={t('adminCategories.requiresGps')} checked={form.requires_gps} onChange={v => setForm(f => ({ ...f, requires_gps: v }))} />
          {form.requires_gps && (
            <div className="pl-6 flex gap-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('adminCategories.gpsRadius')}</label>
                <input type="number" min={1} value={form.gps_radius_m} onChange={e => setForm(f => ({ ...f, gps_radius_m: Number(e.target.value) }))} className={`${inputCls} w-32`} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t('adminCategories.maxAccuracy')}</label>
                <input type="number" min={1} value={form.gps_accuracy_threshold_m} onChange={e => setForm(f => ({ ...f, gps_accuracy_threshold_m: Number(e.target.value) }))} className={`${inputCls} w-32`} />
              </div>
            </div>
          )}
          <Toggle label={t('adminCategories.requiresEvidence')} checked={form.requires_evidence} onChange={v => setForm(f => ({ ...f, requires_evidence: v }))} />
          {form.requires_evidence && (
            <div className="pl-6">
              <label className="block text-xs text-slate-500 mb-1">{t('adminCategories.minPhotoCount')}</label>
              <input type="number" min={0} value={form.evidence_min_count} onChange={e => setForm(f => ({ ...f, evidence_min_count: Number(e.target.value) }))} className={`${inputCls} w-32`} />
            </div>
          )}
          <Toggle label={t('adminCategories.requiresPersonnel')} checked={form.requires_personnel} onChange={v => setForm(f => ({ ...f, requires_personnel: v }))} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-control px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">{t('common.cancel')}</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-4 py-2 hover:bg-brand-700 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {t('common.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const inputCls = 'w-full rounded-control border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

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
