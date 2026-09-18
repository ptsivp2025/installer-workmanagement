import { compressImage } from './image-compress';
import { supabase } from './supabase';

const BUCKET = process.env.NEXT_PUBLIC_EVIDENCE_BUCKET || 'activity-evidence';

export async function fetchSignedUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return {};
  const res = await fetch('/api/evidence/signed-urls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: unique }),
  });
  if (!res.ok) return {};
  const { urls } = await res.json();
  return urls ?? {};
}

/**
 * Compresses a full-size + thumbnail variant and uploads both to Storage.
 * The two uploads run in parallel; if only one succeeds, that half is
 * removed before throwing rather than left behind as an orphaned object
 * with no activity_evidence row ever pointing to it.
 */
export async function uploadEvidencePhoto(activityId: string, file: File): Promise<{ storagePath: string; thumbnailPath: string }> {
  const [full, thumb] = await Promise.all([
    compressImage(file, { maxDim: 1600, quality: 0.75 }),
    compressImage(file, { maxDim: 320, quality: 0.6 }),
  ]);

  const id = crypto.randomUUID();
  const storagePath = `${activityId}/${id}.jpg`;
  const thumbnailPath = `${activityId}/thumb_${id}.jpg`;

  const [fullRes, thumbRes] = await Promise.allSettled([
    supabase.storage.from(BUCKET).upload(storagePath, full, { contentType: 'image/jpeg', upsert: false }),
    supabase.storage.from(BUCKET).upload(thumbnailPath, thumb, { contentType: 'image/jpeg', upsert: false }),
  ]);

  const fullOk = fullRes.status === 'fulfilled' && !fullRes.value.error;
  const thumbOk = thumbRes.status === 'fulfilled' && !thumbRes.value.error;

  if (fullOk && thumbOk) return { storagePath, thumbnailPath };

  const orphaned: string[] = [];
  if (fullOk) orphaned.push(storagePath);
  if (thumbOk) orphaned.push(thumbnailPath);
  if (orphaned.length > 0) {
    await supabase.storage.from(BUCKET).remove(orphaned).catch(() => {});
  }

  const failure = !fullOk
    ? (fullRes.status === 'fulfilled' ? fullRes.value.error : fullRes.reason)
    : (thumbRes.status === 'fulfilled' ? thumbRes.value.error : thumbRes.reason);
  throw failure instanceof Error ? failure : new Error('Photo upload failed. Please try again.');
}

/**
 * Deletes storage objects before the activity_evidence row that references
 * them — if storage delete fails, we throw and leave the DB row in place
 * (retryable, and the evidence stays visible) rather than deleting the row
 * first and risking an orphaned file nobody can find again.
 */
export async function deleteEvidencePhoto(storagePath: string, thumbnailPath: string | null): Promise<void> {
  const paths = [storagePath, thumbnailPath].filter((p): p is string => Boolean(p));
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) throw error;
}
