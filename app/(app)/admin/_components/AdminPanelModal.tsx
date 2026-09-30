'use client';

import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAuth, useLanguage } from '@/app/providers';
import { supabase } from '@/lib/supabase';
import { LoadingState, ErrorState } from '@/components/shared/States';
import { Modal, ModalBanner, BannerBadge, BannerTile } from '@/components/shared/Modal';
import { AdminSidebar } from './AdminSidebar';
import { CategoriesSection } from './CategoriesSection';
import { UsersSection } from './UsersSection';
import { SalesDivisionsSection } from './SalesDivisionsSection';
import { SettingsSection } from './SettingsSection';
import { NotificationsSection } from './NotificationsSection';
import { IntegrationsSection } from './IntegrationsSection';
import { AuditLogSection } from './AuditLogSection';
import { AndroidAppSection } from './AndroidAppSection';
import { SystemRulesSection } from './SystemRulesSection';
import type { AdminTab } from './types';
import type { DictKey } from '@/lib/i18n';

const TAB_LABEL: Record<AdminTab, DictKey> = {
  categories: 'admin.tab.categories',
  users: 'admin.tab.users',
  'sales-divisions': 'admin.tab.salesDivisions',
  settings: 'admin.tab.settings',
  notifications: 'admin.tab.notifications',
  integrations: 'admin.tab.integrations',
  'audit-log': 'admin.tab.auditLog',
  'android-app': 'admin.tab.androidApp',
  rules: 'admin.tab.rules',
};

/**
 * The Admin Panel is a popup, not a page: the app stays mounted (dimmed)
 * behind it and switching sections never changes the route. Same banner and
 * layout as the Profile popup and the Sales Management Platform.
 */
export function AdminPanelModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const [tab, setTab] = useState<AdminTab>('categories');
  const [counts, setCounts] = useState({ activeUsers: 0, waiting: 0 });

  const loadCounts = useCallback(async () => {
    const head = (table: string) => supabase.from(table).select('*', { count: 'exact', head: true });
    const [active, pending, resets] = await Promise.all([
      head('users').eq('active', true),
      head('users').eq('approval_status', 'pending'),
      head('password_reset_requests').eq('status', 'pending'),
    ]);
    setCounts({ activeUsers: active.count ?? 0, waiting: (pending.count ?? 0) + (resets.count ?? 0) });
  }, []);

  useEffect(() => { if (open && user?.role === 'admin') loadCounts(); }, [open, user?.role, loadCounts, tab]);
  useEffect(() => {
    if (!open) return;
    const onChange = () => { loadCounts(); };
    window.addEventListener('iwm:admin-changed', onChange);
    return () => window.removeEventListener('iwm:admin-changed', onChange);
  }, [open, loadCounts]);

  const selectTab = useCallback((next: AdminTab) => setTab(next), []);

  return (
    <Modal open={open} onClose={onClose} title={t('admin.panel')} size="full" bare>
      <ModalBanner
        onClose={onClose}
        eyebrow={t('admin.modalSubtitle')}
        title={t('admin.panel')}
        aside={user?.role === 'admin' ? (
          <>
            <BannerTile value={counts.activeUsers} label={t('admin.tileActiveUsers')} />
            <BannerTile value={counts.waiting} label={t('admin.tileWaiting')} amber={counts.waiting > 0} />
          </>
        ) : undefined}
      >
        <BannerBadge><ShieldCheck className="h-3 w-3" /> {t(TAB_LABEL[tab])}</BannerBadge>
      </ModalBanner>

      {authLoading ? (
        <div className="flex-1 flex items-center justify-center"><LoadingState /></div>
      ) : !user || user.role !== 'admin' ? (
        <div className="flex-1 flex items-center justify-center p-6"><ErrorState message={t('admin.onlyAdmins')} /></div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col sm:flex-row">
          <aside className="shrink-0 border-b sm:border-b-0 sm:border-r border-slate-200 bg-white sm:w-56 sm:overflow-y-auto overflow-x-hidden">
            <AdminSidebar active={tab} onSelect={selectTab} badges={{ users: counts.waiting }} />
          </aside>
          <div className="flex-1 min-w-0 min-h-0 overflow-y-auto bg-slate-50 p-4 sm:p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {tab === 'categories' && <CategoriesSection />}
            {tab === 'users' && <UsersSection />}
            {tab === 'sales-divisions' && <SalesDivisionsSection />}
            {tab === 'settings' && <SettingsSection />}
            {tab === 'notifications' && <NotificationsSection />}
            {tab === 'audit-log' && <AuditLogSection />}
            {tab === 'android-app' && <AndroidAppSection />}
            {tab === 'rules' && <SystemRulesSection />}
            {tab === 'integrations' && <IntegrationsSection onOpenNotifications={() => selectTab('notifications')} />}
          </div>
        </div>
      )}
    </Modal>
  );
}
