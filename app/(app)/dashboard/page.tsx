'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarClock, PlayCircle, CheckCircle2, Clock3, FolderKanban, RefreshCw, Star, History } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import type { ActivityCategory, PlatformSettings } from '@/lib/types';
import { LoadingState, ErrorState } from '@/components/shared/States';
import { ACTIVITY_STATUSES } from '@/lib/constants';
import type { DictKey } from '@/lib/i18n';

interface CategoryCount { category: ActivityCategory; today: number }
interface DayCount { date: string; label: string; count: number }

async function fetchCompletedByCategory(categoryIds: string[]): Promise<{ id: string; project_id: string }[]> {
  if (categoryIds.length === 0) return [];
  const { data } = await supabase.from('activities').select('id, project_id').eq('status', 'completed').in('category_id', categoryIds);
  return (data as { id: string; project_id: string }[] | null) ?? [];
}

// Same colors as StatusBadge/statusColor (lib/constants.ts) — a chart and a
// badge for the same status must never disagree.
const STATUS_HEX: Record<string, string> = {
  scheduled: '#fbbf24',
  in_progress: '#3b82f6',
  completed: '#10b981',
  cancelled: '#f87171',
};

// A fixed, stable-per-category palette for "Today by Category" — assigned by
// each category's sort_order, so a given category always gets the same
// color across reloads instead of one that shifts with which categories
// happen to be active today.
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

