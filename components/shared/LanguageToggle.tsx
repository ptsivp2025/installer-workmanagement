'use client';

import { useLanguage } from '@/app/providers';

export function LanguageToggle({ dark }: { dark?: boolean }) {
  const { lang, setLang } = useLanguage();
  return (
    <div className={`inline-flex rounded-control border text-xs font-semibold overflow-hidden ${dark ? 'border-white/25' : 'border-slate-300'}`}>
      {(['id', 'en'] as const).map(l => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          className={`px-2.5 py-1.5 transition ${
            lang === l
              ? dark ? 'bg-white/20 text-white' : 'bg-brand-600 text-white'
              : dark ? 'text-white/70 hover:bg-white/10' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
