import { downloadXlsx, type Cell } from '@/lib/xlsx';
import { localDateKey, fetchAllRows } from '@/lib/utils';
import { suspiciousGpsFlags } from '@/lib/constants';
import type { DictKey } from '@/lib/i18n';

/** The query-builder methods the list filters use (see request-schedule/page.tsx). */
export interface Filterable<T> {
  eq(column: string, value: unknown): T;
  gte(column: string, value: unknown): T;
  lte(column: string, value: unknown): T;
  lt(column: string, value: unknown): T;
  in(column: string, values: unknown[]): T;
  or(filters: string): T;
}

interface ExportRow {
  request_number: string;
  title: string;
  scheduled_date: string;
  start_time: string | null;
  status: string;
  started_at: string | null;
  start_distance_m: number | null;
  completed_at: string | null;
  distance_from_target_m: number | null;
  gps_validation_status: string | null;
  gps_risk_flags: string[] | null;
  start_gps_flags: string[] | null;
  activity_categories: { name: string } | null;
  projects: { name: string; code: string; customer_name: string | null } | null;
  activity_personnel: { name: string; is_primary: boolean }[] | null;
  form_reviews: { status: string; created_at: string }[] | null;
}

/** The most recent review. A reopened activity has several, in no guaranteed order. */
const latestReview = (r: ExportRow) =>
  (r.form_reviews ?? []).reduce<{ status: string; created_at: string } | null>(
    (latest, x) => (!latest || x.created_at > latest.created_at ? x : latest), null)?.status ?? '';

type T = (key: DictKey, vars?: Record<string, string | number>) => string;

const dt = (v: string | null) => (v ? new Date(v).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '');
const round = (v: number | null) => (v == null ? null : Math.round(v));
const fakeFlags = (r: ExportRow) =>
  suspiciousGpsFlags(Array.from(new Set([...(r.gps_risk_flags ?? []), ...(r.start_gps_flags ?? [])])));

/**
 * Activity report as a real .xlsx: one row per activity (with the filters
 * currently applied on screen), plus a per-installer recap sheet.
 */
export async function exportActivities(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  t: T,
): Promise<void> {
  const rows = await fetchAllRows<ExportRow>(page as (from: number, to: number) => PromiseLike<{ data: ExportRow[] | null; error: { message: string } | null }>);

  const header: Cell[] = [
    t('export.col.requestNo'), t('export.col.title'), t('export.col.category'), t('export.col.project'),
    t('export.col.projectCode'), t('export.col.customer'), t('export.col.date'), t('export.col.time'),
    t('export.col.status'), t('export.col.team'), t('export.col.primaryPic'),
    t('export.col.checkIn'), t('export.col.checkInDistance'), t('export.col.completedAt'),
    t('export.col.completeDistance'), t('export.col.gpsStatus'), t('export.col.fakeGps'), t('export.col.review'),
  ];
  const detail: Cell[][] = [header, ...rows.map(r => {
    const team = r.activity_personnel ?? [];
    const flags = fakeFlags(r);
    const review = latestReview(r);
    return [
      r.request_number, r.title, r.activity_categories?.name ?? '', r.projects?.name ?? '',
      r.projects?.code ?? '', r.projects?.customer_name ?? '', r.scheduled_date, r.start_time?.slice(0, 5) ?? '',
      t(`status.${r.status}` as DictKey), team.map(p => p.name).join(', '), team.find(p => p.is_primary)?.name ?? '',
      dt(r.started_at), round(r.start_distance_m), dt(r.completed_at),
      round(r.distance_from_target_m), r.gps_validation_status ?? '',
      flags.map(f => t(`gpsRisk.${f}` as DictKey)).join('; '),
      review ? t(`status.${review}` as DictKey) : '',
    ];
  })];

  // Recap per person (by name: free-text helpers have no account).
  const perPerson = new Map<string, { total: number; completed: number; flagged: number }>();
  for (const r of rows) {
    for (const p of r.activity_personnel ?? []) {
      const e = perPerson.get(p.name) ?? { total: 0, completed: 0, flagged: 0 };
      e.total++;
      if (r.status === 'completed') e.completed++;
      if (fakeFlags(r).length > 0) e.flagged++;
      perPerson.set(p.name, e);
    }
  }
  const recap: Cell[][] = [
    [t('export.col.installer'), t('export.col.activities'), t('export.col.completed'), t('export.col.flagged')],
    ...Array.from(perPerson.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .map(([name, e]) => [name, e.total, e.completed, e.flagged]),
  ];

  downloadXlsx(`laporan-kegiatan-${localDateKey()}.xlsx`, [
    { name: t('export.sheet.activities'), rows: detail, widths: [16, 34, 18, 28, 14, 24, 12, 8, 14, 30, 20, 17, 10, 17, 10, 14, 40, 12] },
    { name: t('export.sheet.recap'), rows: recap, widths: [28, 12, 12, 16] },
  ]);
}
