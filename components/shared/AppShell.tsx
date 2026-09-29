'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard, CalendarClock, ClipboardCheck, FolderKanban, Settings, Star, MoreHorizontal, Inbox, Search,
  BarChart3, CloudOff, Download, Bell, CalendarDays, AlertTriangle, LogOut, Repeat2,
} from 'lucide-react';
import { useAuth, useLanguage } from '@/app/providers';
import { clearSession, type SessionUserProfile } from '@/lib/auth';
import { peekToday, peekOverdue, peekFormReview, peekProjectRequests, peekSalesReview, peekAccounts, type PeekItem } from '@/lib/peek';
import { supabase } from '@/lib/supabase';
import { useNavBadges, type NavBadgeCounts } from '@/lib/notification-badges';
import { useOnlineStatus } from '@/lib/useOnlineStatus';
import { nativeAppVersion, canCheckAppUpdate, checkAppUpdate } from '@/lib/native';
import { LanguageToggle } from './LanguageToggle';
import { ProfileModal } from './ProfileModal';
import { GlobalSearchModal } from './GlobalSearchModal';
import { AdminPanelModal } from '@/app/(app)/admin/_components/AdminPanelModal';
import type { DictKey } from '@/lib/i18n';
import type { Role } from '@/lib/constants';

/**
 * The app frame, in the same family as the Sales Management Platform:
 * a sticky top bar (identity left, badge shortcuts + notifications + avatar
 * right), a sidebar grouped by the kind of work from 900px up, a footer
 * pinned to the bottom with the build identity, and a thumb-reachable tab
 * bar on phones.
 *
 * Hiding a menu here is cosmetic. What a role can actually read or change
 * is decided by RLS in the database, not by which links it sees.
 */

type Group = 'work' | 'review' | 'sales' | 'system';
const GROUPS: Group[] = ['work', 'review', 'sales', 'system'];

interface NavItem {
  href: string;
  labelKey: DictKey;
  icon: React.ElementType;
  group: Group;
  roles: Role[];
  /** Opens the Admin Panel popup instead of navigating. */
  modal?: true;
  badgeKey?: keyof NavBadgeCounts;
}

const STAFF: Role[] = ['admin', 'supervisor', 'reviewer'];

// Order inside each group follows the work: today's schedule first, then the
// projects it belongs to; review before reporting.
const NAV: NavItem[] = [
  { href: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard, group: 'work', roles: ['admin', 'supervisor', 'reviewer', 'installer', 'sales'] },
  // Projects first: a project is the parent, activities hang under it.
  { href: '/projects', labelKey: 'nav.projects', icon: FolderKanban, group: 'work', roles: ['admin', 'supervisor', 'reviewer', 'installer', 'sales'] },
  { href: '/request-schedule', labelKey: 'nav.requestSchedule', icon: CalendarClock, group: 'work', roles: [...STAFF, 'installer'], badgeKey: 'today' },
  { href: '/form-review', labelKey: 'nav.formReview', icon: ClipboardCheck, group: 'review', roles: STAFF, badgeKey: 'formReview' },
  { href: '/project-progress', labelKey: 'nav.projectProgress', icon: BarChart3, group: 'review', roles: [...STAFF, 'sales'] },
  // The record behind billing the installer for a repeat visit (029).
  { href: '/demo-recap', labelKey: 'nav.demoRecap', icon: Repeat2, group: 'review', roles: [...STAFF, 'sales'] },
  { href: '/project-requests', labelKey: 'nav.projectRequests', icon: Inbox, group: 'sales', roles: ['admin', 'supervisor', 'sales'], badgeKey: 'projectRequests' },
  { href: '/sales-review', labelKey: 'nav.salesReview', icon: Star, group: 'sales', roles: [...STAFF, 'sales'], badgeKey: 'salesReview' },
  { href: '#admin', labelKey: 'nav.adminPanel', icon: Settings, group: 'system', roles: ['admin'], modal: true, badgeKey: 'registrations' },
];

