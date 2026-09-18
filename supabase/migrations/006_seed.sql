-- ============================================================================
-- Installer Work Management Platform — Migration 006
-- Seed data: default activity categories (editable afterwards from Admin
-- Panel — this is a starting point, not a hardcoded list) and one bootstrap
-- admin account so the platform is usable on first deploy.
--
-- IMPORTANT: change the seeded admin password immediately after first login
-- (Account -> Change Password). The value below ('ChangeMe123!') is a
-- placeholder, not a secret — do not rely on it in production.
-- ============================================================================

INSERT INTO public.activity_categories (code, name, sort_order, requires_gps, requires_evidence, requires_personnel, evidence_min_count, gps_radius_m) VALUES
  ('survey_meeting', 'Survey & Meeting', 1, true, true, true, 1, 150),
  ('instalasi_demo', 'Instalasi Demo', 2, true, true, true, 3, 100),
  ('instalasi_beli', 'Instalasi Beli', 3, true, true, true, 3, 100),
  ('bongkar_demo', 'Bongkar Demo', 4, true, true, true, 2, 100)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.users (id, username, full_name, role, active)
VALUES ('00000000-0000-0000-0000-000000000001', 'admin', 'Platform Admin', 'admin', true)
ON CONFLICT (username) DO NOTHING;

INSERT INTO public.user_credentials (user_id, password_hash)
SELECT '00000000-0000-0000-0000-000000000001', crypt('ChangeMe123!', gen_salt('bf'))
WHERE NOT EXISTS (SELECT 1 FROM public.user_credentials WHERE user_id = '00000000-0000-0000-0000-000000000001');
