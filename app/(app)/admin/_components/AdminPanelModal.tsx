'use client';

import { useCallback, useEffect, useState } from 'react';
import { X, ShieldCheck } from 'lucide-react';
import { useAuth, useLanguage } from '@/app/providers';
import { LoadingState, ErrorState } from '@/components/shared/States';
import { AdminSidebar } from './AdminSidebar';
import { CategoriesSection } from './CategoriesSection';
import { UsersSection } from './UsersSection';
import { SalesDivisionsSection } from './SalesDivisionsSection';
import { SettingsSection } from './SettingsSection';
import { NotificationsSection } from './NotificationsSection';
import { IntegrationsSection } from './IntegrationsSection';
import type { AdminTab } from './types';

// A popup, not a page: the main app sidebar/content stay mounted (dimmed)
// behind it, and switching sections inside never navigates a route — only
// this one component tree is ever on screen for the whole Admin Panel.
export function AdminPanelModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const [tab, setTab] = useState<AdminTab>('categories');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const selectTab = useCallback((next: AdminTab) => setTab(next), []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-0 sm:p-6">
      <div className="w-full h-full sm:h-[85vh] sm:max-w-5xl bg-white sm:rounded-card shadow-modal flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="h-8 w-8 rounded-lg bg-slate-800 text-white flex items-center justify-center shrink-0"><ShieldCheck className="h-4 w-4" /></span>
            <div>
              <h2 className="font-semibold text-slate-900 leading-tight">{t('admin.panel')}</h2>
              <p className="text-xs text-slate-400 leading-tight">{t('admin.modalSubtitle')}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 shrink-0"><X className="h-5 w-5" /></button>
        </div>

        {authLoading ? (
          <div className="flex-1 flex items-center justify-center"><LoadingState /></div>
        ) : !user || user.role !== 'admin' ? (
          <div className="flex-1 flex items-center justify-center p-6"><ErrorState message={t('admin.onlyAdmins')} /></div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col sm:flex-row">
            <div className="shrink-0 border-b sm:border-b-0 sm:border-r border-slate-100 p-3 overflow-y-auto sm:w-56">
              <AdminSidebar active={tab} onSelect={selectTab} />
            </div>
            <div className="flex-1 min-w-0 overflow-y-auto p-5">
              {tab === 'categories' && <CategoriesSection />}
              {tab === 'users' && <UsersSection />}
              {tab === 'sales-divisions' && <SalesDivisionsSection />}
              {tab === 'settings' && <SettingsSection />}
              {tab === 'notifications' && <NotificationsSection />}
              {tab === 'integrations' && <IntegrationsSection onOpenNotifications={() => selectTab('notifications')} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
