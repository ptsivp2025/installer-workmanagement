'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, KeyRound, Loader2, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/app/providers';
import { LanguageToggle } from '@/components/shared/LanguageToggle';

/**
 * Forgot password: sends a reset request to the admins, who set a new
 * password (there's no email service to send a reset link). The reply is
 * the same whether or not the username exists.
 */
export default function ForgotPasswordPage() {
  const { t } = useLanguage();
  const [username, setUsername] = useState('');
  const [contact, setContact] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, contact }),
      });
      if (!res.ok) throw new Error();
      setSent(true);
    } catch {
      setError(t('forgot.failed'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="flex items-center justify-between mb-6">
          <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
            <ArrowLeft className="h-4 w-4" /> {t('forgot.backToLogin')}
          </Link>
          <LanguageToggle />
        </div>

        {sent ? (
          <div className="bg-white rounded-card shadow-card border border-slate-200 p-6 text-center animate-zoom-in">
            <CheckCircle2 className="h-10 w-10 text-emerald-600 mx-auto mb-3" />
            <h1 className="font-semibold text-slate-900">{t('forgot.sentTitle')}</h1>
            <p className="text-sm text-slate-500 mt-1.5">{t('forgot.sentBody')}</p>
            <Link href="/login" className="mt-5 inline-flex rounded-control bg-brand-600 text-white text-sm font-medium px-4 py-2 hover:bg-brand-700">{t('forgot.backToLogin')}</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="bg-white rounded-card shadow-card border border-slate-200 p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <span className="h-9 w-9 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><KeyRound className="h-4 w-4" /></span>
              <h1 className="text-lg font-semibold text-slate-900">{t('forgot.title')}</h1>
            </div>
            <p className="text-sm text-slate-500">{t('forgot.subtitle')}</p>
            {error && <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}
            <div>
              <label className="block text-xs font-bold mb-1.5 text-slate-600 tracking-wide uppercase">{t('login.username')}</label>
              <input required autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" value={username} onChange={e => setUsername(e.target.value)}
                className="w-full rounded-control border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1.5 text-slate-600 tracking-wide uppercase">{t('forgot.contact')}</label>
              <input value={contact} onChange={e => setContact(e.target.value)} inputMode="tel" placeholder="08xx / email"
                className="w-full rounded-control border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <p className="text-xs text-slate-400 mt-1">{t('forgot.contactHint')}</p>
            </div>
            <button type="submit" disabled={sending || !username.trim()}
              className="w-full flex items-center justify-center gap-2 rounded-control bg-brand-600 text-white font-semibold py-2.5 hover:bg-brand-700 disabled:opacity-60">
              {sending && <Loader2 className="h-4 w-4 animate-spin" />} {t('forgot.send')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
