'use client';

import { statusColor } from '@/lib/constants';
import { classNames } from '@/lib/utils';
import { useLanguage } from '@/app/providers';
import { dict, type DictKey } from '@/lib/i18n';

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const { t } = useLanguage();
  const key = `status.${status}` as DictKey;
  const label = key in dict ? t(key) : status.replace('_', ' ');
  return (
    <span className={classNames('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', statusColor(status), className)}>
      {label}
    </span>
  );
}
