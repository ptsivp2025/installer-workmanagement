'use client';

import { ShieldAlert } from 'lucide-react';
import { useLanguage } from '@/app/providers';
import type { DictKey } from '@/lib/i18n';
import { suspiciousGpsFlags } from '@/lib/constants';

/**
 * Red warning shown to reviewers/staff when a completion came with Fake GPS
 * signals (migration 023), or when earlier completion attempts on the same
 * activity were blocked as fake. "Flagged" is not proof. It means someone
 * should look at the photos and the map before approving.
 */
export function GpsRiskBanner({ flags, blockedAttempts = 0 }: { flags: string[] | null | undefined; blockedAttempts?: number }) {
  const { t } = useLanguage();
  // Informational flags (e.g. done outside the Android app) aren't warnings.
  const list = suspiciousGpsFlags(flags);
  if (list.length === 0 && blockedAttempts === 0) return null;

  return (
    <div className="flex items-start gap-2.5 rounded-control bg-red-50 border border-red-200 text-red-800 text-sm px-3.5 py-3">
      <ShieldAlert className="h-5 w-5 shrink-0 text-red-600" />
      <div className="min-w-0">
        <p className="font-semibold">{t('gpsRisk.title')}</p>
        {list.length > 0 && (
          <ul className="mt-1 list-disc pl-4 space-y-0.5">
            {list.map(f => <li key={f}>{t(`gpsRisk.${f}` as DictKey)}</li>)}
          </ul>
        )}
        {blockedAttempts > 0 && <p className="mt-1">{t('gpsRisk.blockedAttempts', { count: blockedAttempts })}</p>}
        <p className="mt-1.5 text-xs text-red-700/80">{t('gpsRisk.hint')}</p>
      </div>
    </div>
  );
}
