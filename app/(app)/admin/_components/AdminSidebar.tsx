'use client';

import { Layers, Users, Building2, Palette, Bell, Plug, History, Smartphone } from 'lucide-react';
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
      { tab: 'android-app', labelKey: 'admin.tab.androidApp', icon: Smartphone },
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
  {
    labelKey: 'admin.group.security',
    items: [
      { tab: 'audit-log', labelKey: 'admin.tab.auditLog', icon: History },
    ],
  },
];

export function AdminSidebar({ active, onSelect, badges = {} }: {
  active: AdminTab; onSelect: (tab: AdminTab) => void; badges?: Partial<Record<AdminTab, number>>;
}) {
  const { t } = useLanguage();
  return (
    <>
      {/* Phone: one scrollable row of pills, so the section content isn't
          pushed a whole screen down by a vertical menu. */}
      <nav className="sm:hidden flex gap-1.5 overflow-x-auto no-scrollbar px-3 py-2.5">
        {GROUPS.flatMap(g => g.items).map(item => {
          const Icon = item.icon;
          const isActive = active === item.tab;
          const n = badges[item.tab] ?? 0;
          return (
            <button key={item.tab} onClick={() => onSelect(item.tab)}
              className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition ${
                isActive ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-slate-600'}`}>
              <Icon className="h-3.5 w-3.5" /> {t(item.labelKey)}
              {n > 0 && <span className="inline-grid place-items-center min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-black px-1">{n}</span>}
            </button>
          );
        })}
      </nav>

      <nav className="hidden sm:flex flex-col gap-0.5 p-2.5">
        {GROUPS.map(group => (
          <div key={group.labelKey} className="flex flex-col gap-0.5 mb-2 last:mb-0">
            <p className="px-3 pt-1 pb-1 text-[9px] font-bold text-slate-400 uppercase tracking-[0.14em]">{t(group.labelKey)}</p>
            {group.items.map(item => {
              const Icon = item.icon;
              const isActive = active === item.tab;
              const n = badges[item.tab] ?? 0;
              return (
                <button key={item.tab} onClick={() => onSelect(item.tab)} aria-current={isActive ? 'true' : undefined}
                  className={`w-full flex items-center gap-2.5 rounded-control px-3 py-2.5 text-[13px] font-semibold text-left transition-colors ${
                    isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}>
                  <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-brand-700' : 'text-slate-400'}`} />
                  <span className="truncate">{t(item.labelKey)}</span>
                  {n > 0 && <span className="ml-auto inline-grid place-items-center min-w-[20px] h-5 rounded-full bg-red-500 text-white text-[10px] font-black px-1">{n}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </>
  );
}
