'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { UserPlus, Loader2, CheckCircle2, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { useLanguage, useSettings } from '@/app/providers';
import { LanguageToggle } from '@/components/shared/LanguageToggle';
import { TEAM_ROLES, isSalesRole, type AccountType } from '@/lib/constants';
import { usePositions } from '@/lib/positions';
import { AccountTypePicker } from '@/components/shared/AccountTypePicker';

interface DivisionOption { id: string; name: string }

export default function RegisterPage() {
  const { t } = useLanguage();
  const { get } = useSettings();
  const positions = usePositions();
  // Admin Panel → Aturan Sistem → Akun & Login. Admin can never sign up here.
  const open = get<boolean>('register.enabled');
  const types = get<AccountType[]>('register.account_types').filter(x => x !== 'admin');
  const typesKey = types.join();
  const [form, setForm] = useState({
    full_name: '', username: '', email: '', phone: '', position: '', role: 'sales',
    sales_division_id: '', password: '', confirm: '',
  });
  useEffect(() => {
    // Start on an allowed type once the settings are known.
    const allowed = (role: string) => types.some(x => (x === 'team' ? (TEAM_ROLES as readonly string[]) : [x]).includes(role));
    if (types.length > 0 && !allowed(form.role)) {
      setForm(f => ({ ...f, role: types.includes('sales') ? 'sales' : types[0] === 'team' ? 'installer' : types[0], sales_division_id: '' }));
    }
  }, [typesKey, form.role]); // eslint-disable-line react-hooks/exhaustive-deps
  const [divisions, setDivisions] = useState<DivisionOption[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [brand, setBrand] = useState<{ platform_name: string; company_name: string; logo_url: string | null; primary_color: string; secondary_color: string; login_bg_url: string | null } | null>(null);

  useEffect(() => {
    fetch('/api/public/branding').then(r => r.json()).then(setBrand).catch(() => {});
    // Via the API, not the browser Supabase client: sales_divisions' RLS
    // needs is_authenticated(), which nobody on this page is yet.
    fetch('/api/public/sales-divisions')
      .then(r => r.json())
      .then((d: { divisions?: DivisionOption[] }) => setDivisions(d.divisions ?? []))
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const filled = form.full_name && form.username && form.email && form.phone && form.position && form.password;
    if (!filled) { setError(t('register.allFieldsRequired')); return; }
    if (isSalesRole(form.role) && !form.sales_division_id) { setError(t('account.divisionRequired')); return; }
    if (form.password !== form.confirm) { setError(t('register.passwordMismatch')); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Registration failed.'); return; }
      setDone(true);
    } catch {
      setError(t('login.networkError'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-slate-50">
      <div
        className="hidden lg:flex lg:w-1/2 relative flex-col justify-between p-12 text-white overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-brand-800 bg-cover bg-center"
        style={brand?.login_bg_url ? { backgroundImage: `linear-gradient(135deg, ${brand.primary_color}e0, ${brand.secondary_color}e0), url(${brand.login_bg_url})` } : undefined}
      >
        <div className="absolute inset-0 opacity-[0.07] bg-[radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] bg-[length:28px_28px]" />
        <div className="relative flex items-center justify-between gap-2.5 animate-slide-down">
          <div className="flex items-center gap-2.5">
            {brand?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logo_url} alt="" className="h-9 w-9 rounded-xl object-contain bg-white/15 backdrop-blur" />
            ) : (
              // Default logo (a worker in a hard hat) until an admin uploads one.
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/logo.svg" alt="" className="h-9 w-9 rounded-xl shrink-0" />
            )}
            <span className="text-lg font-bold tracking-tight">{brand?.platform_name ?? 'Installer Work Management'}</span>
          </div>
          <LanguageToggle dark />
        </div>
        <div className="relative max-w-md animate-slide-up anim-d160">
          <h1 className="text-4xl font-black leading-tight mb-4">{t('register.title')}</h1>
          <p className="text-white/80 text-base leading-relaxed">{t('register.subtitle')}</p>
        </div>
        <p className="relative text-white/50 text-xs">{brand?.company_name ?? ''}</p>
      </div>

      <div className="flex-1 flex items-center justify-center p-4 sm:p-8 overflow-y-auto">
        <div className="w-full max-w-md py-6">
          <div className="flex lg:hidden justify-end mb-4"><LanguageToggle /></div>

          {!open ? (
            <div className="bg-white rounded-card shadow-card border border-slate-200 p-8 text-center">
              <p className="text-sm text-slate-600">{t('register.closed')}</p>
              <Link href="/login" className="mt-6 inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-semibold px-4 py-2.5 hover:bg-brand-700 transition">
                <ArrowLeft className="h-4 w-4" /> {t('register.backToLogin')}
              </Link>
            </div>
          ) : done ? (
            <div className="bg-white rounded-card shadow-card border border-slate-200 p-8 text-center animate-zoom-in">
              <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
              <h2 className="text-xl font-bold text-slate-900">{t('register.successTitle')}</h2>
              <p className="text-sm text-slate-500 mt-2">{t('register.successBody')}</p>
              <Link href="/login" className="mt-6 inline-flex items-center gap-1.5 rounded-control bg-brand-600 text-white text-sm font-semibold px-4 py-2.5 hover:bg-brand-700 transition">
                <ArrowLeft className="h-4 w-4" /> {t('register.backToLogin')}
              </Link>
            </div>
          ) : (
            <div className="animate-slide-up">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{t('register.title')}</h2>
                <p className="text-slate-500 text-sm mt-1.5">{t('register.subtitle')}</p>
              </div>

              <form onSubmit={handleSubmit} className="bg-white rounded-card shadow-card border border-slate-200 p-6 space-y-4">
                {error && (
                  <div className="rounded-control bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 animate-fade-in">{error}</div>
                )}

                <AccountTypePicker
                  role={form.role}
                  divisionId={form.sales_division_id}
                  onChange={({ role, divisionId }) => setForm(f => ({ ...f, role, sales_division_id: divisionId }))}
                  types={types}
                  divisions={divisions}
                />

                <Field label={t('register.fullName')}>
                  <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} className={inputCls} required />
                </Field>

                <Field label={t('register.username')} hint={t('register.usernameHint')}>
                  <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value.toLowerCase() }))} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" className={inputCls} required />
                </Field>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label={t('register.email')}>
                    <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={inputCls} required />
                  </Field>
                  <Field label={t('register.phone')}>
                    <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className={inputCls} required />
                  </Field>
                </div>

                <Field label={t('register.position')}>
                  <select value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} className={inputCls} required>
                    <option value="">{t('register.selectPosition')}</option>
                    {positions.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </Field>

                <Field label={t('register.password')} hint={t('register.passwordHint')}>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      className={`${inputCls} pr-10`}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      tabIndex={-1}
                      aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                      className="absolute right-0 top-0 h-full px-3 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </Field>

                <Field label={t('register.confirmPassword')}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.confirm}
                    onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
                    className={inputCls}
                    required
                  />
                </Field>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 rounded-control bg-brand-600 text-white font-semibold py-2.5 hover:bg-brand-700 disabled:opacity-60 transition"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                  {t('register.submit')}
                </button>
              </form>

              <p className="text-center text-sm text-slate-500 mt-5">
                {t('register.haveAccount')}{' '}
                <Link href="/login" className="font-semibold text-brand-600 hover:text-brand-700">{t('register.signInHere')}</Link>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-control border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold mb-1.5 text-slate-600 tracking-wide uppercase">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}
