'use client';

import { useEffect, useState } from 'react';
import { Loader2, Users, MapPin } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/app/providers';
import { Modal } from '@/components/shared/Modal';
import { SearchInput } from '@/components/shared/SearchInput';
import type { Activity, ActivityCategory, AppUser } from '@/lib/types';
import type { DictKey } from '@/lib/i18n';
import { PRIORITIES } from '@/lib/constants';

interface ProjectOption { id: string; name: string; code: string; customer_name: string | null; address: string | null; }

export function ActivityFormModal({
  open, onClose, onSaved, categories, activity, defaultProjectId,
}: {
  open: boolean; onClose: () => void; onSaved: () => void;
  categories: ActivityCategory[]; activity?: Activity | null; defaultProjectId?: string;
}) {
  const { t } = useLanguage();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [personnelSearch, setPersonnelSearch] = useState('');
  const [selectedPersonnel, setSelectedPersonnel] = useState<string[]>([]);
  const [primaryPersonnel, setPrimaryPersonnel] = useState<string>('');
  const [form, setForm] = useState({
    project_id: '', category_id: '', title: '',
    scheduled_date: '', start_time: '', end_time: '', priority: 'normal', notes: '',
    pic_name: '', pic_phone: '',
    product_brand: '', product_type: '', product_model: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCategory = categories.find(c => c.id === form.category_id) ?? null;
  const needsProduct = !!selectedCategory && (selectedCategory.counts_as_demo || selectedCategory.counts_as_installation);

  useEffect(() => {
    if (!open) return;
    supabase.from('projects').select('id, name, code, customer_name, address').eq('status', 'active').order('name').limit(200)
      .then((res: { data: ProjectOption[] | null }) => setProjects(res.data ?? []));
    supabase.from('users').select('*').eq('active', true).order('full_name')
      .then((res: { data: AppUser[] | null }) => setUsers(res.data ?? []));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (activity) {
      setForm({
        project_id: activity.project_id, category_id: activity.category_id, title: activity.title,
        scheduled_date: activity.scheduled_date, start_time: activity.start_time ?? '', end_time: activity.end_time ?? '',
        priority: activity.priority, notes: activity.notes ?? '',
        pic_name: activity.pic_name ?? '', pic_phone: activity.pic_phone ?? '',
        product_brand: activity.product_brand ?? '', product_type: activity.product_type ?? '', product_model: activity.product_model ?? '',
      });
    } else {
      setForm({
        project_id: defaultProjectId ?? '', category_id: categories.find(c => c.active)?.id ?? '', title: '',
        scheduled_date: new Date().toISOString().slice(0, 10),
        start_time: '', end_time: '', priority: 'normal', notes: '',
        pic_name: '', pic_phone: '', product_brand: '', product_type: '', product_model: '',
      });
    }
    setSelectedPersonnel([]);
    setPrimaryPersonnel('');
    setPersonnelSearch('');
    setError(null);
  }, [open, activity, defaultProjectId, categories]);

  function togglePersonnel(userId: string) {
    setSelectedPersonnel(sel => {
      const next = sel.includes(userId) ? sel.filter(id => id !== userId) : [...sel, userId];
      setPrimaryPersonnel(p => {
        if (!next.includes(p)) return next.length === 1 ? next[0] : '';
        return p;
      });
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.project_id || !form.category_id || !form.title.trim() || !form.scheduled_date) {
      setError(t('activity.requiredFieldsMsg'));
      return;
    }
    if (needsProduct && (!form.product_brand.trim() || !form.product_type.trim())) {
      setError(t('activity.productModelRequiredMsg'));
      return;
    }
    if (!activity && selectedPersonnel.length > 1 && !primaryPersonnel) {
      setError(t('activity.primaryPicRequiredMsg'));
      return;
    }
    setSaving(true);
    setError(null);

    const project = projects.find(p => p.id === form.project_id);
    const productFields = {
      product_brand: form.product_brand.trim() || null,
      product_type: form.product_type.trim() || null,
      product_model: form.product_model.trim() || null,
    };

    if (activity) {
      const payload = {
        project_id: form.project_id,
        category_id: form.category_id,
        title: form.title.trim(),
        customer_name: project?.customer_name ?? null,
        scheduled_date: form.scheduled_date,
        start_time: form.start_time || null,
        end_time: form.end_time || null,
        priority: form.priority,
        notes: form.notes.trim() || null,
        pic_name: form.pic_name.trim() || null,
        pic_phone: form.pic_phone.trim() || null,
        ...productFields,
      };
      const result = await supabase.from('activities').update(payload).eq('id', activity.id);
      setSaving(false);
      if (result.error) { setError(result.error.message); return; }
      onSaved();
      return;
    }

    // Atomic: activity + PIC + support team are created together server-side
    // (iwm_create_activity, migration 015) — a failed personnel insert can
    // never leave a half-configured activity behind.
    const personnel = selectedPersonnel.map(userId => {
      const u = users.find(x => x.id === userId);
      return {
        user_id: userId,
        name: u?.full_name ?? 'Unknown',
        role: u?.role ?? null,
        is_primary: selectedPersonnel.length === 1 ? true : userId === primaryPersonnel,
      };
    });

    const { error: rpcErr } = await supabase.rpc('iwm_create_activity', {
      p_project_id: form.project_id,
      p_category_id: form.category_id,
      p_title: form.title.trim(),
      p_customer_name: project?.customer_name ?? null,
      p_location_address: null,
      p_scheduled_date: form.scheduled_date,
      p_start_time: form.start_time || null,
      p_end_time: form.end_time || null,
      p_priority: form.priority,
      p_notes: form.notes.trim() || null,
      p_target_latitude: null,
      p_target_longitude: null,
      p_pic_name: form.pic_name.trim() || null,
      p_pic_phone: form.pic_phone.trim() || null,
      p_product_brand: productFields.product_brand,
      p_product_type: productFields.product_type,
      p_product_model: productFields.product_model,
      p_personnel: personnel,
    });

    setSaving(false);
    if (rpcErr) { setError(rpcErr.message ?? t('activity.failedToCreate')); return; }
    onSaved();
  }

  const filteredUsers = users.filter(u => u.full_name.toLowerCase().includes(personnelSearch.trim().toLowerCase()));

  return (
    <Modal open={open} onClose={onClose} title={activity ? t('activity.editActivity') : t('activity.newActivity')} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('activity.project')} required>
            <select value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))} className={inputCls}>
              <option value="">{t('activity.selectProject')}</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
            </select>
          </Field>
          <Field label={t('activity.category')} required>
            <select value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))} className={inputCls}>
              <option value="">{t('activity.selectCategory')}</option>
              {categories.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t('activity.title')} required>
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={inputCls} placeholder={t('activity.titlePlaceholder')} />
        </Field>
        <Field label={t('activity.priority')}>
          <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className={`${inputCls} sm:w-48`}>
            {PRIORITIES.map(p => <option key={p} value={p}>{t(`priority.${p}` as DictKey)}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label={t('activity.scheduledDate')} required>
            <input type="date" value={form.scheduled_date} onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))} className={inputCls} />
          </Field>
          <Field label={t('activity.startTime')}>
            <input type="time" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} className={inputCls} />
          </Field>
          <Field label={t('activity.endTime')}>
            <input type="time" value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} className={inputCls} />
          </Field>
        </div>
        {form.project_id && (
          <div className="rounded-control border border-slate-200 bg-slate-50 px-3.5 py-2.5 flex items-start gap-2">
            <MapPin className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">{t('activity.location')}</p>
              <p className="text-sm text-slate-700 truncate">{projects.find(p => p.id === form.project_id)?.address || t('activity.projectLocationNotSet')}</p>
              <p className="text-xs text-slate-400 mt-0.5">{t('activity.locationFromProjectHint')}</p>
            </div>
          </div>
        )}

        {needsProduct && (
          <div className="rounded-control border border-slate-200 bg-slate-50 p-3.5 space-y-3">
            <p className="text-sm font-medium text-slate-700">{t('activity.installationInfo')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={t('activity.productBrand')} required>
                <input value={form.product_brand} onChange={e => setForm(f => ({ ...f, product_brand: e.target.value }))} className={inputCls} placeholder={t('activity.productBrandPlaceholder')} list="product-brand-suggestions" />
                <datalist id="product-brand-suggestions">
                  <option value="Maxhub" /><option value="Promethean" /><option value="Panasonic" />
                </datalist>
              </Field>
              <Field label={t('activity.productType')} required>
                <input value={form.product_type} onChange={e => setForm(f => ({ ...f, product_type: e.target.value }))} className={inputCls} placeholder={t('activity.productTypePlaceholder')} list="product-type-suggestions" />
                <datalist id="product-type-suggestions">
                  <option value="Videowall" /><option value="Signage" /><option value="Projector LED" />
                </datalist>
              </Field>
            </div>
            <Field label={t('activity.productModel')}>
              <input value={form.product_model} onChange={e => setForm(f => ({ ...f, product_model: e.target.value }))} className={`${inputCls} sm:w-1/2`} placeholder={t('activity.productModelPlaceholder')} />
            </Field>
            <p className="text-xs text-slate-400">{t('activity.productModelHint')}</p>
          </div>
        )}

        <div>
          <p className="text-sm font-medium text-slate-700 mb-1">{t('activity.siteContact')}</p>
          <p className="text-xs text-slate-400 mb-2">{t('activity.siteContactHint')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t('activity.picName')}>
              <input value={form.pic_name} onChange={e => setForm(f => ({ ...f, pic_name: e.target.value }))} className={inputCls} />
            </Field>
            <Field label={t('activity.picPhone')}>
              <input value={form.pic_phone} onChange={e => setForm(f => ({ ...f, pic_phone: e.target.value }))} className={inputCls} />
            </Field>
          </div>
        </div>

        {!activity && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-1.5"><Users className="h-4 w-4" /> {t('activity.teamTechnicians')}</label>
            {users.length > 6 && (
              <div className="mb-2">
                <SearchInput value={personnelSearch} onChange={setPersonnelSearch} placeholder={t('activity.searchName')} />
              </div>
            )}
            <div className="rounded-control border border-slate-300 max-h-48 overflow-y-auto divide-y divide-slate-100">
              {users.length === 0 ? (
                <p className="text-sm text-slate-400 px-3 py-2">{t('activity.noActiveUsers')}</p>
              ) : filteredUsers.length === 0 ? (
                <p className="text-sm text-slate-400 px-3 py-2">{t('activity.noMatch')}</p>
              ) : filteredUsers.map(u => (
                <div key={u.id} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                  <label className="flex-1 flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={selectedPersonnel.includes(u.id)} onChange={() => togglePersonnel(u.id)} className="rounded" />
                    <span className="text-slate-700">{u.full_name}</span>
                    <span className="text-xs text-slate-400">{t(`role.${u.role}` as DictKey)}</span>
                  </label>
                  {selectedPersonnel.includes(u.id) && (
                    <label className="inline-flex items-center gap-1 text-xs text-brand-700 shrink-0 cursor-pointer">
                      <input
                        type="radio"
                        name="primary_pic"
                        checked={primaryPersonnel === u.id}
                        onChange={() => setPrimaryPersonnel(u.id)}
                      />
                      {t('activity.primaryPic')}
                    </label>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-1">{t('activity.teamHint')}</p>
          </div>
        )}
        <Field label={t('common.notes')}>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={inputCls} rows={3} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-control px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">{t('common.cancel')}</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-4 py-2 hover:bg-brand-700 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {t('activity.saveActivity')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const inputCls = 'w-full rounded-control border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}{required && <span className="text-red-500"> *</span>}</label>
      {children}
    </div>
  );
}
