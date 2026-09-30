/**
 * Business rules the admin sets in Admin Panel → Aturan Sistem, instead of
 * numbers buried in code. Stored in public.app_settings (migration 030) as
 * key → JSON value; anything unset falls back to the default here, which is
 * exactly the value that used to be hardcoded.
 *
 * The database reads the Fake GPS keys itself (setting_num / setting_list,
 * with the same defaults), so a change there takes effect on the next check.
 */

export type SettingType = 'number' | 'boolean' | 'flags' | 'account_types' | 'options';

export interface SettingDef {
  key: string;
  group: SettingGroup;
  type: SettingType;
  default: unknown;
  label: { id: string; en: string };
  help?: { id: string; en: string };
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
}

export const SETTING_GROUPS = ['accounts', 'field_gps', 'fake_gps', 'photos', 'lists', 'master'] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

export const SETTING_GROUP_LABELS: Record<SettingGroup, { id: string; en: string; hint: { id: string; en: string } }> = {
  accounts: { id: 'Akun & Login', en: 'Accounts & sign-in', hint: { id: 'Berapa lama tetap masuk, dan siapa yang boleh mendaftar sendiri.', en: 'How long people stay signed in, and who may sign up.' } },
  field_gps: { id: 'GPS Lapangan', en: 'Field GPS', hint: { id: 'Cara aplikasi mengambil lokasi saat Mulai dan Selesai.', en: 'How the app reads location at start and finish.' } },
  fake_gps: { id: 'Deteksi Fake GPS', en: 'Fake GPS detection', hint: { id: 'Batas yang dipakai server untuk menandai lokasi mencurigakan, dan tanda mana yang memblokir.', en: 'Thresholds the server uses to flag a suspicious location, and which flags block.' } },
  photos: { id: 'Foto Bukti', en: 'Photo evidence', hint: { id: 'Ukuran foto yang diunggah dari HP.', en: 'Size of photos uploaded from the phone.' } },
  lists: { id: 'Tampilan & Notifikasi', en: 'Lists & notifications', hint: { id: 'Jumlah baris per halaman dan seberapa sering angka notifikasi diperbarui.', en: 'Rows per page and how often notification counts refresh.' } },
  master: { id: 'Data Master', en: 'Master data', hint: { id: 'Pilihan yang muncul di formulir.', en: 'Choices offered in forms.' } },
};

/** Every GPS flag the server can raise (023–026), for the "which ones block" choice. */
export const GPS_FLAGS = [
  'zero_accuracy', 'frozen_precise', 'frozen', 'sample_jump', 'no_samples', 'mock_provider', 'bad_challenge',
  'stale_reading', 'bad_signature', 'emulator', 'virtual_env', 'rooted', 'integer_accuracy', 'no_altitude', 'impossible_travel',
] as const;
const DEFAULT_BLOCKING = ['zero_accuracy', 'frozen_precise', 'sample_jump', 'no_samples', 'mock_provider', 'bad_challenge', 'stale_reading', 'bad_signature', 'emulator', 'virtual_env'];

export interface PositionOption { value: string; label: string }
export const DEFAULT_POSITIONS: PositionOption[] = [
  { value: 'staff', label: 'Staff' }, { value: 'senior_staff', label: 'Staff Senior' },
  { value: 'supervisor', label: 'Supervisor' }, { value: 'manager', label: 'Manajer' }, { value: 'director', label: 'Direktur' },
];

const n = (key: string, group: SettingGroup, def: number, id: string, en: string, o: Partial<SettingDef> = {}): SettingDef =>
  ({ key, group, type: 'number', default: def, label: { id, en }, ...o });