export default function DashboardPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [todayCount, setTodayCount] = useState(0);
  const [inProgressCount, setInProgressCount] = useState(0);
  const [completedTodayCount, setCompletedTodayCount] = useState(0);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const [projectsInProgress, setProjectsInProgress] = useState(0);
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
      const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
      const today = todayStart.toISOString().slice(0, 10);
      const fourteenDaysAgo = new Date(todayStart); fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);

      const [
        { count: todayC }, { count: inProgC }, { count: completedTodayC }, { count: pendingC }, { count: projC },
        { data: cats }, { data: settings }, { data: allStatuses }, { data: recentCompletions }, { data: salesReviews },
      ] = await Promise.all([
        supabase.from('activities').select('*', { count: 'exact', head: true }).eq('scheduled_date', today),
        supabase.from('activities').select('*', { count: 'exact', head: true }).eq('status', 'in_progress'),
        supabase.from('activities').select('*', { count: 'exact', head: true }).eq('status', 'completed').gte('completed_at', todayStart.toISOString()).lte('completed_at', todayEnd.toISOString()),
        supabase.from('form_reviews').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('projects').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('activity_categories').select('*').eq('active', true).order('sort_order'),
        supabase.from('platform_settings').select('show_dashboard_category_breakdown').eq('id', true).single(),
        supabase.from('activities').select('status'),
        supabase.from('activities').select('completed_at').eq('status', 'completed').gte('completed_at', fourteenDaysAgo.toISOString()),
        supabase.from('sales_reviews').select('status, rating'),
      ]);

      setTodayCount(todayC ?? 0);
      setInProgressCount(inProgC ?? 0);
      setCompletedTodayCount(completedTodayC ?? 0);
      setPendingReviewCount(pendingC ?? 0);
      setProjectsInProgress(projC ?? 0);
      setShowCategoryBreakdown((settings as PlatformSettings | null)?.show_dashboard_category_breakdown ?? true);

      const categories = (cats as ActivityCategory[]) ?? [];
      const counts = await Promise.all(categories.map(async c => {
        const { count } = await supabase.from('activities').select('*', { count: 'exact', head: true }).eq('category_id', c.id).eq('scheduled_date', today);
        return { category: c, today: count ?? 0 };
      }));
      setCategoryCounts(counts);

      const sc: Record<string, number> = {};
      for (const a of (allStatuses as { status: string }[]) ?? []) sc[a.status] = (sc[a.status] ?? 0) + 1;
      setStatusCounts(sc);

      const byDay: Record<string, number> = {};
      for (const a of (recentCompletions as { completed_at: string }[]) ?? []) {
        const d = a.completed_at.slice(0, 10);
        byDay[d] = (byDay[d] ?? 0) + 1;
      }
      const days: DayCount[] = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(todayStart); d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        days.push({ date: key, label: d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' }), count: byDay[key] ?? 0 });
      }
      setTrend(days);

      const reviews = (salesReviews as { status: string; rating: number | null }[]) ?? [];
      const rated = reviews.filter(r => r.status === 'submitted' && r.rating != null);
      setAvgRating(rated.length ? rated.reduce((sum, r) => sum + (r.rating ?? 0), 0) / rated.length : null);
      setPendingSalesReviews(reviews.filter(r => r.status === 'pending').length);

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
          const { data: eligData } = await supabase.from('activity_discount_eligibility').select('activity_id');
          const elig = (eligData as { activity_id: string }[] | null) ?? [];
          const purchaseIds = new Set(purchaseActs.map(a => a.id));
          const matchedIds = new Set(elig.map(e => e.activity_id));
          const purchaseAfterDemo = [...purchaseIds].filter(id => matchedIds.has(id)).length;
          const demoProjectIds = new Set(demoActs.map(a => a.project_id));
          const purchaseProjectIds = new Set(purchaseActs.map(a => a.project_id));
          const demoOnlyProjects = [...demoProjectIds].filter(pid => !purchaseProjectIds.has(pid)).length;
          setDemoPurchase({
            demoCount: demoActs.length,
            purchaseCount: purchaseIds.size,
            purchaseAfterDemo,
            demoOnlyProjects,
          });
        }
      } catch {
        setDemoPurchase({ demoCount: 0, purchaseCount: 0, purchaseAfterDemo: 0, demoOnlyProjects: 0 });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const totalActivities = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const maxTrend = Math.max(1, ...trend.map(d => d.count));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t('nav.dashboard')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('dashboard.welcomeBack')}{user?.full_name ? `, ${user.full_name}` : ''}.</p>
        </div>
        <button onClick={load} className="inline-flex items-center justify-center rounded-control border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <MetricCard icon={CalendarClock} label={t('dashboard.todaySchedule')} value={todayCount} color="indigo" href="/request-schedule" />
        <MetricCard icon={PlayCircle} label={t('dashboard.inProgress')} value={inProgressCount} color="blue" href="/request-schedule" />
        <MetricCard icon={CheckCircle2} label={t('dashboard.completedToday')} value={completedTodayCount} color="emerald" href="/request-schedule" />
        <MetricCard icon={Clock3} label={t('dashboard.pendingReview')} value={pendingReviewCount} color="amber" href="/form-review" />
        <MetricCard icon={FolderKanban} label={t('dashboard.projectsInProgress')} value={projectsInProgress} color="purple" href="/project-progress" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="bg-white rounded-card border border-slate-200 shadow-card p-5">
          <h2 className="font-semibold text-slate-900 mb-1">{t('dashboard.activityStatus')}</h2>
          <p className="text-xs text-slate-400 mb-4">{totalActivities} {t('dashboard.totalActivitiesAllTime')}</p>
          {totalActivities === 0 ? (
            <p className="text-sm text-slate-400">{t('dashboard.noActivitiesYet')}</p>
          ) : (
            <div className="flex items-center gap-5">
              <StatusDonut statusCounts={statusCounts} total={totalActivities} />
              <div className="flex-1 space-y-2.5 min-w-0">
                {ACTIVITY_STATUSES.map(status => {
                  const count = statusCounts[status] ?? 0;
                  const pct = totalActivities === 0 ? 0 : Math.round((count / totalActivities) * 100);
                  return (
                    <div key={status} className="flex items-center justify-between text-sm gap-2">
                      <span className="inline-flex items-center gap-2 text-slate-700 min-w-0">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: STATUS_HEX[status] }} />
                        <span className="truncate">{t(`status.${status}` as DictKey)}</span>
                      </span>
                      <span className="text-slate-500 tabular-nums shrink-0">{count} ({pct}%)</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-card border border-slate-200 shadow-card p-5">
          <h2 className="font-semibold text-slate-900 mb-1">{t('dashboard.completionsLast14')}</h2>
          <p className="text-xs text-slate-400 mb-4">{t('dashboard.activitiesCompletedPerDay')}</p>
          <div className="flex items-end gap-1 h-32">
            {trend.map(d => (
              <div key={d.date} className="flex-1 group relative flex flex-col items-center justify-end h-full">
                <div
                  className="w-full rounded-t bg-brand-500 group-hover:bg-brand-600 transition-colors min-h-[2px]"
                  style={{ height: `${(d.count / maxTrend) * 100}%` }}
                />
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
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <Link href="/sales-review" className="bg-white rounded-card border border-slate-200 shadow-card p-4 hover:shadow-modal transition flex items-center gap-3">
          <div className="flex items-center gap-0.5 text-amber-400">
            <Star className="h-5 w-5 fill-amber-400" />
          </div>
          <div>
            <p className="text-2xl font-semibold text-slate-900">{avgRating != null ? avgRating.toFixed(1) : '—'}</p>
            <p className="text-xs text-slate-500">{t('dashboard.avgSalesRating')}</p>
          </div>
        </Link>
        <Link href="/sales-review" className="bg-white rounded-card border border-slate-200 shadow-card p-4 hover:shadow-modal transition">
          <p className="text-2xl font-semibold text-amber-600">{pendingSalesReviews}</p>
          <p className="text-xs text-slate-500 mt-0.5">{t('dashboard.pendingSalesReviews')}</p>
        </Link>
      </div>

      {(demoPurchase.demoCount > 0 || demoPurchase.purchaseCount > 0) && (
        <div className="bg-white rounded-card border border-slate-200 shadow-card p-5 mb-4">
          <h2 className="font-semibold text-slate-900 mb-1 flex items-center gap-2"><History className="h-4 w-4 text-slate-400" /> {t('dashboard.demoToPurchase')}</h2>
          <p className="text-xs text-slate-400 mb-4">{t('dashboard.demoToPurchaseSubtitle')}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-control border border-blue-100 bg-blue-50 p-3">
              <p className="text-2xl font-semibold text-blue-700">{demoPurchase.demoCount}</p>
              <p className="text-xs text-blue-700/80 mt-0.5">{t('dashboard.demoCount')}</p>
            </div>
            <div className="rounded-control border border-violet-100 bg-violet-50 p-3">
              <p className="text-2xl font-semibold text-violet-700">{demoPurchase.purchaseCount}</p>
              <p className="text-xs text-violet-700/80 mt-0.5">{t('dashboard.purchaseCount')}</p>
            </div>
            <div className="rounded-control border border-emerald-100 bg-emerald-50 p-3">
              <p className="text-2xl font-semibold text-emerald-700">{demoPurchase.purchaseAfterDemo}</p>
              <p className="text-xs text-emerald-700/80 mt-0.5">{t('dashboard.purchaseAfterDemo')}</p>
            </div>
            <div className="rounded-control border border-amber-100 bg-amber-50 p-3">
              <p className="text-2xl font-semibold text-amber-700">{demoPurchase.purchaseCount - demoPurchase.purchaseAfterDemo}</p>
              <p className="text-xs text-amber-700/80 mt-0.5">{t('dashboard.noPreviousDemo')}</p>
            </div>
          </div>
          {demoPurchase.demoOnlyProjects > 0 && (
            <p className="text-xs text-slate-400 mt-3">{demoPurchase.demoOnlyProjects} · {t('dashboard.demoOnlyProjects')}</p>
          )}
        </div>
      )}

      {showCategoryBreakdown && (
      <div className="bg-white rounded-card border border-slate-200 shadow-card p-5">
        <h2 className="font-semibold text-slate-900 mb-4">{t('dashboard.todayByCategory')}</h2>
        {categoryCounts.length === 0 ? (
          <p className="text-sm text-slate-400">{t('dashboard.noActiveCategories')}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {categoryCounts.map(({ category, today }) => {
              const c = CATEGORY_PALETTE[category.sort_order % CATEGORY_PALETTE.length];
              return (
                <div key={category.id} className={`rounded-control border ${c.ring} ${c.bg} p-3`}>
                  <p className={`text-2xl font-semibold ${c.text}`}>{today}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{category.name}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

const METRIC_COLOR = {
  indigo: 'bg-indigo-50 text-indigo-600',
  blue: 'bg-blue-50 text-blue-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  purple: 'bg-purple-50 text-purple-600',
} as const;

function MetricCard({ icon: Icon, label, value, color, href }: { icon: React.ElementType; label: string; value: number; color: keyof typeof METRIC_COLOR; href: string }) {
  return (
    <Link href={href} className="bg-white rounded-card border border-slate-200 shadow-card p-4 hover:shadow-modal transition">
      <span className={`inline-flex items-center justify-center h-9 w-9 rounded-full mb-2.5 ${METRIC_COLOR[color]}`}>
        <Icon className="h-5 w-5" />
      </span>
      <p className="text-2xl font-semibold text-slate-900">{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
    </Link>
  );
}

// Multi-segment donut built from stroke-dasharray — no charting library
// needed for four segments. Rotated -90deg so the first segment starts at
// 12 o'clock. Center shows the completion share as a headline number so the
// chart isn't decoration-only (dataviz: a chart earns its place).
function StatusDonut({ statusCounts, total }: { statusCounts: Record<string, number>; total: number }) {
  const { t } = useLanguage();
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let cursor = 0;
  const segments = ACTIVITY_STATUSES.map(status => {
    const count = statusCounts[status] ?? 0;
    const dash = total === 0 ? 0 : (count / total) * circumference;
    const seg = { status, count, dash, offset: cursor };
    cursor += dash;
    return seg;
  }).filter(s => s.count > 0);
  const completedPct = total === 0 ? 0 : Math.round(((statusCounts.completed ?? 0) / total) * 100);

  return (
    <div className="relative h-32 w-32 shrink-0">
      <svg viewBox="0 0 120 120" className="h-32 w-32 -rotate-90">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="16" />
        {segments.map(s => (
          <circle
            key={s.status}
            cx="60" cy="60" r={radius} fill="none"
            stroke={STATUS_HEX[s.status]}
            strokeWidth="16"
            strokeDasharray={`${s.dash} ${circumference - s.dash}`}
            strokeDashoffset={-s.offset}
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-semibold text-slate-900">{completedPct}%</span>
        <span className="text-[10px] text-slate-400">{t('dashboard.completedShort')}</span>
      </div>
    </div>
  );
}
