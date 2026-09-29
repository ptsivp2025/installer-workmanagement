'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useLanguage } from '@/app/providers';

/**
 * Goes back to wherever the user actually came from — an installer who
 * opened a task from the Dashboard lands on the Dashboard again, not on the
 * full Request Schedule list, and a list keeps its filters/page. Only a page
 * opened directly (shared link, new tab) falls back to `fallbackHref`.
 */
export function BackButton({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter();
  const { t } = useLanguage();

  function goBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push(fallbackHref);
  }

  return (
    <button onClick={goBack} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4 py-1">
      <ArrowLeft className="h-4 w-4" /> {t('common.back')}
    </button>
  );
}
