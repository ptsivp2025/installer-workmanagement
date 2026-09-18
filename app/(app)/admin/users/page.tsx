'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, KeyRound, Loader2, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/app/providers';
import type { AppUser, SalesDivision } from '@/lib/types';
import { ROLES, roleLabel } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import { LoadingState, ErrorState } from '@/components/shared/States';
import { Modal } from '@/components/shared/Modal';

export default function AdminUsersPage() {
  const { user: me, loading: authLoading } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [divisions, setDivisions] = useState<SalesDivision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<AppUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [{ data, error: err }, { data: divs }] = await Promise.all([
      supabase.from('users').select('*').order('created_at', { ascending: false }),
      supabase.from('sales_divisions').select('*').order('sort_order').order('name'),
    ]);
    if (err) setError(err.message);
    else setUsers((data as AppUser[]) ?? []);
    setDivisions((divs as SalesDivision[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleActive(u: AppUser) {
    await supabase.from('users').update({ active: !u.active }).eq('id', u.id);
    load();
  }

  async function changeRole(u: AppUser, role: string) {
    await supabase.from('users').update({ role }).eq('id', u.id);
    load();
  }

  async function changeDivision(u: AppUser, division: string) {
    await supabase.from('users').update({ sales_division: division || null }).eq('id', u.id);
    load();
  }

  async function updateTelegram(u: AppUser, chatId: string) {
    await supabase.from('users').update({ telegram_chat_id: chatId || null }).eq('id', u.id);
    load();
  }

  if (authLoading) return <LoadingState />;
  if (!me || me.role !== 'admin') return <ErrorState message="Only admins can access this page." />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">Accounts for installers, supervisors, reviewers, and admins.</p>
        <button onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-3.5 py-2 hover:bg-brand-700">
          <Plus className="h-4 w-4" /> New User
        </button>
      </div>

      <div className="bg-white rounded-card border border-slate-200 shadow-card overflow-hidden">
        {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={load} /> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2.5">User</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5">Sales Division</th>
                <th className="px-4 py-2.5">Telegram Chat ID</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Joined</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map(u => (
                <tr key={u.id} className={u.active ? '' : 'opacity-50'}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{u.full_name}</p>
                    <p className="text-xs text-slate-400 font-mono">@{u.username}{u.phone ? ` · ${u.phone}` : ''}</p>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      onChange={e => changeRole(u, e.target.value)}
                      disabled={u.id === me.id}
                      className="rounded-control border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
                    >
                      {ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={u.sales_division ?? ''}
                      onChange={e => changeDivision(u, e.target.value)}
                      className="rounded-control border border-slate-300 px-2 py-1 text-xs"
                    >
                      <option value="">—</option>
                      {divisions.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <TelegramCell value={u.telegram_chat_id} onSave={v => updateTelegram(u, v)} />
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleActive(u)} disabled={u.id === me.id} className={`text-xs font-medium disabled:opacity-50 ${u.active ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {u.active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(u.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setResetTarget(u)} className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-700 text-xs">
                      <KeyRound className="h-3.5 w-3.5" /> Reset password
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CreateUserModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); load(); }} divisions={divisions} />
      <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />
    </div>
  );
}

function TelegramCell({ value, onSave }: { value: string | null; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value ?? '');

  if (!editing) {
    return (
      <button onClick={() => { setVal(value ?? ''); setEditing(true); }} className="text-xs text-slate-500 hover:text-brand-600">
        {value || <span className="text-slate-300">Not linked</span>}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={() => { setEditing(false); onSave(val.trim()); }}
        onKeyDown={e => { if (e.key === 'Enter') { setEditing(false); onSave(val.trim()); } }}
        placeholder="e.g. 123456789"
        className="w-28 rounded-control border border-slate-300 px-2 py-1 text-xs"
      />
    </div>
  );
}

function CreateUserModal({ open, onClose, onCreated, divisions }: { open: boolean; onClose: () => void; onCreated: () => void; divisions: SalesDivision[] }) {
  const [form, setForm] = useState({ username: '', full_name: '', role: 'installer', phone: '', password: '', sales_division: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setForm({ username: '', full_name: '', role: 'installer', phone: '', password: '', sales_division: '' }); setError(null); }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setError(data.error ?? 'Failed to create user.'); return; }
    onCreated();
  }

  return (
    <Modal open={open} onClose={onClose} title="New User">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
        <Field label="Full Name">
          <input required value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} className={inputCls} />
        </Field>
        <Field label="Username">
          <input required value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Role">
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className={inputCls}>
              {ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
          </Field>
          <Field label="Phone">
            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className={inputCls} />
          </Field>
        </div>
        <Field label="Sales Division (optional)">
          <select value={form.sales_division} onChange={e => setForm(f => ({ ...f, sales_division: e.target.value }))} className={inputCls}>
            <option value="">—</option>
            {divisions.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Temporary Password">
          <input required type="text" minLength={8} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className={inputCls} placeholder="At least 8 characters" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-control px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-4 py-2 hover:bg-brand-700 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Create User
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: AppUser | null; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => { setPassword(''); setError(null); setDone(false); }, [user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/admin/users/${user.id}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setError(data.error ?? 'Failed to reset password.'); return; }
    setDone(true);
  }

  return (
    <Modal open={!!user} onClose={onClose} title={`Reset Password — ${user?.full_name ?? ''}`}>
      {done ? (
        <div className="text-center py-4">
          <Send className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
          <p className="text-sm text-slate-600">Password updated. Share it with {user?.full_name} through a secure channel.</p>
          <button onClick={onClose} className="mt-4 rounded-control bg-slate-900 text-white text-sm font-medium px-4 py-2">Done</button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
          <Field label="New Password">
            <input required type="text" minLength={8} value={password} onChange={e => setPassword(e.target.value)} className={inputCls} placeholder="At least 8 characters" />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-control px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-4 py-2 hover:bg-brand-700 disabled:opacity-60">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Set Password
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

const inputCls = 'w-full rounded-control border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
    </div>
  );
}
