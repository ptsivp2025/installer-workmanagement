'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin/categories', label: 'Activity Categories' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/sales-divisions', label: 'Sales Divisions' },
  { href: '/admin/settings', label: 'Account Settings' },
  { href: '/admin/notifications', label: 'Notifications' },
  { href: '/admin/integrations', label: 'Integrations' },
];

export function AdminTabs() {
  const pathname = usePathname();
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
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
