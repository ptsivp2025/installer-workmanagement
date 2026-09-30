'use client';

import { useState } from 'react';
import { Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { useAuth, useLanguage } from '@/app/providers';
import { Modal } from './Modal';
import type { DictKey } from '@/lib/i18n';

export type DeleteKind = 'project' | 'activity' | 'project_request' | 'user' | 'category' | 'division';

/**
 * Admin-only permanent delete for any list row or detail page. Opens a
 * confirmation that first shows what goes with it (activities, photos,
 * reviews, Demo→Beli links…) and asks for the word HAPUS to be typed, so a
 * slip of the thumb on a phone can't wipe a project. Renders nothing for
 * anyone who isn't the app admin; the API checks again on the server.
 */
export function DeleteButton({
  kind, id, name, onDeleted, variant = 'icon',
}: { kind: DeleteKind; id: string; name: string; onDeleted: () => void; variant?: 'icon' | 'button' }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user?.role !== 'admin') return null;
  const phrase = t('delete.phrase');

  async function openDialog(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(true); setTyped(''); setError(null); setCounts(null);
    const res = await fetch(`/api/admin/delete?kind=${kind}&id=${id}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setError(body.error ?? t('delete.failed')); return; }
    setCounts(body.counts ?? {});
  }

  async function confirm() {
    setBusy(true); setError(null);
    const res = await fetch('/api/admin/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(body.error ?? t('delete.failed')); return; }
    setOpen(false);
    onDeleted();
  }

  const impact = Object.entries(counts ?? {}).filter(([, n]) => n > 0);

  return (
    <>
      {variant === 'icon' ? (
        <button type="button" onClick={openDialog} title={t('delete.button')} aria-label={t('delete.button')}
          className="text-slate-400 hover:text-red-600 inline-flex p-1 rounded-control hover:bg-red-50">
          <Trash2 className="h-4 w-4" />
        </button>
      ) : (
        <button type="button" onClick={openDialog}
          className="inline-flex items-center gap-1 rounded-control border border-red-200 text-red-600 px-3 py-1.5 text-sm hover:bg-red-50">
          <Trash2 className="h-3.5 w-3.5" /> {t('delete.button')}
        </button>
      )}

      <Modal open={open} onClose={() => !busy && setOpen(false)} title={t('delete.title')}>
        <div className="space-y-4" onClick={e => e.stopPropagation()}>
          <div className="rounded-control border border-red-200 bg-red-50 p-3 flex gap-2.5">
            <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-red-800">{t(`delete.kind.${kind}` as DictKey)}: {name}</p>
              <p className="text-red-700 mt-1">{t('delete.warning')}</p>
            </div>
          </div>

          {counts === null && !error ? (
            <p className="text-sm text-slate-400 inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> {t('delete.checking')}</p>
          ) : impact.length > 0 ? (
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">{t('delete.alsoRemoved')}</p>
              <ul className="grid grid-cols-2 gap-1.5">
                {impact.map(([k, n]) => (
                  <li key={k} className="rounded-control bg-slate-50 border border-slate-200 px-2.5 py-1.5 text-sm">
                    <b className="tabular-nums">{n}</b> <span className="text-slate-600">{t(`delete.count.${k}` as DictKey)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : counts !== null ? (
            <p className="text-sm text-slate-500">{t('delete.nothingElse')}</p>
          ) : null}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t('delete.typeToConfirm', { phrase })}</label>
            <input value={typed} onChange={e => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off"
              className="w-full rounded-control border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className="rounded-control px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">{t('common.cancel')}</button>
            <button type="button" onClick={confirm} disabled={busy || counts === null || typed.trim().toUpperCase() !== phrase.toUpperCase()}
              className="inline-flex items-center gap-1.5 rounded-control bg-red-600 text-white text-sm font-semibold px-4 py-2 hover:bg-red-700 disabled:opacity-40">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} {t('delete.button')}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
