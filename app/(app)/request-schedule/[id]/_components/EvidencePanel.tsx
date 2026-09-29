'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Trash2, Loader2, AlertTriangle, RefreshCw, X, ImagePlus, CloudOff } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/utils';
import { useAuth, useLanguage } from '@/app/providers';
import type { ActivityEvidence } from '@/lib/types';
import { uploadEvidencePhoto, deleteEvidencePhoto, fetchSignedUrls } from '@/lib/evidence';
import { useSignedUrls } from '@/lib/useSignedUrls';
import { queuePhotos, listQueuedPhotos, removeQueuedPhoto, isOfflineError, type QueuedPhoto } from '@/lib/evidence-queue';
import { useOnlineStatus } from '@/lib/useOnlineStatus';
import { useDialog } from '@/components/shared/ConfirmDialog';

export function EvidencePanel({
  activityId, projectId, evidence, locked, minRequired, onChanged, cameraOnly = false,
}: {
  activityId: string; projectId: string; evidence: ActivityEvidence[]; locked: boolean; minRequired: number; onChanged: () => void;
  /** GPS-verified categories: fresh camera shots only, no gallery. */
  cameraOnly?: boolean;
}) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { confirm: askConfirm, dialog } = useDialog();
  const { urls: thumbs, error: thumbsError, retry: retryThumbs } = useSignedUrls(evidence.map(e => e.thumbnail_path ?? e.storage_path));
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [retryFiles, setRetryFiles] = useState<File[] | null>(null);
  const [preview, setPreview] = useState<{ url: string | null } | null>(null);
  const [queued, setQueued] = useState<QueuedPhoto[]>([]);
  const online = useOnlineStatus();
  const flushing = useRef(false);

  const refreshQueue = useCallback(async () => {
    try { setQueued(await listQueuedPhotos(activityId)); } catch { setQueued([]); }
  }, [activityId]);

  useEffect(() => { refreshQueue(); }, [refreshQueue]);

  async function uploadOne(file: File) {
    const { storagePath, thumbnailPath } = await uploadEvidencePhoto(activityId, file);
    const { error: err } = await supabase.from('activity_evidence').insert({
      activity_id: activityId, project_id: projectId, uploader_id: user?.id ?? null,
      storage_path: storagePath, thumbnail_path: thumbnailPath, evidence_type: 'completion',
    });
    if (err) throw err;
  }

  /** Keeps photos on the device when there's no signal; true if it could. */
  async function keepForLater(files: File[]): Promise<boolean> {
    try {
      await queuePhotos(activityId, files);
      await refreshQueue();
      return true;
    } catch {
      return false; // no IndexedDB (private mode): fall back to in-page retry
    }
  }

  async function uploadFiles(files: File[]) {
    setUploadError(null);
    setRetryFiles(null);
    if (!navigator.onLine && await keepForLater(files)) return;

    setUploading(true);
    const failedHere: File[] = [];
    let uploadedAny = false;
    for (let i = 0; i < files.length; i++) {
      setUploadProgress({ done: i, total: files.length });
      try {
        await uploadOne(files[i]);
        uploadedAny = true;
      } catch (e) {
        // Signal dropped mid-batch: park this one and everything after it
        // on the device rather than failing them one by one.
        if (isOfflineError(e) && await keepForLater(files.slice(i))) break;
        failedHere.push(files[i]);
        setUploadError(
          files.length === 1
            ? errorMessage(e, t('evidence.uploadFailed'))
            : t('evidence.someFailed', { failed: failedHere.length, total: files.length }),
        );
      }
    }
    setUploadProgress(null);
    setUploading(false);
    if (failedHere.length > 0) setRetryFiles(failedHere);
    // Reloading with no signal would fail and swap the whole activity page
    // for an error screen, the queued-photos notice included.
    if (uploadedAny && navigator.onLine) onChanged();
  }

  const flushQueue = useCallback(async () => {
    if (flushing.current || !navigator.onLine) return;
    flushing.current = true;
    setUploading(true);
    let uploaded = 0;
    try {
      const items = await listQueuedPhotos(activityId);
      for (let i = 0; i < items.length; i++) {
        setUploadProgress({ done: i, total: items.length });
        const { id, file } = items[i];
        const asFile = file instanceof File ? file : new File([file], `photo-${id}.jpg`, { type: file.type || 'image/jpeg' });
        try {
          await uploadOne(asFile);
          await removeQueuedPhoto(id);
          uploaded++;
        } catch (e) {
          if (isOfflineError(e)) break; // still no signal; try again on the next 'online'
          setUploadError(errorMessage(e, t('evidence.uploadFailed')));
        }
      }
    } catch { /* IndexedDB unavailable */ }
    setUploadProgress(null);
    setUploading(false);
    flushing.current = false;
    await refreshQueue();
    if (uploaded > 0 && navigator.onLine) onChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uploadOne/onChanged are recreated every render; the queue itself is re-read from IndexedDB on each run
  }, [activityId, refreshQueue]);

  // Back online (or opened with a queue waiting): upload what's parked.
  useEffect(() => {
    if (online && queued.length > 0 && !locked) flushQueue();
  }, [online, queued.length, locked, flushQueue]);

  async function discardQueue() {
    if (!(await askConfirm({ title: t('evidence.discardQueuedConfirm', { count: queued.length }), confirmLabel: t('common.delete'), danger: true }))) return;
    try { for (const q of queued) await removeQueuedPhoto(q.id); } catch { /* ignore */ }
    await refreshQueue();
  }

  function handleFiles(input: HTMLInputElement) {
    const files = Array.from(input.files ?? []);
    input.value = ''; // so picking the same photo again still fires onChange
    if (files.length === 0) return;
    uploadFiles(files);
  }

  // Full-size on tap — thumbnails are 320px, too small to check a
  // serial-number sticker or a cable run. Fetched only when asked for.
  async function openPreview(item: ActivityEvidence) {
    setPreview({ url: null });
    const urls = await fetchSignedUrls([item.storage_path]);
    const url = urls[item.storage_path] ?? thumbs[item.thumbnail_path ?? item.storage_path] ?? null;
    if (!url) { setPreview(null); setUploadError(t('evidence.couldNotLoadPreviews')); return; }
    setPreview({ url });
  }

  async function handleDelete(item: ActivityEvidence) {
    if (!(await askConfirm({ title: t('evidence.deleteConfirm'), confirmLabel: t('common.delete'), danger: true }))) return;
    try {
      await deleteEvidencePhoto(item.storage_path, item.thumbnail_path);
    } catch {
      setUploadError(t('evidence.deleteFailed'));
      return;
    }
    const { error: err } = await supabase.from('activity_evidence').delete().eq('id', item.id);
    if (err) return;
    onChanged();
  }

  const canDelete = (item: ActivityEvidence) => !locked && (user?.role === 'admin' || user?.role === 'supervisor' || item.uploader_id === user?.id);

  return (
    <div id="evidence" className="bg-white rounded-card border border-slate-200 shadow-card p-5 scroll-mt-32">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2"><Camera className="h-4 w-4" /> {t('evidence.title')}</h3>
        <span className={`text-sm font-medium ${evidence.length < minRequired ? 'text-amber-600' : 'text-slate-500'}`}>
          {evidence.length} {evidence.length === 1 ? t('evidence.photo') : t('evidence.photos2')}{minRequired > 0 ? ` (${t('evidence.min')} ${minRequired})` : ''}
        </span>
      </div>

      {evidence.length === 0 ? (
        <p className="text-sm text-slate-400 py-3">{t('evidence.noneUploaded')}</p>
      ) : (
        <>
          {thumbsError && (
            <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-control px-3 py-1.5 mb-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">{t('evidence.couldNotLoadPreviews')}</span>
              <button onClick={retryThumbs} className="inline-flex items-center gap-1 font-medium underline">
                <RefreshCw className="h-3 w-3" /> {t('evidence.retry')}
              </button>
            </div>
          )}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-3">
            {evidence.map(item => (
              <div key={item.id} className="relative aspect-square rounded-control overflow-hidden bg-slate-100 group">
                {thumbs[item.thumbnail_path ?? item.storage_path] ? (
                  <button type="button" onClick={() => openPreview(item)} className="h-full w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumbs[item.thumbnail_path ?? item.storage_path]} alt="Evidence" className="h-full w-full object-cover" loading="lazy" />
                  </button>
                ) : (
                  <div className="h-full w-full flex items-center justify-center">
                    {!thumbsError && <Loader2 className="h-4 w-4 animate-spin text-slate-300" />}
                  </div>
                )}
                {canDelete(item) && (
                  <button onClick={() => handleDelete(item)} aria-label={t('common.delete')} className="absolute top-1 right-1 h-7 w-7 rounded-full bg-slate-900/60 text-white flex items-center justify-center [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {uploadError && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-control px-3 py-2 mb-3">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{uploadError}</span>
          {retryFiles && (
            <button onClick={() => uploadFiles(retryFiles)} className="underline font-medium shrink-0">
              {t('evidence.retry')}
            </button>
          )}
        </div>
      )}

      {queued.length > 0 && (
        <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-control px-3 py-2.5 mb-3">
          <CloudOff className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="flex-1">
            {t('evidence.queuedCount', { count: queued.length })}
            <span className="block text-xs text-amber-700/80 mt-0.5">{online ? t('evidence.queuedOnlineHint') : t('evidence.queuedOfflineHint')}</span>
          </span>
          {!uploading && (
            <span className="flex flex-col items-end gap-1 shrink-0">
              {online && !locked && <button onClick={flushQueue} className="underline font-medium">{t('evidence.uploadNow')}</button>}
              <button onClick={discardQueue} className="text-xs text-amber-700/80 underline">{t('evidence.discardQueued')}</button>
            </span>
          )}
        </div>
      )}

      {!locked && (
        uploading ? (
          <p className="inline-flex items-center gap-2 px-1 py-2.5 text-sm font-medium text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            {uploadProgress ? t('evidence.uploadingProgress', { done: uploadProgress.done + 1, total: uploadProgress.total }) : t('evidence.uploading')}
          </p>
        ) : (
          // Camera for a fresh shot on site; gallery for photos taken
          // earlier. capture= forces the camera on Android, so the two need
          // separate inputs. Where the category requires GPS, gallery is off:
          // an old photo plus a faked location is exactly the fraud the GPS
          // check exists to stop. (No signal is covered by the offline queue,
          // which takes camera photos too.)
          <div className="flex flex-col sm:flex-row gap-2">
            <label className="inline-flex items-center justify-center gap-2 rounded-control bg-brand-600 text-white px-4 py-2.5 text-sm font-medium hover:bg-brand-700 cursor-pointer">
              <Camera className="h-4 w-4" /> {t('evidence.takePhoto')}
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => handleFiles(e.currentTarget)} />
            </label>
            {!cameraOnly && (
              <label className="inline-flex items-center justify-center gap-2 rounded-control border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 cursor-pointer">
                <ImagePlus className="h-4 w-4" /> {t('evidence.fromGallery')}
                <input type="file" accept="image/*" multiple className="hidden" onChange={e => handleFiles(e.currentTarget)} />
              </label>
            )}
          </div>
        )
      )}

      {preview && createPortal(
        <div className="fixed inset-0 z-[70] bg-slate-950/90 flex items-center justify-center p-4 animate-fade-in" onClick={() => setPreview(null)}>
          <button onClick={() => setPreview(null)} aria-label={t('common.close')} className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/10 text-white flex items-center justify-center">
            <X className="h-5 w-5" />
          </button>
          {preview.url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={preview.url} alt="Evidence" className="max-h-full max-w-full object-contain rounded" />
            : <Loader2 className="h-8 w-8 animate-spin text-white/70" />}
        </div>,
        document.body,
      )}
      {dialog}
    </div>
  );
}
