'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/app/providers';

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  /** Red confirm button — for delete/cancel/reject. */
  danger?: boolean;
}

interface PromptOptions extends ConfirmOptions {
  label?: string;
  placeholder?: string;
  /** Confirm stays disabled until something is typed. */
  required?: boolean;
}

type Pending =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void };

/**
 * In-app replacement for window.confirm / window.prompt. The browser's own
 * boxes can't be styled or translated: on a phone they show the site's URL
 * as their title, in Chrome a one-line prompt is too small to type a
 * rejection reason into, and some in-app browsers (WhatsApp, Instagram)
 * suppress them entirely, which made the action silently do nothing.
 *
 *   const { confirm, prompt, dialog } = useDialog();
 *   if (!(await confirm({ title: '…', danger: true }))) return;
 *   const reason = await prompt({ title: '…', required: true });
 *   …
 *   return <>{…}{dialog}</>;
 */
export function useDialog() {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>(resolve => setPending({ kind: 'confirm', opts, resolve })),
    [],
  );
  const prompt = useCallback(
    (opts: PromptOptions) => new Promise<string | null>(resolve => setPending({ kind: 'prompt', opts, resolve })),
    [],
  );

  const dialog = pending ? (
    <DialogView
      key={pending.opts.title}
      kind={pending.kind}
      opts={pending.opts}
      onDone={(value) => {
        if (pending.kind === 'confirm') pending.resolve(value !== null);
        else pending.resolve(value);
        setPending(null);
      }}
    />
  ) : null;

  return { confirm, prompt, dialog };
}

function DialogView({
  kind, opts, onDone,
}: { kind: 'confirm' | 'prompt'; opts: PromptOptions; onDone: (value: string | null) => void }) {
  const { t } = useLanguage();
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const canConfirm = kind === 'confirm' || !opts.required || text.trim().length > 0;
  // The parent passes a new onDone every render; keep the effect below from
  // re-running (and re-grabbing focus) each time it does.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const focusTimer = setTimeout(() => (kind === 'prompt' ? inputRef.current : confirmRef.current)?.focus(), 30);
    // Capture phase on window + stopPropagation: this dialog often opens on
    // top of another modal (Admin Panel), whose own Escape listener would
    // otherwise close both at once.
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onDoneRef.current(null);
    }
    window.addEventListener('keydown', onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [kind]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canConfirm) return;
    onDone(kind === 'prompt' ? text.trim() : '');
  }

  // Portal: rendered inside an animated (transformed) modal, a fixed
  // overlay would be positioned relative to that modal instead of the
  // screen.
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-slate-900/50 px-0 sm:px-4 animate-fade-in" onClick={() => onDone(null)}>
      <form
        onSubmit={submit}
        onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-sm bg-white sm:rounded-card rounded-t-card shadow-modal p-5 animate-zoom-in"
      >
        <div className="flex items-start gap-3">
          {opts.danger && (
            <span className="h-9 w-9 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-slate-900">{opts.title}</h2>
            {opts.message && <p className="text-sm text-slate-500 mt-1">{opts.message}</p>}
          </div>
        </div>

        {kind === 'prompt' && (
          <div className="mt-4">
            {opts.label && <label className="block text-sm font-medium text-slate-700 mb-1">{opts.label}{opts.required && <span className="text-red-500"> *</span>}</label>}
            <textarea
              ref={inputRef}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={opts.placeholder}
              rows={3}
              className="w-full rounded-control border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
          <button type="button" onClick={() => onDone(null)} className="rounded-control px-4 py-2.5 sm:py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 border border-slate-200 sm:border-transparent">
            {t('common.cancel')}
          </button>
          <button
            ref={confirmRef}
            type="submit"
            disabled={!canConfirm}
            className={`rounded-control px-4 py-2.5 sm:py-2 text-sm font-medium text-white disabled:opacity-50 ${opts.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-600 hover:bg-brand-700'}`}
          >
            {opts.confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
