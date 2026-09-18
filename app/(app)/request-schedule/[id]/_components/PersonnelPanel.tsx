'use client';

import { useState } from 'react';
import { Users, Plus, Trash2, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { ActivityPersonnel } from '@/lib/types';

export function PersonnelPanel({
  activityId, personnel, locked, canEdit, isStaff, onChanged,
}: { activityId: string; personnel: ActivityPersonnel[]; locked: boolean; canEdit: boolean; isStaff: boolean; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addPersonnel(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.from('activity_personnel').insert({ activity_id: activityId, name: name.trim(), role: role.trim() || null });
    setSaving(false);
    if (err) { setError(err.message); return; }
    setName(''); setRole('');
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
              <span className="text-slate-700">{i + 1}. {p.name}{p.role && <span className="text-slate-400"> — {p.role}</span>}</span>
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
        <form onSubmit={addPersonnel} className="flex flex-col sm:flex-row gap-2">
          {locked && isStaff && <p className="text-xs text-amber-600 basis-full">Adding to a completed activity (staff correction).</p>}
          {error && <p className="text-xs text-red-600 sm:hidden">{error}</p>}
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" className="flex-1 rounded-control border border-slate-300 px-3 py-2 text-sm" />
          <input value={role} onChange={e => setRole(e.target.value)} placeholder="Role (e.g. Installer)" className="flex-1 rounded-control border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" disabled={saving || !name.trim()} className="inline-flex items-center justify-center gap-1 rounded-control bg-slate-900 text-white text-sm font-medium px-3 py-2 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
          </button>
        </form>
      )}
      {error && <p className="text-xs text-red-600 mt-2 hidden sm:block">{error}</p>}
    </div>
  );
}
