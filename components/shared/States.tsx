'use client';

import { Loader2, AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/app/providers';

export function LoadingState({ label }: { label?: string }) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400 animate-fade-in">
      <Loader2 className="h-6 w-6 animate-spin mb-2" />
      <p className="text-sm">{label ?? t('common.loading')}</p>
    </div>
  );
}

/**
 * Shaped placeholders for a list/table that's still loading — the page
 * keeps its layout instead of collapsing to a spinner and jumping back,
 * which on a slow field connection reads as "broken" rather than "loading".
 */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="p-4 space-y-3 animate-fade-in" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="skeleton h-9 w-9 rounded-lg shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3.5 rounded w-1/3" />
            <div className="skeleton h-3 rounded w-1/2" />
          </div>
          <div className="skeleton h-6 w-16 rounded-full shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-fade-in" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white rounded-card border border-slate-200 p-4 space-y-3">
          <div className="skeleton h-9 w-9 rounded-full" />
          <div className="skeleton h-6 rounded w-1/2" />
          <div className="skeleton h-3 rounded w-3/4" />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-4">
      <AlertTriangle className="h-6 w-6 text-red-500 mb-2" />
      <p className="text-sm text-slate-600 max-w-sm">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700">
          <RefreshCw className="h-3.5 w-3.5" /> {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-4">
      <Inbox className="h-8 w-8 text-slate-300 mb-3" />
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description && <p className="text-sm text-slate-400 mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
