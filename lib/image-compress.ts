/**
 * Resize + re-encode photos in the browser before uploading to Supabase
 * Storage. Phone photos are typically 3000-4000px / 3-8MB even though they
 * only ever get displayed at 400-1200px — compressing here is what keeps
 * Supabase egress/storage and Vercel bandwidth on a free tier viable.
 *
 * Downscales to a max long edge (default 1600px) and re-encodes as JPEG at
 * ~0.75 quality. Non-image files (PDF, etc.) and GIF/SVG pass through
 * untouched, since resizing those would corrupt them.
 */

export interface CompressOptions {
  maxDim?: number;
  quality?: number;
}

const DEFAULT_MAX_DIM = 1600;
const DEFAULT_QUALITY = 0.75;
const SKIP_TYPES = new Set(['image/gif', 'image/svg+xml']);

export async function compressImage(file: File, opts: CompressOptions = {}): Promise<File> {
  if (!file.type.startsWith('image/') || SKIP_TYPES.has(file.type)) return file;

  const maxDim = opts.maxDim ?? DEFAULT_MAX_DIM;
  const quality = opts.quality ?? DEFAULT_QUALITY;

  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;

    if (width <= maxDim && height <= maxDim && file.size <= 400 * 1024) {
      bitmap.close?.();
      return file;
    }

    const scale = Math.min(1, maxDim / Math.max(width, height));
    const targetW = Math.round(width * scale);
    const targetH = Math.round(height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close?.();

    const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) return file;
    if (blob.size >= file.size) return file;

    const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], newName, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
}

export async function compressImages(files: File[], opts?: CompressOptions): Promise<File[]> {
  return Promise.all(files.map(f => compressImage(f, opts)));
}
