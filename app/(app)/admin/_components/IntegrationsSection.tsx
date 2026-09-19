'use client';

import { useCallback, useEffect, useState } from 'react';
import { Send, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/app/providers';
import { LoadingState, ErrorState } from '@/components/shared/States';

export function IntegrationsSection({ onOpenNotifications }: { onOpenNotifications: () => void }) {
  const { t, lang } = useLanguage();
  const [telegramConfigured, setTelegramConfigured] = useState(false);
  const [activeGroups, setActiveGroups] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [{ data: settings, error: sErr }, { count, error: gErr }] = await Promise.all([
      supabase.from('notification_settings').select('telegram_bot_token').eq('id', true).single(),
      supabase.from('notification_groups').select('*', { count: 'exact', head: true }).eq('active', true),
    ]);
    if (sErr) setError(sErr.message);
    else if (gErr) setError(gErr.message);
    else {
      setTelegramConfigured(!!settings?.telegram_bot_token);
      setActiveGroups(count ?? 0);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <p className="text-sm text-slate-500 mb-6">{t('adminIntegrations.subtitle')}</p>

      {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={load} /> : (
        <div className="max-w-lg space-y-3">
          <button onClick={onOpenNotifications} className="w-full text-left block bg-white rounded-card border border-slate-200 shadow-card p-5 hover:shadow-modal transition">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <Send className="h-5 w-5 text-brand-600 mt-0.5" />
                <div>
                  <p className="font-medium text-slate-900">Telegram</p>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {telegramConfigured
                      ? `${t('adminIntegrations.botConfigured')} · ${activeGroups} ${t('adminIntegrations.activeGroups')}${lang === 'en' && activeGroups !== 1 ? 's' : ''}`
                      : t('adminIntegrations.tokenNotSet')}
                  </p>
                </div>
              </div>
              {telegramConfigured
                ? <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                : <XCircle className="h-5 w-5 text-slate-300 shrink-0" />}
            </div>
          </button>
          <p className="text-xs text-slate-400 px-1">{t('adminIntegrations.noOthersConnected')}</p>
        </div>
      )}
    </div>
  );
}
