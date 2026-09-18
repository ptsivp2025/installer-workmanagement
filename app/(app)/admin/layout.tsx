'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { classNames } from '@/lib/utils';

const TABS = [
  { href: '/admin/categories', label: 'Activity Categories' },
  { href: '/admin/users', label: 'User Management' },
  { href: '/admin/sales-divisions', label: 'Sales Divisions' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Admin Panel</h1>
        <div className="flex gap-1 mt-4 border-b border-slate-200">
          {TABS.map(tab => (
            <Link
              key={tab.href}
              href={tab.href}
              className={classNames(
                'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition',
                pathname === tab.href
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700',
              )}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>
      {children}
    </div>
  );
}
