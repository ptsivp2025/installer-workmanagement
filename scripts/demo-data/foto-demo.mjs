// Foto bukti untuk data demo (isi-data-demo.sql), di bucket activity-evidence.
//
//   node scripts/demo-data/foto-demo.mjs unggah   → unggah semua foto contoh
//   node scripts/demo-data/foto-demo.mjs hapus    → hapus semuanya lagi
//
// Memakai NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY dari
// .env.local. Gambarnya ilustrasi (bukan foto pelanggan) di folder foto/.
// Jalurnya sama persis dengan yang ditulis isi-data-demo.sql:
// <id kegiatan>/<nama>.jpg.
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
const BUCKET = 'activity-evidence';
const auth = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// Kegiatan demo yang selesai (nomor, kategori) — sama dengan isi-data-demo.sql.
const DONE = [[1, 'survey'], [2, 'pasang'], [3, 'bongkar'], [4, 'pasang'], [5, 'pasang'], [6, 'bongkar'], [7, 'pasang'],
  [10, 'pasang'], [11, 'pasang'], [13, 'survey'], [16, 'pasang'], [17, 'bongkar'], [18, 'pasang'], [20, 'survey'],
  [25, 'pasang'], [26, 'bongkar'], [27, 'pasang']];
const files = DONE.flatMap(([n, kind]) => {
  const id = `c1000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const v = 1 + ((48 + (n % 10)) % 3); // = 1 + ascii(last char of id) % 3, as in the SQL
  const imgs = kind === 'survey' ? ['survey-1', 'survey-2'] : kind === 'bongkar' ? ['bongkar-1', 'bongkar-2'] : [`pasang-${v}`, `unit-${v}`, 'serah-terima-1'];
  return imgs.map(img => ({ path: `${id}/${img}.jpg`, img }));
});

const cmd = process.argv[2];
if (cmd === 'unggah') {
  let ok = 0;
  for (const f of files) {
    const r = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${f.path}`, {
      method: 'POST', headers: { ...auth, 'content-type': 'image/jpeg', 'x-upsert': 'true' },
      body: readFileSync(join(here, 'foto', `${f.img}.jpg`)),
    });
    if (r.ok) ok++; else console.error('gagal', f.path, r.status, await r.text());
  }
  console.log(`${ok}/${files.length} foto contoh terunggah ke ${BUCKET}.`);
} else if (cmd === 'hapus') {
  const r = await fetch(`${URL_}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ prefixes: files.map(f => f.path) }),
  });
  const out = await r.json().catch(() => []);
  console.log(r.ok ? `${Array.isArray(out) ? out.length : 0} foto contoh dihapus dari ${BUCKET}.` : `gagal: ${r.status} ${JSON.stringify(out)}`);
} else {
  console.log('Pakai: node scripts/demo-data/foto-demo.mjs unggah|hapus');
}
