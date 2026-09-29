'use client';

/**
 * Photos taken with no signal wait here (IndexedDB, on the device) instead
 * of failing. Installers regularly shoot evidence in basements, plant rooms
 * and new builds with no reception. Before, the upload just errored, and
 * the only "retry" lived in page memory: navigating away or reloading lost
 * the photos. Queued files survive reloads and closing the tab, and
 * EvidencePanel uploads them on its own once the browser is back online.
 *
 * Only the photo upload is queued. Completing an activity still needs a
 * connection, because the server has to check GPS/evidence at that moment.
 */

export interface QueuedPhoto {
  id: number;
  activityId: string;
  file: Blob;
  queuedAt: number;
}

const DB_NAME = 'iwm_offline';
const STORE = 'evidence_queue';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      store.createIndex('activityId', 'activityId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  }));
}

export async function queuePhotos(activityId: string, files: Blob[]): Promise<void> {
  for (const file of files) {
    await run('readwrite', store => store.add({ activityId, file, queuedAt: Date.now() }));
  }
}

export async function listQueuedPhotos(activityId: string): Promise<QueuedPhoto[]> {
  const all = await run<QueuedPhoto[]>('readonly', store => store.index('activityId').getAll(activityId));
  return all.sort((a, b) => a.queuedAt - b.queuedAt);
}

export async function removeQueuedPhoto(id: number): Promise<void> {
  await run('readwrite', store => store.delete(id));
}

/** Upload failed because there's no connection, not because the server said no. */
export function isOfflineError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e ?? '');
  return /failed to fetch|networkerror|network request failed|load failed/i.test(msg);
}
