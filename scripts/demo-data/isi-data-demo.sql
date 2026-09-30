-- ════════════════════════════════════════════════════════════════════════════
-- ISI DATA DEMO: contoh lengkap supaya semua menu terlihat terisi.
--
-- Jalankan sekali di Supabase → SQL Editor. Hapus lagi dengan
-- hapus-data-demo.sql. Foto contohnya diunggah/dihapus dengan
-- `node scripts/demo-data/foto-demo.mjs unggah|hapus`.
--
-- Aman untuk data asli:
--  • hanya MENAMBAH baris; semua ID contoh berawalan a1000000- (akun),
--    b1000000- (proyek), c1000000- (kegiatan), dan setiap UPDATE di bawah
--    dibatasi ke ID itu. Data, akun, pengaturan, dan divisi asli tidak diubah.
--  • proyek contoh berkode DEMO-01 … DEMO-08; akun contoh ber-username demo.*
--    dan TIDAK punya kata sandi, jadi tidak bisa dipakai masuk.
--  • semua dalam satu transaksi: kalau ada yang gagal, tidak ada yang tersimpan.
--  • tidak mengirim notifikasi Telegram (itu dikirim aplikasi, bukan database).
--
-- Tanggal dihitung dari hari ini, jadi "Hari Ini" dan "Terlambat" langsung
-- terisi. Nama orang, perusahaan, dan nomor telepon semuanya fiktif.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL TIME ZONE 'Asia/Jakarta';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.users WHERE id = 'a1000000-0000-0000-0000-000000000001')
     OR EXISTS (SELECT 1 FROM public.projects WHERE id = 'b1000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Data demo sudah ada. Jalankan hapus-data-demo.sql dulu kalau ingin mengisi ulang.';
  END IF;
END $$;

-- Data ini ditulis sebagai riwayat yang sudah terjadi, jadi pemeriksaan
-- "saat kerja" (absen GPS, foto wajib, peran) dimatikan sementara, hanya di
-- dalam transaksi ini. Kalau transaksi gagal, ini ikut dibatalkan.
ALTER TABLE public.users              DISABLE TRIGGER USER;
ALTER TABLE public.activities         DISABLE TRIGGER USER;
ALTER TABLE public.activity_personnel DISABLE TRIGGER USER;
ALTER TABLE public.activity_evidence  DISABLE TRIGGER USER;
ALTER TABLE public.project_requests   DISABLE TRIGGER USER;

-- ── Akun contoh (tanpa kata sandi) ─────────────────────────────────────────
CREATE TEMP TABLE demo_div (sales text, code text) ON COMMIT DROP;
INSERT INTO demo_div VALUES ('andi', 'enterprise'), ('sari', 'havs'), ('fajar', 'ivp'), ('lina', 'mvi');
CREATE TEMP TABLE demo_div_id ON COMMIT DROP AS
SELECT d.sales, COALESCE((SELECT id FROM public.sales_divisions s WHERE s.code = d.code),
                         (SELECT id FROM public.sales_divisions ORDER BY sort_order, name LIMIT 1)) AS division_id
FROM demo_div d;

INSERT INTO public.users (id, username, full_name, role, phone, active, sales_division_id, email, position, approval_status, registered_at, created_at)
SELECT v.id::uuid, 'demo.' || v.u, v.full_name, v.role, v.phone, true, dd.division_id, v.email, v.position, v.approval,
       now() - v.age, now() - v.age
FROM (VALUES
 ('a1000000-0000-0000-0000-000000000001', 'rina',   'Rina Kusuma',    'supervisor', '0812-3456-1001', 'rina@contoh.co.id',   'supervisor',   'approved', interval '90 days'),
 ('a1000000-0000-0000-0000-000000000002', 'budi',   'Budi Santoso',   'installer',  '0812-3456-2001', NULL,                  'senior_staff', 'approved', interval '80 days'),
 ('a1000000-0000-0000-0000-000000000003', 'joko',   'Joko Susilo',    'installer',  '0812-3456-2002', NULL,                  'staff',        'approved', interval '80 days'),
 ('a1000000-0000-0000-0000-000000000004', 'agus',   'Agus Wibowo',    'installer',  '0812-3456-2003', NULL,                  'staff',        'approved', interval '60 days'),
 ('a1000000-0000-0000-0000-000000000005', 'rudi',   'Rudi Hartono',   'installer',  '0812-3456-2004', NULL,                  'staff',        'approved', interval '45 days'),
 ('a1000000-0000-0000-0000-000000000006', 'andi',   'Andi Pratama',   'sales',      '0813-7788-3001', 'andi@contoh.co.id',   'staff',        'approved', interval '70 days'),
 ('a1000000-0000-0000-0000-000000000007', 'sari',   'Sari Lestari',   'sales',      '0813-7788-3002', 'sari@contoh.co.id',   'staff',        'approved', interval '70 days'),
 ('a1000000-0000-0000-0000-000000000008', 'fajar',  'Fajar Nugroho',  'sales',      '0813-7788-3003', 'fajar@contoh.co.id',  'staff',        'approved', interval '50 days'),
 ('a1000000-0000-0000-0000-000000000009', 'lina',   'Lina Marlina',   'sales',      '0813-7788-3004', 'lina@contoh.co.id',   'staff',        'approved', interval '50 days'),
 ('a1000000-0000-0000-0000-000000000010', 'hendra', 'Hendra Gunawan', 'reviewer',   '0812-3456-1002', 'hendra@contoh.co.id', 'staff',        'approved', interval '40 days'),
 ('a1000000-0000-0000-0000-000000000011', 'yoga',   'Yoga Pratama',   'installer',  '0812-9900-4411', 'yoga@contoh.co.id',   'staff',        'pending',  interval '20 hours')
) AS v(id, u, full_name, role, phone, email, position, approval, age)
LEFT JOIN demo_div_id dd ON dd.sales = v.u;

INSERT INTO public.password_reset_requests (user_id, username, contact, status, created_at)
VALUES ('a1000000-0000-0000-0000-000000000004', 'demo.agus', '0812-3456-2003', 'pending', now() - interval '3 hours');

-- ── Proyek ──────────────────────────────────────────────────────────────────
CREATE TEMP TABLE p (n int, name text, customer text, address text, lat numeric, lng numeric, status text, sales text, notes text) ON COMMIT DROP;
INSERT INTO p VALUES
 (1, 'Ruang Rapat Direksi Menara Sentosa', 'PT Nusantara Sentosa', 'Menara Sentosa Lt. 32, Jl. Jend. Sudirman Kav. 52, Jakarta Selatan', -6.225300, 106.809000, 'active', 'andi', 'Paket interactive display ruang rapat direksi.'),
 (2, 'Hotel Grand Arunika – Lobby & Ballroom', 'PT Arunika Hospitality', 'Jl. H.R. Rasuna Said Kav. C-11, Kuningan, Jakarta Selatan', -6.229700, 106.831600, 'active', 'sari', 'Digital signage lobby, lanjut ballroom.'),
 (3, 'RS Medika Utama – Nurse Station', 'RS Medika Utama', 'Jl. Letjen S. Parman Kav. 87, Slipi, Jakarta Barat', -6.193500, 106.797600, 'active', 'sari', 'Display informasi pasien di tiap nurse station.'),
 (4, 'Universitas Cendekia – Kelas Hybrid', 'Universitas Cendekia', 'Jl. Margonda Raya No. 100, Depok', -6.362200, 106.824000, 'active', 'fajar', 'Pilot kelas hybrid gedung A.'),
 (5, 'Bank Sejahtera – Video Wall Lobby', 'PT Bank Sejahtera Tbk', 'Jl. M.H. Thamrin No. 5, Jakarta Pusat', -6.192000, 106.823000, 'active', 'andi', 'Video wall 3x3 lobby utama.'),
 (6, 'Command Center Pemkot Harapan', 'Pemerintah Kota Harapan', 'Jl. Ahmad Yani No. 1, Bekasi', -6.234900, 106.989600, 'active', 'lina', 'Dari permintaan proyek sales.'),
 (7, 'Cahaya Plaza – Digital Signage', 'PT Cahaya Plaza Retail', 'Jl. Boulevard Raya, Kelapa Gading, Jakarta Utara', -6.158000, 106.908000, 'on_hold', 'sari', 'Menunggu persetujuan desain tenant.'),
 (8, 'Logistik Samudra – Ruang Operasional', 'PT Logistik Samudra', 'Kawasan Industri Pulogadung, Cakung, Jakarta Timur', -6.185000, 106.936000, 'completed', 'andi', 'Selesai dan diserahterimakan.');

INSERT INTO public.projects (id, code, name, customer_name, address, latitude, longitude, status, notes,
                             expected_completion, created_by, created_at, sales_division_id, sales_person_name, sales_user_id)
SELECT ('b1000000-0000-0000-0000-' || lpad(p.n::text, 12, '0'))::uuid, 'DEMO-' || lpad(p.n::text, 2, '0'), p.name, p.customer, p.address, p.lat, p.lng,
       p.status, 'Data contoh (DEMO). ' || p.notes, current_date + (20 + p.n * 3),
       (SELECT id FROM public.users WHERE username = 'admin' LIMIT 1),
       now() - ((50 - p.n * 3) || ' days')::interval,
       u.sales_division_id, u.full_name, u.id
FROM p JOIN public.users u ON u.username = 'demo.' || p.sales;

-- ── Kegiatan ────────────────────────────────────────────────────────────────
CREATE TEMP TABLE a (n int, proj int, cat text, title text, off int, t time, status text,
                     room text, brand text, typ text, model text, crew text[], pic text, pic_phone text, prio text, notes text) ON COMMIT DROP;
INSERT INTO a VALUES
 -- DEMO-01: survey → demo → bongkar → beli (tertaut, sudah ditagih)
 ( 1, 1, 'survey_meeting', 'Survey ruang rapat direksi',        -24, '10:00', 'completed', 'Ruang Rapat Direksi Lt. 32', NULL, NULL, NULL, '{budi}', 'Ibu Maya', '0811-1000-001', 'normal', 'Ukur dinding & jalur kabel.'),
 ( 2, 1, 'instalasi_demo', 'Demo interactive display 85"',       -20, '09:00', 'completed', 'Ruang Rapat Direksi Lt. 32', 'Samsung', 'Interactive Display', 'WM85B', '{budi,joko}', 'Ibu Maya', '0811-1000-001', 'high', 'Unit demo 2 minggu.'),
 ( 3, 1, 'bongkar_demo',   'Bongkar unit demo',                   -13, '16:00', 'completed', 'Ruang Rapat Direksi Lt. 32', 'Samsung', 'Interactive Display', 'WM85B', '{joko}', 'Ibu Maya', '0811-1000-001', 'normal', NULL),
 ( 4, 1, 'instalasi_beli', 'Instalasi unit pembelian 85"',        -6,  '09:00', 'completed', 'Ruang Rapat Direksi Lt. 32', 'Samsung', 'Interactive Display', 'WM85B', '{budi,joko}', 'Ibu Maya', '0811-1000-001', 'high', 'PO 4500123.'),
 -- DEMO-02: demo → bongkar → beli dengan produk diganti (tertaut, disetujui) + ballroom menyusul
 ( 5, 2, 'instalasi_demo', 'Demo signage lobby utama',            -30, '10:00', 'completed', 'Lobby Utama', 'LG', 'Digital Signage', '55SM5J', '{agus}', 'Bpk. Hadi', '0811-2000-002', 'normal', NULL),
 ( 6, 2, 'bongkar_demo',   'Bongkar signage lobby',               -22, '14:00', 'completed', 'Lobby Utama', 'LG', 'Digital Signage', '55SM5J', '{agus}', 'Bpk. Hadi', '0811-2000-002', 'normal', NULL),
 ( 7, 2, 'instalasi_beli', 'Instalasi signage lobby 65"',         -9,  '10:00', 'completed', 'Lobby Utama', 'LG', 'Digital Signage', '65UH5J', '{agus,rudi}', 'Bpk. Hadi', '0811-2000-002', 'normal', 'Customer upgrade ke 65 inci.'),
 ( 8, 2, 'instalasi_beli', 'Instalasi meeting room Melati',        0,  '13:00', 'in_progress', 'Meeting Room Melati', 'LG', 'Digital Signage', '55UH5J', '{joko}', 'Bpk. Hadi', '0811-2000-002', 'normal', NULL),
 ( 9, 2, 'instalasi_beli', 'Instalasi LED ballroom',               3,  '08:00', 'scheduled', 'Grand Ballroom', 'Samsung', 'LED Wall', 'IE025R', '{budi,joko,agus}', 'Bpk. Hadi', '0811-2000-002', 'urgent', 'Sebelum acara tgl ' || to_char(current_date + 5, 'DD/MM') || '.'),
 -- DEMO-03: demo selesai, beli selesai kemarin (menunggu dipasangkan)
 (10, 3, 'instalasi_demo', 'Demo display nurse station Lt. 5',    -12, '09:30', 'completed', 'Nurse Station Lt. 5', 'Samsung', 'Smart Signage', 'QM55C', '{rudi}', 'Ns. Rahma', '0811-3000-003', 'normal', NULL),
 (11, 3, 'instalasi_beli', 'Instalasi display nurse station Lt. 5', -1, '10:00', 'completed', 'Nurse Station Lt. 5', 'Samsung', 'Smart Signage', 'QM55C', '{rudi}', 'Ns. Rahma', '0811-3000-003', 'normal', NULL),
 (12, 3, 'instalasi_beli', 'Instalasi display nurse station Lt. 6', 0,  '10:00', 'scheduled', 'Nurse Station Lt. 6', 'Samsung', 'Smart Signage', 'QM55C', '{rudi}', 'Ns. Rahma', '0811-3000-003', 'normal', NULL),
 -- DEMO-04: survey selesai, demo hari ini
 (13, 4, 'survey_meeting', 'Survey kelas hybrid A301',            -5,  '13:00', 'completed', 'Kelas Hybrid A301', NULL, NULL, NULL, '{budi}', 'Dr. Irawan', '0811-4000-004', 'normal', NULL),
 (14, 4, 'instalasi_demo', 'Demo interactive panel kelas A301',    0,  '09:00', 'scheduled', 'Kelas Hybrid A301', 'Samsung', 'Interactive Display', 'WAF75', '{budi}', 'Dr. Irawan', '0811-4000-004', 'high', 'Bawa bracket mobile stand.'),
 (15, 4, 'bongkar_demo',   'Bongkar demo kelas A301',              14, '15:00', 'scheduled', 'Kelas Hybrid A301', 'Samsung', 'Interactive Display', 'WAF75', '{budi}', 'Dr. Irawan', '0811-4000-004', 'normal', NULL),
 -- DEMO-05: demo → bongkar → beli (tertaut, belum ditagih)
 (16, 5, 'instalasi_demo', 'Demo video wall 2x2',                 -18, '19:00', 'completed', 'Lobby Utama', 'LG', 'Video Wall', '55VM5J', '{joko,rudi}', 'Bpk. Surya', '0811-5000-005', 'high', 'Kerja malam, setelah jam operasional.'),
 (17, 5, 'bongkar_demo',   'Bongkar video wall demo',             -10, '19:00', 'completed', 'Lobby Utama', 'LG', 'Video Wall', '55VM5J', '{joko,rudi}', 'Bpk. Surya', '0811-5000-005', 'normal', NULL),
 (18, 5, 'instalasi_beli', 'Instalasi video wall 3x3',            -4,  '19:00', 'completed', 'Lobby Utama', 'LG', 'Video Wall', '55VM5J', '{joko,rudi,agus}', 'Bpk. Surya', '0811-5000-005', 'high', NULL),
 (19, 5, 'survey_meeting', 'Survey ruang prioritas lt. 2',          0,  '15:30', 'scheduled', 'Ruang Prioritas Lt. 2', NULL, NULL, NULL, '{agus}', 'Bpk. Surya', '0811-5000-005', 'normal', NULL),
 -- DEMO-06: survey selesai, demo terlambat
 (20, 6, 'survey_meeting', 'Survey ruang command center',          -8, '09:00', 'completed', 'Command Center', NULL, NULL, NULL, '{rudi}', 'Bpk. Taufik', '0811-6000-006', 'normal', NULL),
 (21, 6, 'instalasi_demo', 'Demo video wall command center',       -3, '09:00', 'scheduled', 'Command Center', 'Samsung', 'Video Wall', 'VM55B', '{rudi,agus}', 'Bpk. Taufik', '0811-6000-006', 'urgent', 'Menunggu akses gedung.'),
 (22, 6, 'instalasi_demo', 'Demo display ruang rapat walikota',    2,  '10:00', 'scheduled', 'Ruang Rapat Walikota', 'Samsung', 'Interactive Display', 'WM75B', '{budi}', 'Bpk. Taufik', '0811-6000-006', 'normal', NULL),
 -- DEMO-07 (ditunda): survey terlambat, satu dibatalkan
 (23, 7, 'survey_meeting', 'Survey titik signage atrium',          -2, '11:00', 'scheduled', 'Atrium Lt. 1', NULL, NULL, NULL, '{agus}', 'Ibu Clara', '0811-7000-007', 'normal', NULL),
 (24, 7, 'instalasi_demo', 'Demo signage atrium',                  -1, '10:00', 'cancelled', 'Atrium Lt. 1', 'LG', 'Digital Signage', '49SM5J', '{agus}', 'Ibu Clara', '0811-7000-007', 'low', 'Ditunda oleh tenant.'),
 -- DEMO-08 (selesai): demo → bongkar → beli (tertaut, ditolak)
 (25, 8, 'instalasi_demo', 'Demo display ruang operasional',      -40, '09:00', 'completed', 'Ruang Operasional', 'Samsung', 'Smart Signage', 'QB75C', '{budi}', 'Bpk. Yosef', '0811-8000-008', 'normal', NULL),
 (26, 8, 'bongkar_demo',   'Bongkar demo ruang operasional',      -33, '15:00', 'completed', 'Ruang Operasional', 'Samsung', 'Smart Signage', 'QB75C', '{budi}', 'Bpk. Yosef', '0811-8000-008', 'normal', NULL),
 (27, 8, 'instalasi_beli', 'Instalasi display ruang operasional', -26, '09:00', 'completed', 'Ruang Operasional', 'Samsung', 'Smart Signage', 'QB75C', '{budi,joko}', 'Bpk. Yosef', '0811-8000-008', 'normal', NULL),
 -- Jadwal ke depan
 (28, 1, 'instalasi_demo', 'Demo display ruang rapat Lt. 30',      1,  '09:00', 'scheduled', 'Ruang Rapat Lt. 30', 'Samsung', 'Interactive Display', 'WM65B', '{budi,joko}', 'Ibu Maya', '0811-1000-001', 'normal', NULL),
 (29, 3, 'survey_meeting', 'Survey nurse station Lt. 7',           5,  '10:00', 'scheduled', 'Nurse Station Lt. 7', NULL, NULL, NULL, '{rudi}', 'Ns. Rahma', '0811-3000-003', 'low', NULL),
 (30, 5, 'instalasi_beli', 'Instalasi display ruang prioritas',    7,  '19:00', 'scheduled', 'Ruang Prioritas Lt. 2', 'LG', 'Digital Signage', '55UH5J', '{joko,agus}', 'Bpk. Surya', '0811-5000-005', 'normal', NULL);

INSERT INTO public.activities (id, request_number, project_id, category_id, title, customer_name, location_address,
  scheduled_date, start_time, end_time, priority, status, notes, target_latitude, target_longitude,
  created_by, created_at, pic_name, pic_phone, product_brand, product_type, product_model, room_name, personnel_count)
SELECT ('c1000000-0000-0000-0000-' || lpad(a.n::text, 12, '0'))::uuid,
       'DEMO-' || upper(to_hex((extract(epoch FROM (current_date + a.off + a.t)) * 1000)::bigint + a.n)),
       ('b1000000-0000-0000-0000-' || lpad(a.proj::text, 12, '0'))::uuid,
       c.id, a.title, p.customer, p.address, current_date + a.off, a.t, a.t + interval '3 hours',
       a.prio, a.status, a.notes, p.lat, p.lng,
       CASE WHEN a.n % 3 = 0 THEN 'a1000000-0000-0000-0000-000000000001'::uuid
            ELSE (SELECT id FROM public.users WHERE username = 'admin' LIMIT 1) END,
       (current_date + a.off - 6 + time '10:15') AT TIME ZONE 'Asia/Jakarta',
       a.pic, a.pic_phone, a.brand, a.typ, a.model, a.room, cardinality(a.crew)
FROM a JOIN p ON p.n = a.proj JOIN public.activity_categories c ON c.code = a.cat;

-- Absen mulai & selesai seperti yang dicatat aplikasi: beberapa meter dari
-- titik proyek, akurasi baik.
UPDATE public.activities x SET
  started_at        = (x.scheduled_date + x.start_time - interval '4 minutes') AT TIME ZONE 'Asia/Jakarta',
  start_latitude    = x.target_latitude + 0.00011, start_longitude = x.target_longitude - 0.00007,
  start_accuracy_m  = 6 + (s.n % 5), start_distance_m = 14 + (s.n * 7) % 30, start_gps_flags = '{}'
FROM (SELECT id, row_number() OVER (ORDER BY id) AS n FROM public.activities
      WHERE id::text LIKE 'c1000000-0000-0000-0000-%' AND status IN ('in_progress', 'completed')) s
WHERE s.id = x.id;

UPDATE public.activities x SET
  completed_at = x.started_at + ((95 + (s.n * 17) % 120) || ' minutes')::interval,
  execution_latitude = x.target_latitude - 0.00006, execution_longitude = x.target_longitude + 0.00009,
  gps_accuracy_m = 5 + (s.n % 6), gps_captured_at = x.started_at + ((90 + (s.n * 17) % 120) || ' minutes')::interval,
  distance_from_target_m = 9 + (s.n * 11) % 35, gps_validation_status = 'valid', gps_risk_flags = '{}'
FROM (SELECT id, row_number() OVER (ORDER BY id) AS n FROM public.activities
      WHERE id::text LIKE 'c1000000-0000-0000-0000-%' AND status = 'completed') s
WHERE s.id = x.id;

INSERT INTO public.activity_personnel (activity_id, user_id, name, role, is_primary)
SELECT ('c1000000-0000-0000-0000-' || lpad(a.n::text, 12, '0'))::uuid, u.id, u.full_name,
       CASE WHEN c.ord = 1 THEN 'Ketua tim' ELSE 'Teknisi' END, c.ord = 1
FROM a, unnest(a.crew) WITH ORDINALITY AS c(username, ord) JOIN public.users u ON u.username = 'demo.' || c.username;

CREATE TEMP TABLE demo_act ON COMMIT DROP AS
SELECT x.*, pp.user_id AS lead_id, c.code AS cat_code
FROM public.activities x
JOIN public.activity_categories c ON c.id = x.category_id
JOIN public.activity_personnel pp ON pp.activity_id = x.id AND pp.is_primary
WHERE x.id::text LIKE 'c1000000-0000-0000-0000-%';

INSERT INTO public.activity_gps_events (activity_id, user_id, event_type, latitude, longitude, accuracy_m, distance_m, validation_status, created_at, risk_flags)
SELECT id, lead_id, 'start', start_latitude, start_longitude, start_accuracy_m, start_distance_m, 'valid', started_at, '{}'::text[]
FROM demo_act WHERE started_at IS NOT NULL
UNION ALL
SELECT id, lead_id, 'complete', execution_latitude, execution_longitude, gps_accuracy_m, distance_from_target_m, 'valid', gps_captured_at, '{}'::text[]
FROM demo_act WHERE status = 'completed';
-- Satu installer mencoba absen dari parkiran dulu: ditolak, lalu berhasil.
INSERT INTO public.activity_gps_events (activity_id, user_id, event_type, latitude, longitude, accuracy_m, distance_m, validation_status, created_at, risk_flags)
VALUES ('c1000000-0000-0000-0000-000000000018', 'a1000000-0000-0000-0000-000000000003', 'start',
        -6.194900, 106.823000, 9, 322, 'outside_radius', (current_date - 4 + time '18:48') AT TIME ZONE 'Asia/Jakarta', '{}'::text[]);

-- Foto bukti: berkasnya diunggah oleh foto-demo.mjs ke jalur yang sama.
INSERT INTO public.activity_evidence (activity_id, project_id, uploader_id, storage_path, thumbnail_path, evidence_type, latitude, longitude, uploaded_at)
SELECT x.id, x.project_id, x.lead_id, x.id || '/' || e.img || '.jpg', x.id || '/' || e.img || '.jpg', 'completion',
       x.execution_latitude, x.execution_longitude, x.completed_at - ((10 - e.k) || ' minutes')::interval
FROM demo_act x
CROSS JOIN LATERAL (
  SELECT k, (CASE x.cat_code
      WHEN 'survey_meeting' THEN ARRAY['survey-1', 'survey-2']
      WHEN 'bongkar_demo'   THEN ARRAY['bongkar-1', 'bongkar-2']
      ELSE ARRAY['pasang-' || (1 + (ascii(right(x.id::text, 1)) % 3)), 'unit-' || (1 + (ascii(right(x.id::text, 1)) % 3)), 'serah-terima-1']
    END)[k] AS img
  FROM generate_series(1, CASE x.cat_code WHEN 'survey_meeting' THEN 2 WHEN 'bongkar_demo' THEN 2 ELSE 3 END) k
) e
WHERE x.status = 'completed';

-- ── Tinjauan ────────────────────────────────────────────────────────────────
INSERT INTO public.form_reviews (activity_id, status, reviewer_id, reviewed_at, notes, created_at)
SELECT x.id,
       CASE WHEN x.id = 'c1000000-0000-0000-0000-000000000017' THEN 'rejected'
            WHEN x.completed_at < now() - interval '7 days' THEN 'approved' ELSE 'pending' END,
       CASE WHEN x.completed_at < now() - interval '7 days' THEN 'a1000000-0000-0000-0000-000000000001'::uuid END,
       CASE WHEN x.completed_at < now() - interval '7 days' THEN x.completed_at + interval '20 hours' END,
       CASE WHEN x.id = 'c1000000-0000-0000-0000-000000000017' THEN 'Foto unit setelah dibongkar kurang jelas, mohon unggah ulang.'
            WHEN x.completed_at < now() - interval '7 days' THEN 'Foto dan titik GPS sesuai.' END,
       x.completed_at
FROM demo_act x WHERE x.status = 'completed';

INSERT INTO public.sales_reviews (activity_id, status, rating, comment, reviewer_id, reviewed_at, created_at)
SELECT x.id,
       CASE WHEN x.completed_at < now() - interval '5 days' THEN 'submitted' ELSE 'pending' END,
       CASE WHEN x.completed_at < now() - interval '5 days' THEN 4 + (ascii(right(x.id::text, 1)) % 2) END,
       CASE WHEN x.completed_at < now() - interval '5 days' THEN
         (ARRAY['Rapi, kabel tertata dan customer puas.', 'Tepat waktu, customer langsung bisa pakai.', 'Tim sigap, penjelasan ke user jelas.'])[1 + ascii(right(x.id::text, 1)) % 3] END,
       CASE WHEN x.completed_at < now() - interval '5 days' THEN pr.sales_user_id END,
       CASE WHEN x.completed_at < now() - interval '5 days' THEN x.completed_at + interval '1 day' END,
       x.completed_at
FROM demo_act x JOIN public.projects pr ON pr.id = x.project_id WHERE x.status = 'completed';

-- ── Demo → Beli ─────────────────────────────────────────────────────────────
INSERT INTO public.activity_demo_links (purchase_activity_id, demo_activity_id, match_reason, billing_status, billing_note, confirmed_by, confirmed_at)
SELECT v.purchase::uuid, v.demo::uuid, v.reason, v.billing, v.note,
       CASE WHEN v.by_admin THEN (SELECT id FROM public.users WHERE username = 'admin' LIMIT 1) ELSE 'a1000000-0000-0000-0000-000000000001'::uuid END,
       now() - v.ago
FROM (VALUES
 ('c1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000002', 'room_and_product', 'billed',     'Ditagih ke installer via email.',   true,  interval '4 days'),
 ('c1000000-0000-0000-0000-000000000007', 'c1000000-0000-0000-0000-000000000005', 'room',             'accepted',   'Diskon kunjungan kedua disetujui.', false, interval '7 days'),
 ('c1000000-0000-0000-0000-000000000018', 'c1000000-0000-0000-0000-000000000016', 'room_and_product', 'not_billed', NULL,                                true,  interval '2 days'),
 ('c1000000-0000-0000-0000-000000000027', 'c1000000-0000-0000-0000-000000000025', 'room_and_product', 'rejected',   'Ditolak: lewat masa berlaku promo.', false, interval '20 days')
) AS v(purchase, demo, reason, billing, note, by_admin, ago);

-- ── Permintaan proyek dari Sales ───────────────────────────────────────────
INSERT INTO public.project_requests (requested_by, sales_division_id, project_name, customer_name, customer_phone, address, latitude, longitude,
                                     category_id, requested_date, notes, status, reviewed_by, reviewed_at, rejection_reason, resulting_project_id, created_at)
SELECT u.id, u.sales_division_id, '[DEMO] ' || r.name, r.customer, r.phone, r.address, r.lat, r.lng,
       (SELECT id FROM public.activity_categories WHERE code = r.cat), current_date + r.req_off, r.notes, r.status,
       CASE WHEN r.status <> 'pending' THEN (SELECT id FROM public.users WHERE username = 'admin' LIMIT 1) END,
       CASE WHEN r.status <> 'pending' THEN now() - ((r.created_off - 1) || ' days')::interval END,
       r.reason, r.result, now() - (r.created_off || ' days')::interval - interval '2 hours'
FROM (VALUES
  ('andi',  'Bank Sejahtera – Kantor Cabang Bandung', 'PT Bank Sejahtera Tbk', '0811-5000-005', 'Jl. Asia Afrika No. 88, Bandung', -6.921500, 107.607100, 'instalasi_demo', 6, 'Demo 2 unit display teller.', 'pending', NULL, NULL::uuid, 1),
  ('sari',  'Hotel Grand Arunika Bali – Meeting Room', 'PT Arunika Hospitality', '0811-2000-002', 'Jl. Pantai Kuta No. 9, Badung, Bali', -8.718400, 115.168600, 'survey_meeting', 9, 'Survey 4 meeting room.', 'pending', NULL, NULL, 0),
  ('lina',  'Command Center Pemkot Harapan', 'Pemerintah Kota Harapan', '0811-6000-006', 'Jl. Ahmad Yani No. 1, Bekasi', -6.234900, 106.989600, 'survey_meeting', -9, NULL, 'approved', NULL, 'b1000000-0000-0000-0000-000000000006'::uuid, 12),
  ('fajar', 'SMA Bina Bangsa – Lab Multimedia', 'Yayasan Bina Bangsa', '0811-9000-009', 'Jl. Pemuda No. 20, Semarang', -6.982500, 110.409200, 'instalasi_demo', 3, NULL, 'rejected', 'Di luar area layanan, diteruskan ke mitra Semarang.', NULL, 6)
) AS r(sales, name, customer, phone, address, lat, lng, cat, req_off, notes, status, reason, result, created_off)
JOIN public.users u ON u.username = 'demo.' || r.sales;

-- ── Riwayat aktivitas ───────────────────────────────────────────────────────
INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, meta, created_at)
SELECT created_by, 'activity.created', 'activity', id, jsonb_build_object('title', title), created_at FROM demo_act
UNION ALL
SELECT lead_id, 'activity.started', 'activity', id, jsonb_build_object('title', title), started_at FROM demo_act WHERE started_at IS NOT NULL
UNION ALL
SELECT lead_id, 'activity.completed', 'activity', id, jsonb_build_object('title', title), completed_at FROM demo_act WHERE completed_at IS NOT NULL
UNION ALL
SELECT f.reviewer_id, CASE f.status WHEN 'approved' THEN 'review.approved' ELSE 'review.rejected' END, 'activity', f.activity_id,
       jsonb_build_object('notes', f.notes), f.reviewed_at
FROM public.form_reviews f
WHERE f.activity_id::text LIKE 'c1000000-0000-0000-0000-%' AND f.status IN ('approved', 'rejected');

ALTER TABLE public.users              ENABLE TRIGGER USER;
ALTER TABLE public.activities         ENABLE TRIGGER USER;
ALTER TABLE public.activity_personnel ENABLE TRIGGER USER;
ALTER TABLE public.activity_evidence  ENABLE TRIGGER USER;
ALTER TABLE public.project_requests   ENABLE TRIGGER USER;

SELECT (SELECT count(*) FROM public.projects   WHERE id::text LIKE 'b1000000-0000-0000-0000-%') AS proyek_demo,
       (SELECT count(*) FROM public.activities WHERE id::text LIKE 'c1000000-0000-0000-0000-%') AS kegiatan_demo,
       (SELECT count(*) FROM public.users      WHERE id::text LIKE 'a1000000-0000-0000-0000-%') AS akun_demo,
       (SELECT count(*) FROM public.activity_evidence WHERE activity_id::text LIKE 'c1000000-0000-0000-0000-%') AS foto_demo;

COMMIT;
