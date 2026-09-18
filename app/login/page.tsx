'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LogIn, Loader2, CalendarClock, Navigation, Camera, ClipboardCheck } from 'lucide-react';
import { setSession } from '@/lib/auth';
import { setDbToken } from '@/lib/supabase';
import { useAuth } from '@/app/providers';

const FEATURES = [
  { icon: CalendarClock, label: 'Request Schedule' },
  { icon: Navigation, label: 'GPS Execution' },
  { icon: Camera, label: 'Photo Evidence' },
  { icon: ClipboardCheck, label: 'Form Review' },
];

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { setUserProfile } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Login failed.');
        return;
      }
      setSession(data.user);
      setDbToken(data.db_token ?? null);
      // Updates the in-memory auth context directly — sessionStorage alone
      // doesn't do this, and without it the app layout's guard still thinks
      // nobody is logged in and bounces straight back to /login.
      setUserProfile(data.user);
      router.replace(params.get('next') || '/dashboard');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Left: branding panel (desktop only) */}
      <div className="hidden lg:flex lg:w-1/2 relative flex-col justify-between p-12 text-white overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-brand-800">
        <div className="absolute inset-0 opacity-[0.07] bg-[radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] bg-[length:28px_28px]" />

        <div className="relative flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center font-bold text-lg">IW</div>
          <span className="text-lg font-bold tracking-tight">Installer Work Management</span>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-4xl font-black leading-tight mb-4">Every job, one source of truth.</h1>
          <p className="text-white/80 text-base leading-relaxed mb-8">
            Projects, schedules, GPS-verified execution, and photo evidence — all tied together,
            from Survey &amp; Meeting through Instalasi Demo, Instalasi Beli, and Bongkar Demo.
          </p>
          <div className="flex flex-wrap gap-2.5">
            {FEATURES.map(({ icon: Icon, label }) => (
              <span key={label} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/12 backdrop-blur text-sm font-semibold border border-white/15">
                <Icon className="h-4 w-4" /> {label}
              </span>
            ))}
          </div>
        </div>

        <p className="relative text-white/50 text-xs">Installer Work Management Platform</p>
      </div>

      {/* Right: login form */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <div className="flex lg:hidden items-center gap-2.5 mb-6">
              <div className="h-9 w-9 rounded-xl bg-brand-600 text-white flex items-center justify-center font-bold">IW</div>
              <span className="text-lg font-bold text-slate-900">Installer Work Management</span>
            </div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Welcome back</h2>
            <p className="text-slate-500 text-sm mt-1.5">Sign in to your account to continue</p>
          </div>

          <form onSubmit={handleSubmit} className="bg-white rounded-card shadow-card border border-slate-200 p-6 space-y-4">
            {error && (
              <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>
            )}
            <div>
              <label className="block text-xs font-bold mb-1.5 text-slate-600 tracking-wide uppercase">Username</label>
              <input
                type="text"
                required
                autoFocus
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full rounded-control border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1.5 text-slate-600 tracking-wide uppercase">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full rounded-control border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-control bg-brand-600 text-white font-semibold py-2.5 hover:bg-brand-700 disabled:opacity-60 transition"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              Sign In
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
