// Set by LanguageProvider on every render, so every formatDate() call in the
// tree below it follows the chosen UI language ("25 Sep 2026" in Indonesian
// instead of "Sep 25, 2026") without threading `lang` through 30+ call sites.
let dateLocale = 'id-ID';
export function setDateLocale(lang: 'en' | 'id'): void {
  dateLocale = lang === 'en' ? 'en-US' : 'id-ID';
}
export function getDateLocale(): string {
  return dateLocale;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(dateLocale, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(dateLocale, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * YYYY-MM-DD in the browser's own timezone. `toISOString().slice(0, 10)` is
 * the UTC date instead — in WIB (UTC+7) local midnight is 17:00 the previous
 * day in UTC, so "today" came out as yesterday.
 */
export function localDateKey(d: Date = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Makes free text safe to drop into a PostgREST `.or(col.ilike.%term%,…)`
 * filter. A comma or parenthesis in the term (a customer called "PT. Maju,
 * Tbk") otherwise splits or unbalances the filter and the whole list request
 * fails with a parse error instead of just returning fewer rows.
 */
export function ilikeAny(columns: string[], term: string): string | null {
  const clean = term.replace(/[,()"\\]/g, ' ').trim();
  if (!clean) return null;
  return columns.map(c => `${c}.ilike.%${clean}%`).join(',');
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return '—';
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

export function classNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Client-side Haversine distance in meters — for live map/status display only. Real validation always happens server-side (SQL RPC). */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Rejects if a request hasn't come back in time. Supabase/PostgREST calls
 * have no timeout of their own, so a stalled one leaves a page showing its
 * spinner with no error and no way out — a dead screen, which for a field
 * user is indistinguishable from the app being broken.
 */
export function withTimeout<T>(promise: PromiseLike<T>, ms = 20000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('REQUEST_TIMEOUT')), ms);
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Every row a query matches, fetched page by page. The Supabase API returns
 * at most 1,000 rows per request (Settings → API → Max rows) and says
 * nothing when it cuts a result short, so any total, chart or export built
 * from one plain select quietly stops growing at 1,000.
 *
 * `page(from, to)` must return the rows in a stable order (order by a unique
 * column), or pages can overlap. Advances by what actually came back, so a
 * lower server cap than `pageSize` still reads every row.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  { pageSize = 1000, maxRows = 50000 }: { pageSize?: number; maxRows?: number } = {},
): Promise<T[]> {
  const rows: T[] = [];
  while (rows.length < maxRows) {
    const { data, error } = await page(rows.length, rows.length + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
  }
  return rows;
}

/**
 * Throws the first PostgREST error in a batch of results. supabase-js
 * *resolves* failed queries with an `error` field instead of rejecting, so a
 * caller that only destructures `data`/`count` treats "permission denied" or
 * "column does not exist" as an empty result and renders a page of zeros.
 */
export function failIfAnyErrored(results: ReadonlyArray<{ error: { message: string } | null }>): void {
  const failed = results.find(r => r.error);
  if (failed?.error) throw new Error(failed.error.message);
}

/**
 * Pulls a readable message out of anything thrown.
 *
 * supabase-js rejects with a plain `PostgrestError` object — `{ message,
 * details, hint, code }` — which is NOT an `Error` instance, so the usual
 * `e instanceof Error ? e.message : 'Something failed.'` silently discards
 * the one piece of information worth showing ("permission denied for table
 * projects", "JWT expired", "column … does not exist") and replaces it with
 * a generic sentence nobody can act on.
 */
export function errorMessage(e: unknown, fallback = 'Something went wrong.'): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string' && e.trim()) return e;
  if (e && typeof e === 'object') {
    const { message, hint, code } = e as { message?: unknown; hint?: unknown; code?: unknown };
    if (typeof message === 'string' && message.trim()) {
      const suffix = typeof hint === 'string' && hint.trim() ? ` (${hint})`
        : typeof code === 'string' && code.trim() ? ` [${code}]` : '';
      return message + suffix;
    }
  }
  return fallback;
}