export const SETTINGS: SettingDef[] = [
  // Accounts & sign-in
  n('session.web_days', 'accounts', 30, 'Lama tetap masuk di browser', 'Stay signed in (browser)', { unit: 'hari', min: 1, max: 365 }),
  n('session.app_days', 'accounts', 365, 'Lama tetap masuk di aplikasi Android', 'Stay signed in (Android app)', { unit: 'hari', min: 1, max: 730,
    help: { id: 'Diperpanjang otomatis setiap aplikasi dibuka, jadi installer tidak pernah keluar sendiri.', en: 'Renewed each time the app opens, so installers are never signed out.' } }),
  { key: 'register.enabled', group: 'accounts', type: 'boolean', default: true, label: { id: 'Halaman Daftar aktif', en: 'Sign-up page enabled' },
    help: { id: 'Semua pendaftaran tetap menunggu persetujuan Admin Aplikasi.', en: 'Every sign-up still waits for an admin’s approval.' } },
  { key: 'register.account_types', group: 'accounts', type: 'account_types', default: ['team', 'sales_admin', 'sales'],
    label: { id: 'Jenis akun yang boleh mendaftar sendiri', en: 'Account types allowed to sign up' } },

  // Field GPS
  n('gps.samples', 'field_gps', 4, 'Jumlah pembacaan lokasi', 'Location readings per capture', { unit: 'kali', min: 1, max: 10,
    help: { id: 'Beberapa pembacaan membantu server membedakan GPS asli dari Fake GPS.', en: 'Several readings help the server tell a real fix from a fake one.' } }),
  n('gps.sample_gap_ms', 'field_gps', 1300, 'Jeda antar pembacaan', 'Gap between readings', { unit: 'ms', min: 300, max: 10000, step: 100 }),
  n('gps.reading_max_age_min', 'field_gps', 10, 'Umur GPS maksimal sebelum Selesai', 'Max age of the GPS reading at completion', { unit: 'menit', min: 1, max: 120 }),

  // Fake GPS detection (read by the database)
  n('gps.challenge_minutes', 'fake_gps', 15, 'Masa berlaku kode pengambilan GPS', 'GPS challenge lifetime', { unit: 'menit', min: 1, max: 120 }),
  n('gps.check_min_samples', 'fake_gps', 3, 'Minimal pembacaan untuk pemeriksaan pola', 'Readings needed for pattern checks', { min: 2, max: 10 }),
  n('gps.frozen_min_span_ms', 'fake_gps', 2500, 'Lokasi “beku”: rentang waktu minimal', 'Frozen location: minimum time span', { unit: 'ms', min: 500, max: 20000, step: 100 }),
  n('gps.frozen_precise_acc_m', 'fake_gps', 10, 'Lokasi “beku” dianggap presisi bila akurasi ≤', 'Frozen counts as precise when accuracy ≤', { unit: 'm', min: 1, max: 100 }),
  n('gps.no_altitude_max_acc_m', 'fake_gps', 20, 'Tanpa ketinggian mencurigakan bila akurasi ≤', 'No altitude is suspicious when accuracy ≤', { unit: 'm', min: 1, max: 200 }),
  n('gps.jump_max_m', 'fake_gps', 300, 'Lompatan lokasi maksimal antar pembacaan', 'Max jump between readings', { unit: 'm', min: 10, max: 10000 }),
  n('gps.jump_window_s', 'fake_gps', 10, '…dalam rentang waktu', '…within', { unit: 'detik', min: 1, max: 120 }),
  n('gps.jump_min_acc_m', 'fake_gps', 50, '…hanya jika akurasi kedua pembacaan ≤', '…only when both readings are accurate to ≤', { unit: 'm', min: 1, max: 500 }),
  n('gps.travel_max_kmh', 'fake_gps', 200, 'Perpindahan mustahil: kecepatan >', 'Impossible travel: speed >', { unit: 'km/jam', min: 20, max: 2000 }),
  n('gps.travel_min_km', 'fake_gps', 20, '…dan jarak >', '…and distance >', { unit: 'km', min: 1, max: 1000 }),
  n('gps.travel_window_hours', 'fake_gps', 6, '…dibanding lokasi terakhir dalam', '…compared with the last location within', { unit: 'jam', min: 1, max: 72 }),
  n('gps.travel_min_acc_m', 'fake_gps', 100, '…yang akurasinya ≤', '…whose accuracy is ≤', { unit: 'm', min: 1, max: 1000 }),
  { key: 'gps.blocking_flags', group: 'fake_gps', type: 'flags', default: DEFAULT_BLOCKING,
    label: { id: 'Tanda yang MEMBLOKIR Mulai/Selesai', en: 'Flags that BLOCK start/finish' },
    help: { id: 'Tanda lain tetap dicatat dan ditampilkan ke peninjau, tapi tidak memblokir.', en: 'Other flags are still recorded and shown to reviewers, but do not block.' } },

  // Photos
  n('photo.max_dim', 'photos', 1600, 'Sisi terpanjang foto', 'Longest side of a photo', { unit: 'px', min: 640, max: 4096, step: 16 }),
  n('photo.quality', 'photos', 75, 'Kualitas JPEG', 'JPEG quality', { unit: '%', min: 30, max: 100 }),
  n('app.max_apk_mb', 'photos', 50, 'Ukuran maksimal berkas APK yang diunggah', 'Max APK upload size', { unit: 'MB', min: 5, max: 200 }),

  // Lists & notifications
  n('list.page_size', 'lists', 15, 'Baris per halaman', 'Rows per page', { min: 5, max: 100 }),
  n('notif.poll_seconds', 'lists', 30, 'Perbarui angka notifikasi setiap', 'Refresh notification counts every', { unit: 'detik', min: 10, max: 600 }),
  n('peek.limit', 'lists', 12, 'Item di kotak informasi header', 'Items in the header info boxes', { min: 3, max: 50 }),

  // Master data
  { key: 'master.positions', group: 'master', type: 'options', default: DEFAULT_POSITIONS, label: { id: 'Daftar Jabatan', en: 'Job titles' },
    help: { id: 'Muncul di halaman Daftar, Profil, dan Panel Admin → Pengguna.', en: 'Offered on sign-up, the profile and Admin Panel → Users.' } },
];

export const SETTING_BY_KEY = new Map(SETTINGS.map(s => [s.key, s]));

export type SettingValues = Record<string, unknown>;

/** The saved value, or the default when unset / of the wrong shape. */
export function readSetting<T>(values: SettingValues, key: string): T {
  const def = SETTING_BY_KEY.get(key);
  const v = values[key];
  if (v === undefined || v === null || !def) return def?.default as T;
  if (def.type === 'number') return (typeof v === 'number' && Number.isFinite(v) ? v : def.default) as T;
  if (def.type === 'boolean') return (typeof v === 'boolean' ? v : def.default) as T;
  if (def.type === 'flags' || def.type === 'account_types') return (Array.isArray(v) ? v : def.default) as T;
  if (def.type === 'options') return (Array.isArray(v) && v.length > 0 ? v : def.default) as T;
  return v as T;
}

export function toValues(rows: { key: string; value: unknown }[] | null | undefined): SettingValues {
  return Object.fromEntries((rows ?? []).map(r => [r.key, r.value]));
}
