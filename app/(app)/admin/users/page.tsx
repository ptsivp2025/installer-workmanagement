'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Power, Loader2, KeyRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import type { AppUser, SalesDivision } from '@/lib/types';
import type { DictKey } from '@/lib/i18n';
import { ROLES } from '@/lib/constants';
import { LoadingState, ErrorState } from '@/components/shared/States';
import { Modal } from '@/components/shared/Modal';
import { AdminTabs } from '@/components/shared/AdminTabs';
import { SearchInput } from '@/components/shared/SearchInput';

export default function AdminUsersPage() {
  const { user: me, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.from('users').select('*').order('full_name');
    if (err) setError(err.message);
    else setUsers((data as AppUser[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleActive(u: AppUser) {
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !u.active }),
    });
    if (res.ok) load();
  }

  if (authLoading) return <LoadingState />;
  if (!me || me.role !== 'admin') return <ErrorState message={t('admin.onlyAdmins')} />;

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">{t('admin.panel')}</h1>
      <AdminTabs />
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-slate-500">{t('adminUsers.subtitle')}</p>
        <button onClick={() => { setEditing(null); setFormOpen(true); }} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-3.5 py-2 hover:bg-brand-700">
          <Plus className="h-4 w-4" /> {t('adminUsers.newUser')}
        </button>
      </div>

      {users.length > 6 && (
        <div className="mb-4"><SearchInput value={search} onChange={setSearch} placeholder={t('adminUsers.searchPlaceholder')} /></div>
      )}

      <div className="bg-white rounded-card border border-slate-200 shadow-card overflow-hidden">
        {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={load} /> : (() => {
          const filtered = users.filter(u =>
            u.full_name.toLowerCase().includes(search.trim().toLowerCase()) ||
            u.username.toLowerCase().includes(search.trim().toLowerCase())
          );
          return filtered.length === 0 ? (
            <p className="text-sm text-slate-400 p-5">{t('adminUsers.noMatch', { search })}</p>
          ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2.5">{t('common.name')}</th>
                <th className="px-4 py-2.5">{t('adminUsers.username')}</th>
                <th className="px-4 py-2.5">{t('adminUsers.role')}</th>
                <th className="px-4 py-2.5">{t('common.phone')}</th>
                <th className="px-4 py-2.5">{t('common.status')}</th>
                <th className="px-4 py-2.5 text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(u => (
                <tr key={u.id} className={u.active ? '' : 'opacity-50'}>
                  <td className="px-4 py-3 font-medium text-slate-800">{u.full_name}</td>
                  <td className="px-4 py-3 text-slate-500 font-mono text-xs">{u.username}</td>
                  <td className="px-4 py-3 text-slate-600">{t(`role.${u.role}` as DictKey)}</td>
                  <td className="px-4 py-3 text-slate-500">{u.phone ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${u.active ? 'text-emerald-600' : 'text-slate-400'}`}>{u.active ? t('common.active') : t('common.inactive')}</span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button onClick={() => { setEditing(u); setFormOpen(true); }} className="text-slate-400 hover:text-slate-700 inline-flex"><Pencil className="h-4 w-4" /></button>
                    <button
                      onClick={() => toggleActive(u)}
                      disabled={u.id === me.id}
                      title={u.id === me.id ? t('adminUsers.cannotDeactivateSelf') : u.active ? t('common.deactivate') : t('common.activate')}
                      className="text-slate-400 hover:text-slate-700 inline-flex disabled:opacity-30"
                    ><Power className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          );
        })()}
      </div>

      <UserFormModal open={formOpen} onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); load(); }} user={editing} selfId={me.id} />
    </div>
  );
}

function UserFormModal({
  open, onClose, onSaved, user, selfId,
}: { open: boolean; onClose: () => void; onSaved: () => void; user: AppUser | null; selfId: string }) {
  const { t } = useLanguage();
  const [form, setForm] = useState({ username: '', full_name: '', role: 'installer', phone: '', password: '', new_password: '', sales_division_id: '' });
  const [divisions, setDivisions] = useState<SalesDivision[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    supabase.from('sales_divisions').select('*').eq('active', true).order('sort_order')
      .then((res: { data: SalesDivision[] | null }) => setDivisions(res.data ?? []));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (user) {
      setForm({ username: user.username, full_name: user.full_name, role: user.role, phone: user.phone ?? '', password: '', new_password: '', sales_division_id: user.sales_division_id ?? '' });
    } else {
      setForm({ username: '', full_name: '', role: 'installer', phone: '', password: '', new_password: '', sales_division_id: '' });
    }
    setError(null);
  }, [open, user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim()) { setError(t('adminUsers.fullNameRequired')); return; }
    if (!user && (!form.username.trim() || form.password.length < 8)) {
      setError(t('adminUsers.newUserRequirements'));
      return;
    }
    if (form.role === 'sales' && !form.sales_division_id) { setError(t('adminUsers.divisionRequired')); return; }
    setSaving(true);
    setError(null);

    const res = user
      ? await fetch(`/api/admin/users/${user.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ full_name: form.full_name.trim(), role: form.role, phone: form.phone.trim() || null, new_password: form.new_password || undefined, sales_division_id: form.sales_division_id || undefined }),
        })
      : await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: form.username.trim(), full_name: form.full_name.trim(), role: form.role, phone: form.phone.trim() || null, password: form.password, sales_division_id: form.sales_division_id || undefined }),
        });

    setSaving(false);
    if (!res.ok) { const body = await res.json().catch(() => ({})); setError(body.error ?? t('adminUsers.saveFailed')); return; }
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title={user ? t('adminUsers.editUser') : t('adminUsers.newUser')}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{t('adminUsers.fullName')}</label>
          <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{t('adminUsers.username')}</label>
          <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} className={inputCls} disabled={!!user} />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{t('adminUsers.role')}</label>
          <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className={inputCls} disabled={user?.id === selfId}>
            {ROLES.map(r => <option key={r} value={r}>{t(`role.${r}` as DictKey)}</option>)}
          </select>
          {user?.id === selfId && <p className="text-xs text-slate-400 mt-1">{t('adminUsers.cannotChangeOwnRole')}</p>}
        </div>
        {form.role === 'sales' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('adminUsers.salesDivision')}</label>
            <select value={form.sales_division_id} onChange={e => setForm(f => ({ ...f, sales_division_id: e.target.value }))} className={inputCls}>
              <option value="">{t('adminUsers.selectDivision')}</option>
              {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <p className="text-xs text-slate-400 mt-1">{t('adminUsers.salesDivisionHint')}</p>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{t('common.phone')}</label>
          <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className={inputCls} />
        </div>
        {!user && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('adminUsers.password')}</label>
            <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className={inputCls} placeholder={t('adminUsers.minChars')} />
          </div>
        )}
        {user && (
          <div>
            <label className="text-sm font-medium text-slate-700 mb-1 flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" /> {t('adminUsers.resetPassword')}</label>
            <input type="password" value={form.new_password} onChange={e => setForm(f => ({ ...f, new_password: e.target.value }))} className={inputCls} placeholder={t('adminUsers.keepCurrentPassword')} />
          </div>
        )}
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

const inputCls = 'w-full rounded-control border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-400';
