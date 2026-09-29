'use client';

import { useState } from 'react';
import Link from 'next/link';

/**
 * Dashboard building blocks, in the Sales Management Platform's bento style:
 * a 12-column grid of cards with four looks so neighbouring cards don't read
 * as identical, a big anchor number, a gauge, a donut WITH its legend (the
 * donut says "what share", the legend says "exactly how many"), a meter and
 * an exception row.
 *
 * Spans are spelled out, not built as `col-span-${n}`: Tailwind scans source
 * as text and never generates a class assembled at runtime.
 */

export type Span = 3 | 4 | 5 | 6 | 7 | 8 | 12;
type Tone = 'plain' | 'accent' | 'dark' | 'dashed';

const SPAN: Record<Span, string> = {
  3: 'sm:col-span-3 lg:col-span-3',
  4: 'sm:col-span-3 lg:col-span-4',
  5: 'sm:col-span-6 lg:col-span-5',
  6: 'sm:col-span-6 lg:col-span-6',
  7: 'sm:col-span-6 lg:col-span-7',
  8: 'sm:col-span-6 lg:col-span-8',
  12: 'sm:col-span-6 lg:col-span-12',
};

const TONE: Record<Tone, string> = {
  plain: 'bg-white border border-slate-200/80 shadow-bento',
  accent: 'bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 text-white shadow-bento border border-brand-700/20',
  dark: 'bg-gradient-to-br from-slate-900 to-slate-800 text-white shadow-bento border border-slate-900/20',
  dashed: 'bg-slate-50/70 border border-dashed border-slate-300',
};

export function BentoGrid({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`grid grid-cols-1 sm:grid-cols-6 lg:grid-cols-12 gap-3 sm:gap-4 ${className}`}>{children}</div>;
}

export function BentoCard({ children, span = 4, tone = 'plain', title, action, minH, className = '' }: {
  children: React.ReactNode;
  span?: Span;
  tone?: Tone;
  title?: string;
  /** Small link/button at the right of the title row. */
  action?: React.ReactNode;
  /** Keeps a row of cards the same height. */
  minH?: boolean;
  className?: string;
}) {
  const light = tone === 'accent' || tone === 'dark';
  return (
    <section className={`${SPAN[span]} ${TONE[tone]} ${minH ? 'min-h-[208px]' : ''} rounded-card p-4 sm:p-5 flex flex-col gap-3 overflow-hidden ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-2 shrink-0">
          <p className={`text-[11px] font-bold uppercase tracking-wider ${light ? 'text-white/75' : 'text-slate-500'}`}>{title}</p>
          {action}
        </header>
      )}
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </section>
  );
}

/** One big number as the card's visual anchor. tabular-nums: refreshed numbers don't wobble. */
export function BigNumber({ value, unit, caption, light }: { value: React.ReactNode; unit?: string; caption?: string; light?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className={`text-[30px] sm:text-[34px] font-black leading-none tracking-tight tabular-nums ${light ? 'text-white' : 'text-slate-900'}`}>{value}</span>
        {unit && <span className={`text-sm font-bold ${light ? 'text-white/60' : 'text-slate-400'}`}>{unit}</span>}
      </div>
      {caption && <p className={`text-[12px] ${light ? 'text-white/70' : 'text-slate-500'}`}>{caption}</p>}
    </div>
  );
}

/** Label / value line for dark and accent cards. */
export function LightRow({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[12px] text-white/60">{label}</span>
      <span className={`text-[13px] tabular-nums ${strong ? 'font-black text-white' : 'font-semibold text-white/85'}`}>{value}</span>
    </div>
  );
}

/**
 * 270° gauge for a share (e.g. today's jobs done). White track on the
 * accent card, the percentage in the middle, "x of y" under it.
 */
export function Gauge({ done, total, caption }: { done: number; total: number; caption: string }) {
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  const pct = Math.round(ratio * 100);
  const r = 52, c = 2 * Math.PI * r, arc = c * 0.75;
  const angle = (135 + 270 * ratio) * (Math.PI / 180);
  const dx = 60 + r * Math.cos(angle), dy = 60 + r * Math.sin(angle);
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 120 120" className="w-[150px] h-[150px]" role="img" aria-label={`${pct}% · ${done}/${total}`}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${arc} ${c}`} transform="rotate(135 60 60)" />
        {ratio > 0 && (
          <circle cx="60" cy="60" r={r} fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round"
            strokeDasharray={`${arc * ratio} ${c}`} transform="rotate(135 60 60)" style={{ transition: 'stroke-dasharray .6s ease' }} />
        )}
        <circle cx={dx} cy={dy} r="6" fill="#fff" />
        <text x="60" y="60" textAnchor="middle" fontSize="24" fontWeight="900" fill="#fff">{pct}<tspan fontSize="12">%</tspan></text>
        <text x="60" y="75" textAnchor="middle" fontSize="7.5" fontWeight="800" fill="rgba(255,255,255,.8)" letterSpacing=".6">{caption}</text>
      </svg>
    </div>
  );
}

export interface Slice { label: string; value: number; color: string }

/**
 * Donut with a legend that never scrolls: the legend drops under the donut
 * on narrow cards instead of shrinking to nothing, and splits into two
 * columns past five rows.
 */