// Phone tab bar: what each role reaches for most, 4 + "More" at most (five
// labels + More no longer fit a 360px screen readably).
const PHONE_TABS: Record<string, string[]> = {
  installer: ['/dashboard', '/projects', '/request-schedule'],
  sales: ['/dashboard', '/projects', '/project-requests', '/sales-review'],
  staff: ['/dashboard', '/projects', '/request-schedule', '/form-review'],
};

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + '/');

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, setUserProfile } = useAuth();
  const { t } = useLanguage();
  const [adminOpen, setAdminOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [brand, setBrand] = useState<{ platform_name: string; company_name: string; logo_url: string | null } | null>(null);

  useEffect(() => {
    supabase.from('platform_settings').select('platform_name, company_name, logo_url').eq('id', true).single()
      .then((res: { data: { platform_name: string; company_name: string; logo_url: string | null } | null }) => setBrand(res.data));
  }, []);

  // Ctrl/Cmd+K opens the search from anywhere.
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

  // A link inside a popup (audit log entry, More sheet) navigates the page
  // underneath; close the popup so the page is actually visible.
  useEffect(() => { setAdminOpen(false); setMoreOpen(false); }, [pathname]);

  const badges = useNavBadges(user);
  const online = useOnlineStatus();
  const [appVersion, setAppVersion] = useState<string | null>(null);
  useEffect(() => { if (canCheckAppUpdate()) setAppVersion(nativeAppVersion()); }, []);

  if (!user) return null;

  const role = user.role as Role;
  const items = NAV.filter(i => i.roles.includes(role));
  const tabHrefs = PHONE_TABS[role === 'installer' || role === 'sales' ? role : 'staff'];
  const tabs = items.filter(i => tabHrefs.includes(i.href));
  const more = items.filter(i => !tabHrefs.includes(i.href));

  const platformName = brand?.platform_name || 'Installer Work Management';
  const openItem = (item: NavItem) => { if (item.modal) setAdminOpen(true); };

  async function signOut() {
    setSigningOut(true);
    clearSession();
    setUserProfile(null);
    router.replace('/login');
  }

  return (
    <div className="min-h-[100dvh] flex flex-col">
      <TopBar
        platformName={platformName}
        companyName={brand?.company_name || t('shell.internalPlatform')}
        logoUrl={brand?.logo_url ?? null}
        user={user}
        badges={badges}
        onSearch={() => setSearchOpen(true)}
        onProfile={() => setProfileOpen(true)}
        onAdmin={() => setAdminOpen(true)}
      />

      {/* Without this, losing signal just looked like every page breaking
          at once ("Failed to fetch"), with nothing saying why. */}
      {!online && (
        <div className="sticky top-14 z-30 flex items-center gap-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm px-4 py-2">
          <CloudOff className="h-4 w-4 shrink-0" />
          <span>{t('common.offlineBanner')}</span>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <aside className="hidden sidebar:flex w-[228px] shrink-0 flex-col bg-white border-r border-slate-200 sticky top-14 h-[calc(100dvh-3.5rem-2.25rem)]">
          <nav className="flex-1 overflow-y-auto px-2.5 py-3 flex flex-col gap-0.5">
            {GROUPS.map(group => {
              const inGroup = items.filter(i => i.group === group);
              if (inGroup.length === 0) return null;
              return (
                <div key={group} role="group" aria-label={t(`nav.group.${group}` as DictKey)} className="flex flex-col gap-0.5 mb-2 last:mb-0">
                  <p className="px-3 pt-1 pb-1 text-[9px] font-bold text-slate-400 uppercase tracking-[0.14em]">
                    {t(`nav.group.${group}` as DictKey)}
                  </p>
                  {inGroup.map(item => (
                    <SidebarLink key={item.href} item={item} active={!item.modal && isActive(pathname, item.href)}
                      count={item.badgeKey ? badges[item.badgeKey] : 0} onModal={() => openItem(item)} />
                  ))}
                </div>
              );
            })}
          </nav>

          <div className="px-2.5 py-3 border-t border-slate-100 space-y-1">
            <div className="px-2 pb-1"><LanguageToggle /></div>
            {appVersion && (
              <button onClick={checkAppUpdate}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-control text-[12px] font-semibold text-slate-500 hover:bg-slate-50">
                <Download className="h-4 w-4" /> {t('app.checkUpdate')}
                <span className="ml-auto text-[10px] text-slate-400">v{appVersion}</span>
              </button>
            )}
            <button type="button" onClick={() => setProfileOpen(true)}
              className="w-full text-left flex items-center gap-2.5 px-2 py-2 rounded-control hover:bg-slate-50 transition-colors">
              <Initials name={user.full_name || user.username} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-bold text-slate-800 truncate">{user.full_name || user.username}</span>
                <span className="block text-[10px] text-slate-400">{t(`role.${role}` as DictKey)}</span>
              </span>
            </button>
            <button type="button" onClick={signOut} disabled={signingOut}
              className="w-full px-3 py-2 rounded-control text-[12px] font-semibold text-slate-500 hover:bg-slate-50 hover:text-red-600 transition-colors text-left disabled:opacity-50">
              {signingOut ? t('shell.signingOut') : t('common.signOut')}
            </button>
          </div>
        </aside>

        {/* Bottom padding keeps the phone tab bar + footer from covering the
            end of the page, save buttons at the foot of a form included. */}
        <main className="flex-1 min-w-0 px-3 sm:px-5 py-4 pb-[calc(4.75rem+env(safe-area-inset-bottom))] sidebar:pb-[3.75rem] max-w-[1500px] w-full mx-auto flex flex-col">
          {/* key={pathname}: each page enters with the same short animation. */}
          <div key={pathname} className="animate-page flex-1">{children}</div>
          {/* Phone: the footer ends the page and scrolls with it, so the
              tab bar is the only thing pinned to the bottom of the screen. */}
          <Footer platformName={platformName} inline />
        </main>
      </div>

      <Footer platformName={platformName} />

      {/* Phone tab bar */}
      <nav className="sidebar:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 pb-[env(safe-area-inset-bottom)]">
        <div className="flex">
          {tabs.map(item => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            const count = item.badgeKey ? badges[item.badgeKey] : 0;
            return (
              <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}
                className={`flex-1 min-w-0 min-h-[56px] flex flex-col items-center justify-center gap-0.5 py-2 ${active ? 'text-brand-700' : 'text-slate-400'}`}>
                <span className="relative"><Icon className="h-[19px] w-[19px]" strokeWidth={1.9} /><Dot count={count} /></span>
                <span className="text-[10px] font-bold leading-none max-w-full truncate px-1">{t(item.labelKey)}</span>
              </Link>
            );
          })}
          <button type="button" onClick={() => setMoreOpen(o => !o)} aria-expanded={moreOpen}
            className={`flex-1 min-h-[56px] flex flex-col items-center justify-center gap-0.5 py-2 ${moreOpen || more.some(i => isActive(pathname, i.href)) ? 'text-brand-700' : 'text-slate-400'}`}>
            <span className="relative">
              <MoreHorizontal className="h-[19px] w-[19px]" strokeWidth={1.9} />
              <Dot count={more.reduce((n, i) => n + (i.badgeKey ? badges[i.badgeKey] : 0), 0)} />
            </span>
            <span className="text-[10px] font-bold leading-none">{t('nav.more')}</span>
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="sidebar:hidden fixed inset-0 z-40" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-slate-900/30 animate-fade-in" aria-hidden="true" />
          <div role="dialog" aria-label={t('nav.more')} onClick={e => e.stopPropagation()}
            className="absolute inset-x-3 bottom-[calc(68px+env(safe-area-inset-bottom))] bg-white rounded-card border border-slate-200 shadow-modal p-2 animate-rise">
            {more.length > 0 && (
              <div className="grid grid-cols-3 gap-1">
                {more.map(item => {
                  const Icon = item.icon;
                  const active = !item.modal && isActive(pathname, item.href);
                  const count = item.badgeKey ? badges[item.badgeKey] : 0;
                  const inner = (
                    <>
                      <span className="relative"><Icon className="h-[19px] w-[19px]" strokeWidth={1.9} /><Dot count={count} /></span>
                      <span className="text-[11px] font-bold text-center leading-tight">{t(item.labelKey)}</span>
                    </>
                  );
                  const cls = `min-h-[64px] rounded-control flex flex-col items-center justify-center gap-1 px-1 ${active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50'}`;
                  return item.modal
                    ? <button key={item.href} type="button" className={cls} onClick={() => { setMoreOpen(false); setAdminOpen(true); }}>{inner}</button>
                    : <Link key={item.href} href={item.href} className={cls}>{inner}</Link>;
                })}
              </div>
            )}
            <div className={`flex items-center justify-between gap-2 px-2 pt-2 ${more.length > 0 ? 'mt-2 border-t border-slate-100' : ''}`}>
              <LanguageToggle />
              <div className="flex items-center gap-1">
                {appVersion && (
                  <button onClick={checkAppUpdate} className="inline-flex items-center gap-1.5 rounded-control px-3 py-2 text-[12px] font-semibold text-slate-600 hover:bg-slate-50">
                    <Download className="h-4 w-4" /> v{appVersion}
                  </button>
                )}
                <button onClick={signOut} disabled={signingOut}
                  className="inline-flex items-center gap-1.5 rounded-control px-3 py-2 text-[12px] font-semibold text-slate-600 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
                  <LogOut className="h-4 w-4" /> {signingOut ? t('shell.signingOut') : t('common.signOut')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} onSignOut={signOut} />
      <AdminPanelModal open={adminOpen} onClose={() => setAdminOpen(false)} />
      <GlobalSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

/* ── Top bar ──────────────────────────────────────────────────────────────── */

const PILL_BADGE = {
  red: 'bg-red-500 text-white',
  blue: 'bg-brand-700 text-white',
  amber: 'bg-amber-500 text-white',
  neutral: 'bg-slate-200 text-slate-600',
} as const;
type Tone = keyof typeof PILL_BADGE;

interface BoxDef {
  key: string; icon: React.ElementType; label: DictKey; title: DictKey; empty: DictKey;
  count: number; tone: Tone; href: string; openLabel: DictKey; load: () => Promise<PeekItem[]>;
}

function TopBar({ platformName, companyName, logoUrl, user, badges, onSearch, onProfile, onAdmin }: {
  platformName: string; companyName: string; logoUrl: string | null; user: SessionUserProfile;
  badges: NavBadgeCounts; onSearch: () => void; onProfile: () => void; onAdmin: () => void;
}) {
  const { t } = useLanguage();
  const role = user.role as Role;
  const staff = role === 'admin' || role === 'supervisor';
  const reviewer = staff || role === 'reviewer';
  // One floating panel at a time: two open panels cover each other.
  const [open, setOpen] = useState<string | null>(null);
  const pathname = usePathname();
  useEffect(() => { setOpen(null); }, [pathname]);

  // Info boxes, not navigation: each one opens a panel listing the actual
  // items behind its number, with a link to the full page at the bottom.
  const boxes: BoxDef[] = [];
  if (role !== 'sales') boxes.push({ key: 'today', icon: CalendarDays, label: 'shell.today', title: 'peek.today', empty: 'peek.todayEmpty', count: badges.today, tone: 'neutral', href: '/request-schedule', openLabel: 'nav.requestSchedule', load: () => peekToday(user) });
  if (staff) boxes.push({ key: 'overdue', icon: AlertTriangle, label: 'shell.overdue', title: 'peek.overdue', empty: 'peek.overdueEmpty', count: badges.overdue, tone: 'red', href: '/request-schedule', openLabel: 'nav.requestSchedule', load: peekOverdue });
  if (reviewer) boxes.push({ key: 'review', icon: ClipboardCheck, label: 'shell.review', title: 'peek.formReview', empty: 'peek.formReviewEmpty', count: badges.formReview, tone: 'amber', href: '/form-review', openLabel: 'nav.formReview', load: peekFormReview });
  if (staff) boxes.push({ key: 'requests', icon: Inbox, label: 'shell.requests', title: 'peek.projectRequests', empty: 'peek.projectRequestsEmpty', count: badges.projectRequests, tone: 'blue', href: '/project-requests', openLabel: 'nav.projectRequests', load: peekProjectRequests });

  // The bell: everything someone else is waiting on, as items. "Today" is
  // information, not a request, so it isn't counted here.
  const total = badges.overdue + badges.formReview + badges.projectRequests + badges.salesReview + badges.registrations;
  async function loadBell(): Promise<{ label: DictKey; items: PeekItem[] }[]> {
    const groups: Promise<{ label: DictKey; items: PeekItem[] }>[] = [];
    if (role === 'admin' && badges.registrations > 0) {
      groups.push(peekAccounts({ signup: t('peek.signup'), reset: t('peek.reset') }).then(items => ({ label: 'shell.notif.registrations' as DictKey, items })));
    }
    if (staff && badges.overdue > 0) groups.push(peekOverdue().then(items => ({ label: 'shell.notif.overdue' as DictKey, items })));
    if (reviewer && badges.formReview > 0) groups.push(peekFormReview().then(items => ({ label: 'shell.notif.formReview' as DictKey, items })));
    if (staff && badges.projectRequests > 0) groups.push(peekProjectRequests().then(items => ({ label: 'shell.notif.projectRequests' as DictKey, items })));
    if (role === 'sales' && badges.salesReview > 0) groups.push(peekSalesReview().then(items => ({ label: 'shell.notif.salesReview' as DictKey, items })));
    return (await Promise.all(groups)).filter(g => g.items.length > 0);
  }

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
      <div className="px-3 sm:px-5 h-14 flex items-center gap-3">
        <Link href="/dashboard" className="flex items-center gap-2.5 min-w-0 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl || '/logo.svg'} alt="" className="h-[34px] w-[34px] rounded-control object-contain bg-white shrink-0" />
          <span className="min-w-0 hidden sm:block">
            <span className="block text-[14px] font-black text-slate-900 leading-tight truncate max-w-[260px]">{platformName}</span>
            <span className="block text-[10px] text-slate-400 leading-tight truncate max-w-[260px]">{companyName}</span>
          </span>
          <span className="sm:hidden text-[13px] font-black text-slate-900 truncate max-w-[40vw]">{platformName}</span>
        </Link>

        <div className="flex-1" />

        {/* min-w-0 + horizontal scroll: a long row of boxes must never push
            the header (and the whole page) wider than the screen. */}
        <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto no-scrollbar">
          <button type="button" onClick={onSearch}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-control border border-slate-200 bg-slate-50 px-3 py-1.5 min-h-[34px] text-[12px] font-semibold text-slate-500 hover:bg-slate-100 transition-colors">
            <Search className="h-4 w-4" />
            <span className="hidden sidebar:inline">{t('shell.search')}</span>
            <kbd className="hidden lg:inline text-[10px] text-slate-300 border border-slate-200 rounded px-1">Ctrl K</kbd>
          </button>

          {boxes.map(b => (
            <InfoBox key={b.key} box={b} open={open === b.key}
              onToggle={() => setOpen(o => (o === b.key ? null : b.key))} onClose={() => setOpen(null)} />
          ))}

          <BellBox total={total} open={open === 'bell'} onToggle={() => setOpen(o => (o === 'bell' ? null : 'bell'))}
            onClose={() => setOpen(null)} load={loadBell} onAdmin={() => { setOpen(null); onAdmin(); }} />

          <button type="button" onClick={onProfile} aria-label={t('profile.openProfile')} className="shrink-0 ml-0.5 rounded-full">
            <Initials name={user.full_name || user.username} />
          </button>
        </div>
      </div>
    </header>
  );
}

/**
 * Floating panel under its trigger. Fixed and positioned from the trigger's
 * rectangle, because the box row scrolls horizontally and would clip an
 * absolutely positioned child. Closes on outside click and Escape.
 */
function FloatingPanel({ anchor, onClose, width = 340, children }: {
  anchor: React.RefObject<HTMLElement>; onClose: () => void; width?: number; children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const w = Math.min(width, window.innerWidth - 24);
      setPos({ top: r.bottom + 8, left: Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12)), width: w });
    };
    place();
    window.addEventListener('resize', place);
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (panel.current?.contains(target) || anchor.current?.contains(target)) return;
      onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchor, width]);

  if (!pos) return null;
  return (
    <div ref={panel} style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 60 }}
      className="bg-white rounded-card border border-slate-200 shadow-dropdown overflow-hidden animate-rise">
      {children}
    </div>
  );
}

