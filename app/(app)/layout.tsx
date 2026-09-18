'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/providers';
import { AppShell } from '@/components/shared/AppShell';
import { LoadingState } from '@/components/shared/States';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading || !user) return <LoadingState label="Checking session…" />;

  return <AppShell>{children}</AppShell>;
}
