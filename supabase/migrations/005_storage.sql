-- ============================================================================
-- Installer Work Management Platform — Migration 005
-- Storage bucket for evidence photos.
--
-- The bucket is PRIVATE. Uploads go straight from the browser (already
-- resized/compressed client-side, see lib/image-compress.ts) using the
-- logged-in user's PostgREST JWT. Reads never use a public URL or a client
-- SELECT policy — app/api/evidence/signed-urls mints short-lived signed
-- URLs (batched, one request per page) with the service-role key on
-- demand, which is what keeps
-- historical photo lists from downloading full-size images just to render
-- a list (spec §12, §22).
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('activity-evidence', 'activity-evidence', false, 8388608, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY activity_evidence_storage_insert ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'activity-evidence' AND public.is_authenticated());

CREATE POLICY activity_evidence_storage_delete ON storage.objects
  FOR DELETE TO anon
  USING (bucket_id = 'activity-evidence' AND public.is_authenticated());

-- No SELECT policy: reads only ever go through the service-role signed-URL
-- route above, never a direct anon storage.objects SELECT.
