'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/app/providers';
import type { SalesDivision } from '@/lib/types';
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/States';

export default function SalesDivisionsPage() {
  const { user, loading: authLoading } = useAuth();
  const [divisions, setDivisions] = useState<SalesDivision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.from('sales_divisions').select('*').order('sort_order').order('name');
    if (err) setError(err.message);
    else setDivisions((data as SalesDivision[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addDivision(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setFormError(null);
    const { error: err } = await supabase.from('sales_divisions').insert({ name: name.trim(), sort_order: divisions.length });
    setSaving(false);
    if (err) {
      setFormError(err.code === '23505' ? `"${name.trim()}" already exists.` : err.message);
      return;
    }
    setName('');
    load();
  }

  async function removeDivision(d: SalesDivision) {
    setDeleteError(null);
    const { error: err } = await supabase.from('sales_divisions').delete().eq('id', d.id);
    if (err) {
      setDeleteError(
        err.code === '23503'
          ? `"${d.name}" is still assigned to one or more users or projects — reassign them first.`
          : err.message,
      );
      return;
    }
    load();
  }

  if (authLoading) return <LoadingState />;
  if (!user || user.role !== 'admin') return <ErrorState message="Only admins can access this page." />;

  return (
    <div>
      <p className="text-sm text-slate-500 mb-4">
        Used by the Sales Division dropdown on User Management and Projects. A division still assigned to a user or project cannot be deleted.
      </p>

      <form onSubmit={addDivision} className="flex gap-2 mb-4">
        {formError && <p className="text-xs text-red-600 basis-full">{formError}</p>}
        <input value={name} onChange={e => setName(e.target.value)} placeholder="New division name…" className="flex-1 rounded-control border border-slate-300 px-3 py-2 text-sm" />
        <button type="submit" disabled={saving || !name.trim()} className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-medium px-3.5 py-2 hover:bg-brand-700 disabled:opacity-60">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
        </button>
      </form>
      {deleteError && <p className="text-xs text-red-600 mb-3">{deleteError}</p>}

      <div className="bg-white rounded-card border border-slate-200 shadow-card overflow-hidden">
        {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={load} /> : divisions.length === 0 ? (
          <EmptyState title="No sales divisions yet" description="Add one above." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {divisions.map(d => (
              <li key={d.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-slate-800">{d.name}</span>
                <button onClick={() => removeDivision(d)} className="text-slate-300 hover:text-red-500">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
