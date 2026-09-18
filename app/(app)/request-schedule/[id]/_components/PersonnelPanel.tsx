'use client';

import { useEffect, useState } from 'react';
import { Users, Plus, Trash2, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { ActivityPersonnel } from '@/lib/types';

interface UserOption { id: string; full_name: string; role: string; }

export function PersonnelPanel({
  activityId, personnel, locked, canEdit, isStaff, onChanged,
}: { activityId: string; personnel: ActivityPersonnel[]; locked: boolean; canEdit: boolean; isStaff: boolean; onChanged: () => void }) {
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('users').select('id, full_name, role').eq('active', true).order('full_name')
      .then((res: { data: UserOption[] | null }) => setUserOptions(res.data ?? []));
  }, []);

  function pickUser(userId: string) {
    setSelectedUserId(userId);
    const u = userOptions.find(o => o.id === userId);
    if (u) { setName(u.full_name); setRole(u.role); }
  }

  async function addPersonnel(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.from('activity_personnel').insert({
      activity_id: activityId, name: name.trim(), role: role.trim() || null,
      user_id: selectedUserId || null,
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    setName(''); setRole(''); setSelectedUserId('');
    onChanged();
  }

  async function removePersonnel(id: string) {
    const { error: err } = await supabase.from('activity_personnel').delete().eq('id', id);
    if (!err) onChanged();
  }

  return (
    <div className="bg-white rounded-card border border-slate-200 shadow-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2"><Users className="h-4 w-4" /> Personnel</h3>
        <span className="text-sm font-medium text-slate-500">{personnel.length} {personnel.length === 1 ? 'person' : 'people'}</span>
      </div>

      {personnel.length === 0 ? (
        <p className="text-sm text-slate-400 py-3">No personnel recorded yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 mb-3">
          {personnel.map((p, i) => (
            <li key={p.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-slate-700">
                {i + 1}. {p.name}{p.role && <span className="text-slate-400"> — {p.role}</span>}
                {p.user_id && <span className="ml-1.5 text-xs text-brand-600">· linked</span>}
              </span>
              {(isStaff || (canEdit && !locked)) && (
                <button onClick={() => removePersonnel(p.id)} className="text-slate-300 hover:text-red-500">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {(!locked || isStaff) && (
        <form onSubmit={addPersonnel} className="space-y-2">
          {locked && isStaff && <p className="text-xs text-amber-600">Adding to a completed activity (staff correction).</p>}
          {userOptions.length > 0 && (
            <select
              value={selectedUserId}
              onChange={e => pickUser(e.target.value)}
              className="w-full rounded-control border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Or pick an existing user…</option>
              {userOptions.map(u => <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>)}
            </select>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <input value={name} onChange={e => { setName(e.target.value); setSelectedUserId(''); }} placeholder="Name" className="flex-1 rounded-control border border-slate-300 px-3 py-2 text-sm" />
            <input value={role} onChange={e => setRole(e.target.value)} placeholder="Role (e.g. Installer)" className="flex-1 rounded-control border border-slate-300 px-3 py-2 text-sm" />
            <button type="submit" disabled={saving || !name.trim()} className="inline-flex items-center justify-center gap-1 rounded-control bg-slate-900 text-white text-sm font-medium px-3 py-2 disabled:opacity-50 shrink-0">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
            </button>
          </div>
        </form>
      )}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}
