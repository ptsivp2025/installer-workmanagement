'use client';

/**
 * The small summary above a list: a donut of how the rows split, with a
 * legend of counts. Each legend item is also the filter for that slice, so
 * the chart answers "how many" and one tap shows "which ones".
 */
export interface DonutItem { key: string; label: string; count: number; color: string }

export function MiniDonut({
  title, items, active, onPick, className = '',
}: {
  title: string;
  items: DonutItem[];
  /** The key currently filtered on, '' for none. */
  active?: string;
  onPick?: (key: string) => void;
  className?: string;
}) {
  const total = items.reduce((a, i) => a + i.count, 0);
  const R = 26, C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className={`bg-white rounded-card border border-slate-200 shadow-bento px-4 py-3 flex items-center gap-4 ${className}`}>
      <div className="relative h-[68px] w-[68px] shrink-0">
        <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="32" cy="32" r={R} fill="none" stroke="#eef2f7" strokeWidth="9" />
          {total > 0 && items.filter(i => i.count > 0).map(i => {
            const len = (i.count / total) * C;
            const el = (
              <circle key={i.key} cx="32" cy="32" r={R} fill="none" stroke={i.color} strokeWidth="9"
                strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset}
                opacity={active && active !== i.key ? 0.25 : 1} />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className="text-[15px] font-black text-slate-900 tabular-nums">{total}</span>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-slate-400 mb-1.5">{title}</p>
        <div className="flex flex-wrap gap-1.5">
          {items.map(i => {
            const on = active === i.key;
            const Tag = onPick ? 'button' : 'span';
            return (
              <Tag key={i.key} {...(onPick ? { type: 'button' as const, onClick: () => onPick(i.key), 'aria-pressed': on } : {})}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold transition ${
                  on ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: i.color }} />
                {i.label}
                <span className={`tabular-nums ${on ? 'text-white' : 'text-slate-900'}`}>{i.count}</span>
              </Tag>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Shared colours for statuses, so a slice means the same everywhere. */
export const STATUS_COLOR: Record<string, string> = {
  scheduled: '#f59e0b', in_progress: '#2563eb', completed: '#16a34a', cancelled: '#dc2626',
  active: '#2563eb', on_hold: '#94a3b8',
  pending: '#f59e0b', approved: '#16a34a', rejected: '#dc2626', submitted: '#16a34a',
};
