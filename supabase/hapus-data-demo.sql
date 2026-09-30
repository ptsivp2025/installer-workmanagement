-- ════════════════════════════════════════════════════════════════════════════
-- HAPUS DATA DEMO: membersihkan semua yang ditambahkan isi-data-demo.sql.
--
-- Jalankan di Supabase → SQL Editor. Yang dihapus hanya baris ber-ID contoh
-- (a1000000- akun, b1000000- proyek, c1000000- kegiatan) dan semua yang
-- menempel padanya, termasuk kegiatan/tinjauan yang sempat dibuat orang
-- di proyek DEMO-xx. Data asli tidak tersentuh.
--
-- Foto contohnya di Storage dihapus terpisah:
--   node scripts/demo-data/foto-demo.mjs hapus
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- Kegiatan yang sudah selesai dikunci oleh trigger; buka sementara di
-- dalam transaksi ini saja.
ALTER TABLE public.activities         DISABLE TRIGGER USER;
ALTER TABLE public.activity_personnel DISABLE TRIGGER USER;
ALTER TABLE public.activity_evidence  DISABLE TRIGGER USER;
ALTER TABLE public.project_requests   DISABLE TRIGGER USER;
ALTER TABLE public.users              DISABLE TRIGGER USER;

CREATE TEMP TABLE demo_acts ON COMMIT DROP AS
SELECT id FROM public.activities
WHERE id::text LIKE 'c1000000-0000-0000-0000-%' OR project_id::text LIKE 'b1000000-0000-0000-0000-%';

DELETE FROM public.activity_demo_links
WHERE purchase_activity_id IN (SELECT id FROM demo_acts) OR demo_activity_id IN (SELECT id FROM demo_acts);
DELETE FROM public.form_reviews        WHERE activity_id IN (SELECT id FROM demo_acts);
DELETE FROM public.sales_reviews       WHERE activity_id IN (SELECT id FROM demo_acts);
DELETE FROM public.activity_evidence   WHERE activity_id IN (SELECT id FROM demo_acts) OR project_id::text LIKE 'b1000000-0000-0000-0000-%';
DELETE FROM public.activity_gps_events WHERE activity_id IN (SELECT id FROM demo_acts);
DELETE FROM public.activity_personnel  WHERE activity_id IN (SELECT id FROM demo_acts);
DELETE FROM public.audit_logs
WHERE entity_id IN (SELECT id FROM demo_acts)
   OR entity_id::text LIKE 'b1000000-0000-0000-0000-%'
   OR actor_id::text  LIKE 'a1000000-0000-0000-0000-%';
DELETE FROM public.activities WHERE id IN (SELECT id FROM demo_acts);

DELETE FROM public.project_requests
WHERE requested_by::text LIKE 'a1000000-0000-0000-0000-%' OR resulting_project_id::text LIKE 'b1000000-0000-0000-0000-%';
DELETE FROM public.projects WHERE id::text LIKE 'b1000000-0000-0000-0000-%';

-- Akun contoh dan jejaknya.
DELETE FROM public.password_reset_requests WHERE user_id::text LIKE 'a1000000-0000-0000-0000-%';
DELETE FROM public.login_attempts          WHERE username LIKE 'demo.%';
DELETE FROM public.user_sessions           WHERE user_id::text LIKE 'a1000000-0000-0000-0000-%';
DELETE FROM public.user_credentials        WHERE user_id::text LIKE 'a1000000-0000-0000-0000-%';
DELETE FROM public.gps_challenges          WHERE user_id::text LIKE 'a1000000-0000-0000-0000-%';
DELETE FROM public.users                   WHERE id::text LIKE 'a1000000-0000-0000-0000-%';

ALTER TABLE public.activities         ENABLE TRIGGER USER;
ALTER TABLE public.activity_personnel ENABLE TRIGGER USER;
ALTER TABLE public.activity_evidence  ENABLE TRIGGER USER;
ALTER TABLE public.project_requests   ENABLE TRIGGER USER;
ALTER TABLE public.users              ENABLE TRIGGER USER;

SELECT (SELECT count(*) FROM public.projects   WHERE id::text LIKE 'b1000000-0000-0000-0000-%') AS sisa_proyek_demo,
       (SELECT count(*) FROM public.activities WHERE id::text LIKE 'c1000000-0000-0000-0000-%') AS sisa_kegiatan_demo,
       (SELECT count(*) FROM public.users      WHERE id::text LIKE 'a1000000-0000-0000-0000-%') AS sisa_akun_demo;

COMMIT;
