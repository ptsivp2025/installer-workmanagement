'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/app/providers';
import { ilikeAny } from '@/lib/utils';

export interface ProjectOption {
  id: string; name: string; code: string; customer_name: string | null; address: string | null;
  latitude?: number | null; longitude?: number | null;
}

/**
 * Type-to-search project field. It replaces a plain <select> of the first 200
 * active projects. That list was unsearchable (scrolling for the right name
 * on a phone), and past 200 projects the one you wanted simply wasn't in it.
 * Searches the server by name, code or customer, so the list size no longer
 * matters.
 */
export function ProjectPicker({
  selected, onChange,
}: { selected: ProjectOption | null; onChange: (p: ProjectOption) => void }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    let stale = false;
    const timer = setTimeout(async () => {
      let q = supabase.from('projects').select('id, name, code, customer_name, address, latitude, longitude').eq('status', 'active').order('name').limit(30);
      const filter = ilikeAny(['name', 'code', 'customer_name'], query);
      if (filter) q = q.or(filter);
      const { data } = await q;
      if (stale) return;
      setResults((data as ProjectOption[]) ?? []);
      setLoading(false);
    }, 250);
    return () => { stale = true; clearTimeout(timer); };
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 30);
    function onDown(e: MouseEvent | TouchEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setQuery(''); }}
        className="w-full flex items-center justify-between gap-2 rounded-control border border-slate-300 px-3 py-2 text-sm text-left focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        <span className={`truncate ${selected ? 'text-slate-900' : 'text-slate-400'}`}>
          {selected ? `${selected.name} (${selected.code})` : t('activity.selectProject')}
        </span>
        <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-control border border-slate-200 bg-white shadow-modal overflow-hidden animate-fade-in">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
            <Search className="h-4 w-4 text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (results[0]) { onChange(results[0]); setOpen(false); } } }}
              placeholder={t('projects.searchPlaceholder')}
              className="flex-1 text-sm outline-none placeholder:text-slate-400"
            />
            {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400 shrink-0" />}
          </div>
          <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
            {!loading && results.length === 0 ? (
              <p className="px-3 py-3 text-sm text-slate-400">{t('common.noMatch')}</p>
            ) : results.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => { onChange(p); setOpen(false); }}
                className={`w-full text-left px-3 py-2 hover:bg-slate-50 ${selected?.id === p.id ? 'bg-brand-50' : ''}`}
              >
                <p className="text-sm text-slate-900 truncate">{p.name} <span className="text-xs text-slate-400 font-mono">{p.code}</span></p>
                {p.customer_name && <p className="text-xs text-slate-500 truncate">{p.customer_name}</p>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
