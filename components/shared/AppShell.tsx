'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard, CalendarClock, ClipboardCheck, FolderKanban, Settings, LogOut, Menu, X, Star,
} from 'lucide-react';
import { useAuth, useLanguage } from '@/app/providers';
import { clearSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { LanguageToggle } from './LanguageToggle';
import type { DictKey } from '@/lib/i18n';

const NAV: { href: string; labelKey: DictKey; icon: React.ElementType }[] = [
  { href: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { href: '/projects', labelKey: 'nav.projects', icon: FolderKanban },
  { href: '/request-schedule', labelKey: 'nav.requestSchedule', icon: CalendarClock },
  { href: '/form-review', labelKey: 'nav.formReview', icon: ClipboardCheck },
  { href: '/project-progress', labelKey: 'nav.projectProgress', icon: FolderKanban },
  { href: '/sales-review', labelKey: 'nav.salesReview', icon: Star },
];

// A Sales Division account only checks progress and rates finished work on
// its own division's projects (RLS-scoped) — scheduling and internal QC
// (Form Review) aren't theirs to touch.
const SALES_NAV: { href: string; labelKey: DictKey; icon: React.ElementType }[] = [
  { href: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { href: '/projects', labelKey: 'nav.projects', icon: FolderKanban },
  { href: '/project-progress', labelKey: 'nav.projectProgress', icon: FolderKanban },
  { href: '/sales-review', labelKey: 'nav.salesReview', icon: Star },
];

const ADMIN_NAV: { href: string; labelKey: DictKey; icon: React.ElementType } = { href: '/admin/categories', labelKey: 'nav.adminPanel', icon: Settings };

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, setUserProfile } = useAuth();
  const { t } = useLanguage();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [brand, setBrand] = useState<{ company_name: string; logo_url: string | null } | null>(null);

  useEffect(() => {
    supabase.from('platform_settings').select('company_name, logo_url').eq('id', true).single()
      .then((res: { data: { company_name: string; logo_url: string | null } | null }) => setBrand(res.data));
  }, []);

  async function handleLogout() {
    clearSession();
    setUserProfile(null);
    router.replace('/login');
  }

  const items = user?.role === 'sales' ? SALES_NAV : user?.role === 'admin' ? [...NAV, ADMIN_NAV] : NAV;

  return (
    <div className="min-h-screen flex">
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 inset-x-0 h-14 bg-white border-b border-slate-200 z-40 flex items-center justify-between px-4">
        <button onClick={() => setMobileOpen(true)} className="text-slate-600"><Menu className="h-5 w-5" /></button>
        <span className="font-semibold text-slate-900 text-sm">{brand?.company_name ?? 'Installer Work Management'}</span>
        <div className="w-5" />
      </div>

      {/* Sidebar */}
      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-14 flex items-center justify-between px-5 border-b border-slate-100">
          <div className="flex items-center gap-2 min-w-0">
            {brand?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logo_url} alt="" className="h-8 w-8 rounded-lg object-contain shrink-0" />
            ) : (
              <div className="h-8 w-8 rounded-lg bg-brand-600 text-white flex items-center justify-center text-sm font-bold shrink-0">
                {(brand?.company_name ?? 'IW').slice(0, 2).toUpperCase()}
              </div>
            )}
            <span className="font-semibold text-slate-900 text-sm truncate">{brand?.company_name ?? 'Work Management'}</span>
          </div>
          <button onClick={() => setMobileOpen(false)} className="lg:hidden text-slate-400"><X className="h-5 w-5" /></button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
          {items.map(item => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 rounded-control px-3 py-2 text-sm font-medium transition ${
                  active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon className="h-4 w-4" />
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-100 p-3 space-y-2">
          <div className="px-2"><LanguageToggle /></div>
          {!loading && user && (
            <div className="flex items-center gap-2 px-2 py-2">
              <div className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-semibold text-slate-600">
                {user.full_name?.charAt(0) ?? user.username.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 truncate">{user.full_name || user.username}</p>
                <p className="text-xs text-slate-400">{t(`role.${user.role}` as DictKey)}</p>
              </div>
              <button onClick={handleLogout} title={t('common.signOut')} className="text-slate-400 hover:text-red-500">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {mobileOpen && <div className="fixed inset-0 bg-slate-900/40 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <main className="flex-1 min-w-0 pt-14 lg:pt-0">
        <div className="max-w-7xl mx-auto p-4 sm:p-6">{children}</div>
      </main>
    </div>
  );
}
