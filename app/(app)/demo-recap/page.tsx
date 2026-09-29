'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FileSpreadsheet, Loader2, RefreshCw, Link2, ArrowRight, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import { formatDate, errorMessage, localDateKey, fetchAllRows } from '@/lib/utils';
import { downloadXlsx, type Cell } from '@/lib/xlsx';
import { SkeletonList, ErrorState, EmptyState } from '@/components/shared/States';
import { SearchInput } from '@/components/shared/SearchInput';
import { SearchableSelect } from '@/components/shared/SearchableSelect';
import { BentoGrid, BentoCard, BigNumber, PageHeader } from '@/components/shared/Bento';
import { useDialog } from '@/components/shared/ConfirmDialog';
import type { DemoTimelineRow, DemoSuggestion } from '@/lib/types';
import type { DictKey } from '@/lib/i18n';

type Billing = NonNullable<DemoTimelineRow['billing_status']>;

const BILLING: { value: Billing; labelKey: DictKey; cls: string }[] = [
  { value: 'not_billed', labelKey: 'recap.notBilled', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  { value: 'billed', labelKey: 'recap.billed', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'accepted', labelKey: 'recap.accepted', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { value: 'rejected', labelKey: 'recap.rejected', cls: 'bg-red-50 text-red-700 border-red-200' },
];

interface Row extends DemoTimelineRow {
  project_name?: string;
  project_code?: string;
  sales_name?: string | null;
}

/**
 * Demo → Purchase recap: every purchase that came out of an earlier demo,
 * and every purchase that still needs its demo confirmed. This is the
 * evidence behind asking the installer for a discount on the second visit —
 * so it shows the elapsed days and why the two were matched, and never
 * computes an amount.
 */
export default function DemoRecapPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { confirm: askConfirm, dialog } = useDialog();
  const [rows, setRows] = useState<Row[]>([]);
  const [suggestions, setSuggestions] = useState<(DemoSuggestion & { purchase_title?: string; project_name?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const isStaff = user?.role === 'admin' || user?.role === 'supervisor';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Only purchases matter here: a demo on its own isn't a claim yet.
      const timeline = await fetchAllRows<DemoTimelineRow>((from, to) => supabase
        .from('activity_demo_timeline').select('*').eq('counts_as_installation', true)
        .order('activity_id').range(from, to));
      const linked = timeline.filter(r => r.demo_activity_id);

      const projectIds = [...new Set(timeline.map(r => r.project_id))];
      const projects = projectIds.length === 0 ? [] : await fetchAllRows<{ id: string; name: string; code: string; sales_person_name: string | null }>(
        (from, to) => supabase.from('projects').select('id, name, code, sales_person_name').in('id', projectIds).order('id').range(from, to));
      const byProject = new Map(projects.map(p => [p.id, p]));

      setRows(linked.map(r => ({
        ...r,
        project_name: byProject.get(r.project_id)?.name,
        project_code: byProject.get(r.project_id)?.code,
        sales_name: byProject.get(r.project_id)?.sales_person_name ?? null,
      })));

      // Suggestions: only the best candidate per purchase.
      const sugg = await fetchAllRows<DemoSuggestion>((from, to) => supabase
        .from('activity_demo_suggestions').select('*').eq('rank', 1).order('purchase_activity_id').range(from, to));
      const unlinked = new Map(timeline.filter(r => !r.demo_activity_id).map(r => [r.activity_id, r]));
      setSuggestions(sugg.filter(s => unlinked.has(s.purchase_activity_id)).map(s => ({
        ...s,
        purchase_title: unlinked.get(s.purchase_activity_id)?.title,
        project_name: byProject.get(s.project_id)?.name,
      })));
    } catch (e) {
      setError(errorMessage(e, t('common.failedToLoad')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r =>
      (!status || r.billing_status === status)
      && (!q || `${r.title} ${r.project_name ?? ''} ${r.project_code ?? ''} ${r.room_name ?? ''} ${r.sales_name ?? ''}`.toLowerCase().includes(q)));
  }, [rows, search, status]);

  async function setBilling(row: Row, next: Billing) {
    setBusy(row.activity_id);
    const { error: err } = await supabase.from('activity_demo_links')
      .update({ billing_status: next }).eq('purchase_activity_id', row.activity_id);
    setBusy(null);
    if (err) { setError(errorMessage(err, t('common.actionFailed'))); return; }
    load();
  }

  async function confirmLink(s: DemoSuggestion) {
    if (!(await askConfirm({ title: t('recap.confirmLinkTitle'), message: t('recap.confirmLinkBody'), confirmLabel: t('recap.confirmLink') }))) return;
    setBusy(s.purchase_activity_id);
    const { error: err } = await supabase.rpc('iwm_link_demo', {
      p_purchase_activity_id: s.purchase_activity_id,
      p_demo_activity_id: s.demo_activity_id,
      p_match_reason: s.match_reason,
    });
    setBusy(null);
    if (err) { setError(errorMessage(err, t('common.actionFailed'))); return; }
    load();
  }

  function exportExcel() {
    const header: Cell[] = [
      t('recap.col.project'), t('recap.col.projectCode'), t('recap.col.sales'), t('recap.col.room'),
      t('recap.col.demoNo'), t('recap.col.demoDate'), t('recap.col.demoProduct'),
      t('recap.col.purchaseNo'), t('recap.col.purchaseDate'), t('recap.col.purchaseProduct'),
      t('recap.col.days'), t('recap.col.reason'), t('recap.col.billing'), t('recap.col.note'),
    ];
    const body: Cell[][] = filtered.map(r => [
      r.project_name ?? '', r.project_code ?? '', r.sales_name ?? '', r.room_name ?? '',
      r.demo_request_number ?? '', r.demo_completed_at ? formatDate(r.demo_completed_at) : '',
      [r.demo_product_brand, r.demo_product_type, r.demo_product_model].filter(Boolean).join(' '),
      r.request_number, r.completed_at ? formatDate(r.completed_at) : formatDate(r.scheduled_date),
      [r.product_brand, r.product_type, r.product_model].filter(Boolean).join(' '),
      r.days_since_demo ?? null,
      t(`recap.reason.${r.match_reason}` as DictKey),
      t(BILLING.find(b => b.value === r.billing_status)?.labelKey ?? 'recap.notBilled'),
      r.billing_note ?? '',
    ]);
    downloadXlsx(`rekap-demo-beli-${localDateKey()}.xlsx`, [{
      name: t('recap.sheetName'),
      rows: [header, ...body],
      widths: [28, 14, 20, 22, 16, 13, 24, 16, 13, 24, 8, 18, 14, 30],
    }]);
  }

  const counts = useMemo(() => ({
    total: rows.length,
    notBilled: rows.filter(r => r.billing_status === 'not_billed').length,
    billed: rows.filter(r => r.billing_status === 'billed').length,
    accepted: rows.filter(r => r.billing_status === 'accepted').length,
  }), [rows]);

  return (
    <div>
      <PageHeader
        title={t('nav.demoRecap')}
        subtitle={t('recap.subtitle')}
        actions={
          <>
            <button onClick={exportExcel} disabled={filtered.length === 0}
              className="inline-flex items-center gap-1.5 rounded-control border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              <FileSpreadsheet className="h-4 w-4" /> {t('export.button')}
            </button>
            <button onClick={load} title={t('common.refresh')} aria-label={t('common.refresh')}
              className="inline-flex items-center justify-center rounded-control border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </>
        }
      />

      {error && <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 mb-4">{error}</div>}

      <BentoGrid className="mb-4">
        <BentoCard span={3} title={t('recap.tileTotal')}><BigNumber value={counts.total} caption={t('recap.tileTotalCaption')} /></BentoCard>
        <BentoCard span={3} title={t('recap.notBilled')}><BigNumber value={counts.notBilled} caption={t('recap.tileNotBilledCaption')} /></BentoCard>
        <BentoCard span={3} title={t('recap.billed')}><BigNumber value={counts.billed} caption={t('recap.tileBilledCaption')} /></BentoCard>
        <BentoCard span={3} title={t('recap.accepted')}><BigNumber value={counts.accepted} caption={t('recap.tileAcceptedCaption')} /></BentoCard>
      </BentoGrid>

      {/* Purchases whose demo still needs confirming — the work to do, first. */}
      {isStaff && suggestions.length > 0 && (
        <div className="bg-white rounded-card border border-amber-200 shadow-bento mb-4 overflow-hidden">
          <header className="px-4 py-3 border-b border-amber-100 bg-amber-50/60 flex items-center gap-2">
            <Link2 className="h-4 w-4 text-amber-600" />
            <h2 className="text-[11px] font-bold text-amber-800 uppercase tracking-[0.14em] flex-1">{t('recap.needsConfirm')}</h2>
            <span className="rounded-full bg-amber-500 text-white text-[10px] font-black px-2 py-0.5">{suggestions.length}</span>
          </header>
          <p className="px-4 pt-3 text-[12.5px] text-slate-500">{t('recap.needsConfirmHint')}</p>
          <ul className="divide-y divide-slate-100">
            {suggestions.map(s => (
              <li key={s.purchase_activity_id} className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-bold text-slate-800 truncate">{s.purchase_title}</p>
                  <p className="text-[12px] text-slate-500 truncate">
                    {s.project_name} · <span className="text-slate-400">{t(`recap.reason.${s.match_reason}` as DictKey)}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[12px] text-slate-600 min-w-0">
                  <span className="truncate">{s.demo_title}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-300 shrink-0" />
                  <span className="tabular-nums text-slate-400">{s.days_since_demo} {t('recap.daysShort')}</span>
                </div>
                <button onClick={() => confirmLink(s)} disabled={busy === s.purchase_activity_id}
                  className="inline-flex items-center gap-1.5 rounded-control bg-brand-700 text-white text-[12px] font-bold px-3 py-1.5 hover:bg-brand-800 disabled:opacity-50 shrink-0">
                  {busy === s.purchase_activity_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {t('recap.confirmLink')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <div className="flex-1"><SearchInput value={search} onChange={setSearch} placeholder={t('recap.searchPlaceholder')} /></div>
        <SearchableSelect
          value={status} onChange={setStatus}
          options={[{ value: '', label: t('recap.allStatuses') }, ...BILLING.map(b => ({ value: b.value, label: t(b.labelKey) }))]}
          placeholder={t('recap.allStatuses')} className="sm:w-52"
        />
      </div>

      <div className="bg-white rounded-card border border-slate-200 shadow-bento overflow-hidden">
        {loading ? <SkeletonList rows={5} />
          : error ? <ErrorState message={error} onRetry={load} />
          : filtered.length === 0 ? <EmptyState title={t('recap.empty')} description={t('recap.emptyHint')} />
          : (
            <ul className="divide-y divide-slate-100">
              {filtered.map(r => {
                const badge = BILLING.find(b => b.value === r.billing_status) ?? BILLING[0];
                const productChanged = [r.demo_product_brand, r.demo_product_type].join('|').toLowerCase()
                  !== [r.product_brand, r.product_type].join('|').toLowerCase();
                return (
                  <li key={r.activity_id} className="px-4 py-3.5">
                    <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                      <div className="min-w-0 flex-1">
                        <Link href={`/projects/${r.project_id}`} className="text-[13.5px] font-bold text-slate-800 hover:text-brand-700">
                          {r.project_name} <span className="font-mono text-[11px] text-slate-400">{r.project_code}</span>
                        </Link>
                        <p className="text-[12px] text-slate-500 mt-0.5 truncate">
                          {r.room_name ? <span className="font-semibold text-slate-600">{r.room_name} · </span> : null}
                          {r.sales_name ?? t('projects.salesUnassigned')}
                        </p>
                      </div>
                      <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold shrink-0 ${badge.cls}`}>{t(badge.labelKey)}</span>
                    </div>

                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-x-3 gap-y-1.5 rounded-control bg-slate-50 border border-slate-200 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('recap.demoSide')}</p>
                        <p className="text-[12.5px] font-semibold text-slate-700 truncate">
                          {[r.demo_product_brand, r.demo_product_type, r.demo_product_model].filter(Boolean).join(' ') || '—'}
                        </p>
                        <p className="text-[11px] text-slate-400 tabular-nums">
                          {r.demo_request_number} · {r.demo_completed_at ? formatDate(r.demo_completed_at) : '—'}
                        </p>
                      </div>
                      <div className="flex sm:flex-col items-center gap-1 shrink-0">
                        <ArrowRight className="h-4 w-4 text-slate-300" />
                        <span className="text-[11px] font-black text-slate-500 tabular-nums">{r.days_since_demo ?? '—'} {t('recap.daysShort')}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t('recap.purchaseSide')}</p>
                        <p className="text-[12.5px] font-semibold text-slate-700 truncate">
                          {[r.product_brand, r.product_type, r.product_model].filter(Boolean).join(' ') || '—'}
                          {productChanged && <span className="ml-1.5 text-[10px] font-bold text-amber-600">{t('recap.productChanged')}</span>}
                        </p>
                        <p className="text-[11px] text-slate-400 tabular-nums">
                          {r.request_number} · {r.completed_at ? formatDate(r.completed_at) : formatDate(r.scheduled_date)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-slate-400">{t(`recap.reason.${r.match_reason}` as DictKey)}</span>
                      {isStaff && (
                        <div className="ml-auto flex items-center gap-1.5">
                          {BILLING.filter(b => b.value !== r.billing_status).map(b => (
                            <button key={b.value} onClick={() => setBilling(r, b.value)} disabled={busy === r.activity_id}
                              className="rounded-control border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-50">
                              {t(b.labelKey)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
      </div>
      {dialog}
    </div>
  );
}
