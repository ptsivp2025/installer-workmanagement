'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Project } from '@/lib/types';
import { formatDate } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { SearchInput } from '@/components/shared/SearchInput';
import { LoadingState, ErrorState, EmptyState } from '@/components/shared/States';

export default function ProjectProgressListPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [counts, setCounts] = useState<Record<string, { total: number; completed: number; inProgress: number }>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase.from('projects').select('*').in('status', ['active', 'on_hold']).order('created_at', { ascending: false }).limit(100);
      if (search.trim()) query = query.or(`name.ilike.%${search.trim()}%,code.ilike.%${search.trim()}%`);
      const { data, error: err } = await query;
      if (err) throw err;
      setProjects((data as Project[]) ?? []);

      const ids = ((data as Project[]) ?? []).map(p => p.id);
      if (ids.length > 0) {
        const { data: acts } = await supabase.from('activities').select('project_id, status').in('project_id', ids);
        const next: Record<string, { total: number; completed: number; inProgress: number }> = {};
        for (const a of acts ?? []) {
          next[a.project_id] ??= { total: 0, completed: 0, inProgress: 0 };
          next[a.project_id].total++;
          if (a.status === 'completed') next[a.project_id].completed++;
          if (a.status === 'in_progress') next[a.project_id].inProgress++;
        }
        setCounts(next);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load project progress.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Project Progress</h1>
          <p className="text-sm text-slate-500 mt-0.5">Lifecycle overview across all active projects.</p>
        </div>
        <button onClick={load} className="inline-flex items-center justify-center rounded-control border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-4"><SearchInput value={search} onChange={setSearch} placeholder="Search project or code…" /></div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : projects.length === 0 ? (
        <EmptyState title="No active projects" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(p => {
            const c = counts[p.id] ?? { total: 0, completed: 0, inProgress: 0 };
            const pct = c.total === 0 ? 0 : Math.round((c.completed / c.total) * 100);
            return (
              <Link key={p.id} href={`/project-progress/${p.id}`} className="bg-white rounded-card border border-slate-200 shadow-card p-4 hover:shadow-modal transition">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">{p.name}</p>
                    <p className="text-xs text-slate-400 font-mono">{p.code}</p>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mb-2">
                  <div className="h-full bg-brand-600 rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>{c.completed}/{c.total} completed · {c.inProgress} in progress</span>
                  <span>{pct}%</span>
                </div>
                {p.expected_completion && <p className="text-xs text-slate-400 mt-2">Target: {formatDate(p.expected_completion)}</p>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
