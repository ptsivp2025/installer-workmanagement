'use client';

import { useEffect, useState } from 'react';

/**
 * useState that survives leaving the page and coming back in the same tab.
 * A list's search/filter/page used to reset every time someone opened a row
 * and pressed Back — so after checking item 3 on page 2 of "Scheduled ·
 * Installation" they had to rebuild the whole filter to check item 4.
 * sessionStorage (per tab, gone when the tab closes) is enough for that; a
 * blocked or unavailable storage just behaves like plain useState.
 */
export function useSessionState<T>(key: string, initial: T): [T, (v: T) => void] {
  const storageKey = `iwm_list:${key}`;
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* ignore */ }
  }, [storageKey, value]);

  return [value, setValue];
}

/**
 * The value, but only after it has stopped changing for `ms`. Search boxes
 * used to fire one server query per keystroke — and a slow early response
 * could land after a later one, showing results for "ins" under "install".
 */
export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
