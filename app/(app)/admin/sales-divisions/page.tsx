'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, ArrowUp, ArrowDown, Pencil, Power, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import type { SalesDivision } from '@/lib/types';
import { LoadingState, ErrorState } from '@/components/shared/States';
import { Modal } from '@/components/shared/Modal';
import { AdminTabs } from '@/components/shared/AdminTabs';
import { SearchInput } from '@/components/shared/SearchInput';

export default function AdminSalesDivisionsPage() {
  const { user, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const [divisions, setDivisions] = useState<SalesDivision[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SalesDivision | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.from('sales_divisions').select('*').order('sort_order');
    if (err) setError(err.message);
    else setDivisions((data as SalesDivision[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleActive(d: SalesDivision) {
    await supabase.from('sales_divisions').update({ active: !d.active }).eq('id', d.id);
    load();
  }

  async function move(d: SalesDivision, direction: -1 | 1) {
    const idx = divisions.findIndex(x => x.id === d.id);
    const swapWith = divisions[idx + direction];
    if (!swapWith) return;
    await Promise.all([
      supabase.from('sales_divisions').update({ sort_order: swapWith.sort_order }).eq('id', d.id),
      supabase.from('sales_divisions').update({ sort_order: d.sort_order }).eq('id', swapWith.id),
    ]);
    load();
  }

  if (authLoading) return <LoadingState />;
  if (!user || user.role !== 'admin') return <ErrorState message={t('admin.onlyAdmins')} />;

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">{t('admin.panel')}</h1>
      <AdminTabs />
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-slate-500">{t('adminDivisions.subtitle')}</p>
        <button onClick={() => { setEditing(null); setFormOpen(true); }} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-3.5 py-2 hover:bg-brand-700">
          <Plus className="h-4 w-4" /> {t('adminDivisions.newDivision')}
        </button>
      </div>

      {divisions.length > 6 && (
        <div className="mb-4"><SearchInput value={search} onChange={setSearch} placeholder={t('adminDivisions.searchPlaceholder')} /></div>
      )}

      <div className="bg-white rounded-card border border-slate-200 shadow-card overflow-hidden">
        {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={load} /> : (() => {
          const filtered = divisions.filter(d => d.name.toLowerCase().includes(search.trim().toLowerCase()));
          const filtering = search.trim() !== '';
          return filtered.length === 0 ? (
            <p className="text-sm text-slate-400 p-5">{t('adminDivisions.noMatch', { search })}</p>
          ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2.5 w-16">{t('adminCategories.order')}</th>
                <th className="px-4 py-2.5">{t('common.name')}</th>
                <th className="px-4 py-2.5">{t('common.status')}</th>
                <th className="px-4 py-2.5 text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(d => {
                const i = divisions.findIndex(x => x.id === d.id);
                return (
                <tr key={d.id} className={d.active ? '' : 'opacity-50'}>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => move(d, -1)} disabled={filtering || i === 0} title={filtering ? t('adminDivisions.clearToReorder') : undefined} className="text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                      <button onClick={() => move(d, 1)} disabled={filtering || i === divisions.length - 1} title={filtering ? t('adminDivisions.clearToReorder') : undefined} className="text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{d.name}</p>
                    <p className="text-xs text-slate-400 font-mono">{d.code}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${d.active ? 'text-emerald-600' : 'text-slate-400'}`}>{d.active ? t('common.active') : t('common.inactive')}</span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button onClick={() => { setEditing(d); setFormOpen(true); }} className="text-slate-400 hover:text-slate-700 inline-flex"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => toggleActive(d)} title={d.active ? t('common.deactivate') : t('common.activate')} className="text-slate-400 hover:text-slate-700 inline-flex"><Power className="h-4 w-4" /></button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          );
        })()}
      </div>

      <DivisionFormModal open={formOpen} onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); load(); }} division={editing} nextSortOrder={divisions.length} />
    </div>
  );
}

function DivisionFormModal({
  open, onClose, onSaved, division, nextSortOrder,
}: { open: boolean; onClose: () => void; onSaved: () => void; division: SalesDivision | null; nextSortOrder: number }) {
  const { t } = useLanguage();
  const [form, setForm] = useState({ code: '', name: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(division ? { code: division.code, name: division.name } : { code: '', name: '' });
    setError(null);
  }, [open, division]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) { setError(t('projects.codeNameRequired')); return; }
    setSaving(true);
    setError(null);
    const payload = { code: form.code.trim().toLowerCase().replace(/\s+/g, '_'), name: form.name.trim() };
    const result = division
      ? await supabase.from('sales_divisions').update(payload).eq('id', division.id)
      : await supabase.from('sales_divisions').insert({ ...payload, sort_order: nextSortOrder });
    setSaving(false);
    if (result.error) { setError(result.error.message); return; }
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title={division ? t('adminDivisions.editDivision') : t('adminDivisions.newDivision')}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{t('common.name')}</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} placeholder={t('adminDivisions.namePlaceholder')} />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{t('adminCategories.code')}</label>
          <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} className={inputCls} placeholder="corporate_sales" disabled={!!division} />
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
