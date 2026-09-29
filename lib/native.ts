'use client';

import { isNativeApp } from './geolocation';

/**
 * Hooks into the Installer WM Android app (android/). Every function is a
 * no-op in a normal browser, and in older app builds that don't have the
 * method yet.
 */

let readySent = false;

/**
 * The app shows its own loading screen on every launch and keeps it up
 * until the first screen's data is actually in (spec: don't show a
 * half-loaded page). Called by the login page and by the dashboards once
 * their first load has finished, whether it succeeded or failed.
 */
export function notifyAppReady(): void {
  if (readySent || !isNativeApp()) return;
  readySent = true;
  try { window.IWMNative?.ready?.(); } catch { /* old app build */ }
}

/** "1.3" inside the app, null in a browser. */
export function nativeAppVersion(): string | null {
  if (!isNativeApp()) return null;
  try { return window.IWMNative!.version(); } catch { return null; }
}

export function canCheckAppUpdate(): boolean {
  return isNativeApp() && typeof window.IWMNative?.checkUpdate === 'function';
}

export function checkAppUpdate(): void {
  try { window.IWMNative?.checkUpdate?.(true); } catch { /* old app build */ }
}
