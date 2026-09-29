-- ============================================================================
-- Installer Work Management Platform — Migration 028
-- Run after 027.
--
-- Android app releases, managed from Admin Panel → Aplikasi Android.
--
-- The APK used to sit in public/app/ of the web app, i.e. downloadable by
-- anyone and committed to a public repository. From app 1.5 it carries the
-- GPS signing key (026), so it moves to a PRIVATE storage bucket:
--   * only an admin can upload / replace it (from the Admin Panel);
--   * signed-in users download it through /api/app/download, which hands out
--     a 5-minute signed link (the Android app's own updater sends the login
--     cookie along);
--   * /api/app/version tells the app which version is current (public: it
--     reveals nothing but a version number and release notes).
-- ============================================================================

ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS app_version_code integer;
ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS app_version_name text;
ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS app_release_notes text;
ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS app_update_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS app_file_size bigint;
ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS app_uploaded_at timestamptz;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('app-releases', 'app-releases', false, 52428800,
        ARRAY['application/vnd.android.package-archive', 'application/octet-stream'])
ON CONFLICT (id) DO UPDATE SET public = false;

-- Admin only, checked live (current_role_from_db, as in 027). An upload with
-- upsert needs insert + select + update; delete lets an admin withdraw it.
DROP POLICY IF EXISTS app_releases_storage_select ON storage.objects;
CREATE POLICY app_releases_storage_select ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'app-releases' AND public.current_role_from_db() = 'admin');
DROP POLICY IF EXISTS app_releases_storage_insert ON storage.objects;
CREATE POLICY app_releases_storage_insert ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'app-releases' AND public.current_role_from_db() = 'admin');
DROP POLICY IF EXISTS app_releases_storage_update ON storage.objects;
CREATE POLICY app_releases_storage_update ON storage.objects FOR UPDATE TO anon
  USING (bucket_id = 'app-releases' AND public.current_role_from_db() = 'admin')
  WITH CHECK (bucket_id = 'app-releases' AND public.current_role_from_db() = 'admin');
DROP POLICY IF EXISTS app_releases_storage_delete ON storage.objects;
CREATE POLICY app_releases_storage_delete ON storage.objects FOR DELETE TO anon
  USING (bucket_id = 'app-releases' AND public.current_role_from_db() = 'admin');
