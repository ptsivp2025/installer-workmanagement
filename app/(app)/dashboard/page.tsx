'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarClock, PlayCircle, CheckCircle2, Clock3, FolderKanban, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/app/providers';
import type { ActivityCategory } from '@/lib/types';
import { LoadingState, ErrorState } from '@/components/shared/States';

interface CategoryCount { category: ActivityCategory; today: number }

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
      const today = todayStart.toISOString().slice(0, 10);

      const [{ count: todayC }, { count: inProgC }, { count: completedTodayC }, { count: pendingC }, { count: projC }, { data: cats }] = await Promise.all([
        supabase.from('activities').select('*', { count: 'exact', head: true }).eq('scheduled_date', today),
        supabase.from('activities').select('*', { count: 'exact', head: true }).eq('status', 'in_progress'),
        supabase.from('activities').select('*', { count: 'exact', head: true }).eq('status', 'completed').gte('completed_at', todayStart.toISOString()).lte('completed_at', todayEnd.toISOString()),
        supabase.from('form_reviews').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('projects').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('activity_categories').select('*').eq('active', true).order('sort_order'),
      ]);

      setTodayCount(todayC ?? 0);
      setInProgressCount(inProgC ?? 0);
      setCompletedTodayCount(completedTodayC ?? 0);
      setPendingReviewCount(pendingC ?? 0);
      setProjectsInProgress(projC ?? 0);

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

      <div className="bg-white rounded-card border border-slate-200 shadow-card p-5">
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
