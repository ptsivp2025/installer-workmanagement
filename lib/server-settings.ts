import { getAdminClient } from './supabase-admin';
import { readSetting, toValues, type SettingValues } from './settings';

// Server-side reads of Admin Panel → Aturan Sistem. Cached briefly per
// server instance so a login doesn't cost an extra query each time; a change
// in the Admin Panel reaches the server within this window.
const TTL_MS = 30_000;
let cache: { at: number; values: SettingValues } | null = null;

async function values(): Promise<SettingValues> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.values;
  try {
    const { data } = await getAdminClient().from('app_settings').select('key, value');
    cache = { at: Date.now(), values: toValues(data as { key: string; value: unknown }[] | null) };
  } catch {
    // Unreachable or table not created yet (030 not run): defaults.
    cache = { at: Date.now(), values: cache?.values ?? {} };
  }
  return cache.values;
}

export async function getServerSetting<T>(key: string): Promise<T> {
  return readSetting<T>(await values(), key);
}
