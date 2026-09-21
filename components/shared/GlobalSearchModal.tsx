'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Loader2, FolderKanban, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/app/providers';
import type { Project } from '@/lib/types';
import { StatusBadge } from './StatusBadge';
import { errorMessage } from '@/lib/utils';

type ProjectHit = Pick<Project, 'id' | 'code' | 'name' | 'customer_name' | 'status'>;

/**
 * Quick project search from anywhere in the app (Ctrl/Cmd+K, or the search
 * bar pinned above every page). RLS already scopes the underlying query —
 * a Sales account only ever sees results from its own division
 * (projects_select, 014), so this needs no extra filtering of its own.
 */
export function GlobalSearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProjectHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults([]);
    setError(null);
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const debounce = setTimeout(async () => {
      const { data, error: err } = await supabase
        .from('projects')
        .select('id, code, name, customer_name, status')
        .or(`name.ilike.%${q}%,code.ilike.%${q}%,customer_name.ilike.%${q}%`)
        .order('created_at', { ascending: false })
        .limit(8);
      setLoading(false);
      if (err) { setError(errorMessage(err, t('search.failed'))); return; }
      setError(null);
      setResults((data as ProjectHit[]) ?? []);
    }, 250);
    return () => clearTimeout(debounce);
  }, [query, open, t]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  function go(id: string) {
    onClose();
    router.push(`/projects/${id}`);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-900/40 px-4 pt-20 sm:pt-28" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-card shadow-modal overflow-hidden animate-zoom-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100">
          <Search className="h-4 w-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            className="flex-1 text-sm outline-none placeholder:text-slate-400"
          />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400 shrink-0" />}
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 shrink-0"><X className="h-4 w-4" /></button>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {error ? (
            <p className="px-4 py-8 text-center text-sm text-red-600">{error}</p>
          ) : query.trim().length < 2 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">{t('search.hint')}</p>
          ) : !loading && results.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">{t('search.noResults')}</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {results.map(p => (
                <button key={p.id} onClick={() => go(p.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition">
                  <FolderKanban className="h-4 w-4 text-brand-600 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 truncate">{p.name}</p>
                    <p className="text-xs text-slate-400 truncate font-mono">{p.code}{p.customer_name ? ` · ${p.customer_name}` : ''}</p>
                  </div>
                  <StatusBadge status={p.status} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
