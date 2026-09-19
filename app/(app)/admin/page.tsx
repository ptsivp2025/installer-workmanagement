'use client';

import { Suspense, useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth, useLanguage } from '@/app/providers';
import { LoadingState, ErrorState } from '@/components/shared/States';
import { AdminSidebar } from './_components/AdminSidebar';
import { CategoriesSection } from './_components/CategoriesSection';
import { UsersSection } from './_components/UsersSection';
import { SalesDivisionsSection } from './_components/SalesDivisionsSection';
import { SettingsSection } from './_components/SettingsSection';
import { NotificationsSection } from './_components/NotificationsSection';
import { IntegrationsSection } from './_components/IntegrationsSection';
import type { AdminTab } from './_components/types';

const VALID_TABS: AdminTab[] = ['categories', 'users', 'sales-divisions', 'settings', 'notifications', 'integrations'];

// A single page with a sidebar that swaps content by client-side state,
// instead of six separate routes behind a top tab bar — the whole Admin
// Panel is one mounted component tree, so switching sections is a state
// change, never a route transition.
function AdminPanelContent() {
  const { user, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();

  const tabParam = searchParams.get('tab');
  const initialTab: AdminTab = (VALID_TABS as string[]).includes(tabParam ?? '') ? (tabParam as AdminTab) : 'categories';
  const [tab, setTab] = useState<AdminTab>(initialTab);

  const selectTab = useCallback((next: AdminTab) => {
    setTab(next);
    router.replace(`/admin?tab=${next}`, { scroll: false });
  }, [router]);

  if (authLoading) return <LoadingState />;
  if (!user || user.role !== 'admin') return <ErrorState message={t('admin.onlyAdmins')} />;

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-6">{t('admin.panel')}</h1>
      <div className="flex flex-col lg:flex-row gap-6">
        <AdminSidebar active={tab} onSelect={selectTab} />
        <div className="flex-1 min-w-0">
          {tab === 'categories' && <CategoriesSection />}
          {tab === 'users' && <UsersSection />}
          {tab === 'sales-divisions' && <SalesDivisionsSection />}
          {tab === 'settings' && <SettingsSection />}
          {tab === 'notifications' && <NotificationsSection />}
          {tab === 'integrations' && <IntegrationsSection onOpenNotifications={() => selectTab('notifications')} />}
        </div>
      </div>
    </div>
  );
}

export default function AdminPanelPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <AdminPanelContent />
    </Suspense>
  );
}
