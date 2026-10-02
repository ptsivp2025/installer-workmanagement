// Menghapus SEMUA berkas foto bukti di bucket activity-evidence (Storage),
// pasangan dari kosongkan-data-operasional.sql. Berkas APK tidak disentuh.
//
//   node scripts/reset/kosongkan-storage.mjs          → hanya menghitung
//   node scripts/reset/kosongkan-storage.mjs --hapus  → benar-benar menghapus
//
// Memakai NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY dari .env.local.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(here, '..', '..', '.env.local'), 'utf8').split(/\r?\n/)
    .map(l => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/)).filter(Boolean).map(m => [m[1], m[2]]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum ada di .env.local'); process.exit(1); }
const BUCKET = env.NEXT_PUBLIC_EVIDENCE_BUCKET || 'activity-evidence';
const auth = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };

/** Every object path under a prefix (folders are one per activity). */
async function list(prefix = '') {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${URL_}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST', headers: auth, body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!r.ok) throw new Error(`list ${prefix}: ${r.status} ${await r.text()}`);
    const rows = await r.json();
    for (const row of rows) {
      const path = prefix ? `${prefix}/${row.name}` : row.name;
      if (row.id === null) out.push(...await list(path)); // a folder
      else out.push(path);
    }
    if (rows.length < 1000) return out;
  }
}

const paths = await list();
console.log(`${paths.length} berkas foto di ${BUCKET}.`);
if (!process.argv.includes('--hapus')) {
  console.log('Belum ada yang dihapus. Jalankan lagi dengan --hapus untuk menghapus semuanya.');
  process.exit(0);
}
let removed = 0;
for (let i = 0; i < paths.length; i += 100) {
  const r = await fetch(`${URL_}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: auth, body: JSON.stringify({ prefixes: paths.slice(i, i + 100) }) });
  if (r.ok) removed += (await r.json()).length; else console.error('gagal', r.status, await r.text());
}
console.log(`${removed} berkas foto dihapus dari ${BUCKET}.`);
