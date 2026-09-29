'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useLanguage } from '@/app/providers';
import { AppShell } from '@/components/shared/AppShell';
import { LoadingState, ErrorState } from '@/components/shared/States';
import { notifyAppReady } from '@/lib/native';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, unreachable, refresh } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  // Only a definite "not logged in" from the server goes to /login. No
  // answer at all (no signal) keeps the user where they are.
  useEffect(() => {
    if (!loading && !user && !unreachable) router.replace('/login');
  }, [loading, user, unreachable, router]);

  const showUnreachable = !loading && !user && unreachable;
  useEffect(() => {
    if (showUnreachable) notifyAppReady(); // lift the Android app's loading screen so this message shows
  }, [showUnreachable]);

  if (showUnreachable) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <ErrorState message={t('session.unreachable')} onRetry={refresh} />
      </div>
    );
  }

  if (loading || !user) return <LoadingState label={t('session.checking')} />;

  return <AppShell>{children}</AppShell>;
}
