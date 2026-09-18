'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchSignedUrls } from './evidence';

/**
 * Fetches signed URLs for a batch of storage paths and tracks a distinct
 * "the whole batch failed" error state with a retry — without this, a
 * transient network failure leaves each thumbnail's loading spinner
 * spinning forever with no way for the viewer to recover except a full
 * page reload.
 */
export function useSignedUrls(paths: string[]): { urls: Record<string, string>; error: boolean; retry: () => void } {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const key = paths.join('|');

  useEffect(() => {
    if (paths.length === 0) {
      setUrls({});
      setError(false);
      return;
    }
    let cancelled = false;
    setError(false);
    fetchSignedUrls(paths).then(result => {
      if (cancelled) return;
      setUrls(result);
      setError(Object.keys(result).length === 0);
    });
    return () => { cancelled = true; };
    // key mirrors the paths array's content; paths itself is a new array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt(a => a + 1), []);
  return { urls, error, retry };
}
