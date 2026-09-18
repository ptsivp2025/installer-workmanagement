import { statusColor, statusLabel } from '@/lib/constants';
import { classNames } from '@/lib/utils';

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={classNames('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', statusColor(status), className)}>
      {statusLabel(status)}
    </span>
  );
}
