'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, History } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/app/providers';
import { formatDateTime, errorMessage } from '@/lib/utils';
import { dict, type DictKey } from '@/lib/i18n';
import { suspiciousGpsFlags } from '@/lib/constants';
import { ErrorState, SkeletonList } from '@/components/shared/States';

interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  meta: Record<string, unknown>;
  created_at: string;
  users: { full_name: string | null; username: string } | null;
}

const PAGE = 50;
const ACTIONS = ['activity.created', 'activity.started', 'activity.status_changed', 'activity.completed', 'activity.primary_pic_changed', 'review.approved', 'review.rejected'];

/**
 * Read-only view of audit_logs, which the database has been writing all
 * along (every create/start/complete/status change/review) with no screen to
 * read it on. Admin/supervisor only (audit_logs_select, 004). Immutable: no
 * edit or delete, here or in the database.
 */
export function AuditLogSection() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async (offset: number) => {
    let q = supabase.from('audit_logs')
      .select('id, action, entity_type, entity_id, meta, created_at, users(full_name, username)')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (action) q = q.eq('action', action);
    const { data, error: err } = await q;
    if (err) throw err;
    return (data as unknown as AuditRow[]) ?? [];
  }, [action]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchPage(0);
      setRows(page);
      setHasMore(page.length === PAGE);
    } catch (e) {
      setError(errorMessage(e, t('common.failedToLoad')));
    } finally {
      setLoading(false);
    }
  }, [fetchPage, t]);

  useEffect(() => { load(); }, [load]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const page = await fetchPage(rows.length);
      setRows(r => [...r, ...page]);
      setHasMore(page.length === PAGE);
    } catch (e) {
      setError(errorMessage(e, t('common.failedToLoad')));
    } finally {
      setLoadingMore(false);
    }
  }

  const label = (a: string) => {
    const key = `audit.action.${a}` as DictKey;
    return key in dict ? t(key) : a;
  };

  function detail(r: AuditRow): string {
    const m = r.meta ?? {};
    if (r.action === 'activity.status_changed' && m.from && m.to) return `${m.from} → ${m.to}`;
    if (typeof m.distance_m === 'number') return `${Math.round(m.distance_m)} m`;
    if (typeof m.notes === 'string' && m.notes) return m.notes;
    return '';
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <p className="text-sm text-slate-500">{t('audit.subtitle')}</p>
        <select value={action} onChange={e => setAction(e.target.value)} className="rounded-control border border-slate-300 px-3 py-2 text-sm">
          <option value="">{t('audit.allActions')}</option>
          {ACTIONS.map(a => <option key={a} value={a}>{label(a)}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-card border border-slate-200 shadow-card overflow-hidden">
        {loading ? <SkeletonList rows={8} /> : error ? <ErrorState message={error} onRetry={load} /> : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">{t('audit.empty')}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map(r => {
              const activityId = r.entity_type === 'activity' ? r.entity_id
                : typeof r.meta?.activity_id === 'string' ? r.meta.activity_id : null;
              const flags = Array.isArray(r.meta?.gps_risk_flags) ? suspiciousGpsFlags(r.meta.gps_risk_flags as string[]) : [];
              return (
                <div key={r.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                  <History className="h-4 w-4 text-slate-300 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-slate-800">
                      <span className="font-medium">{r.users?.full_name || r.users?.username || t('audit.system')}</span>
                      {' · '}{label(r.action)}
                      {flags.length > 0 && <span className="ml-1.5 rounded-full bg-red-50 border border-red-200 text-red-700 text-[11px] font-semibold px-1.5 py-0.5">{t('gpsRisk.badge')}</span>}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {formatDateTime(r.created_at)}
                      {detail(r) && ` · ${detail(r)}`}
                      {activityId && <> · <Link href={`/request-schedule/${activityId}`} className="text-brand-600 hover:underline">{t('audit.openActivity')}</Link></>}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {hasMore && !loading && (
          <button onClick={loadMore} disabled={loadingMore} className="w-full flex items-center justify-center gap-2 border-t border-slate-100 py-3 text-sm font-medium text-brand-600 hover:bg-slate-50">
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />} {t('audit.loadMore')}
          </button>
        )}
      </div>
    </div>
  );
}
