'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { useLanguage } from '@/app/providers';

export interface SelectOption { value: string; label: string; hint?: string }

/**
 * A dropdown with a search box, for any pick from a list that keeps growing
 * (people, sales divisions, categories). A plain <select> turns into a long
 * spinning wheel on a phone. Plain <select> stays fine for short fixed lists
 * (status, priority, role). Same look as ProjectPicker, which searches the
 * server instead because projects run into the thousands.
 */
export function SearchableSelect({
  value, onChange, options, placeholder, disabled = false, className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder: string;
  disabled?: boolean;
  /** Extra classes for the outer box, e.g. a width. */
  className?: string;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find(o => o.value === value);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(q));
  }, [options, query]);

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

  function pick(v: string) {
    onChange(v);
    setOpen(false);
  }

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setOpen(o => !o); setQuery(''); }}
        className="w-full flex items-center justify-between gap-2 rounded-control border border-slate-300 bg-white px-3 py-2 text-sm text-left focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-400"
      >
        <span className={`truncate ${selected ? 'text-slate-900' : 'text-slate-400'}`}>
          {selected ? selected.label : placeholder}
          {selected?.hint && <span className="text-xs text-slate-400"> · {selected.hint}</span>}
        </span>
        <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[14rem] rounded-control border border-slate-200 bg-white shadow-modal overflow-hidden animate-fade-in">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
            <Search className="h-4 w-4 text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); if (matches[0]) pick(matches[0].value); }
                if (e.key === 'Escape') setOpen(false);
              }}
              placeholder={t('common.search')}
              className="flex-1 min-w-0 text-sm outline-none placeholder:text-slate-400"
            />
          </div>
          <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
            {matches.length === 0 ? (
              <p className="px-3 py-3 text-sm text-slate-400">{t('common.noMatch')}</p>
            ) : matches.map(o => (
              <button
                key={o.value || '__empty'}
                type="button"
                onClick={() => pick(o.value)}
                className={`w-full text-left px-3 py-2 hover:bg-slate-50 ${o.value === value ? 'bg-brand-50' : ''}`}
              >
                <p className="text-sm text-slate-900 truncate">{o.label}</p>
                {o.hint && <p className="text-xs text-slate-500 truncate">{o.hint}</p>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
