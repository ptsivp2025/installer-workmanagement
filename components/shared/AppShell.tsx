'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard, CalendarClock, ClipboardCheck, FolderKanban, Settings, LogOut, Menu, X, Star, MoreHorizontal, UserRound, Inbox, Search,
} from 'lucide-react';
import { useAuth, useLanguage } from '@/app/providers';
import { clearSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useNavBadges, type NavBadgeCounts } from '@/lib/notification-badges';
import { LanguageToggle } from './LanguageToggle';
import { ProfileModal } from './ProfileModal';
import { GlobalSearchModal } from './GlobalSearchModal';
import { AdminPanelModal } from '@/app/(app)/admin/_components/AdminPanelModal';
import type { DictKey } from '@/lib/i18n';

// A regular item navigates via href; a modal item (Admin Panel) opens a
// popup over whatever page is currently showing instead — it never has its
// own route, so there's only ever one sidebar on screen (spec: the admin
// section must not render as a second full-page sidebar next to this one).
// badgeKey names which count from useNavBadges() this item shows, if any.
type NavItem = { href: string; labelKey: DictKey; icon: React.ElementType; modal?: true; badgeKey?: keyof NavBadgeCounts };

const STAFF_NAV: NavItem[] = [
  { href: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { href: '/projects', labelKey: 'nav.projects', icon: FolderKanban },
  { href: '/request-schedule', labelKey: 'nav.requestSchedule', icon: CalendarClock },
  { href: '/form-review', labelKey: 'nav.formReview', icon: ClipboardCheck, badgeKey: 'formReview' },
  { href: '/project-progress', labelKey: 'nav.projectProgress', icon: FolderKanban },
  { href: '/sales-review', labelKey: 'nav.salesReview', icon: Star },
];

// Admin and supervisor only (added onto STAFF_NAV below) — a reviewer isn't
// staff (is_staff() = admin/supervisor) and has nothing to decide here.
const PROJECT_REQUESTS_NAV: NavItem = {
  href: '/project-requests', labelKey: 'nav.projectRequests', icon: Inbox, badgeKey: 'projectRequests',
};

// An installer's whole job is: see today's work, do the work, done — Form
// Review (approve/reject) and Project Progress (management reporting)
// aren't theirs to act on, so they're just clutter in the way of the 3
// screens an installer actually needs (spec: simpler navigation for a
// non-technical field user).
const INSTALLER_NAV: NavItem[] = [
  { href: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { href: '/request-schedule', labelKey: 'nav.requestSchedule', icon: CalendarClock },
  { href: '/projects', labelKey: 'nav.projects', icon: FolderKanban },
];

// A Sales Division account checks progress, requests new work, and rates
// finished work on its own division's projects (RLS-scoped) — scheduling
// and internal QC (Form Review) aren't theirs to touch.
const SALES_NAV: NavItem[] = [
  { href: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { href: '/projects', labelKey: 'nav.projects', icon: FolderKanban },
  { href: '/project-progress', labelKey: 'nav.projectProgress', icon: FolderKanban },
  { href: '/project-requests', labelKey: 'nav.projectRequests', icon: Inbox },
  { href: '/sales-review', labelKey: 'nav.salesReview', icon: Star, badgeKey: 'salesReview' },
];

const ADMIN_NAV: NavItem = { href: '#admin', labelKey: 'nav.adminPanel', icon: Settings, modal: true, badgeKey: 'registrations' };

/** Small red count pill — capped at "9+" so a busy queue never stretches the nav row. */
function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-bold leading-none">
      {count > 9 ? '9+' : count}
    </span>
  );
}

/** Same signal, no room for text — a corner dot on the bottom-nav icon. */
function NavDot({ count }: { count: number }) {
  if (count <= 0) return null;
  return <span className="absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, setUserProfile } = useAuth();
  const { t } = useLanguage();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [brand, setBrand] = useState<{ platform_name: string; company_name: string; logo_url: string | null } | null>(null);

  useEffect(() => {
    supabase.from('platform_settings').select('platform_name, company_name, logo_url').eq('id', true).single()
      .then((res: { data: { platform_name: string; company_name: string; logo_url: string | null } | null }) => setBrand(res.data));
  }, []);

  // Ctrl/Cmd+K opens the project search from anywhere — the same shortcut
  // this kind of tool trains people to reach for.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function handleLogout() {
    clearSession();
    setUserProfile(null);
    router.replace('/login');
  }

  const badges = useNavBadges(user);

  const items =
    user?.role === 'sales' ? SALES_NAV :
    user?.role === 'installer' ? INSTALLER_NAV :
    user?.role === 'admin' ? [...STAFF_NAV, PROJECT_REQUESTS_NAV, ADMIN_NAV] :
    user?.role === 'supervisor' ? [...STAFF_NAV, PROJECT_REQUESTS_NAV] :
    STAFF_NAV; // reviewer

  // A short list (installer/sales) gets a thumb-reachable bottom tab bar on
  // mobile instead of forcing every tap through the hamburger drawer — the
  // pattern field users already know from Gojek/WhatsApp-style apps (which
  // itself runs 5 bottom tabs). A longer staff/admin list stays drawer-only
  // (too many items for a bottom bar to stay readable).
  const showBottomNav = items.length <= 5;

  return (
    <div className="min-h-screen flex">
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 inset-x-0 h-14 bg-white border-b border-slate-200 z-40 flex items-center justify-between px-4">
        <button onClick={() => setMobileOpen(true)} className="text-slate-600"><Menu className="h-5 w-5" /></button>
        <span className="font-semibold text-slate-900 text-sm truncate max-w-[70%]">{brand?.platform_name ?? 'Installer Work Management'}</span>
        <div className="w-5" />
      </div>

      {/* Sidebar */}
      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-16 flex items-center justify-between px-5 border-b border-slate-100">
          <div className="flex items-center gap-2.5 min-w-0">
            {brand?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logo_url} alt="" className="h-9 w-9 rounded-lg object-contain shrink-0" />
            ) : (
              <div className="h-9 w-9 rounded-lg bg-brand-600 text-white flex items-center justify-center text-sm font-bold shrink-0">
                {(brand?.platform_name ?? 'IW').slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="font-semibold text-slate-900 text-sm leading-tight truncate">{brand?.platform_name ?? 'Installer Work Management'}</p>
              <p className="text-[11px] text-slate-400 leading-tight truncate">{brand?.company_name ?? ''}</p>
            </div>
          </div>
          <button onClick={() => setMobileOpen(false)} className="lg:hidden text-slate-400 shrink-0"><X className="h-5 w-5" /></button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
          {items.map(item => {
            const Icon = item.icon;
            const badgeCount = item.badgeKey ? badges[item.badgeKey] : 0;
            if (item.modal) {
              return (
                <button
                  key={item.href}
                  onClick={() => { setAdminOpen(true); setMobileOpen(false); }}
                  className="w-full flex items-center gap-3 rounded-control px-3 py-2 text-sm font-medium transition text-slate-600 hover:bg-slate-50"
                >
                  <Icon className="h-4 w-4" />
                  {t(item.labelKey)}
                  <NavBadge count={badgeCount} />
                </button>
              );
            }
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
                <NavBadge count={badgeCount} />
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-100 p-3 space-y-2">
          <div className="px-2"><LanguageToggle /></div>
          {!loading && user && (
            <div className="flex items-center gap-2 px-2 py-2">
              <button
                onClick={() => { setProfileOpen(true); setMobileOpen(false); }}
                title={t('profile.openProfile')}
                className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-semibold text-slate-600 shrink-0 hover:bg-slate-300 transition"
              >
                {user.full_name?.charAt(0) ?? user.username.charAt(0)}
              </button>
              <button
                onClick={() => { setProfileOpen(true); setMobileOpen(false); }}
                className="min-w-0 flex-1 text-left"
              >
                <p className="text-sm font-medium text-slate-800 truncate">{user.full_name || user.username}</p>
                <p className="text-xs text-slate-400">{t(`role.${user.role}` as DictKey)}</p>
              </button>
              <button
                onClick={() => { setProfileOpen(true); setMobileOpen(false); }}
                title={t('profile.openProfile')}
                className="text-slate-400 hover:text-brand-600 shrink-0"
              >
                <UserRound className="h-4 w-4" />
              </button>
              <button onClick={handleLogout} title={t('common.signOut')} className="text-slate-400 hover:text-red-500 shrink-0">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {mobileOpen && <div className="fixed inset-0 bg-slate-900/40 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <main className={`flex-1 min-w-0 pt-14 lg:pt-0 ${showBottomNav ? 'pb-16 lg:pb-0' : ''}`}>
        {/* Pinned above every page, not just the Projects list — jumping
            straight to a project from anywhere is the point (spec: a
            project search "up top", like the reference platform). Sticks
            just below the fixed mobile header; on desktop there's nothing
            above it to clear. */}
        <div className="sticky top-14 lg:top-0 z-30 bg-slate-50/90 backdrop-blur border-b border-slate-100 px-4 sm:px-6 py-2.5">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 w-full sm:w-80 rounded-control border border-slate-300 bg-white px-3 py-2 text-sm text-slate-400 hover:border-slate-400 hover:text-slate-500 transition"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="truncate">{t('search.trigger')}</span>
            <kbd className="ml-auto hidden sm:inline-flex items-center gap-0.5 text-[10px] text-slate-300 border border-slate-200 rounded px-1 py-0.5 shrink-0">Ctrl K</kbd>
          </button>
        </div>
        {/* key={pathname} restarts the entrance animation on every
            navigation — without it React reuses the node and the new page
            simply appears. */}
        <div key={pathname} className="max-w-7xl mx-auto p-4 sm:p-6 animate-fade-in">{children}</div>
      </main>

      {showBottomNav && (
        <nav className="lg:hidden fixed bottom-0 inset-x-0 h-16 bg-white border-t border-slate-200 z-40 flex items-stretch">
          {items.map(item => {
            const Icon = item.icon;
            const badgeCount = item.badgeKey ? badges[item.badgeKey] : 0;
            if (item.modal) {
              return (
                <button
                  key={item.href}
                  onClick={() => setAdminOpen(true)}
                  className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-slate-500"
                >
                  <span className="relative"><Icon className="h-5 w-5" /><NavDot count={badgeCount} /></span>
                  {t(item.labelKey)}
                </button>
              );
            }
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active ? 'text-brand-600' : 'text-slate-500'}`}
              >
                <span className="relative"><Icon className="h-5 w-5" /><NavDot count={badgeCount} /></span>
                {t(item.labelKey)}
              </Link>
            );
          })}
          <button
            onClick={() => setMobileOpen(true)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-slate-500"
          >
            <MoreHorizontal className="h-5 w-5" />
            {t('nav.more')}
          </button>
        </nav>
      )}

      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
      <AdminPanelModal open={adminOpen} onClose={() => setAdminOpen(false)} />
      <GlobalSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
