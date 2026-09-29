'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import type { ActivityCategory, PlatformSettings } from '@/lib/types';
import { ErrorState, SkeletonCards } from '@/components/shared/States';
import { withTimeout, failIfAnyErrored, fetchAllRows, errorMessage, localDateKey, getDateLocale, formatDate } from '@/lib/utils';
import { ACTIVITY_STATUSES } from '@/lib/constants';
import type { DictKey } from '@/lib/i18n';
import { InstallerDashboard } from './_components/InstallerDashboard';
import { notifyAppReady } from '@/lib/native';
import { BentoGrid, BentoCard, BigNumber, LightRow, Gauge, DonutLegend, Meter, StripeRow } from '@/components/shared/Bento';

interface CategoryCount { category: ActivityCategory; today: number }
interface DayCount { date: string; label: string; count: number }
interface AgendaItem {
  id: string; title: string; status: string; scheduled_date: string; start_time: string | null; personnel_count: number;
  projects: { name: string } | null; activity_categories: { name: string } | null;
}

async function fetchCompletedByCategory(categoryIds: string[]): Promise<{ id: string; project_id: string }[]> {
  if (categoryIds.length === 0) return [];
  return fetchAllRows<{ id: string; project_id: string }>((from, to) => supabase.from('activities')
    .select('id, project_id').eq('status', 'completed').in('category_id', categoryIds)
    .order('id').range(from, to));
}

// Same colors as StatusBadge/statusColor (lib/constants.ts): a chart and a
// badge for the same status must never disagree.
const STATUS_HEX: Record<string, string> = {
  scheduled: '#64748b',
  in_progress: '#2a78d6',
  completed: '#059669',
  cancelled: '#e34948',
};

// A fixed, stable-per-category palette for "Today by Category", assigned by
// sort_order so a category keeps its color across reloads.
const CATEGORY_PALETTE = [
  { bg: 'bg-indigo-50', text: 'text-indigo-700', ring: 'border-indigo-100' },
  { bg: 'bg-teal-50', text: 'text-teal-700', ring: 'border-teal-100' },
  { bg: 'bg-pink-50', text: 'text-pink-700', ring: 'border-pink-100' },
  { bg: 'bg-orange-50', text: 'text-orange-700', ring: 'border-orange-100' },
  { bg: 'bg-cyan-50', text: 'text-cyan-700', ring: 'border-cyan-100' },
  { bg: 'bg-violet-50', text: 'text-violet-700', ring: 'border-violet-100' },
  { bg: 'bg-lime-50', text: 'text-lime-700', ring: 'border-lime-100' },
  { bg: 'bg-rose-50', text: 'text-rose-700', ring: 'border-rose-100' },
];

const OPEN = ['scheduled', 'in_progress'];
const AGENDA_SELECT = 'id, title, status, scheduled_date, start_time, personnel_count, projects(name), activity_categories(name)';

function greetingKey(): DictKey {
  const h = new Date().getHours();
  return h < 4 ? 'greeting.night' : h < 11 ? 'greeting.morning' : h < 15 ? 'greeting.afternoon' : h < 18 ? 'greeting.evening' : 'greeting.night';
}

export default function DashboardPage() {
  const { user } = useAuth();
  if (user?.role === 'installer') return <InstallerDashboard />;
  return <StaffDashboard />;
}