export function DonutLegend({ data, centerValue, centerLabel, emptyText, size = 120 }: {
  data: Slice[]; centerValue?: React.ReactNode; centerLabel?: string; emptyText: string; size?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const rows = data.filter(d => d.value > 0);
  const total = rows.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <p className="text-slate-400 text-[13px] py-1">{emptyText}</p>;

  const cx = 60, cy = 60, r = 50, ir = 30;
  let angle = -Math.PI / 2;
  const slices = rows.map((d, i) => {
    const sweep = (d.value / total) * 2 * Math.PI;
    // One category at 100%: an arc with identical start and end draws
    // nothing, so it's two circles instead.
    if (rows.length === 1) return { ...d, path: '', full: true, i };
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(angle + sweep), y2 = cy + r * Math.sin(angle + sweep);
    const xi1 = cx + ir * Math.cos(angle), yi1 = cy + ir * Math.sin(angle);
    const xi2 = cx + ir * Math.cos(angle + sweep), yi2 = cy + ir * Math.sin(angle + sweep);
    const large = sweep > Math.PI ? 1 : 0;
    const path = `M ${xi1} ${yi1} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${ir} ${ir} 0 ${large} 0 ${xi1} ${yi1} Z`;
    angle += sweep;
    return { ...d, path, full: false, i };
  });

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
      <svg width={size} height={size} viewBox="0 0 120 120" className="shrink-0" role="img"
        aria-label={rows.map(d => `${d.label} ${d.value}`).join(', ')}>
        {slices.map(s => s.full ? (
          <g key={s.i}><circle cx={cx} cy={cy} r={r} fill={s.color} /><circle cx={cx} cy={cy} r={ir} fill="white" /></g>
        ) : (
          <path key={s.i} d={s.path} fill={s.color} opacity={hover === null || hover === s.i ? 1 : 0.4}
            style={{ transition: 'opacity .15s' }} onMouseEnter={() => setHover(s.i)} onMouseLeave={() => setHover(null)} />
        ))}
        <text x={cx} y={cy + 1} textAnchor="middle" fontSize="19" fontWeight="800" fill="#0f172a">{centerValue ?? total}</text>
        {centerLabel && <text x={cx} y={cy + 14} textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#94a3b8">{centerLabel}</text>}
      </svg>
      <ul className={`grid gap-x-4 gap-y-0.5 flex-1 min-w-[170px] ${rows.length > 5 ? 'basis-[240px] sm:grid-cols-2 max-w-[460px]' : 'basis-[170px] max-w-[300px]'}`}>
        {slices.map(s => (
          <li key={s.i} onMouseEnter={() => setHover(s.i)} onMouseLeave={() => setHover(null)}
            className={`flex items-center gap-2 rounded-chip px-1.5 py-1.5 ${hover === s.i ? 'bg-slate-50' : ''}`}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="text-[12.5px] font-semibold text-slate-700 flex-1 min-w-0 truncate">{s.label}</span>
            <span className="text-[12.5px] font-black text-slate-800 tabular-nums">{s.value}</span>
            <span className="text-[11px] text-slate-400 tabular-nums w-9 text-right">{Math.round((s.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One ratio in its smallest form. */
export function Meter({ value, max, label, color = '#1d4ed8', light }: { value: number; max: number; label?: string; color?: string; light?: boolean }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="flex flex-col gap-1 w-full">
      {label && (
        <div className="flex items-baseline justify-between gap-2">
          <span className={`text-[11px] font-semibold truncate ${light ? 'text-white/70' : 'text-slate-500'}`}>{label}</span>
          <span className={`text-[11px] font-bold tabular-nums shrink-0 ${light ? 'text-white' : 'text-slate-700'}`}>
            {value}<span className={light ? 'text-white/50' : 'text-slate-400'}>/{max}</span>
          </span>
        </div>
      )}
      <div className={`h-1.5 rounded-full overflow-hidden ${light ? 'bg-white/20' : 'bg-slate-100'}`}>
        <div className="h-full rounded-full" style={{ width: `${ratio * 100}%`, background: light ? '#fff' : color, transition: 'width .5s ease' }} />
      </div>
    </div>
  );
}

/** A row with a thin status stripe on the left: the exception-list line. */
export function StripeRow({ color, title, subtitle, right, href }: {
  color: string; title: React.ReactNode; subtitle?: React.ReactNode; right?: React.ReactNode; href?: string;
}) {
  const body = (
    <>
      <span className="w-1 self-stretch min-h-[32px] rounded-full shrink-0" style={{ background: color }} />
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-bold text-slate-800 leading-tight truncate">{title}</span>
        {subtitle && <span className="block text-[11px] text-slate-500 leading-tight mt-0.5 truncate">{subtitle}</span>}
      </span>
      {right && <span className="shrink-0 text-right">{right}</span>}
    </>
  );
  const cls = 'w-full flex items-center gap-2.5 py-2 px-2 -mx-2 rounded-control text-left';
  return href ? <Link href={href} className={`${cls} hover:bg-slate-50 transition-colors`}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** Page heading used on every menu page: title, one-line description, actions on the right. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 flex-wrap mb-4">
      <div className="min-w-0">
        <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-[12.5px] text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}
