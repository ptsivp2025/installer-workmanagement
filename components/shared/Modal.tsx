'use client';

import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const SIZE = { md: 'sm:max-w-md', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl', full: 'sm:max-w-6xl' } as const;

/**
 * Popup used everywhere. A bottom sheet on phones, a centred card from `sm`.
 *
 * `bare`: no title bar and no inner padding; the content lays itself out and
 * scrolls itself (the Profile and Admin Panel popups put a coloured banner at
 * the top that stays put while the body scrolls).
 */
export function Modal({
  open, onClose, title, children, wide, size, bare, footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Kept for existing callers: same as size="lg". */
  wide?: boolean;
  size?: keyof typeof SIZE;
  bare?: boolean;
  /** Pinned action row under the scrolling body. */
  footer?: React.ReactNode;
}) {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    // Without this the page behind the modal scrolls instead of the form on
    // a phone, and the form's own scroll position jumps around.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open) return null;

  const width = SIZE[size ?? (wide ? 'lg' : 'md')];

  // Portal to <body>: rendered in place, the overlay lived inside the page's
  // animated container. That container can form its own stacking context,
  // which would put the modal under the fixed header and bottom tab bar and
  // cover a bottom-sheet form's Save button.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`absolute inset-0 animate-fade-in ${bare ? 'bg-slate-950/55 backdrop-blur-[6px]' : 'bg-slate-900/50 backdrop-blur-[2px]'}`}
        onClick={onClose} aria-hidden="true" />
      <div className={`relative w-full ${width} bg-white shadow-modal rounded-t-panel sm:rounded-card flex flex-col animate-rise ${
        bare ? 'overflow-hidden max-h-[94dvh] sm:max-h-[calc(100dvh-2rem)]' : 'max-h-[92dvh] sm:max-h-[88vh]'}`}>
        {!bare && (
          <header className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
            <h2 className="text-base font-bold text-slate-900 leading-snug">{title}</h2>
            <button onClick={onClose} aria-label="Close"
              className="shrink-0 w-8 h-8 grid place-items-center rounded-chip text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </header>
        )}
        <div className={`flex-1 min-h-0 ${bare ? 'flex flex-col' : 'overflow-y-auto px-5 py-4'}`}>{children}</div>
        {footer && (
          <footer className="shrink-0 px-5 py-3.5 border-t border-slate-100 flex items-center justify-end gap-2 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Gradient banner at the top of a `bare` modal: the Profile / Admin Panel
 * look (same as the Sales Management Platform). Stays fixed while the body
 * below it scrolls.
 */
export function ModalBanner({ eyebrow, title, children, aside, onClose }: {
  eyebrow?: React.ReactNode;
  title: string;
  /** Badges under the title. */
  children?: React.ReactNode;
  /** Number tiles on the right. */
  aside?: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <header className="relative overflow-hidden shrink-0 text-white bg-gradient-to-br from-brand-800 via-brand-700 to-brand-500">
      <div aria-hidden="true" className="absolute -right-16 -top-24 w-72 h-72 rounded-full bg-white/10 blur-3xl" />
      <div aria-hidden="true" className="absolute left-1/3 -bottom-24 w-64 h-40 rounded-full bg-sky-300/10 blur-3xl" />
      <div className="relative px-5 sm:px-7 py-5 sm:py-6 pr-14 sm:pr-16 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[200px]">
          {eyebrow && <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-white/75">{eyebrow}</p>}
          <h1 className="text-2xl sm:text-[30px] font-black tracking-tight leading-tight mt-1.5">{title}</h1>
          {children && <div className="flex items-center gap-2 flex-wrap mt-2.5">{children}</div>}
        </div>
        {aside && <div className="flex items-stretch gap-2.5">{aside}</div>}
      </div>
      <button type="button" onClick={onClose} aria-label="Close"
        className="absolute top-4 right-4 w-9 h-9 grid place-items-center rounded-lg bg-white/15 hover:bg-white/25 transition-colors">
        <X className="h-4 w-4" />
      </button>
    </header>
  );
}

export function BannerBadge({ children, tone = 'glass' }: { children: React.ReactNode; tone?: 'glass' | 'red' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold ${tone === 'red' ? 'bg-red-500' : 'bg-white/20'}`}>
      {children}
    </span>
  );
}

export function BannerTile({ value, label, amber }: { value: number | string; label: string; amber?: boolean }) {
  return (
    <div className={`rounded-xl px-4 py-3 text-center min-w-[78px] flex flex-col justify-center ${amber ? 'bg-amber-400 text-amber-950' : 'bg-slate-950/30 text-white'}`}>
      <p className="text-[26px] font-black leading-none tabular-nums">{value}</p>
      <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] mt-1.5 opacity-80">{label}</p>
    </div>
  );
}

/** White section card with an uppercase title row, used inside bare modals. */
export function SectionCard({ icon: Icon, title, count, action, flush, children }: {
  icon?: React.ElementType;
  title: string;
  count?: string | number;
  action?: React.ReactNode;
  /** No inner padding: rows bring their own. */
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-card border border-slate-200/80 shadow-[0_1px_3px_rgba(15,23,42,.05)] overflow-hidden">
      <header className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100">
        {Icon && <Icon className="h-4 w-4 text-slate-500 shrink-0" />}
        <h2 className="text-[11px] font-bold text-slate-700 uppercase tracking-[0.14em] flex-1">{title}</h2>
        {count != null && (
          <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-500 tabular-nums">{count}</span>
        )}
        {action}
      </header>
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </section>
  );
}

/** Label-value row: uppercase label left, value right, "Not filled in" when empty. */
export function InfoRow({ icon: Icon, label, value, emptyText, good }: {
  icon?: React.ElementType; label: string; value: React.ReactNode; emptyText: string; good?: boolean;
}) {
  const empty = value == null || value === '';
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0">
      {Icon && <Icon className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
      <dt className="text-[10.5px] font-bold text-slate-500 uppercase tracking-[0.12em] flex-1 min-w-0">{label}</dt>
      <dd className={`text-[13.5px] text-right min-w-0 truncate ${empty ? 'text-slate-400 italic' : good ? 'font-bold text-emerald-600' : 'font-semibold text-slate-800'}`}>
        {good && !empty && <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-600 mr-1.5 align-middle" />}
        {empty ? emptyText : value}
      </dd>
    </div>
  );
}
