'use client';

import { useRef, useState } from 'react';
import { Camera, Trash2, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth, useLanguage } from '@/app/providers';
import type { ActivityEvidence } from '@/lib/types';
import { uploadEvidencePhoto, deleteEvidencePhoto } from '@/lib/evidence';
import { useSignedUrls } from '@/lib/useSignedUrls';

export function EvidencePanel({
  activityId, projectId, evidence, locked, minRequired, onChanged,
}: { activityId: string; projectId: string; evidence: ActivityEvidence[]; locked: boolean; minRequired: number; onChanged: () => void }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const { urls: thumbs, error: thumbsError, retry: retryThumbs } = useSignedUrls(evidence.map(e => e.thumbnail_path ?? e.storage_path));
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [retryFiles, setRetryFiles] = useState<File[] | null>(null);

  async function uploadFiles(files: File[]) {
    setUploading(true);
    setUploadError(null);
    setRetryFiles(null);
    const failedHere: File[] = [];
    for (let i = 0; i < files.length; i++) {
      setUploadProgress({ done: i, total: files.length });
      const file = files[i];
      try {
        const { storagePath, thumbnailPath } = await uploadEvidencePhoto(activityId, file);
        const { error: err } = await supabase.from('activity_evidence').insert({
          activity_id: activityId, project_id: projectId, uploader_id: user?.id ?? null,
          storage_path: storagePath, thumbnail_path: thumbnailPath, evidence_type: 'completion',
        });
        if (err) throw err;
      } catch (e) {
        failedHere.push(file);
        setUploadError(
          files.length === 1
            ? (e instanceof Error ? e.message : t('evidence.uploadFailed'))
            : t('evidence.someFailed', { failed: failedHere.length, total: files.length }),
        );
      }
    }
    setUploadProgress(null);
    setUploading(false);
    if (inputRef.current) inputRef.current.value = '';
    if (failedHere.length > 0) setRetryFiles(failedHere);
    onChanged();
  }

  function handleFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    uploadFiles(files);
  }

  async function handleDelete(item: ActivityEvidence) {
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
    <div className="bg-white rounded-card border border-slate-200 shadow-card p-5">
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
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbs[item.thumbnail_path ?? item.storage_path]} alt="Evidence" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center">
                    {!thumbsError && <Loader2 className="h-4 w-4 animate-spin text-slate-300" />}
                  </div>
                )}
                {canDelete(item) && (
                  <button onClick={() => handleDelete(item)} className="absolute top-1 right-1 h-6 w-6 rounded-full bg-slate-900/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                    <Trash2 className="h-3 w-3" />
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

      {!locked && (
        <label className="inline-flex items-center gap-2 rounded-control border border-dashed border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 cursor-pointer">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          {uploading ? (uploadProgress ? t('evidence.uploadingProgress', { done: uploadProgress.done + 1, total: uploadProgress.total }) : t('evidence.uploading')) : t('evidence.addPhotos')}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={e => handleFiles(e.target.files)}
          />
        </label>
      )}
    </div>
  );
}
