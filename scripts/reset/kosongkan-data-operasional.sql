-- ════════════════════════════════════════════════════════════════════════════
-- KOSONGKAN DATA OPERASIONAL: mulai production dari nol.
--
-- Menghapus SEMUA data kerja, demo maupun asli:
--   proyek, kegiatan (jadwal), personel, foto bukti (barisnya), GPS,
--   Tinjauan Formulir, Ulasan Sales, tautan Demo→Beli, Permintaan Proyek,
--   Riwayat Aktivitas, percobaan login, permintaan reset sandi, kode GPS.
--
-- Yang TETAP ada:
--   akun Admin Aplikasi, Kategori Kegiatan, Divisi Sales, Pengaturan Akun,
--   Aturan Sistem, Notifikasi/Telegram, rilis APK, kunci GPS APK.
--   Akun lain (Team / Admin Sales / Sales Proyek): ikut aturan v_hapus_akun
--   di bawah. Akun demo (demo.*) selalu dihapus.
--
-- Berkas foto di Storage dihapus terpisah:
--   node scripts/reset/kosongkan-storage.mjs
--
-- TIDAK BISA DIBATALKAN. Backup dulu (Supabase → Database → Backups).
-- Pengaman: ganti v_yakin menjadi true sebelum menjalankan.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

DO $$
DECLARE
  v_yakin     boolean := false;  -- ← ganti ke true kalau sudah yakin
  v_hapus_akun boolean := false; -- true = hapus juga semua akun selain Admin Aplikasi
BEGIN
  IF NOT v_yakin THEN
    RAISE EXCEPTION 'Belum dikonfirmasi: ubah v_yakin menjadi true di baris atas, lalu jalankan lagi.';
  END IF;

  -- Pemeriksaan "data sudah terkunci" (kegiatan selesai, foto) hanya
  -- dimatikan di dalam transaksi ini.
  ALTER TABLE public.activities         DISABLE TRIGGER USER;
  ALTER TABLE public.activity_personnel DISABLE TRIGGER USER;
  ALTER TABLE public.activity_evidence  DISABLE TRIGGER USER;
  ALTER TABLE public.project_requests   DISABLE TRIGGER USER;
  ALTER TABLE public.users              DISABLE TRIGGER USER;

  DELETE FROM public.activity_demo_links;
  DELETE FROM public.form_reviews;
  DELETE FROM public.sales_reviews;
  DELETE FROM public.activity_evidence;
  DELETE FROM public.activity_gps_events;
  DELETE FROM public.activity_personnel;
  DELETE FROM public.activities;
  DELETE FROM public.project_requests;
  DELETE FROM public.projects;
  DELETE FROM public.audit_logs;
  DELETE FROM public.login_attempts;
  DELETE FROM public.password_reset_requests;
  DELETE FROM public.gps_challenges;

  -- Akun demo selalu; akun lain hanya bila diminta. Admin Aplikasi tidak pernah.
  DELETE FROM public.users
  WHERE role <> 'admin'
    AND (id::text LIKE 'a1000000-0000-0000-0000-%' OR username LIKE 'demo.%' OR v_hapus_akun);

  ALTER TABLE public.activities         ENABLE TRIGGER USER;
  ALTER TABLE public.activity_personnel ENABLE TRIGGER USER;
  ALTER TABLE public.activity_evidence  ENABLE TRIGGER USER;
  ALTER TABLE public.project_requests   ENABLE TRIGGER USER;
  ALTER TABLE public.users              ENABLE TRIGGER USER;
END $$;

SELECT (SELECT count(*) FROM public.projects)         AS proyek,
       (SELECT count(*) FROM public.activities)       AS kegiatan,
       (SELECT count(*) FROM public.project_requests) AS permintaan,
       (SELECT count(*) FROM public.users)            AS akun_tersisa,
       (SELECT count(*) FROM public.users WHERE role = 'admin') AS admin;

COMMIT;