function StaffDashboard() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState({ total: 0, done: 0 });
  const [inProgressCount, setInProgressCount] = useState(0);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const [projectsActive, setProjectsActive] = useState(0);
  const [blockedGps, setBlockedGps] = useState(0);
  const [agendaToday, setAgendaToday] = useState<AgendaItem[]>([]);
  const [overdue, setOverdue] = useState<{ items: AgendaItem[]; count: number }>({ items: [], count: 0 });
  const [categoryCounts, setCategoryCounts] = useState<CategoryCount[]>([]);
  const [showCategoryBreakdown, setShowCategoryBreakdown] = useState(true);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [trend, setTrend] = useState<DayCount[]>([]);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [pendingSalesReviews, setPendingSalesReviews] = useState(0);
  const [demoPurchase, setDemoPurchase] = useState({ demoCount: 0, purchaseCount: 0, purchaseAfterDemo: 0, demoOnlyProjects: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayKey = localDateKey(todayStart);
      const fourteenDaysAgo = new Date(todayStart); fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);
      const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

      // Totals are counted by the database (count/head), never by fetching
      // rows and adding them up here: the API returns at most 1,000 rows per
      // request, so a client-side tally silently stops at 1,000. The lists
      // that do need rows are short (limit) or read page by page.
      const [results, byStatus, pendingSales, recentCompletions, ratings] = await withTimeout(Promise.all([
        Promise.all([
          supabase.from('activities').select('*', { count: 'exact', head: true }).eq('scheduled_date', todayKey).neq('status', 'cancelled'),
          supabase.from('activities').select('*', { count: 'exact', head: true }).eq('scheduled_date', todayKey).eq('status', 'completed'),
          supabase.from('activities').select('*', { count: 'exact', head: true }).eq('status', 'in_progress'),
          supabase.from('form_reviews').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase.from('projects').select('*', { count: 'exact', head: true }).eq('status', 'active'),
          supabase.from('activity_categories').select('*').eq('active', true).order('sort_order'),
          supabase.from('activities').select(AGENDA_SELECT).eq('scheduled_date', todayKey).in('status', OPEN)
            .order('start_time', { ascending: true, nullsFirst: false }).limit(8),
          supabase.from('activities').select(AGENDA_SELECT, { count: 'exact' }).lt('scheduled_date', todayKey).in('status', OPEN)
            .order('scheduled_date', { ascending: true }).limit(6),
          supabase.from('activity_gps_events').select('*', { count: 'exact', head: true }).eq('validation_status', 'suspected_mock').gte('created_at', weekAgo),
        ]),
        Promise.all(ACTIVITY_STATUSES.map(s =>
          supabase.from('activities').select('*', { count: 'exact', head: true }).eq('status', s))),
        supabase.from('sales_reviews').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        fetchAllRows<{ id: string; completed_at: string }>((from, to) => supabase.from('activities')
          .select('id, completed_at').eq('status', 'completed').gte('completed_at', fourteenDaysAgo.toISOString())
          .order('id').range(from, to)),
        fetchAllRows<{ id: string; rating: number }>((from, to) => supabase.from('sales_reviews')
          .select('id, rating').eq('status', 'submitted').not('rating', 'is', null)
          .order('id').range(from, to)),
      ]));

      // A PostgREST error resolves the promise rather than rejecting it, so
      // without this the page would silently render zeros instead of saying
      // what broke.
      failIfAnyErrored([...results, ...byStatus, pendingSales]);

      const [
        { count: todayTotal }, { count: todayDone }, { count: inProgC }, { count: pendingC }, { count: projC },
        { data: cats }, { data: agendaRows }, { data: overdueRows, count: overdueC }, { count: blockedC },
      ] = results;

      // Optional on purpose: a missing settings row (or a column from a
      // migration that hasn't been run) is a preference, not a reason to take
      // the whole dashboard down.
      const { data: settings } = await supabase
        .from('platform_settings').select('show_dashboard_category_breakdown').eq('id', true).maybeSingle();

      setToday({ total: todayTotal ?? 0, done: todayDone ?? 0 });
      setInProgressCount(inProgC ?? 0);
      setPendingReviewCount(pendingC ?? 0);
      setProjectsActive(projC ?? 0);
      setBlockedGps(blockedC ?? 0);
      setAgendaToday((agendaRows as unknown as AgendaItem[]) ?? []);
      setOverdue({ items: (overdueRows as unknown as AgendaItem[]) ?? [], count: overdueC ?? 0 });
      setShowCategoryBreakdown((settings as PlatformSettings | null)?.show_dashboard_category_breakdown ?? true);

      const categories = (cats as ActivityCategory[]) ?? [];
      const counts = await Promise.all(categories.map(async c => {
        const { count } = await supabase.from('activities').select('*', { count: 'exact', head: true }).eq('category_id', c.id).eq('scheduled_date', todayKey);
        return { category: c, today: count ?? 0 };
      }));
      setCategoryCounts(counts);

      const sc: Record<string, number> = {};
      ACTIVITY_STATUSES.forEach((s, i) => { sc[s] = byStatus[i].count ?? 0; });
      setStatusCounts(sc);

      const byDay: Record<string, number> = {};
      for (const a of recentCompletions as { completed_at: string }[]) {
        const d = localDateKey(new Date(a.completed_at));
        byDay[d] = (byDay[d] ?? 0) + 1;
      }
      const days: DayCount[] = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(todayStart); d.setDate(d.getDate() - i);
        const key = localDateKey(d);
        days.push({ date: key, label: d.toLocaleDateString(getDateLocale(), { day: '2-digit', month: 'short' }), count: byDay[key] ?? 0 });
      }
      setTrend(days);

      const rated = ratings as { id: string; rating: number }[];
      setAvgRating(rated.length ? rated.reduce((sum, r) => sum + r.rating, 0) / rated.length : null);
      setPendingSalesReviews(pendingSales.count ?? 0);

      // Best-effort: Demo -> Purchase is a reporting overlay, never something
      // that should take the whole dashboard down if a migration is pending.
      try {
        const demoCatIds = categories.filter(c => c.counts_as_demo).map(c => c.id);
        const installCatIds = categories.filter(c => c.counts_as_installation).map(c => c.id);
        if (demoCatIds.length > 0 || installCatIds.length > 0) {
          const [demoActs, purchaseActs] = await Promise.all([
            fetchCompletedByCategory(demoCatIds),
            fetchCompletedByCategory(installCatIds),
          ]);
          const elig = await fetchAllRows<{ activity_id: string }>((from, to) =>
            supabase.from('activity_discount_eligibility').select('activity_id').order('activity_id').range(from, to));
          const purchaseIds = new Set(purchaseActs.map(a => a.id));
          const matchedIds = new Set(elig.map(e => e.activity_id));
          const purchaseAfterDemo = [...purchaseIds].filter(id => matchedIds.has(id)).length;
          const demoProjectIds = new Set(demoActs.map(a => a.project_id));
          const purchaseProjectIds = new Set(purchaseActs.map(a => a.project_id));
          const demoOnlyProjects = [...demoProjectIds].filter(pid => !purchaseProjectIds.has(pid)).length;
          setDemoPurchase({ demoCount: demoActs.length, purchaseCount: purchaseIds.size, purchaseAfterDemo, demoOnlyProjects });
        }
      } catch {
        setDemoPurchase({ demoCount: 0, purchaseCount: 0, purchaseAfterDemo: 0, demoOnlyProjects: 0 });
      }
    } catch (e) {
      const msg = errorMessage(e, t('common.failedToLoad'));
      setError(msg === 'REQUEST_TIMEOUT' ? t('common.requestTimeout') : msg);
    } finally {
      setLoading(false);
      notifyAppReady(); // Android app: first data is in, drop the loading screen
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const firstName = user?.full_name?.split(' ')[0];
  const heading = (
    <div className="flex items-end justify-between gap-3 flex-wrap mb-4">
      <div>
        <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">{t(greetingKey())}{firstName ? `, ${firstName}` : ''}</h1>
        <p className="text-[12.5px] text-slate-500 mt-0.5">{t('dashboard.staffSubtitle')}</p>
      </div>
      <button onClick={load} title={t('common.refresh')} aria-label={t('common.refresh')}
        className="inline-flex items-center justify-center rounded-control border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );

  if (loading && trend.length === 0) return <div>{heading}<SkeletonCards count={3} /></div>;
  if (error) return <div>{heading}<ErrorState message={error} onRetry={load} /></div>;

  const totalActivities = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const maxTrend = Math.max(1, ...trend.map(d => d.count));
  const left = today.total - today.done;

  return (
    <div>
      {heading}
      <BentoGrid>
        {/* ── Row 1: the three anchors ── */}
        <BentoCard span={4} tone="accent" title={t('dashboard.todayProgress')} minH>
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <Gauge done={today.done} total={today.total} caption={t('dashboard.gaugeOf', { done: today.done, total: today.total })} />
            <p className="text-[13px] text-white/90 text-center">
              {today.total === 0 ? t('dashboard.todayNone') : left > 0 ? <><b>{left}</b> {t('dashboard.todayLeft', { n: '' }).trim()}</> : t('dashboard.todayAllDone')}
            </p>
          </div>
        </BentoCard>

        <BentoCard span={4} title={t('dashboard.fieldNow')} minH action={<SeeAll href="/request-schedule" />}>
          <BigNumber value={inProgressCount} caption={t('dashboard.fieldCaption')} />
          <div className="mt-auto pt-4 space-y-3">
            <Meter value={today.done} max={today.total} label={t('dashboard.completedToday')} color="#059669" />
            <div className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className="font-semibold text-slate-500">{t('dashboard.projectsActive')}</span>
              <Link href="/projects" className="font-black text-slate-800 tabular-nums hover:text-brand-700">{projectsActive}</Link>
            </div>
          </div>
        </BentoCard>

        <BentoCard span={4} tone="dark" title={t('dashboard.qualityTitle')} minH action={<SeeAll href="/form-review" light />}>
          <BigNumber value={pendingReviewCount} caption={t('dashboard.waitingReview')} light />
          <div className="mt-auto pt-4 space-y-2.5">
            <LightRow label={t('dashboard.avgSalesRating')} value={avgRating != null ? `★ ${avgRating.toFixed(1)}` : '—'} />
            <LightRow label={t('dashboard.pendingSalesReviews')} value={pendingSalesReviews} />
            <div className="h-px bg-white/10" />
            <LightRow label={t('dashboard.fakeGpsBlocked')} value={blockedGps} strong />
          </div>
        </BentoCard>

        {/* ── Row 2: agenda, exception-first ── */}
        <BentoCard span={12} title={t('dashboard.agenda')}
          action={<span className="text-[11px] text-slate-400">{formatDate(localDateKey())}</span>}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            <div>
              <p className="flex items-center gap-2 text-[13px] font-bold text-slate-800 mb-1.5">
                <span className="w-2 h-2 rounded-full bg-brand-600" /> {t('dashboard.today')}
                {agendaToday.length > 0 && <Count n={agendaToday.length} tone="blue" />}
              </p>
              {agendaToday.length === 0 ? (
                <p className="text-[12.5px] text-slate-400 py-1">{t('dashboard.noAgendaToday')}</p>
              ) : agendaToday.map(a => (
                <StripeRow key={a.id} href={`/request-schedule/${a.id}`} color={STATUS_HEX[a.status] ?? '#64748b'}
                  title={a.title}
                  subtitle={`${a.activity_categories?.name ?? ''} · ${a.projects?.name ?? ''}${a.personnel_count === 0 ? ` · ${t('dashboard.noTeam')}` : ''}`}
                  right={<span className="text-[11px] font-bold text-slate-500 tabular-nums">{a.start_time?.slice(0, 5) ?? t(`status.${a.status}` as DictKey)}</span>} />
              ))}
            </div>
            <div>
              <p className="flex items-center gap-2 text-[13px] font-bold text-slate-800 mb-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500" /> {t('dashboard.overdue')}
                {overdue.count > 0 && <Count n={overdue.count} tone="red" />}
                {overdue.count > overdue.items.length && <span className="ml-auto"><SeeAll href="/request-schedule" /></span>}
              </p>
              {overdue.items.length === 0 ? (
                <p className="text-[12.5px] text-slate-400 py-1">{t('dashboard.noOverdue')}</p>
              ) : overdue.items.map(a => (
                <StripeRow key={a.id} href={`/request-schedule/${a.id}`} color="#e34948"
                  title={a.title}
                  subtitle={`${a.activity_categories?.name ?? ''} · ${t('dashboard.overdueSince', { d: formatDate(a.scheduled_date) })}${a.personnel_count === 0 ? ` · ${t('dashboard.noTeam')}` : ''}`}
                  right={<span className="text-[11px] font-bold text-slate-500">{t(`status.${a.status}` as DictKey)}</span>} />
              ))}
            </div>
          </div>
        </BentoCard>

        {/* ── Row 3: status + trend ── */}
        <BentoCard span={5} title={t('dashboard.activityStatus')} action={<SeeAll href="/request-schedule" />}>
          <div className="flex-1 flex items-center">
            <DonutLegend
              emptyText={t('dashboard.noActivitiesYet')}
              centerValue={totalActivities}
              centerLabel={t('dashboard.jobsUnit')}
              data={ACTIVITY_STATUSES.map(s => ({ label: t(`status.${s}` as DictKey), value: statusCounts[s] ?? 0, color: STATUS_HEX[s] }))}
            />
          </div>
        </BentoCard>

        <BentoCard span={7} title={t('dashboard.completionsLast14')}
          action={<span className="text-[11px] text-slate-400 tabular-nums">Σ {trend.reduce((a, d) => a + d.count, 0)}</span>}>
          <div className="flex items-end gap-1 h-36 mt-2">
            {trend.map(d => (
              <div key={d.date} className="flex-1 group relative flex flex-col items-center justify-end h-full">
                <div className="w-full rounded-t bg-brand-500 group-hover:bg-brand-700 transition-colors min-h-[2px]"
                  style={{ height: `${(d.count / maxTrend) * 100}%` }} />
                <div className="absolute -top-7 left-1/2 -translate-x-1/2 hidden group-hover:block bg-slate-800 text-white text-xs rounded px-1.5 py-0.5 whitespace-nowrap z-10">
                  {d.label}: {d.count}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-slate-400 mt-1.5">
            <span>{trend[0]?.label}</span>
            <span>{trend[trend.length - 1]?.label}</span>
          </div>
        </BentoCard>

        {/* ── Row 4: categories + demo → purchase ── */}
        {showCategoryBreakdown && (
          <BentoCard span={(demoPurchase.demoCount > 0 || demoPurchase.purchaseCount > 0) ? 8 : 12} title={t('dashboard.todayByCategory')}>
            {categoryCounts.length === 0 ? (
              <p className="text-[12.5px] text-slate-400">{t('dashboard.noActiveCategories')}</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {categoryCounts.map(({ category, today: n }) => {
                  const c = CATEGORY_PALETTE[category.sort_order % CATEGORY_PALETTE.length];
                  return (
                    <div key={category.id} className={`rounded-control border ${c.ring} ${c.bg} px-3.5 py-3`}>
                      <p className={`text-[22px] font-black leading-none tabular-nums ${c.text}`}>{n}</p>
                      <p className="text-[11.5px] font-semibold text-slate-600 mt-1.5 leading-tight">{category.name}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </BentoCard>
        )}

        {(demoPurchase.demoCount > 0 || demoPurchase.purchaseCount > 0) && (
          <BentoCard span={showCategoryBreakdown ? 4 : 12} title={t('dashboard.demoToPurchase')}>
            <div className="space-y-1">
              <StripeRow color="#2a78d6" title={t('dashboard.demoCount')} right={<b className="tabular-nums">{demoPurchase.demoCount}</b>} />
              <StripeRow color="#7c3aed" title={t('dashboard.purchaseCount')} right={<b className="tabular-nums">{demoPurchase.purchaseCount}</b>} />
              <StripeRow color="#059669" title={t('dashboard.purchaseAfterDemo')} right={<b className="tabular-nums">{demoPurchase.purchaseAfterDemo}</b>} />
              <StripeRow color="#eda100" title={t('dashboard.demoOnlyProjects')} right={<b className="tabular-nums">{demoPurchase.demoOnlyProjects}</b>} />
            </div>
            <p className="text-[11px] text-slate-400 mt-2">{t('dashboard.demoToPurchaseSubtitle')}</p>
          </BentoCard>
        )}
      </BentoGrid>
    </div>
  );
}

function SeeAll({ href, light }: { href: string; light?: boolean }) {
  const { t } = useLanguage();
  return (
    <Link href={href} className={`text-[11px] font-bold shrink-0 ${light ? 'text-white/80 hover:text-white' : 'text-brand-700 hover:text-brand-800'}`}>
      {t('dashboard.seeAll')}
    </Link>
  );
}

function Count({ n, tone }: { n: number; tone: 'red' | 'blue' }) {
  return (
    <span className={`inline-grid place-items-center min-w-[20px] h-5 rounded-full px-1.5 text-[10.5px] font-black tabular-nums ${tone === 'red' ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-brand-700'}`}>
      {n}
    </span>
  );
}
