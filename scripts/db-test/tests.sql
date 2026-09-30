-- Database behaviour tests (run by scripts/db-test/run.sh after all migrations).
-- Every check prints "✓ name" or "✗ name"; the run fails if any "✗" appears.

\set ON_ERROR_STOP 1

-- ── test helpers ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION t_check(p_name text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(p_ok, false) THEN RAISE NOTICE '✓ %', p_name;
  ELSE
    PERFORM set_config('t.failed', (COALESCE(NULLIF(current_setting('t.failed', true), ''), '0')::int + 1)::text, false);
    RAISE NOTICE '✗ %', p_name;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION t_raises(p_name text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  PERFORM t_check(p_name || ' (expected an error, got none)', false);
EXCEPTION WHEN OTHERS THEN
  PERFORM t_check(p_name, true);
END $$;

CREATE OR REPLACE FUNCTION t_as(p_user uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('user_id', p_user)::text, false);
$$;

-- A realistic GPS series near (-6.2, 106.8), and variants.
CREATE OR REPLACE FUNCTION t_real(p_native boolean DEFAULT false, p_mock boolean DEFAULT false) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(s || CASE WHEN p_native THEN jsonb_build_object('src', 'native', 'mock', p_mock, 'mockApp', false) ELSE '{}'::jsonb END)
  FROM (VALUES
    ('{"lat":-6.2000102,"lng":106.8000091,"acc":9.41,"alt":31.2,"ts":1,"at":1000}'::jsonb),
    ('{"lat":-6.2000081,"lng":106.8000123,"acc":7.93,"alt":30.8,"ts":2,"at":2400}'::jsonb),
    ('{"lat":-6.2000064,"lng":106.8000140,"acc":8.12,"alt":31.0,"ts":3,"at":3900}'::jsonb)) v(s);
$$;
GRANT EXECUTE ON FUNCTION t_check(text, boolean), t_raises(text, text), t_as(uuid), t_real(boolean, boolean) TO anon;

-- t_real() carrying a server challenge (026), as the web page sends it.
CREATE OR REPLACE FUNCTION t_web(p_nonce text, p_native boolean DEFAULT false) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(s || jsonb_build_object('nonce', p_nonce) || CASE WHEN p_native THEN '{"src":"native","mock":false,"mockApp":false}'::jsonb ELSE '{}'::jsonb END)
  FROM jsonb_array_elements(t_real()) s;
$$;
-- The same readings as the Android app signs them (026). p_flags is
-- "mock|mockApp|emulator|rooted|virtual". SECURITY DEFINER: pgcrypto lives in
-- the extensions schema, which anon can't use.
CREATE OR REPLACE FUNCTION t_signed(p_nonce text, p_key text, p_flags text DEFAULT '0|0|0|0|0', p_tamper boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT jsonb_agg(s || jsonb_build_object('src', 'native', 'mock', false, 'mockApp', false, 'nonce', p_nonce,
      'att', att, 'kid', 'k1',
      'sig', CASE WHEN p_tamper THEN repeat('0', 64) ELSE encode(hmac(att, p_key, 'sha256'), 'hex') END))
  FROM (
    SELECT s, concat_ws('|', 'v1', p_nonce, s->>'lat', s->>'lng', s->>'acc', s->>'ts', p_flags) AS att
    FROM jsonb_array_elements(t_real()) s
  ) x;
$$;
GRANT EXECUTE ON FUNCTION t_web(text, boolean), t_signed(text, text, text, boolean) TO anon;

-- ── fixtures ───────────────────────────────────────────────────────────────
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
INSERT INTO users (id, username, full_name, role, active, approval_status) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'inst', 'Installer A', 'installer', true, 'approved'),
  ('00000000-0000-0000-0000-0000000000b1', 'sales1', 'Sales One', 'sales', true, 'approved');
UPDATE activity_categories SET requires_evidence = false, requires_personnel = false, requires_gps = true;
INSERT INTO projects (id, code, name, status, latitude, longitude)
  VALUES ('00000000-0000-0000-0000-0000000000f1', 'P1', 'Proj', 'active', -6.2, 106.8);
INSERT INTO activities (id, request_number, project_id, category_id, title, scheduled_date, status)
SELECT ('00000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid, 'R' || g, '00000000-0000-0000-0000-0000000000f1',
       (SELECT id FROM activity_categories ORDER BY sort_order LIMIT 1), 'T' || g, current_date,
       CASE WHEN g <= 10 THEN 'in_progress' ELSE 'scheduled' END
FROM generate_series(1, 16) g;
UPDATE platform_settings SET require_native_app = false;

SET ROLE anon;
SELECT t_as('00000000-0000-0000-0000-0000000000a1');

-- ── 023/024: Fake GPS at completion ────────────────────────────────────────
SELECT t_check('real GPS series completes',
  (iwm_complete_activity('00000000-0000-0000-0000-000000000001', -6.2000081, 106.8000123, 7.93, t_real()) ->> 'blocked')::boolean = false);
SELECT t_check('frozen high-precision readings are blocked as suspected_mock',
  iwm_complete_activity('00000000-0000-0000-0000-000000000002', -6.2, 106.8, 5,
    '[{"lat":-6.2,"lng":106.8,"acc":5,"alt":null,"ts":1,"at":1000},{"lat":-6.2,"lng":106.8,"acc":5,"alt":null,"ts":1,"at":2500},{"lat":-6.2,"lng":106.8,"acc":5,"alt":null,"ts":1,"at":4000}]')
  ->> 'validation_status' = 'suspected_mock');
SELECT t_check('0 m accuracy is blocked',
  iwm_complete_activity('00000000-0000-0000-0000-000000000003', -6.2, 106.8, 0, '[{"lat":-6.2,"lng":106.8,"acc":0,"alt":1,"ts":1,"at":1}]')
  ->> 'validation_status' = 'suspected_mock');
SELECT t_check('a 1 km jump between readings is blocked',
  iwm_complete_activity('00000000-0000-0000-0000-000000000004', -6.2, 106.8, 8,
    '[{"lat":-6.209,"lng":106.8,"acc":8.3,"alt":12,"ts":1,"at":1000},{"lat":-6.2,"lng":106.8,"acc":8.1,"alt":12,"ts":2,"at":2000}]')
  ->> 'validation_status' = 'suspected_mock');
SELECT t_check('no readings at all is blocked',
  iwm_complete_activity('00000000-0000-0000-0000-000000000005', -6.2, 106.8, 8, NULL) ->> 'validation_status' = 'suspected_mock');
SELECT t_check('Android-reported mock location is blocked even with natural drift',
  iwm_complete_activity('00000000-0000-0000-0000-000000000006', -6.2000081, 106.8000123, 7.93, t_real(true, true))
  -> 'signals' ? 'mock_provider');
SELECT t_check('outside the site radius is blocked',
  iwm_complete_activity('00000000-0000-0000-0000-000000000007', -6.3, 106.8, 7.93,
    '[{"lat":-6.3000102,"lng":106.8000091,"acc":9.41,"alt":31.2,"ts":1,"at":1000},{"lat":-6.3000081,"lng":106.8000123,"acc":7.93,"alt":30.8,"ts":2,"at":2400},{"lat":-6.3000064,"lng":106.8000140,"acc":8.12,"alt":31.0,"ts":3,"at":3900}]')
  ->> 'validation_status' = 'outside_radius');
UPDATE activities SET gps_validation_status = NULL WHERE id = '00000000-0000-0000-0000-000000000001';
SELECT t_check('installer cannot edit the GPS verdict (RLS: no rows changed)',
  (SELECT gps_validation_status = 'valid' FROM activities WHERE id = '00000000-0000-0000-0000-000000000001'));
SELECT t_as('00000000-0000-0000-0000-000000000001'); -- seeded admin
SELECT t_raises('even an admin cannot edit the GPS verdict by hand',
  $q$ UPDATE activities SET gps_validation_status = NULL WHERE id = '00000000-0000-0000-0000-000000000001' $q$);
SELECT t_as('00000000-0000-0000-0000-0000000000a1');

-- ── 025: GPS check-in at start ─────────────────────────────────────────────
SELECT t_raises('installer cannot skip the check-in with the old status call',
  $q$ SELECT iwm_set_activity_status('00000000-0000-0000-0000-000000000011', 'in_progress') $q$);
SELECT t_check('start without being on site is blocked',
  iwm_start_activity('00000000-0000-0000-0000-000000000012', -6.3, 106.8, 7.9, t_real()) ->> 'blocked' = 'true');
SELECT t_check('start with fake GPS is blocked',
  iwm_start_activity('00000000-0000-0000-0000-000000000013', -6.2, 106.8, 7.9, t_real(true, true)) ->> 'validation_status' = 'suspected_mock');
SELECT t_check('start on site with real GPS works',
  (iwm_start_activity('00000000-0000-0000-0000-000000000014', -6.2000081, 106.8000123, 7.93, t_real()) ->> 'blocked')::boolean = false);
RESET ROLE;
SELECT t_check('the check-in is recorded on the activity',
  (SELECT status = 'in_progress' AND started_at IS NOT NULL AND start_distance_m < 50 FROM activities WHERE id = '00000000-0000-0000-0000-000000000014'));
SELECT t_check('blocked attempts are kept in the GPS log',
  (SELECT count(*) >= 6 FROM activity_gps_events WHERE validation_status = 'suspected_mock'));

-- ── 024: "require the Android app" ─────────────────────────────────────────
UPDATE platform_settings SET require_native_app = true;
SET ROLE anon;
SELECT t_as('00000000-0000-0000-0000-0000000000a1');
SELECT t_check('with the app required, a browser completion is blocked',
  iwm_complete_activity('00000000-0000-0000-0000-000000000008', -6.2000081, 106.8000123, 7.93, t_real()) -> 'signals' ? 'web_browser');
SELECT t_check('with the app required, the app still completes',
  (iwm_complete_activity('00000000-0000-0000-0000-000000000009', -6.2000081, 106.8000123, 7.93, t_real(true, false)) ->> 'blocked')::boolean = false);
RESET ROLE;
UPDATE platform_settings SET require_native_app = false;

-- ── 022: role boundaries ───────────────────────────────────────────────────
SET ROLE anon;
SELECT t_as('00000000-0000-0000-0000-0000000000a1');
SELECT t_raises('installer cannot cancel an activity',
  $q$ SELECT iwm_set_activity_status('00000000-0000-0000-0000-000000000010', 'cancelled') $q$);
INSERT INTO activity_personnel (activity_id, name) VALUES ('00000000-0000-0000-0000-000000000010', 'Helper');
SELECT t_check('installer-added personnel updates personnel_count',
  (SELECT personnel_count = 1 FROM activities WHERE id = '00000000-0000-0000-0000-000000000010'));
SELECT t_check('installer can see the user directory', (SELECT count(*) > 1 FROM users));

SELECT t_as('00000000-0000-0000-0000-0000000000b1');
SELECT t_raises('sales cannot start an activity',
  $q$ SELECT iwm_start_activity('00000000-0000-0000-0000-000000000015', -6.2000081, 106.8000123, 7.93, t_real()) $q$);
SELECT t_raises('sales cannot add personnel',
  $q$ INSERT INTO activity_personnel (activity_id, name) VALUES ('00000000-0000-0000-0000-000000000010', 'X') $q$);
SELECT t_check('sales sees only their own user row', (SELECT count(*) = 1 FROM users));
SELECT t_check('sales cannot read password reset requests', (SELECT count(*) = 0 FROM password_reset_requests));
RESET ROLE;

-- ── 026: server challenge + readings signed by the Android app ─────────────
INSERT INTO activities (id, request_number, project_id, category_id, title, scheduled_date, status)
SELECT ('00000000-0000-0000-0000-0000000002' || lpad(g::text, 2, '0'))::uuid, 'S' || g, '00000000-0000-0000-0000-0000000000f1',
       (SELECT id FROM activity_categories ORDER BY sort_order LIMIT 1), 'U' || g, current_date, 'in_progress'
FROM generate_series(1, 20) g;
SET ROLE anon;
SELECT t_as('00000000-0000-0000-0000-000000000001'); -- seeded admin
SELECT iwm_gps_challenge() ->> 'nonce' AS n_admin \gset
SELECT t_as('00000000-0000-0000-0000-0000000000a1');
SELECT iwm_gps_challenge() ->> 'nonce' AS n1 \gset
SELECT iwm_gps_challenge() ->> 'nonce' AS n_old \gset
RESET ROLE;
UPDATE gps_challenges SET created_at = now() - interval '20 minutes' WHERE nonce = :'n_old';
SET ROLE anon;

SELECT t_check('a fresh challenged reading completes',
  (iwm_complete_activity('00000000-0000-0000-0000-000000000201', -6.2000081, 106.8000123, 7.93, t_web(:'n1')) ->> 'blocked')::boolean = false);
SELECT t_check('a reading challenged 20 minutes ago is blocked as stale',
  iwm_complete_activity('00000000-0000-0000-0000-000000000202', -6.2000081, 106.8000123, 7.93, t_web(:'n_old')) -> 'signals' ? 'stale_reading');
SELECT t_check('another account''s challenge is refused',
  iwm_complete_activity('00000000-0000-0000-0000-000000000203', -6.2000081, 106.8000123, 7.93, t_web(:'n_admin')) -> 'signals' ? 'bad_challenge');
SELECT t_check('an invented challenge is refused',
  iwm_complete_activity('00000000-0000-0000-0000-000000000204', -6.2000081, 106.8000123, 7.93, t_web(gen_random_uuid()::text)) -> 'signals' ? 'bad_challenge');
SELECT t_check('without an app key installed, no challenge is only flagged (rollout)',
  (SELECT (r ->> 'blocked')::boolean = false AND r -> 'risk_flags' ? 'no_challenge'
   FROM (SELECT iwm_complete_activity('00000000-0000-0000-0000-000000000205', -6.2000081, 106.8000123, 7.93, t_real()) r) x));
SELECT t_raises('the app signing keys can''t be tested through the API',
  $q$ SELECT iwm_attestation_valid('x', 'y', 'k1') $q$);

RESET ROLE;
INSERT INTO app_attestation_keys (key_id, secret) VALUES ('k1', repeat('s3cr3t-', 6));
-- Payload and signature produced by android/…/Attestation.java itself, with
-- the payload built exactly as MainActivity.toJson() builds it.
SELECT t_check('a reading signed by the app''s own Java code verifies',
  iwm_attestation_valid('v1|0f8fad5b-d9cb-469f-a165-70867728950e|-6.2000081|106.8000123|7.93|1759132800123|0|0|0|0|0',
                        '23c7f3427bf9df63b4d8cc2019a6cbfc281f5c0b2861e63d16f4e0e6acddbafa', 'k1'));
UPDATE platform_settings SET require_native_app = true;
SET ROLE anon;
SELECT t_as('00000000-0000-0000-0000-0000000000a1');
SELECT iwm_gps_challenge() ->> 'nonce' AS n2 \gset
SELECT iwm_gps_challenge() ->> 'nonce' AS n3 \gset
SELECT t_check('the app signing keys are unreadable from the API', (SELECT count(*) = 0 FROM app_attestation_keys));
SELECT t_check('with the app required, a correctly signed app reading completes',
  (iwm_complete_activity('00000000-0000-0000-0000-000000000206', -6.2000081, 106.8000123, 7.93, t_signed(:'n2', repeat('s3cr3t-', 6))) ->> 'blocked')::boolean = false);
SELECT t_check('a page pretending to be the app without a signature counts as a browser',
  iwm_complete_activity('00000000-0000-0000-0000-000000000207', -6.2000081, 106.8000123, 7.93, t_web(:'n2', true)) -> 'signals' ? 'web_browser');
SELECT t_check('a forged signature is blocked',
  iwm_complete_activity('00000000-0000-0000-0000-000000000208', -6.2000081, 106.8000123, 7.93, t_signed(:'n2', repeat('s3cr3t-', 6), p_tamper => true)) -> 'signals' ? 'bad_signature');
SELECT t_check('a signature made with another key is blocked',
  iwm_complete_activity('00000000-0000-0000-0000-000000000209', -6.2000081, 106.8000123, 7.93, t_signed(:'n2', repeat('wrong-k', 6))) -> 'signals' ? 'bad_signature');
SELECT t_check('a signed reading replayed under a new challenge is blocked',
  iwm_complete_activity('00000000-0000-0000-0000-000000000210', -6.2000081, 106.8000123, 7.93,
    (SELECT jsonb_agg(s || jsonb_build_object('nonce', :'n3')) FROM jsonb_array_elements(t_signed(:'n2', repeat('s3cr3t-', 6))) s)) -> 'signals' ? 'bad_signature');
SELECT t_check('a signed reading moved to another position is blocked',
  iwm_complete_activity('00000000-0000-0000-0000-000000000211', -6.2000081, 106.8000123, 7.93,
    (SELECT jsonb_agg(s || '{"lat":-6.2100000}'::jsonb) FROM jsonb_array_elements(t_signed(:'n2', repeat('s3cr3t-', 6))) s)) -> 'signals' ? 'bad_signature');
SELECT t_check('the app on an emulator is blocked',
  iwm_complete_activity('00000000-0000-0000-0000-000000000212', -6.2000081, 106.8000123, 7.93, t_signed(:'n2', repeat('s3cr3t-', 6), '0|0|1|0|0')) -> 'signals' ? 'emulator');
SELECT t_check('the app inside a cloning app is blocked',
  iwm_complete_activity('00000000-0000-0000-0000-000000000213', -6.2000081, 106.8000123, 7.93, t_signed(:'n2', repeat('s3cr3t-', 6), '0|0|0|0|1')) -> 'signals' ? 'virtual_env');
SELECT t_check('Android''s signed mock-location verdict blocks',
  iwm_complete_activity('00000000-0000-0000-0000-000000000214', -6.2000081, 106.8000123, 7.93, t_signed(:'n2', repeat('s3cr3t-', 6), '1|0|0|0|0')) -> 'signals' ? 'mock_provider');
SELECT t_check('a rooted phone is blocked when the app is required',
  iwm_complete_activity('00000000-0000-0000-0000-000000000215', -6.2000081, 106.8000123, 7.93, t_signed(:'n2', repeat('s3cr3t-', 6), '0|0|0|1|0')) -> 'signals' ? 'rooted');
SELECT t_check('once a key is installed, a reading without a challenge is blocked',
  iwm_complete_activity('00000000-0000-0000-0000-000000000216', -6.2000081, 106.8000123, 7.93, t_real(true, false)) -> 'signals' ? 'no_challenge');
SELECT t_check('start with a signed on-site reading works',
  (iwm_start_activity('00000000-0000-0000-0000-000000000016', -6.2000081, 106.8000123, 7.93, t_signed(:'n2', repeat('s3cr3t-', 6))) ->> 'blocked')::boolean = false);
RESET ROLE;
UPDATE platform_settings SET require_native_app = false;
SET ROLE anon;
SELECT t_as('00000000-0000-0000-0000-0000000000a1');
SELECT t_check('a rooted phone is only flagged when the app is not required',
  (SELECT (r ->> 'blocked')::boolean = false AND r -> 'risk_flags' ? 'rooted'
   FROM (SELECT iwm_complete_activity('00000000-0000-0000-0000-000000000217', -6.2000081, 106.8000123, 7.93, t_signed(:'n2', repeat('s3cr3t-', 6), '0|0|0|1|0')) r) x));
RESET ROLE;
DELETE FROM app_attestation_keys;

-- ── 027: admin settings checked live; bot token admin-only ─────────────────
INSERT INTO users (id, username, full_name, role, active, approval_status) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'sup1', 'Supervisor One', 'supervisor', true, 'approved'),
  ('00000000-0000-0000-0000-0000000000d1', 'exadmin', 'Former Admin', 'admin', false, 'approved');
SET ROLE anon;
SELECT t_as('00000000-0000-0000-0000-000000000001'); -- seeded admin
INSERT INTO activity_categories (code, name) VALUES ('T_OK', 'Test by admin');
SELECT t_check('an active admin can add a category', (SELECT count(*) = 1 FROM activity_categories WHERE code = 'T_OK'));
-- A token still saying "admin" for an account that is now an installer, or
-- an admin account that has been deactivated.
SELECT set_config('request.jwt.claims', '{"user_id":"00000000-0000-0000-0000-0000000000a1","user_role":"admin"}', false);
SELECT t_raises('a demoted admin''s old token can''t add a category',
  $q$ INSERT INTO activity_categories (code, name) VALUES ('T_DEMOTED', 'x') $q$);
SELECT set_config('request.jwt.claims', '{"user_id":"00000000-0000-0000-0000-0000000000d1","user_role":"admin"}', false);
SELECT t_raises('a deactivated admin''s old token can''t change platform settings',
  $q$ DO $d$ BEGIN
       UPDATE platform_settings SET require_native_app = true;
       IF NOT FOUND THEN RAISE EXCEPTION 'no rows'; END IF;
     END $d$ $q$);
SELECT t_as('00000000-0000-0000-0000-0000000000c1');
SELECT t_check('a supervisor can''t read the Telegram bot token', (SELECT count(*) = 0 FROM notification_settings));
SELECT t_as('00000000-0000-0000-0000-000000000001');
SELECT t_check('an admin can read the Telegram bot settings', (SELECT count(*) = 1 FROM notification_settings));
RESET ROLE;

-- How many rows a write actually changed (RLS silently filters the rest).
CREATE OR REPLACE FUNCTION t_changed(p_sql text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION t_changed(text) TO anon;

-- ── 028: the Android APK bucket (upload = admin only) ──────────────────────
GRANT USAGE ON SCHEMA storage TO anon;
GRANT ALL ON storage.objects, storage.buckets TO anon;
SELECT t_check('the private app-releases bucket exists',
  (SELECT count(*) = 1 AND bool_and(NOT public) FROM storage.buckets WHERE id = 'app-releases'));
SET ROLE anon;
SELECT t_as('00000000-0000-0000-0000-000000000001'); -- seeded admin
INSERT INTO storage.objects (bucket_id, name) VALUES ('app-releases', 'installer-wm.apk');
SELECT t_check('an admin can upload the APK', (SELECT count(*) = 1 FROM storage.objects WHERE bucket_id = 'app-releases'));
SELECT t_check('an admin can replace it (upsert needs update + select)',
  t_changed($q$ UPDATE storage.objects SET name = 'installer-wm.apk' WHERE bucket_id = 'app-releases' $q$) = 1);
SELECT t_as('00000000-0000-0000-0000-0000000000a1'); -- installer
SELECT t_raises('an installer cannot upload an APK',
  $q$ INSERT INTO storage.objects (bucket_id, name) VALUES ('app-releases', 'evil.apk') $q$);
SELECT t_check('an installer cannot even list the APK file (downloads go through a signed link)',
  (SELECT count(*) = 0 FROM storage.objects WHERE bucket_id = 'app-releases'));
SELECT t_check('and cannot replace it',
  t_changed($q$ UPDATE storage.objects SET name = 'x.apk' WHERE bucket_id = 'app-releases' $q$) = 0);
SELECT t_check('or delete it',
  t_changed($q$ DELETE FROM storage.objects WHERE bucket_id = 'app-releases' $q$) = 0);
RESET ROLE;
SELECT t_check('the APK is still there after the installer''s attempts',
  (SELECT count(*) = 1 FROM storage.objects WHERE bucket_id = 'app-releases' AND name = 'installer-wm.apk'));

-- ── 029: Demo → Purchase timeline, rooms, one sales account per project ────
-- Two sales accounts in the SAME division: the whole point is that they
-- still can't see each other's projects.
INSERT INTO sales_divisions (id, name, code, active)
  VALUES ('00000000-0000-0000-0000-0000000000d9', 'Divisi Uji', 'UJI', true);
INSERT INTO users (id, username, full_name, role, active, approval_status, sales_division_id) VALUES
  ('00000000-0000-0000-0000-000000000091', 'sales_a', 'Sales A', 'sales', true, 'approved', '00000000-0000-0000-0000-0000000000d9'),
  ('00000000-0000-0000-0000-000000000092', 'sales_b', 'Sales B', 'sales', true, 'approved', '00000000-0000-0000-0000-0000000000d9');
INSERT INTO projects (id, code, name, status, latitude, longitude, sales_division_id, sales_user_id) VALUES
  ('00000000-0000-0000-0000-0000000000a9', 'PA', 'Proyek Sales A', 'active', -6.2, 106.8, '00000000-0000-0000-0000-0000000000d9', '00000000-0000-0000-0000-000000000091'),
  ('00000000-0000-0000-0000-0000000000b9', 'PB', 'Proyek Sales B', 'active', -6.2, 106.8, '00000000-0000-0000-0000-0000000000d9', '00000000-0000-0000-0000-000000000092');

-- Demo and purchase in the SAME room, with a DIFFERENT product: the case the
-- old product-only matching missed entirely.
UPDATE activity_categories SET counts_as_demo = (code = 'instalasi_demo'), counts_as_installation = (code = 'instalasi_beli');
INSERT INTO activities (id, request_number, project_id, category_id, title, scheduled_date, status, completed_at, room_name, product_brand, product_type) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'R-DEMO', '00000000-0000-0000-0000-0000000000a9',
   (SELECT id FROM activity_categories WHERE code = 'instalasi_demo'), 'Demo Ruang Rapat', current_date - 40, 'completed', now() - interval '40 days', 'Ruang Rapat 1', 'Maxhub', 'Videowall'),
  ('00000000-0000-0000-0000-0000000000e2', 'R-BELI', '00000000-0000-0000-0000-0000000000a9',
   (SELECT id FROM activity_categories WHERE code = 'instalasi_beli'), 'Beli Ruang Rapat', current_date, 'scheduled', NULL, 'ruang rapat  1', 'Promethean', 'Videowall');

SELECT t_check('the room key ignores case and extra spaces',
  (SELECT count(DISTINCT room_key) = 1 FROM activities WHERE id IN ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2')));
SELECT t_check('a purchase is suggested its demo from the SAME ROOM even when the product changed',
  (SELECT match_reason = 'room' AND rank = 1 FROM activity_demo_suggestions
   WHERE purchase_activity_id = '00000000-0000-0000-0000-0000000000e2' AND demo_activity_id = '00000000-0000-0000-0000-0000000000e1'));
SELECT t_check('the elapsed days are recorded, with no time limit applied',
  (SELECT days_since_demo >= 39 FROM activity_demo_suggestions WHERE purchase_activity_id = '00000000-0000-0000-0000-0000000000e2'));

SET ROLE anon;
SELECT t_as('00000000-0000-0000-0000-0000000000a1'); -- installer, not staff
SELECT t_raises('only staff may confirm a demo link',
  $q$ SELECT iwm_link_demo('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1', 'room') $q$);
SELECT t_as('00000000-0000-0000-0000-000000000001'); -- seeded admin
SELECT t_check('staff confirms the link',
  (iwm_link_demo('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1', 'room') ->> 'linked')::boolean);
SELECT t_check('the confirmed link shows up on the timeline with its reason',
  (SELECT demo_request_number = 'R-DEMO' AND match_reason = 'room' AND billing_status = 'not_billed'
   FROM activity_demo_timeline WHERE activity_id = '00000000-0000-0000-0000-0000000000e2'));
SELECT t_check('a confirmed purchase is no longer suggested',
  (SELECT count(*) = 0 FROM activity_demo_suggestions WHERE purchase_activity_id = '00000000-0000-0000-0000-0000000000e2'));

-- One demo, one purchase: a second purchase in the same room must not be able
-- to claim the same (already spent) demo.
RESET ROLE;
INSERT INTO activities (id, request_number, project_id, category_id, title, scheduled_date, status, room_name, product_brand, product_type) VALUES
  ('00000000-0000-0000-0000-0000000000e3', 'R-BELI-2', '00000000-0000-0000-0000-0000000000a9',
   (SELECT id FROM activity_categories WHERE code = 'instalasi_beli'), 'Beli kedua Ruang Rapat', current_date, 'scheduled', 'Ruang Rapat 1', 'Maxhub', 'Videowall');
SET ROLE anon;
SELECT t_as('00000000-0000-0000-0000-000000000001');
SELECT t_check('a demo already backing a purchase is not suggested for a second one',
  (SELECT count(*) = 0 FROM activity_demo_suggestions WHERE purchase_activity_id = '00000000-0000-0000-0000-0000000000e3'));
SELECT t_raises('and cannot be linked to a second purchase by hand either',
  $q$ SELECT iwm_link_demo('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000e1', 'manual') $q$);
SELECT t_check('the same purchase can still be re-confirmed (correcting the reason)',
  (iwm_link_demo('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1', 'room_and_product') ->> 'linked')::boolean);

-- The isolation that matters: same division, different owner.
SELECT t_as('00000000-0000-0000-0000-000000000091');
SELECT t_check('a sales account sees its own project', (SELECT count(*) = 1 FROM projects WHERE id = '00000000-0000-0000-0000-0000000000a9'));
SELECT t_check('and NOT another sales account''s project in the same division',
  (SELECT count(*) = 0 FROM projects WHERE id = '00000000-0000-0000-0000-0000000000b9'));
SELECT t_check('a sales account sees only its own projects in total', (SELECT count(*) = 1 FROM projects));
SELECT t_check('a sales account sees its own project''s activities', (SELECT count(*) = 3 FROM activities WHERE project_id = '00000000-0000-0000-0000-0000000000a9'));
SELECT t_as('00000000-0000-0000-0000-000000000092');
SELECT t_check('the other sales account sees neither those activities',
  (SELECT count(*) = 0 FROM activities WHERE project_id = '00000000-0000-0000-0000-0000000000a9'));
SELECT t_raises('nor may it confirm a demo link',
  $q$ SELECT iwm_link_demo('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1', 'room') $q$);
RESET ROLE;
INSERT INTO projects (id, code, name, status, sales_division_id, sales_user_id)
  VALUES ('00000000-0000-0000-0000-0000000000c9', 'PC', 'Proyek Belum Punya Sales', 'active', '00000000-0000-0000-0000-0000000000d9', NULL);
SET ROLE anon;
SELECT t_as('00000000-0000-0000-0000-000000000091');
SELECT t_check('a project with no sales account assigned is invisible to sales',
  (SELECT count(*) = 0 FROM projects WHERE id = '00000000-0000-0000-0000-0000000000c9'));
RESET ROLE;
SELECT t_check('but staff still see it, so an admin can assign one',
  (SELECT count(*) = 1 FROM projects WHERE id = '00000000-0000-0000-0000-0000000000c9'));

-- ── 030: one clear Sales owner per project ─────────────────────────────────
SELECT t_check('a project''s sales name comes from its sales account',
  (SELECT sales_person_name = 'Sales A' FROM projects WHERE id = '00000000-0000-0000-0000-0000000000a9'));
UPDATE projects SET sales_user_id = '00000000-0000-0000-0000-000000000092' WHERE id = '00000000-0000-0000-0000-0000000000c9';
SELECT t_check('assigning a sales account later fills in the name too',
  (SELECT sales_person_name = 'Sales B' FROM projects WHERE id = '00000000-0000-0000-0000-0000000000c9'));
UPDATE projects SET sales_person_name = 'Nama Ketik Bebas' WHERE id = '00000000-0000-0000-0000-0000000000c9';
SELECT t_check('a typed name can''t drift away from the account',
  (SELECT sales_person_name = 'Sales B' FROM projects WHERE id = '00000000-0000-0000-0000-0000000000c9'));
UPDATE users SET full_name = 'Sales B Baru' WHERE id = '00000000-0000-0000-0000-000000000092';
SELECT t_check('renaming the sales account renames it on its projects',
  (SELECT bool_and(sales_person_name = 'Sales B Baru') FROM projects WHERE sales_user_id = '00000000-0000-0000-0000-000000000092'));

INSERT INTO project_requests (id, requested_by, sales_division_id, project_name, status)
  VALUES ('00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-000000000091', '00000000-0000-0000-0000-0000000000d9', 'Permintaan Sales A', 'pending');
SET ROLE anon;
SELECT t_as('00000000-0000-0000-0000-000000000001');
SELECT t_check('approving a sales request creates the project',
  (iwm_approve_project_request('00000000-0000-0000-0000-0000000000f9', 'PRQ-1') ->> 'project_id') IS NOT NULL);
RESET ROLE;
SELECT t_check('with the requesting Sales as its owner, name included',
  (SELECT p.sales_user_id = '00000000-0000-0000-0000-000000000091' AND p.sales_person_name = 'Sales A'
   FROM projects p JOIN project_requests r ON r.resulting_project_id = p.id WHERE r.id = '00000000-0000-0000-0000-0000000000f9'));
SET ROLE anon;
SELECT t_as('00000000-0000-0000-0000-000000000091');
SELECT t_check('so that Sales sees the new project straight away',
  (SELECT count(*) = 1 FROM projects WHERE code = 'PRQ-1'));
RESET ROLE;

-- Admin Sales: the whole division, and asks on a Sales Proyek's behalf.
INSERT INTO sales_divisions (id, name, code, active) VALUES ('00000000-0000-0000-0000-0000000000d8', 'Divisi Lain', 'LAIN', true);
INSERT INTO users (id, username, full_name, role, active, approval_status, sales_division_id) VALUES
  ('00000000-0000-0000-0000-000000000093', 'admin_sales_uji', 'Admin Sales Uji', 'sales_admin', true, 'approved', '00000000-0000-0000-0000-0000000000d9'),
  ('00000000-0000-0000-0000-000000000094', 'sales_lain', 'Sales Lain', 'sales', true, 'approved', '00000000-0000-0000-0000-0000000000d8');
INSERT INTO projects (id, code, name, status, sales_user_id)
  VALUES ('00000000-0000-0000-0000-0000000000c8', 'PL', 'Proyek Divisi Lain', 'active', '00000000-0000-0000-0000-000000000094');
SELECT t_check('a project takes its division from its Sales Proyek',
  (SELECT sales_division_id = '00000000-0000-0000-0000-0000000000d8' FROM projects WHERE id = '00000000-0000-0000-0000-0000000000c8'));
SET ROLE anon;
SELECT t_as('00000000-0000-0000-0000-000000000093');
SELECT t_check('Admin Sales sees every project of its division (both Sales Proyek)',
  (SELECT count(*) = 2 FROM projects WHERE id IN ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000b9')));
SELECT t_check('and their activities', (SELECT count(*) = 3 FROM activities WHERE project_id = '00000000-0000-0000-0000-0000000000a9'));
SELECT t_check('but not another division''s project',
  (SELECT count(*) = 0 FROM projects WHERE id = '00000000-0000-0000-0000-0000000000c8'));
SELECT t_check('it may pick only its division''s Sales Proyek',
  (SELECT array_agg(username ORDER BY username) = ARRAY['sales_a', 'sales_b'] FROM iwm_sales_choices()));
SELECT t_check('Admin Sales requests a schedule for a Sales Proyek of its division',
  t_changed($q$ INSERT INTO project_requests (requested_by, sales_division_id, project_name, status, sales_user_id)
    VALUES ('00000000-0000-0000-0000-000000000093', '00000000-0000-0000-0000-0000000000d9', 'Diajukan Admin Sales', 'pending', '00000000-0000-0000-0000-000000000092') $q$) = 1);
SELECT t_raises('but not for a Sales Proyek of another division',
  $q$ INSERT INTO project_requests (requested_by, sales_division_id, project_name, status, sales_user_id)
    VALUES ('00000000-0000-0000-0000-000000000093', '00000000-0000-0000-0000-0000000000d9', 'Salah divisi', 'pending', '00000000-0000-0000-0000-000000000094') $q$);
SELECT t_raises('and not without naming one',
  $q$ INSERT INTO project_requests (requested_by, sales_division_id, project_name, status)
    VALUES ('00000000-0000-0000-0000-000000000093', '00000000-0000-0000-0000-0000000000d9', 'Tanpa Sales', 'pending') $q$);
SELECT t_as('00000000-0000-0000-0000-000000000092');
SELECT t_check('the Sales Proyek it was requested for sees the request',
  (SELECT count(*) = 1 FROM project_requests WHERE project_name = 'Diajukan Admin Sales'));
SELECT t_as('00000000-0000-0000-0000-000000000091');
SELECT t_check('a different Sales Proyek of the same division does not',
  (SELECT count(*) = 0 FROM project_requests WHERE project_name = 'Diajukan Admin Sales'));
SELECT t_check('a Sales Proyek may pick only itself', (SELECT array_agg(username) = ARRAY['sales_a'] FROM iwm_sales_choices()));
SELECT t_as('00000000-0000-0000-0000-000000000001');
SELECT set_config('t.prq2', iwm_approve_project_request(
  (SELECT id FROM project_requests WHERE project_name = 'Diajukan Admin Sales'), 'PRQ-2') ->> 'project_id', false);
SELECT t_check('approving it makes that Sales Proyek the owner, not the Admin Sales',
  (SELECT sales_user_id = '00000000-0000-0000-0000-000000000092' FROM projects WHERE id = current_setting('t.prq2')::uuid));
SELECT t_as('00000000-0000-0000-0000-000000000093');
SELECT t_check('Admin Sales counts as vendor side for every Sales guard', is_sales() AND NOT is_staff());
RESET ROLE;

-- Settings replace hardcoded rules.
SELECT t_check('an unset setting falls back to the default', setting_num('gps.jump_max_m', 300) = 300);
INSERT INTO app_settings (key, value) VALUES ('gps.jump_max_m', '500') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
SELECT t_check('a saved setting is what the checks use', setting_num('gps.jump_max_m', 300) = 500);
INSERT INTO app_settings (key, value) VALUES ('gps.blocking_flags', '["mock_provider"]') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
SELECT t_check('the list of blocking Fake GPS signals is a setting too',
  iwm_gps_blocking(ARRAY['mock_provider', 'sample_jump']) = ARRAY['mock_provider']);
DELETE FROM app_settings WHERE key IN ('gps.jump_max_m', 'gps.blocking_flags');
SET ROLE anon;
SELECT t_as('00000000-0000-0000-0000-0000000000a1');
SELECT t_raises('only an admin may change settings',
  $q$ INSERT INTO app_settings (key, value) VALUES ('x.y', '1') $q$);
RESET ROLE;

-- ── result ─────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF COALESCE(NULLIF(current_setting('t.failed', true), ''), '0')::int > 0 THEN
    RAISE EXCEPTION '% database test(s) failed', current_setting('t.failed', true);
  END IF;
  RAISE NOTICE '✓ all database tests passed';
END $$;