function PeekList({ items, onPick }: { items: PeekItem[]; onPick: (item: PeekItem) => void }) {
  return (
    <ul>
      {items.map(item => {
        const body = (
          <>
            <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: item.color }} />
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-bold text-slate-800 leading-snug truncate">{item.title}</span>
              {item.subtitle && <span className="block text-[11px] text-slate-500 leading-snug truncate">{item.subtitle}</span>}
            </span>
            {item.right && <span className="text-[11px] font-bold text-slate-500 tabular-nums shrink-0">{item.right}</span>}
          </>
        );
        const cls = 'w-full text-left flex items-start gap-2.5 px-3.5 py-2.5 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0';
        return (
          <li key={item.id}>
            {item.href
              ? <Link href={item.href} onClick={() => onPick(item)} className={cls}>{body}</Link>
              : <button type="button" onClick={() => onPick(item)} className={cls}>{body}</button>}
          </li>
        );
      })}
    </ul>
  );
}

function InfoBox({ box, open, onToggle, onClose }: { box: BoxDef; open: boolean; onToggle: () => void; onClose: () => void }) {
  const { t } = useLanguage();
  const ref = useRef<HTMLButtonElement>(null);
  const [items, setItems] = useState<PeekItem[] | null>(null);
  const Icon = box.icon;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setItems(null);
    box.load().then(r => { if (!cancelled) setItems(r); }).catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
    // box.load is recreated each render; fetch once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="shrink-0 hidden sidebar:block">
      <button ref={ref} type="button" onClick={onToggle} aria-expanded={open}
        aria-label={`${t(box.label)}, ${box.count}`}
        className={`inline-flex items-center gap-1.5 rounded-control border px-2.5 py-1.5 min-h-[34px] text-[12px] font-semibold transition-colors ${
          open ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
        <Icon className={`h-4 w-4 ${open ? 'text-brand-700' : 'text-slate-400'}`} />
        <span>{t(box.label)}</span>
        {/* A zero isn't shown: a badge that's always there stops meaning anything. */}
        {box.count > 0 && (
          <span className={`inline-grid place-items-center min-w-[18px] h-[18px] rounded-full px-1 text-[10px] font-black tabular-nums ${PILL_BADGE[box.tone]}`}>
            {box.count > 99 ? '99+' : box.count}
          </span>
        )}
      </button>
      {open && (
        <FloatingPanel anchor={ref} onClose={onClose}>
          <header className="px-3.5 py-2.5 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between gap-2">
            <h2 className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">{t(box.title)}</h2>
            {box.count > 0 && <span className="text-[11px] font-black text-slate-500 tabular-nums">{box.count}</span>}
          </header>
          <div className="max-h-[340px] overflow-y-auto">
            {items === null ? (
              <p className="px-3.5 py-5 text-[12px] text-slate-400 text-center">{t('common.loading')}</p>
            ) : items.length === 0 ? (
              <p className="px-3.5 py-5 text-[12px] text-slate-400 text-center leading-snug">{t(box.empty)}</p>
            ) : <PeekList items={items} onPick={onClose} />}
          </div>
          <footer className="px-3.5 py-2 border-t border-slate-100 bg-slate-50/70">
            <Link href={box.href} onClick={onClose} className="text-[11px] font-bold text-brand-700 hover:underline underline-offset-2">
              {t('peek.open', { page: t(box.openLabel) })} →
            </Link>
          </footer>
        </FloatingPanel>
      )}
    </div>
  );
}

function BellBox({ total, open, onToggle, onClose, load, onAdmin }: {
  total: number; open: boolean; onToggle: () => void; onClose: () => void;
  load: () => Promise<{ label: DictKey; items: PeekItem[] }[]>; onAdmin: () => void;
}) {
  const { t } = useLanguage();
  const ref = useRef<HTMLButtonElement>(null);
  const [groups, setGroups] = useState<{ label: DictKey; items: PeekItem[] }[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setGroups(null);
    load().then(r => { if (!cancelled) setGroups(r); }).catch(() => { if (!cancelled) setGroups([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="shrink-0">
      <button ref={ref} type="button" onClick={onToggle} aria-expanded={open}
        aria-label={`${t('shell.notifications')}, ${total}`}
        className={`inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 min-h-[34px] text-[12px] font-bold transition-colors ${
          total > 0 ? 'bg-red-500 text-white hover:bg-red-600' : 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}>
        <Bell className="h-4 w-4" />
        <span className="hidden sidebar:inline">{t('shell.notifications')}</span>
        {total > 0 && (
          <span className="inline-grid place-items-center min-w-[18px] h-[18px] rounded-full px-1 text-[10px] font-black tabular-nums bg-white text-red-600">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>
      {open && (
        <FloatingPanel anchor={ref} onClose={onClose} width={360}>
          <header className="px-3.5 py-2.5 border-b border-slate-100 bg-slate-50/70">
            <h2 className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">{t('shell.notifTitle')}</h2>
          </header>
          <div className="max-h-[420px] overflow-y-auto">
            {groups === null ? (
              <p className="px-3.5 py-5 text-[12px] text-slate-400 text-center">{t('common.loading')}</p>
            ) : groups.length === 0 ? (
              <p className="px-3.5 py-6 text-[12.5px] text-slate-500 text-center">{t('shell.notifEmpty')}</p>
            ) : groups.map(g => (
              <section key={g.label}>
                <p className="px-3.5 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{t(g.label)}</p>
                <PeekList items={g.items} onPick={item => { onClose(); if (item.admin) onAdmin(); }} />
              </section>
            ))}
          </div>
        </FloatingPanel>
      )}
    </div>
  );
}

/* ── Sidebar pieces ───────────────────────────────────────────────────────── */

function SidebarLink({ item, active, count, onModal }: { item: NavItem; active: boolean; count: number; onModal: () => void }) {
  const { t } = useLanguage();
  const Icon = item.icon;
  const cls = `w-full flex items-center gap-2.5 px-3 py-2.5 rounded-control text-[13px] font-semibold transition-colors ${
    active ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`;
  const inner = (
    <>
      <Icon className={`h-[19px] w-[19px] ${active ? 'text-brand-700' : 'text-slate-400'}`} strokeWidth={1.9} />
      <span className="truncate">{t(item.labelKey)}</span>
      {count > 0 && (
        <span className="ml-auto inline-grid place-items-center min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-black tabular-nums">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </>
  );
  return item.modal
    ? <button type="button" onClick={onModal} className={cls}>{inner}</button>
    : <Link href={item.href} aria-current={active ? 'page' : undefined} className={cls}>{inner}</Link>;
}

function Dot({ count }: { count: number }) {
  if (count <= 0) return null;
  return <span className="absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />;
}

export function Initials({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  const letters = name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return (
    <span className={`${size === 'lg' ? 'h-10 w-10 text-[13px]' : 'h-8 w-8 text-[11px]'} rounded-full bg-brand-100 text-brand-800 grid place-items-center font-black shrink-0`}>
      {letters || '?'}
    </span>
  );
}

/* ── Footer ───────────────────────────────────────────────────────────────── */

/**
 * Who made it on the left, which build is running on the right, so a
 * problem report always says which version it's about.
 *
 * Desktop: pinned to the bottom of the screen; its height (h-9) is balanced
 * by <main>'s bottom padding and the sidebar height, change them together.
 * Phone (`inline`): the last thing on the page, scrolling with it. Pinned
 * above the tab bar it read as a second bar stacked on the navigation.
 */
function Footer({ platformName, inline }: { platformName: string; inline?: boolean }) {
  const { t } = useLanguage();
  const version = process.env.NEXT_PUBLIC_APP_VERSION;
  const commit = process.env.NEXT_PUBLIC_COMMIT;
  const built = process.env.NEXT_PUBLIC_BUILD_TIME;
  const builtAt = built
    ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(built))
    : null;

  return (
    <footer className={inline
      ? 'sidebar:hidden mt-6 pt-3 border-t border-slate-200 flex items-center justify-between gap-3'
      : 'hidden sidebar:flex fixed inset-x-0 bottom-0 z-30 h-9 border-t border-slate-200 bg-white/95 backdrop-blur px-5 items-center justify-between gap-3'}>
      <p className="text-[10.5px] sm:text-[11px] text-slate-500 truncate min-w-0">
        © {new Date().getFullYear()} {platformName}
        <span className="text-slate-400"> · {t('shell.createdBy')}</span>
      </p>
      <p className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] sm:text-[10.5px] font-medium text-slate-500 tabular-nums">
        {version && <span>v{version}</span>}
        {commit && <><span aria-hidden="true" className="text-slate-300">·</span><span className="font-mono">{commit}</span></>}
        {builtAt && <span className="hidden sm:contents"><span aria-hidden="true" className="text-slate-300">·</span><span>{builtAt}</span></span>}
      </p>
    </footer>
  );
}
