'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { CalendarClock, PlayCircle, CheckCircle2, Clock3, FolderKanban, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/app/providers';
import type { ActivityCategory } from '@/lib/types';
import { statusLabel } from '@/lib/constants';
import { LoadingState, ErrorState } from '@/components/shared/States';

interface CategoryCount { category: ActivityCategory; today: number }

// Reuses the exact status colors StatusBadge already uses elsewhere in the
// app (Tailwind emerald/blue/amber/red-600), so a slice's color always means
// the same thing here as it does on every status pill in the product.
const STATUS_COLORS: Record<string, string> = {
  scheduled: '#d97706',
  in_progress: '#2563eb',
  completed: '#059669',
  cancelled: '#dc2626',
};

export default function DashboardPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [todayCount, setTodayCount] = useState(0);
  const [inProgressCount, setInProgressCount] = useState(0);
  const [completedTodayCount, setCompletedTodayCount] = useState(0);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const [projectsInProgress, setProjectsInProgress] = useState(0);
  const [categoryCounts, setCategoryCounts] = useState<CategoryCount[]>([]);
  const [statusCounts, setStatusCounts] = useState<{ status: string; count: number }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
      const today = todayStart.toISOString().slice(0, 10);

      const [{ count: todayC }, { count: inProgC }, { count: completedTodayC }, { count: pendingC }, { count: projC }, { data: cats }, statusResults] = await Promise.all([
        supabase.from('activities').select('*', { count: 'exact', head: true }).eq('scheduled_date', today),
        supabase.from('activities').select('*', { count: 'exact', head: true }).eq('status', 'in_progress'),
        supabase.from('activities').select('*', { count: 'exact', head: true }).eq('status', 'completed').gte('completed_at', todayStart.toISOString()).lte('completed_at', todayEnd.toISOString()),
        supabase.from('form_reviews').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('projects').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('activity_categories').select('*').eq('active', true).order('sort_order'),
        Promise.all(Object.keys(STATUS_COLORS).map(async status => {
          const { count } = await supabase.from('activities').select('*', { count: 'exact', head: true }).eq('status', status);
          return { status, count: count ?? 0 };
        })),
      ]);

      setTodayCount(todayC ?? 0);
      setInProgressCount(inProgC ?? 0);
      setCompletedTodayCount(completedTodayC ?? 0);
      setPendingReviewCount(pendingC ?? 0);
      setProjectsInProgress(projC ?? 0);
      setStatusCounts((statusResults as { status: string; count: number }[]).filter(s => s.count > 0));

      const categories = (cats as ActivityCategory[]) ?? [];
      const counts = await Promise.all(categories.map(async c => {
        const { count } = await supabase.from('activities').select('*', { count: 'exact', head: true }).eq('category_id', c.id).eq('scheduled_date', today);
        return { category: c, today: count ?? 0 };
      }));
      setCategoryCounts(counts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">Welcome back{user?.full_name ? `, ${user.full_name}` : ''}.</p>
        </div>
        <button onClick={load} className="inline-flex items-center justify-center rounded-control border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <MetricCard icon={CalendarClock} label="Today's Schedule" value={todayCount} href="/request-schedule" />
        <MetricCard icon={PlayCircle} label="In Progress" value={inProgressCount} accent="text-blue-600" href="/request-schedule" />
        <MetricCard icon={CheckCircle2} label="Completed Today" value={completedTodayCount} accent="text-emerald-600" href="/request-schedule" />
        <MetricCard icon={Clock3} label="Pending Review" value={pendingReviewCount} accent="text-amber-600" href="/form-review" />
        <MetricCard icon={FolderKanban} label="Projects In Progress" value={projectsInProgress} href="/project-progress" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-card border border-slate-200 shadow-card p-5">
          <h2 className="font-semibold text-slate-900 mb-4">Today by Category</h2>
          {categoryCounts.length === 0 ? (
            <p className="text-sm text-slate-400">No active categories configured.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {categoryCounts.map(({ category, today }) => (
                <div key={category.id} className="rounded-control border border-slate-100 bg-slate-50 p-3">
                  <p className="text-2xl font-semibold text-slate-900">{today}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{category.name}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-card border border-slate-200 shadow-card p-5">
          <h2 className="font-semibold text-slate-900 mb-4">Activity Status</h2>
          {statusCounts.length === 0 ? (
            <p className="text-sm text-slate-400">No activities yet.</p>
          ) : (
            <div className="flex items-center gap-4">
              <div style={{ width: 120, height: 120 }} className="shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusCounts} dataKey="count" nameKey="status" innerRadius={32} outerRadius={56} paddingAngle={2} stroke="none">
                      {statusCounts.map(s => <Cell key={s.status} fill={STATUS_COLORS[s.status]} />)}
                    </Pie>
                    <Tooltip
                      formatter={(value: number, _name, entry) => [`${value}`, statusLabel(String((entry as { payload?: { status?: string } })?.payload?.status ?? ''))]}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-1.5 text-sm">
                {statusCounts.map(s => (
                  <li key={s.status} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLORS[s.status] }} />
                    <span className="text-slate-600">{statusLabel(s.status)}</span>
                    <span className="ml-auto font-medium text-slate-900">{s.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, accent, href }: { icon: React.ElementType; label: string; value: number; accent?: string; href: string }) {
  return (
    <Link href={href} className="bg-white rounded-card border border-slate-200 shadow-card p-4 hover:shadow-modal transition">
      <Icon className={`h-5 w-5 mb-2 ${accent ?? 'text-slate-400'}`} />
      <p className={`text-2xl font-semibold ${accent ?? 'text-slate-900'}`}>{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
    </Link>
  );
}
