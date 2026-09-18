'use client';

import { Loader2, AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/app/providers';

export function LoadingState({ label }: { label?: string }) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      <Loader2 className="h-6 w-6 animate-spin mb-2" />
      <p className="text-sm">{label ?? t('common.loading')}</p>
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
