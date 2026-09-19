'use client';

import { Layers, Users, Building2, Palette, Bell, Plug } from 'lucide-react';
import { useLanguage } from '@/app/providers';
import type { DictKey } from '@/lib/i18n';
import type { AdminTab } from './types';

const GROUPS: { labelKey: DictKey; items: { tab: AdminTab; labelKey: DictKey; icon: React.ElementType }[] }[] = [
  {
    labelKey: 'admin.group.general',
    items: [
      { tab: 'categories', labelKey: 'admin.tab.categories', icon: Layers },
      { tab: 'users', labelKey: 'admin.tab.users', icon: Users },
      { tab: 'sales-divisions', labelKey: 'admin.tab.salesDivisions', icon: Building2 },
    ],
  },
  {
    labelKey: 'admin.group.appearance',
    items: [
      { tab: 'settings', labelKey: 'admin.tab.settings', icon: Palette },
    ],
  },
  {
    labelKey: 'admin.group.notifications',
    items: [
      { tab: 'notifications', labelKey: 'admin.tab.notifications', icon: Bell },
      { tab: 'integrations', labelKey: 'admin.tab.integrations', icon: Plug },
    ],
  },
];

export function AdminSidebar({ active, onSelect }: { active: AdminTab; onSelect: (tab: AdminTab) => void }) {
  const { t } = useLanguage();
  return (
    <nav className="w-full lg:w-56 shrink-0 space-y-5">
      {GROUPS.map(group => (
        <div key={group.labelKey}>
          <p className="px-2.5 mb-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{t(group.labelKey)}</p>
          <div className="space-y-0.5">
            {group.items.map(item => {
              const Icon = item.icon;
              const isActive = active === item.tab;
              return (
                <button
                  key={item.tab}
                  onClick={() => onSelect(item.tab)}
                  className={`w-full flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm font-medium text-left transition ${
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t(item.labelKey)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
