'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/app/providers';
import type { DictKey } from '@/lib/i18n';

const TABS: { href: string; labelKey: DictKey }[] = [
  { href: '/admin/categories', labelKey: 'admin.tab.categories' },
  { href: '/admin/users', labelKey: 'admin.tab.users' },
  { href: '/admin/sales-divisions', labelKey: 'admin.tab.salesDivisions' },
  { href: '/admin/settings', labelKey: 'admin.tab.settings' },
  { href: '/admin/notifications', labelKey: 'admin.tab.notifications' },
  { href: '/admin/integrations', labelKey: 'admin.tab.integrations' },
];

export function AdminTabs() {
  const pathname = usePathname();
  const { t } = useLanguage();
  return (
    <div className="flex gap-1 border-b border-slate-200 mb-6 overflow-x-auto">
      {TABS.map(tab => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-3.5 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition ${
              active ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t(tab.labelKey)}
          </Link>
        );
      })}
    </div>
  );
}
