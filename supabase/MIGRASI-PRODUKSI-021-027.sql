-- ============================================================================
-- Installer Work Management: migrasi 021 -> 027 untuk PRODUKSI, satu kali jalan.
-- Cara pakai: Supabase Dashboard -> SQL Editor -> New query -> tempel SEMUA isi
-- file ini -> Run. Satu transaksi: kalau ada error, TIDAK ADA yang berubah.
-- Aman dijalankan ulang (semua langkah idempotent).
-- Dibuat dari supabase/migrations/021..027 pada commit 22d1ec5.
-- ============================================================================

BEGIN;


-- >>>>>>>>>>>>>>>> 021_sales_reschedule.sql >>>>>>>>>>>>>>>>
-- ============================================================================
-- Installer Work Management Platform — Migration 021
--
-- Lets a Sales account reschedule/edit an activity — but only one that
-- belongs to a project in their OWN division (activities_update below joins
-- to projects.sales_division_id = current_sales_division_id(), the exact
-- same boundary 014 already draws for reading), never a colleague's, and
-- never someone else's division. "Handles that project" means division, not
-- the individual account — the same scoping every other Sales policy in
-- this schema already uses (current_sales_division_id(), 014/019), since
-- nothing in the schema assigns a project to one specific salesperson.
--
-- What Sales can touch: scheduled_date, start_time, end_time, priority,
-- location_address, notes. Everything else on the row — category, product
-- identity, PIC, personnel, status, GPS/execution/completion — stays
-- staff-only, enforced in Postgres (guard_activities_sales_edit below), not
-- just hidden in the UI. A locked (completed/cancelled) activity can't be
-- touched by anyone through this path either.
-- ============================================================================

DROP POLICY IF EXISTS activities_update ON public.activities;
CREATE POLICY activities_update ON public.activities FOR UPDATE TO anon
USING (
  public.is_staff()
  OR (
    public.is_sales()
    AND status IN ('scheduled', 'in_progress')
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = activities.project_id AND p.sales_division_id = public.current_sales_division_id()
    )
  )
)
WITH CHECK (
  public.is_staff()
  OR (
    public.is_sales()
    AND status IN ('scheduled', 'in_progress')
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = activities.project_id AND p.sales_division_id = public.current_sales_division_id()
    )
  )
);

CREATE OR REPLACE FUNCTION public.guard_activities_sales_edit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- Not a direct client call (SECURITY DEFINER RPCs run as their owner), or
  -- the caller is staff: nothing here applies to them — staff already goes
  -- through guard_activity_protected_columns() (003) for the fields that
  -- must never be hand-edited by anyone.
  IF current_user NOT IN ('anon', 'authenticated') OR public.is_staff() THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_sales() THEN
    -- The RLS policy above already stops anyone else from reaching this
    -- far; this is a fail-closed backstop if that policy ever changes.
    RAISE EXCEPTION 'You are not allowed to edit this activity.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.category_id IS DISTINCT FROM OLD.category_id
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.request_number IS DISTINCT FROM OLD.request_number
     OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.personnel_count IS DISTINCT FROM OLD.personnel_count
     OR NEW.target_latitude IS DISTINCT FROM OLD.target_latitude
     OR NEW.target_longitude IS DISTINCT FROM OLD.target_longitude
     OR NEW.pic_name IS DISTINCT FROM OLD.pic_name
     OR NEW.pic_phone IS DISTINCT FROM OLD.pic_phone
     OR NEW.product_brand IS DISTINCT FROM OLD.product_brand
     OR NEW.product_type IS DISTINCT FROM OLD.product_type
     OR NEW.product_model IS DISTINCT FROM OLD.product_model
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
  THEN
    RAISE EXCEPTION 'Sales can only change the date/time, priority, location, and notes — everything else needs staff.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_guard_activities_sales_edit
  BEFORE UPDATE ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.guard_activities_sales_edit();

-- >>>>>>>>>>>>>>>> 022_role_hardening_and_personnel_sync.sql >>>>>>>>>>>>>>>>
-- ============================================================================
-- Installer Work Management Platform — Migration 022
--
-- Found in the platform audit. Run after 021.
--
-- 1. Sales could operate the execution flow on ANY activity. The two
--    execution RPCs (003) are SECURITY DEFINER and only check "has a valid
--    session", a rule written before the Sales role existed (014). So a Sales
--    account could start, cancel or complete an activity in another
--    division just by knowing its id. Now:
--      - Sales can't change an activity's status at all.
--      - Cancelling is admin/supervisor only, which matches what the UI
--        already offered.
--    This is enforced as a trigger on the status column itself, so it holds
--    for iwm_set_activity_status(), iwm_complete_activity() and any future
--    path. Server-side calls with no user on the token (service role, cron)
--    are unaffected.
--
-- 2. Sales could add evidence photos and personnel to any activity, in any
--    division. Both are field work, so both are now closed to Sales, and
--    evidence must be recorded under the uploader's own id. That id is what
--    decides who may delete a photo later, so it can no longer be spoofed.
--
-- 3. Any logged-in account could delete any evidence FILE from Storage,
--    including another installer's. The activity_evidence row was
--    protected; the file behind it was not. A file is now deletable by
--    staff, by its uploader, or by anyone when nothing references it (the
--    client's own cleanup of a half-finished upload).
--
-- 4. Sales accounts, who are external, could read the whole user directory:
--    every employee's name, email, phone and role, plus the accounts of
--    other divisions. They now see only their own row, which is all the
--    Sales screens ever read.
--
-- 5. Bug: personnel an INSTALLER added on site never counted. The trigger
--    that keeps activities.personnel_count in sync ran under the installer's
--    RLS, and installers can't UPDATE activities, so its UPDATE matched zero
--    rows without any error. The count stayed at 0, and on categories that
--    require personnel "Complete" was refused ("needs personnel") even with
--    the team listed on screen. The trigger is now SECURITY DEFINER, and
--    every stale count is repaired once below.
-- ============================================================================

-- ── 1. Who may change an activity's status ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_activities_status_by_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- No user on the token = a server-side job (service role); not our concern.
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR public.jwt_user_id() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.is_sales() THEN
    RAISE EXCEPTION 'Sales accounts cannot start, cancel or complete an activity.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status = 'cancelled' AND NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only an admin or supervisor can cancel an activity.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_guard_activities_status_by_role
  BEFORE UPDATE OF status ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.guard_activities_status_by_role();

-- ── 2. Field work stays with field accounts ─────────────────────────────────
DROP POLICY IF EXISTS activity_evidence_insert ON public.activity_evidence;
CREATE POLICY activity_evidence_insert ON public.activity_evidence FOR INSERT TO anon WITH CHECK (
  public.is_authenticated()
  AND NOT public.is_sales()
  AND uploader_id = public.jwt_user_id()
);

DROP POLICY IF EXISTS activity_personnel_insert ON public.activity_personnel;
CREATE POLICY activity_personnel_insert ON public.activity_personnel FOR INSERT TO anon WITH CHECK (
  public.is_authenticated() AND NOT public.is_sales() AND (
    public.is_staff() OR EXISTS (
      SELECT 1 FROM public.activities a WHERE a.id = activity_id AND a.status IN ('scheduled', 'in_progress')
    )
  )
);

DROP POLICY IF EXISTS activity_evidence_storage_insert ON storage.objects;
CREATE POLICY activity_evidence_storage_insert ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'activity-evidence' AND public.is_authenticated() AND NOT public.is_sales());

-- ── 3. Evidence files: only yours, or staff, or unreferenced ───────────────
-- SECURITY DEFINER so the check sees every activity_evidence row, not just
-- the ones the caller's own RLS lets them read. Otherwise "no other
-- uploader's row points at this file" would be trivially true for a photo
-- the caller simply can't see.
CREATE OR REPLACE FUNCTION public.can_delete_evidence_object(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.is_authenticated() AND NOT public.is_sales() AND (
    public.is_staff() OR NOT EXISTS (
      SELECT 1 FROM public.activity_evidence e
      WHERE (e.storage_path = p_name OR e.thumbnail_path = p_name)
        AND e.uploader_id IS DISTINCT FROM public.jwt_user_id()
    )
  );
$$;

REVOKE ALL ON FUNCTION public.can_delete_evidence_object(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_delete_evidence_object(text) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS activity_evidence_storage_delete ON storage.objects;
CREATE POLICY activity_evidence_storage_delete ON storage.objects
  FOR DELETE TO anon
  USING (bucket_id = 'activity-evidence' AND public.can_delete_evidence_object(name));

-- ── 4. User directory: not for external Sales accounts ─────────────────────
-- current_role_from_db() is SECURITY DEFINER since 019, so calling
-- is_sales() here can't recurse back into this policy.
DROP POLICY IF EXISTS users_select ON public.users;
CREATE POLICY users_select ON public.users FOR SELECT TO anon USING (
  id = public.jwt_user_id()
  OR (public.is_authenticated() AND NOT public.is_sales())
);

-- ── 5. personnel_count sync runs with the owner's rights ───────────────────
-- It only ever writes a count derived from activity_personnel, a row the
-- caller was already allowed to insert or delete, so running it as the
-- owner grants nothing new. The guard triggers on activities skip it
-- (current_user is no longer anon), same as for the other SECURITY DEFINER
-- paths.
CREATE OR REPLACE FUNCTION public.sync_activity_personnel_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_activity_id uuid := COALESCE(NEW.activity_id, OLD.activity_id);
BEGIN
  UPDATE public.activities
    SET personnel_count = (SELECT count(*) FROM public.activity_personnel WHERE activity_id = v_activity_id)
    WHERE id = v_activity_id;
  RETURN NULL;
END;
$$;

-- One-off repair of every count the old trigger left behind.
UPDATE public.activities a
SET personnel_count = c.n
FROM (
  SELECT a2.id, (SELECT count(*) FROM public.activity_personnel p WHERE p.activity_id = a2.id) AS n
  FROM public.activities a2
) c
WHERE c.id = a.id AND a.personnel_count IS DISTINCT FROM c.n;

-- >>>>>>>>>>>>>>>> 023_fake_gps_detection.sql >>>>>>>>>>>>>>>>
-- ============================================================================
-- Installer Work Management Platform — Migration 023
--
-- Fake GPS (mock location) detection for activity completion. Run after 022.
--
-- A web page cannot read Android's "this location is mocked" flag. Only a
-- native app can. What the server CAN do is look at the shape of the
-- readings, because a mock location app gives itself away:
--
--   * The phone now sends 3-5 readings taken over a few seconds instead of
--     one. Real GPS drifts slightly from one reading to the next even when
--     standing still. A mock location usually doesn't move at all and
--     reports the same round accuracy (1 m, 3 m, 5 m) every time.
--   * Real GPS never reports an accuracy of 0 m.
--   * A joystick-driven mock can jump hundreds of metres between two
--     readings a second apart. No installer moves that fast.
--   * Being "here" now when the same account was 50 km away 10 minutes ago
--     means one of the two positions was faked.
--
-- BLOCKED (validation_status = 'suspected_mock'; the installer is told to
-- turn off the fake location app and capture again):
--     zero_accuracy, frozen_precise (identical high-precision readings over
--     several seconds), sample_jump, no_samples (an old or tampered page
--     that didn't send readings).
-- FLAGGED (completion goes through, but the flags are stored on the
-- activity and shown in red on Form Review for the reviewer to judge):
--     frozen (identical readings at low precision; normal indoors on Wi-Fi
--     location), integer_accuracy, no_altitude, impossible_travel.
--   Blocking on these would hit honest installers too often, e.g. indoors
--   with Wi-Fi-based location, which also gives flat readings.
--
-- Every attempt, blocked or not, keeps its raw readings and flags in
-- activity_gps_events, so a reviewer can see "2 attempts blocked as fake
-- GPS before this one went through".
--
-- This is not a 100% guarantee: someone who scripts the requests by hand
-- can send any readings they like. It stops the ordinary Fake GPS app,
-- which is what installers actually use.
-- ============================================================================

ALTER TABLE public.activity_gps_events ADD COLUMN IF NOT EXISTS samples jsonb;
ALTER TABLE public.activity_gps_events ADD COLUMN IF NOT EXISTS risk_flags text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS gps_risk_flags text[] NOT NULL DEFAULT '{}';

-- ── The checks ─────────────────────────────────────────────────────────────
-- p_samples: [{ lat, lng, acc, alt, ts, at }, …]. ts = the reading's own
-- timestamp, at = when the page received it (both epoch ms). Timing uses
-- `at`: mock providers (Chrome's own location emulation included) repeat the
-- same `ts` on every reading. Returns every signal found; the caller decides
-- which ones block.
CREATE OR REPLACE FUNCTION public.iwm_gps_risk_flags(
  p_user_id uuid, p_lat numeric, p_lng numeric, p_accuracy numeric, p_samples jsonb
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_flags text[] := '{}';
  v_n integer;
  v_span_ms numeric;
  v_distinct_pos integer;
  v_distinct_acc integer;
  v_max_acc numeric;
  v_all_int boolean;
  v_no_alt boolean;
  v_prev record;
  v_prev_dist numeric;
  v_prev_hours numeric;
  i integer;
  a jsonb;
  b jsonb;
  v_step numeric;
  v_dt numeric;
BEGIN
  IF p_accuracy IS NOT NULL AND p_accuracy <= 0 THEN
    v_flags := array_append(v_flags, 'zero_accuracy');
  END IF;

  IF p_samples IS NULL OR jsonb_typeof(p_samples) <> 'array' OR jsonb_array_length(p_samples) = 0 THEN
    v_flags := array_append(v_flags, 'no_samples');
  ELSE
    v_n := jsonb_array_length(p_samples);

    SELECT
      max(COALESCE((s->>'at')::numeric, (s->>'ts')::numeric)) - min(COALESCE((s->>'at')::numeric, (s->>'ts')::numeric)),
      count(DISTINCT (round((s->>'lat')::numeric, 7), round((s->>'lng')::numeric, 7))),
      count(DISTINCT (s->>'acc')::numeric),
      max((s->>'acc')::numeric),
      bool_and((s->>'acc')::numeric = trunc((s->>'acc')::numeric)),
      bool_and(s->>'alt' IS NULL OR (s->>'alt')::numeric = 0)
    INTO v_span_ms, v_distinct_pos, v_distinct_acc, v_max_acc, v_all_int, v_no_alt
    FROM jsonb_array_elements(p_samples) s;

    IF v_n >= 3 AND COALESCE(v_span_ms, 0) >= 2500 AND v_distinct_pos = 1 AND v_distinct_acc = 1 THEN
      -- Not a single centimetre of drift over several seconds. At GPS-grade
      -- precision that doesn't happen for real; at Wi-Fi precision it can.
      v_flags := array_append(v_flags, CASE WHEN v_max_acc <= 10 THEN 'frozen_precise' ELSE 'frozen' END);
    END IF;

    IF v_n >= 3 AND v_all_int THEN
      v_flags := array_append(v_flags, 'integer_accuracy');
    END IF;

    IF v_n >= 3 AND v_no_alt AND v_max_acc <= 20 THEN
      v_flags := array_append(v_flags, 'no_altitude');
    END IF;

    -- Consecutive readings: > 300 m apart in < 10 s (> ~110 km/h standing
    -- at a job site), both claiming decent accuracy.
    FOR i IN 1 .. v_n - 1 LOOP
      a := p_samples -> (i - 1);
      b := p_samples -> i;
      v_dt := abs(COALESCE((b->>'at')::numeric, (b->>'ts')::numeric) - COALESCE((a->>'at')::numeric, (a->>'ts')::numeric)) / 1000.0;
      IF (a->>'acc')::numeric <= 50 AND (b->>'acc')::numeric <= 50 AND v_dt < 10 THEN
        v_step := public.iwm_distance_meters((a->>'lat')::numeric, (a->>'lng')::numeric, (b->>'lat')::numeric, (b->>'lng')::numeric);
        IF v_step > 300 THEN
          v_flags := array_append(v_flags, 'sample_jump');
          EXIT;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- The same account's previous decent-accuracy position in the last 6 h.
  IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    SELECT latitude, longitude, created_at INTO v_prev
    FROM public.activity_gps_events
    WHERE user_id = p_user_id AND latitude IS NOT NULL AND accuracy_m <= 100
      AND created_at > now() - interval '6 hours'
    ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      v_prev_dist := public.iwm_distance_meters(v_prev.latitude, v_prev.longitude, p_lat, p_lng);
      v_prev_hours := GREATEST(extract(epoch FROM now() - v_prev.created_at) / 3600.0, 1.0 / 3600);
      IF v_prev_dist > 20000 AND v_prev_dist / 1000.0 / v_prev_hours > 200 THEN
        v_flags := array_append(v_flags, 'impossible_travel');
      END IF;
    END IF;
  END IF;

  RETURN v_flags;
END;
$$;

REVOKE ALL ON FUNCTION public.iwm_gps_risk_flags(uuid, numeric, numeric, numeric, jsonb) FROM PUBLIC;

-- ── iwm_complete_activity, now with readings ──────────────────────────────
-- Dropped and recreated rather than overloaded: two versions side by side
-- would make PostgREST's choice of function ambiguous for callers.
DROP FUNCTION IF EXISTS public.iwm_complete_activity(uuid, numeric, numeric, numeric);

CREATE OR REPLACE FUNCTION public.iwm_complete_activity(
  p_activity_id uuid,
  p_lat numeric,
  p_lng numeric,
  p_accuracy numeric DEFAULT NULL,
  p_samples jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := public.jwt_user_id();
  v_activity record;
  v_category record;
  v_project record;
  v_target_lat numeric;
  v_target_lng numeric;
  v_distance numeric;
  v_gps_status text;
  v_evidence_count integer;
  v_flags text[] := '{}';
  v_blocking text[];
BEGIN
  IF v_user_id IS NULL OR NOT public.is_authenticated() THEN
    RAISE EXCEPTION 'No identity on token, or account is inactive.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_activity FROM public.activities WHERE id = p_activity_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Activity not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_activity.status NOT IN ('scheduled', 'in_progress') THEN
    RAISE EXCEPTION 'Activity is already completed or cancelled.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_category FROM public.activity_categories WHERE id = v_activity.category_id;
  SELECT * INTO v_project FROM public.projects WHERE id = v_activity.project_id;
  v_target_lat := COALESCE(v_activity.target_latitude, v_project.latitude);
  v_target_lng := COALESCE(v_activity.target_longitude, v_project.longitude);

  IF v_category.requires_gps THEN
    IF p_lat IS NULL OR p_lng IS NULL THEN
      v_gps_status := 'unavailable';
    ELSE
      v_flags := public.iwm_gps_risk_flags(v_user_id, p_lat, p_lng, p_accuracy, p_samples);
      v_blocking := ARRAY(SELECT unnest(v_flags) INTERSECT SELECT unnest(ARRAY['zero_accuracy', 'frozen_precise', 'sample_jump', 'no_samples']));
      IF array_length(v_blocking, 1) > 0 THEN
        v_gps_status := 'suspected_mock';
      ELSIF p_accuracy IS NOT NULL AND p_accuracy > v_category.gps_accuracy_threshold_m THEN
        v_gps_status := 'low_accuracy';
      ELSIF v_target_lat IS NULL OR v_target_lng IS NULL THEN
        v_gps_status := 'unavailable';
      ELSE
        v_distance := public.iwm_distance_meters(p_lat, p_lng, v_target_lat, v_target_lng);
        v_gps_status := CASE WHEN v_distance > v_category.gps_radius_m THEN 'outside_radius' ELSE 'valid' END;
      END IF;
    END IF;
  ELSE
    v_gps_status := 'valid';
  END IF;

  -- Always logged, pass or fail (spec §24), now with the raw readings and
  -- flags, so a blocked fake-GPS attempt stays visible to the reviewer.
  INSERT INTO public.activity_gps_events (
    activity_id, user_id, event_type, latitude, longitude, accuracy_m, distance_m, validation_status, samples, risk_flags
  ) VALUES (
    p_activity_id, v_user_id, 'complete', p_lat, p_lng, p_accuracy, v_distance, v_gps_status, p_samples, v_flags
  );

  IF v_category.requires_gps AND v_gps_status <> 'valid' THEN
    RETURN jsonb_build_object('blocked', true, 'reason', 'gps', 'validation_status', v_gps_status,
      'distance_m', v_distance, 'radius_m', v_category.gps_radius_m, 'signals', to_jsonb(v_blocking));
  END IF;

  IF v_category.requires_evidence THEN
    SELECT count(*) INTO v_evidence_count FROM public.activity_evidence WHERE activity_id = p_activity_id;
    IF v_evidence_count < v_category.evidence_min_count THEN
      RETURN jsonb_build_object('blocked', true, 'reason', 'evidence', 'evidence_count', v_evidence_count, 'required', v_category.evidence_min_count);
    END IF;
  END IF;

  IF v_category.requires_personnel AND v_activity.personnel_count < 1 THEN
    RETURN jsonb_build_object('blocked', true, 'reason', 'personnel');
  END IF;

  UPDATE public.activities SET
    status = 'completed',
    completed_at = now(),
    execution_latitude = p_lat,
    execution_longitude = p_lng,
    gps_accuracy_m = p_accuracy,
    gps_captured_at = now(),
    distance_from_target_m = v_distance,
    gps_validation_status = v_gps_status,
    gps_risk_flags = COALESCE(v_flags, '{}')
  WHERE id = p_activity_id;

  PERFORM public.log_audit(v_user_id, 'activity.completed', 'activity', p_activity_id,
    jsonb_build_object('validation_status', v_gps_status, 'distance_m', v_distance, 'gps_risk_flags', v_flags));

  RETURN jsonb_build_object('blocked', false, 'validation_status', v_gps_status, 'distance_m', v_distance, 'risk_flags', to_jsonb(v_flags));
END;
$$;

GRANT EXECUTE ON FUNCTION public.iwm_complete_activity(uuid, numeric, numeric, numeric, jsonb) TO anon, authenticated;

-- ── Flags can't be edited away by hand ─────────────────────────────────────
-- Same guard as 003, plus gps_risk_flags: only iwm_complete_activity()
-- (SECURITY DEFINER) sets it, so staff can't clear a warning with a PATCH.
CREATE OR REPLACE FUNCTION public.guard_activity_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF NEW.execution_latitude IS DISTINCT FROM OLD.execution_latitude
     OR NEW.execution_longitude IS DISTINCT FROM OLD.execution_longitude
     OR NEW.gps_accuracy_m IS DISTINCT FROM OLD.gps_accuracy_m
     OR NEW.gps_captured_at IS DISTINCT FROM OLD.gps_captured_at
     OR NEW.distance_from_target_m IS DISTINCT FROM OLD.distance_from_target_m
     OR NEW.gps_validation_status IS DISTINCT FROM OLD.gps_validation_status
     OR NEW.gps_risk_flags IS DISTINCT FROM OLD.gps_risk_flags
     OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
  THEN
    RAISE EXCEPTION 'Execution/GPS fields can only be set by iwm_complete_activity().' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'Use iwm_complete_activity() to complete an activity.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

-- >>>>>>>>>>>>>>>> 024_native_app_mock_location.sql >>>>>>>>>>>>>>>>
-- ============================================================================
-- Installer Work Management Platform — Migration 024
--
-- Android app (android/): Fake GPS verdict straight from Android. Run after 023.
--
-- Inside the Installer WM Android app, each GPS reading now carries two
-- values that no web browser can see:
--   mock    Android marked this fix as coming from a mock location provider
--   mockApp a fake-location app is enabled under Developer Options
-- Either one BLOCKS completion ('mock_provider'). This is the check that
-- actually catches Fake GPS apps, including ones that add random drift to
-- dodge 023's pattern checks.
--
-- Readings that didn't come through the app are flagged 'web_browser'.
-- When an admin turns on "require the Android app"
-- (platform_settings.require_native_app, off by default so nothing breaks
-- until the app is rolled out), 'web_browser' blocks too, which closes the
-- browser route to Fake GPS completely for GPS-verified jobs.
-- ============================================================================

ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS require_native_app boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.iwm_gps_risk_flags(
  p_user_id uuid, p_lat numeric, p_lng numeric, p_accuracy numeric, p_samples jsonb
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_flags text[] := '{}';
  v_n integer;
  v_span_ms numeric;
  v_distinct_pos integer;
  v_distinct_acc integer;
  v_max_acc numeric;
  v_all_int boolean;
  v_no_alt boolean;
  v_prev record;
  v_prev_dist numeric;
  v_prev_hours numeric;
  i integer;
  a jsonb;
  b jsonb;
  v_step numeric;
  v_dt numeric;
BEGIN
  IF p_accuracy IS NOT NULL AND p_accuracy <= 0 THEN
    v_flags := array_append(v_flags, 'zero_accuracy');
  END IF;

  IF p_samples IS NULL OR jsonb_typeof(p_samples) <> 'array' OR jsonb_array_length(p_samples) = 0 THEN
    v_flags := array_append(v_flags, 'no_samples');
    v_flags := array_append(v_flags, 'web_browser');
  ELSE
    v_n := jsonb_array_length(p_samples);

    SELECT
      max(COALESCE((s->>'at')::numeric, (s->>'ts')::numeric)) - min(COALESCE((s->>'at')::numeric, (s->>'ts')::numeric)),
      count(DISTINCT (round((s->>'lat')::numeric, 7), round((s->>'lng')::numeric, 7))),
      count(DISTINCT (s->>'acc')::numeric),
      max((s->>'acc')::numeric),
      bool_and((s->>'acc')::numeric = trunc((s->>'acc')::numeric)),
      bool_and(s->>'alt' IS NULL OR (s->>'alt')::numeric = 0)
    INTO v_span_ms, v_distinct_pos, v_distinct_acc, v_max_acc, v_all_int, v_no_alt
    FROM jsonb_array_elements(p_samples) s;

    IF v_n >= 3 AND COALESCE(v_span_ms, 0) >= 2500 AND v_distinct_pos = 1 AND v_distinct_acc = 1 THEN
      -- Not a single centimetre of drift over several seconds. At GPS-grade
      -- precision that doesn't happen for real; at Wi-Fi precision it can.
      v_flags := array_append(v_flags, CASE WHEN v_max_acc <= 10 THEN 'frozen_precise' ELSE 'frozen' END);
    END IF;

    -- Inside the Android app each reading carries Android's own verdict:
    -- mock = this fix came from a mock provider; mockApp = a fake-location
    -- app is enabled in Developer Options. Either one is decisive.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_samples) s
               WHERE (s->>'mock')::boolean IS TRUE OR (s->>'mockApp')::boolean IS TRUE) THEN
      v_flags := array_append(v_flags, 'mock_provider');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_samples) s WHERE s->>'src' = 'native') THEN
      v_flags := array_append(v_flags, 'web_browser');
    END IF;

    IF v_n >= 3 AND v_all_int THEN
      v_flags := array_append(v_flags, 'integer_accuracy');
    END IF;

    IF v_n >= 3 AND v_no_alt AND v_max_acc <= 20 THEN
      v_flags := array_append(v_flags, 'no_altitude');
    END IF;

    -- Consecutive readings: > 300 m apart in < 10 s (> ~110 km/h standing
    -- at a job site), both claiming decent accuracy.
    FOR i IN 1 .. v_n - 1 LOOP
      a := p_samples -> (i - 1);
      b := p_samples -> i;
      v_dt := abs(COALESCE((b->>'at')::numeric, (b->>'ts')::numeric) - COALESCE((a->>'at')::numeric, (a->>'ts')::numeric)) / 1000.0;
      IF (a->>'acc')::numeric <= 50 AND (b->>'acc')::numeric <= 50 AND v_dt < 10 THEN
        v_step := public.iwm_distance_meters((a->>'lat')::numeric, (a->>'lng')::numeric, (b->>'lat')::numeric, (b->>'lng')::numeric);
        IF v_step > 300 THEN
          v_flags := array_append(v_flags, 'sample_jump');
          EXIT;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- The same account's previous decent-accuracy position in the last 6 h.
  IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    SELECT latitude, longitude, created_at INTO v_prev
    FROM public.activity_gps_events
    WHERE user_id = p_user_id AND latitude IS NOT NULL AND accuracy_m <= 100
      AND created_at > now() - interval '6 hours'
    ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      v_prev_dist := public.iwm_distance_meters(v_prev.latitude, v_prev.longitude, p_lat, p_lng);
      v_prev_hours := GREATEST(extract(epoch FROM now() - v_prev.created_at) / 3600.0, 1.0 / 3600);
      IF v_prev_dist > 20000 AND v_prev_dist / 1000.0 / v_prev_hours > 200 THEN
        v_flags := array_append(v_flags, 'impossible_travel');
      END IF;
    END IF;
  END IF;

  RETURN v_flags;
END;
$$;

CREATE OR REPLACE FUNCTION public.iwm_complete_activity(
  p_activity_id uuid,
  p_lat numeric,
  p_lng numeric,
  p_accuracy numeric DEFAULT NULL,
  p_samples jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := public.jwt_user_id();
  v_activity record;
  v_category record;
  v_project record;
  v_target_lat numeric;
  v_target_lng numeric;
  v_distance numeric;
  v_gps_status text;
  v_evidence_count integer;
  v_flags text[] := '{}';
  v_blocking text[];
  v_require_app boolean := COALESCE((SELECT require_native_app FROM public.platform_settings WHERE id = true), false);
BEGIN
  IF v_user_id IS NULL OR NOT public.is_authenticated() THEN
    RAISE EXCEPTION 'No identity on token, or account is inactive.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_activity FROM public.activities WHERE id = p_activity_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Activity not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_activity.status NOT IN ('scheduled', 'in_progress') THEN
    RAISE EXCEPTION 'Activity is already completed or cancelled.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_category FROM public.activity_categories WHERE id = v_activity.category_id;
  SELECT * INTO v_project FROM public.projects WHERE id = v_activity.project_id;
  v_target_lat := COALESCE(v_activity.target_latitude, v_project.latitude);
  v_target_lng := COALESCE(v_activity.target_longitude, v_project.longitude);

  IF v_category.requires_gps THEN
    IF p_lat IS NULL OR p_lng IS NULL THEN
      v_gps_status := 'unavailable';
    ELSE
      v_flags := public.iwm_gps_risk_flags(v_user_id, p_lat, p_lng, p_accuracy, p_samples);
      v_blocking := ARRAY(SELECT unnest(v_flags) INTERSECT SELECT unnest(
        ARRAY['zero_accuracy', 'frozen_precise', 'sample_jump', 'no_samples', 'mock_provider']
        || CASE WHEN v_require_app THEN ARRAY['web_browser'] ELSE ARRAY[]::text[] END));
      IF array_length(v_blocking, 1) > 0 THEN
        v_gps_status := 'suspected_mock';
      ELSIF p_accuracy IS NOT NULL AND p_accuracy > v_category.gps_accuracy_threshold_m THEN
        v_gps_status := 'low_accuracy';
      ELSIF v_target_lat IS NULL OR v_target_lng IS NULL THEN
        v_gps_status := 'unavailable';
      ELSE
        v_distance := public.iwm_distance_meters(p_lat, p_lng, v_target_lat, v_target_lng);
        v_gps_status := CASE WHEN v_distance > v_category.gps_radius_m THEN 'outside_radius' ELSE 'valid' END;
      END IF;
    END IF;
  ELSE
    v_gps_status := 'valid';
  END IF;

  -- Always logged, pass or fail (spec §24), now with the raw readings and
  -- flags, so a blocked fake-GPS attempt stays visible to the reviewer.
  INSERT INTO public.activity_gps_events (
    activity_id, user_id, event_type, latitude, longitude, accuracy_m, distance_m, validation_status, samples, risk_flags
  ) VALUES (
    p_activity_id, v_user_id, 'complete', p_lat, p_lng, p_accuracy, v_distance, v_gps_status, p_samples, v_flags
  );

  IF v_category.requires_gps AND v_gps_status <> 'valid' THEN
    RETURN jsonb_build_object('blocked', true, 'reason', 'gps', 'validation_status', v_gps_status,
      'distance_m', v_distance, 'radius_m', v_category.gps_radius_m, 'signals', to_jsonb(v_blocking));
  END IF;

  IF v_category.requires_evidence THEN
    SELECT count(*) INTO v_evidence_count FROM public.activity_evidence WHERE activity_id = p_activity_id;
    IF v_evidence_count < v_category.evidence_min_count THEN
      RETURN jsonb_build_object('blocked', true, 'reason', 'evidence', 'evidence_count', v_evidence_count, 'required', v_category.evidence_min_count);
    END IF;
  END IF;

  IF v_category.requires_personnel AND v_activity.personnel_count < 1 THEN
    RETURN jsonb_build_object('blocked', true, 'reason', 'personnel');
  END IF;

  UPDATE public.activities SET
    status = 'completed',
    completed_at = now(),
    execution_latitude = p_lat,
    execution_longitude = p_lng,
    gps_accuracy_m = p_accuracy,
    gps_captured_at = now(),
    distance_from_target_m = v_distance,
    gps_validation_status = v_gps_status,
    gps_risk_flags = COALESCE(v_flags, '{}')
  WHERE id = p_activity_id;

  PERFORM public.log_audit(v_user_id, 'activity.completed', 'activity', p_activity_id,
    jsonb_build_object('validation_status', v_gps_status, 'distance_m', v_distance, 'gps_risk_flags', v_flags));

  RETURN jsonb_build_object('blocked', false, 'validation_status', v_gps_status, 'distance_m', v_distance, 'risk_flags', to_jsonb(v_flags));
END;
$$;

-- >>>>>>>>>>>>>>>> 025_start_checkin_and_password_reset.sql >>>>>>>>>>>>>>>>
-- ============================================================================
-- Installer Work Management Platform — Migration 025
-- Run after 024.
--
-- 1. GPS check-in at START, not just at completion.
--    Before this, "Mulai" (start) had no location check at all: an installer
--    could start a job from home and only needed to be on site to finish
--    it. For GPS-verified categories, starting now goes through
--    iwm_start_activity(). It runs the same checks as completion: on-site
--    radius, accuracy, and every Fake GPS signal from 023/024. The start
--    position and time are stored on the activity for the reviewer.
--    A guard trigger refuses any other route to 'in_progress' for those
--    categories (a direct status change, or the old
--    iwm_set_activity_status call), except for admin/supervisor, who can
--    still start one from the office as an override.
--
-- 2. Forgot-password requests.
--    There's no email service, so password resets stay with the admin, but
--    now a user can ask for one from the login page instead of finding the
--    admin some other way. Requests are written only by the server
--    (/api/auth/forgot-password, service role) and read/handled by admins.
-- ============================================================================

-- ── 1. Start check-in ──────────────────────────────────────────────────────
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS start_latitude numeric(9,6);
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS start_longitude numeric(9,6);
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS start_accuracy_m numeric;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS start_distance_m numeric;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS start_gps_flags text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.activity_gps_events DROP CONSTRAINT IF EXISTS activity_gps_events_type_check;
ALTER TABLE public.activity_gps_events ADD CONSTRAINT activity_gps_events_type_check
  CHECK (event_type = ANY (ARRAY['start', 'complete']));

CREATE OR REPLACE FUNCTION public.iwm_start_activity(
  p_activity_id uuid,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_accuracy numeric DEFAULT NULL,
  p_samples jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := public.jwt_user_id();
  v_activity record;
  v_category record;
  v_project record;
  v_target_lat numeric;
  v_target_lng numeric;
  v_distance numeric;
  v_status text := 'valid';
  v_flags text[] := '{}';
  v_blocking text[];
  v_require_app boolean := COALESCE((SELECT require_native_app FROM public.platform_settings WHERE id = true), false);
BEGIN
  IF v_user_id IS NULL OR NOT public.is_authenticated() THEN
    RAISE EXCEPTION 'No identity on token, or account is inactive.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_activity FROM public.activities WHERE id = p_activity_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Activity not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_activity.status <> 'scheduled' THEN
    RAISE EXCEPTION 'Only a scheduled activity can be started.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_category FROM public.activity_categories WHERE id = v_activity.category_id;
  SELECT * INTO v_project FROM public.projects WHERE id = v_activity.project_id;
  v_target_lat := COALESCE(v_activity.target_latitude, v_project.latitude);
  v_target_lng := COALESCE(v_activity.target_longitude, v_project.longitude);

  IF v_category.requires_gps THEN
    IF p_lat IS NULL OR p_lng IS NULL THEN
      v_status := 'unavailable';
    ELSE
      v_flags := public.iwm_gps_risk_flags(v_user_id, p_lat, p_lng, p_accuracy, p_samples);
      v_blocking := ARRAY(SELECT unnest(v_flags) INTERSECT SELECT unnest(
        ARRAY['zero_accuracy', 'frozen_precise', 'sample_jump', 'no_samples', 'mock_provider']
        || CASE WHEN v_require_app THEN ARRAY['web_browser'] ELSE ARRAY[]::text[] END));
      IF array_length(v_blocking, 1) > 0 THEN
        v_status := 'suspected_mock';
      ELSIF p_accuracy IS NOT NULL AND p_accuracy > v_category.gps_accuracy_threshold_m THEN
        v_status := 'low_accuracy';
      ELSIF v_target_lat IS NULL OR v_target_lng IS NULL THEN
        v_status := 'unavailable';
      ELSE
        v_distance := public.iwm_distance_meters(p_lat, p_lng, v_target_lat, v_target_lng);
        v_status := CASE WHEN v_distance > v_category.gps_radius_m THEN 'outside_radius' ELSE 'valid' END;
      END IF;
    END IF;

    INSERT INTO public.activity_gps_events (
      activity_id, user_id, event_type, latitude, longitude, accuracy_m, distance_m, validation_status, samples, risk_flags
    ) VALUES (
      p_activity_id, v_user_id, 'start', p_lat, p_lng, p_accuracy, v_distance, v_status, p_samples, v_flags
    );

    IF v_status <> 'valid' THEN
      RETURN jsonb_build_object('blocked', true, 'reason', 'gps', 'validation_status', v_status,
        'distance_m', v_distance, 'radius_m', v_category.gps_radius_m, 'signals', to_jsonb(v_blocking));
    END IF;
  END IF;

  -- Lets guard_activity_start_checkin() below know this update came through
  -- the checked path. Transaction-local, so it can't leak to another call.
  PERFORM set_config('iwm.start_checked', '1', true);
  UPDATE public.activities SET
    status = 'in_progress',
    started_at = now(),
    start_latitude = p_lat,
    start_longitude = p_lng,
    start_accuracy_m = p_accuracy,
    start_distance_m = v_distance,
    start_gps_flags = COALESCE(v_flags, '{}')
  WHERE id = p_activity_id;
  PERFORM set_config('iwm.start_checked', '', true);

  PERFORM public.log_audit(v_user_id, 'activity.started', 'activity', p_activity_id,
    jsonb_build_object('distance_m', v_distance, 'gps_risk_flags', v_flags));

  RETURN jsonb_build_object('blocked', false, 'distance_m', v_distance, 'risk_flags', to_jsonb(v_flags));
END;
$$;

GRANT EXECUTE ON FUNCTION public.iwm_start_activity(uuid, numeric, numeric, numeric, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_activity_start_checkin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF OLD.status = 'scheduled' AND NEW.status = 'in_progress'
     AND public.jwt_user_id() IS NOT NULL          -- a real user, not a server job
     AND NOT public.is_staff()                      -- office override stays possible
     AND COALESCE(current_setting('iwm.start_checked', true), '') <> '1'
     AND (SELECT requires_gps FROM public.activity_categories WHERE id = NEW.category_id)
  THEN
    RAISE EXCEPTION 'This activity needs a GPS check-in on site to start. Use iwm_start_activity().'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_guard_activity_start_checkin
  BEFORE UPDATE OF status ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.guard_activity_start_checkin();

-- The check-in record is as protected as the completion one.
CREATE OR REPLACE FUNCTION public.guard_activity_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF NEW.execution_latitude IS DISTINCT FROM OLD.execution_latitude
     OR NEW.execution_longitude IS DISTINCT FROM OLD.execution_longitude
     OR NEW.gps_accuracy_m IS DISTINCT FROM OLD.gps_accuracy_m
     OR NEW.gps_captured_at IS DISTINCT FROM OLD.gps_captured_at
     OR NEW.distance_from_target_m IS DISTINCT FROM OLD.distance_from_target_m
     OR NEW.gps_validation_status IS DISTINCT FROM OLD.gps_validation_status
     OR NEW.gps_risk_flags IS DISTINCT FROM OLD.gps_risk_flags
     OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.start_latitude IS DISTINCT FROM OLD.start_latitude
     OR NEW.start_longitude IS DISTINCT FROM OLD.start_longitude
     OR NEW.start_accuracy_m IS DISTINCT FROM OLD.start_accuracy_m
     OR NEW.start_distance_m IS DISTINCT FROM OLD.start_distance_m
     OR NEW.start_gps_flags IS DISTINCT FROM OLD.start_gps_flags
  THEN
    RAISE EXCEPTION 'Execution/GPS fields can only be set by iwm_start_activity() / iwm_complete_activity().' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'Use iwm_complete_activity() to complete an activity.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

-- ── 2. Forgot-password requests ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.password_reset_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  username text NOT NULL,
  contact text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
  resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_requests_status ON public.password_reset_requests (status, created_at DESC);

ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;
-- Admin only. Inserts come from the server route (service role), so there's
-- deliberately no INSERT policy for clients.
DROP POLICY IF EXISTS password_reset_requests_select ON public.password_reset_requests;
CREATE POLICY password_reset_requests_select ON public.password_reset_requests FOR SELECT TO anon
  USING (public.current_role_from_db() = 'admin');
DROP POLICY IF EXISTS password_reset_requests_update ON public.password_reset_requests;
CREATE POLICY password_reset_requests_update ON public.password_reset_requests FOR UPDATE TO anon
  USING (public.current_role_from_db() = 'admin') WITH CHECK (public.current_role_from_db() = 'admin');

-- >>>>>>>>>>>>>>>> 026_gps_challenge_and_app_attestation.sql >>>>>>>>>>>>>>>>
-- ============================================================================
-- Installer Work Management Platform — Migration 026
-- Run after 025.
--
-- Closes the gaps left in the Fake GPS defence (023–025). Until now every
-- signal the server judged ("this came from the Android app", "Android says
-- it isn't mocked", "this reading is recent") was simply whatever the phone
-- sent, and the source code saying what to send is public. Open the web app
-- in a desktop browser, define window.IWMNative in the console, and every
-- reading arrived as a clean "native" one. Or skip the page and call
-- iwm_complete_activity() with a hand-made series.
--
-- 1. A server-issued challenge per GPS capture (iwm_gps_challenge()).
--    Each reading series carries a one-off nonce the server handed out
--    moments before, timed on the SERVER's clock:
--      'stale_reading'  nonce older than 15 minutes: captured on site,
--                       submitted later from somewhere else          → blocks
--      'bad_challenge'  unknown nonce, someone else's, or mixed      → blocks
--      'no_challenge'   no nonce at all (a page loaded before this
--                       release). Flag only, until an app signing key
--                       is installed (2.), then it blocks too.
--
-- 2. Readings signed by the Android app (1.5+).
--    The app signs each reading (nonce, position, accuracy, and its own
--    Fake GPS / emulator / root / cloned-app verdicts) with HMAC-SHA256,
--    using a key baked in at build time (android/gps.key, never in git).
--    Once that key is added to app_attestation_keys (build.sh prints the
--    exact INSERT), a reading only counts as "from the app" when its
--    signature checks out:
--      signature present but wrong           → 'bad_signature' (blocks)
--      claims to be the app but isn't signed → counted as a browser
--        ('web_browser'; blocks when the Android app is required)
--    With no key installed, everything behaves exactly as before 026.
--
-- 3. Environments the app now reports (signed, so a page can't hide them):
--      'emulator'     BlueStacks, LDPlayer, Nox, MEmu, the SDK emulator…,
--                     where the location is typed in by hand         → blocks
--      'virtual_env'  run inside a cloning app (Parallel Space,
--                     VirtualXposed…), which can feed it any location → blocks
--      'rooted'       root tools can hide a Fake GPS app from Android's own
--                     check. Flagged for the reviewer; blocks once the
--                     Android app is required (strict mode).
--
-- No function signature changes: the nonce and signatures travel inside
-- p_samples, so old and new pages call the same RPCs.
-- ============================================================================

-- ── Tables (service-side only: RLS on, no policies) ───────────────────────
CREATE TABLE IF NOT EXISTS public.gps_challenges (
  nonce uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gps_challenges_created ON public.gps_challenges (created_at);
ALTER TABLE public.gps_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gps_challenges FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.app_attestation_keys (
  key_id text NOT NULL PRIMARY KEY,
  secret text NOT NULL CHECK (length(secret) >= 32),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_attestation_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_attestation_keys FROM anon, authenticated;

-- ── 1. Challenge ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.iwm_gps_challenge()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := public.jwt_user_id();
  v_nonce uuid;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_authenticated() THEN
    RAISE EXCEPTION 'No identity on token, or account is inactive.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM public.gps_challenges WHERE created_at < now() - interval '1 day';
  INSERT INTO public.gps_challenges (user_id) VALUES (v_user_id) RETURNING nonce INTO v_nonce;
  RETURN jsonb_build_object('nonce', v_nonce);
END;
$$;

REVOKE ALL ON FUNCTION public.iwm_gps_challenge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.iwm_gps_challenge() TO anon, authenticated;

-- ── 2. Signature check ─────────────────────────────────────────────────────
-- 'extensions' on the search path: that's where Supabase keeps pgcrypto.
CREATE OR REPLACE FUNCTION public.iwm_attestation_valid(p_payload text, p_sig text, p_key_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_attestation_keys k
    WHERE k.key_id = p_key_id AND k.active
      AND encode(hmac(p_payload, k.secret, 'sha256'), 'hex') = lower(p_sig)
  );
$$;

-- Internal only: Supabase grants EXECUTE on new functions to anon by default.
REVOKE ALL ON FUNCTION public.iwm_attestation_valid(text, text, text) FROM PUBLIC, anon, authenticated;

-- ── Which flags stop a start/completion ────────────────────────────────────
-- One list for iwm_start_activity() and iwm_complete_activity(), instead of
-- the copy each of them carried.
CREATE OR REPLACE FUNCTION public.iwm_gps_blocking(p_flags text[])
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT ARRAY(
    SELECT unnest(p_flags)
    INTERSECT
    SELECT unnest(
      ARRAY['zero_accuracy', 'frozen_precise', 'sample_jump', 'no_samples', 'mock_provider',
            'bad_challenge', 'stale_reading', 'bad_signature', 'emulator', 'virtual_env']
      || CASE WHEN COALESCE((SELECT require_native_app FROM public.platform_settings WHERE id = true), false)
              THEN ARRAY['web_browser', 'rooted'] ELSE ARRAY[]::text[] END
      || CASE WHEN EXISTS (SELECT 1 FROM public.app_attestation_keys WHERE active)
              THEN ARRAY['no_challenge'] ELSE ARRAY[]::text[] END
    )
  );
$$;

REVOKE ALL ON FUNCTION public.iwm_gps_blocking(text[]) FROM PUBLIC, anon, authenticated;

-- ── The checks (023/024, plus the above) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.iwm_gps_risk_flags(
  p_user_id uuid, p_lat numeric, p_lng numeric, p_accuracy numeric, p_samples jsonb
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_flags text[] := '{}';
  v_n integer;
  v_span_ms numeric;
  v_distinct_pos integer;
  v_distinct_acc integer;
  v_max_acc numeric;
  v_all_int boolean;
  v_no_alt boolean;
  v_prev record;
  v_prev_dist numeric;
  v_prev_hours numeric;
  i integer;
  a jsonb;
  b jsonb;
  v_step numeric;
  v_dt numeric;
  v_nonce text;
  v_challenge_at timestamptz;
  v_has_key boolean := EXISTS (SELECT 1 FROM public.app_attestation_keys WHERE active);
  v_sample jsonb;
  v_att text[];
  v_sig_ok boolean;
  v_native_ok boolean := false;
  v_bad_sig boolean := false;
  v_signed_mock boolean := false;
  v_emulator boolean := false;
  v_rooted boolean := false;
  v_virtual boolean := false;
BEGIN
  IF p_accuracy IS NOT NULL AND p_accuracy <= 0 THEN
    v_flags := array_append(v_flags, 'zero_accuracy');
  END IF;

  IF p_samples IS NULL OR jsonb_typeof(p_samples) <> 'array' OR jsonb_array_length(p_samples) = 0 THEN
    v_flags := array_append(v_flags, 'no_samples');
    v_flags := array_append(v_flags, 'web_browser');
  ELSE
    v_n := jsonb_array_length(p_samples);

    -- Freshness, on the server's clock. Every reading in the series must
    -- carry the same nonce, issued to this account.
    v_nonce := p_samples -> 0 ->> 'nonce';
    IF v_nonce IS NULL THEN
      v_flags := array_append(v_flags, 'no_challenge');
    ELSIF v_nonce !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_samples) s WHERE s->>'nonce' IS DISTINCT FROM v_nonce) THEN
      v_flags := array_append(v_flags, 'bad_challenge');
    ELSE
      SELECT created_at INTO v_challenge_at FROM public.gps_challenges
      WHERE nonce = v_nonce::uuid AND user_id = p_user_id;
      IF NOT FOUND THEN
        v_flags := array_append(v_flags, 'bad_challenge');
      ELSIF v_challenge_at < now() - interval '15 minutes' THEN
        v_flags := array_append(v_flags, 'stale_reading');
      END IF;
    END IF;

    SELECT
      max(COALESCE((s->>'at')::numeric, (s->>'ts')::numeric)) - min(COALESCE((s->>'at')::numeric, (s->>'ts')::numeric)),
      count(DISTINCT (round((s->>'lat')::numeric, 7), round((s->>'lng')::numeric, 7))),
      count(DISTINCT (s->>'acc')::numeric),
      max((s->>'acc')::numeric),
      bool_and((s->>'acc')::numeric = trunc((s->>'acc')::numeric)),
      bool_and(s->>'alt' IS NULL OR (s->>'alt')::numeric = 0)
    INTO v_span_ms, v_distinct_pos, v_distinct_acc, v_max_acc, v_all_int, v_no_alt
    FROM jsonb_array_elements(p_samples) s;

    IF v_n >= 3 AND COALESCE(v_span_ms, 0) >= 2500 AND v_distinct_pos = 1 AND v_distinct_acc = 1 THEN
      -- Not a single centimetre of drift over several seconds. At GPS-grade
      -- precision that doesn't happen for real; at Wi-Fi precision it can.
      v_flags := array_append(v_flags, CASE WHEN v_max_acc <= 10 THEN 'frozen_precise' ELSE 'frozen' END);
    END IF;

    -- Android's own verdict, as the page relayed it (024). Unsigned, so it
    -- can only ever add suspicion, never remove it.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_samples) s
               WHERE (s->>'mock')::boolean IS TRUE OR (s->>'mockApp')::boolean IS TRUE) THEN
      v_flags := array_append(v_flags, 'mock_provider');
    END IF;

    -- Which readings provably came from the Android app. Signed payload:
    --   v1|nonce|lat|lng|acc|ts|mock|mockApp|emulator|rooted|virtual
    FOR v_sample IN SELECT value FROM jsonb_array_elements(p_samples) LOOP
      CONTINUE WHEN v_sample->>'src' IS DISTINCT FROM 'native';
      IF NOT v_has_key THEN
        v_native_ok := true; -- no key installed yet: trusted as before 026
        CONTINUE;
      END IF;
      -- Unsigned: an app build from before 1.5, or a page pretending.
      CONTINUE WHEN v_sample->>'att' IS NULL OR v_sample->>'sig' IS NULL;
      v_att := string_to_array(v_sample->>'att', '|');
      BEGIN
        v_sig_ok := public.iwm_attestation_valid(v_sample->>'att', v_sample->>'sig', v_sample->>'kid')
          AND array_length(v_att, 1) = 11 AND v_att[1] = 'v1'
          AND COALESCE(v_att[2], '') = COALESCE(v_nonce, '')
          AND abs(v_att[3]::numeric - (v_sample->>'lat')::numeric) < 0.000001
          AND abs(v_att[4]::numeric - (v_sample->>'lng')::numeric) < 0.000001;
      EXCEPTION WHEN others THEN
        v_sig_ok := false; -- malformed payload
      END;
      IF NOT v_sig_ok THEN
        v_bad_sig := true;
        CONTINUE;
      END IF;
      v_native_ok := true;
      v_signed_mock := v_signed_mock OR v_att[7] = '1' OR v_att[8] = '1';
      v_emulator := v_emulator OR v_att[9] = '1';
      v_rooted := v_rooted OR v_att[10] = '1';
      v_virtual := v_virtual OR v_att[11] = '1';
    END LOOP;

    IF v_bad_sig THEN v_flags := array_append(v_flags, 'bad_signature'); END IF;
    IF v_signed_mock AND NOT ('mock_provider' = ANY (v_flags)) THEN v_flags := array_append(v_flags, 'mock_provider'); END IF;
    IF v_emulator THEN v_flags := array_append(v_flags, 'emulator'); END IF;
    IF v_virtual THEN v_flags := array_append(v_flags, 'virtual_env'); END IF;
    IF v_rooted THEN v_flags := array_append(v_flags, 'rooted'); END IF;
    IF NOT v_native_ok THEN v_flags := array_append(v_flags, 'web_browser'); END IF;

    IF v_n >= 3 AND v_all_int THEN
      v_flags := array_append(v_flags, 'integer_accuracy');
    END IF;

    IF v_n >= 3 AND v_no_alt AND v_max_acc <= 20 THEN
      v_flags := array_append(v_flags, 'no_altitude');
    END IF;

    -- Consecutive readings: > 300 m apart in < 10 s (> ~110 km/h standing
    -- at a job site), both claiming decent accuracy.
    FOR i IN 1 .. v_n - 1 LOOP
      a := p_samples -> (i - 1);
      b := p_samples -> i;
      v_dt := abs(COALESCE((b->>'at')::numeric, (b->>'ts')::numeric) - COALESCE((a->>'at')::numeric, (a->>'ts')::numeric)) / 1000.0;
      IF (a->>'acc')::numeric <= 50 AND (b->>'acc')::numeric <= 50 AND v_dt < 10 THEN
        v_step := public.iwm_distance_meters((a->>'lat')::numeric, (a->>'lng')::numeric, (b->>'lat')::numeric, (b->>'lng')::numeric);
        IF v_step > 300 THEN
          v_flags := array_append(v_flags, 'sample_jump');
          EXIT;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- The same account's previous decent-accuracy position in the last 6 h.
  IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    SELECT latitude, longitude, created_at INTO v_prev
    FROM public.activity_gps_events
    WHERE user_id = p_user_id AND latitude IS NOT NULL AND accuracy_m <= 100
      AND created_at > now() - interval '6 hours'
    ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      v_prev_dist := public.iwm_distance_meters(v_prev.latitude, v_prev.longitude, p_lat, p_lng);
      v_prev_hours := GREATEST(extract(epoch FROM now() - v_prev.created_at) / 3600.0, 1.0 / 3600);
      IF v_prev_dist > 20000 AND v_prev_dist / 1000.0 / v_prev_hours > 200 THEN
        v_flags := array_append(v_flags, 'impossible_travel');
      END IF;
    END IF;
  END IF;

  RETURN v_flags;
END;
$$;

-- ── Start (025) and completion (024), now on the shared blocking list ──────
CREATE OR REPLACE FUNCTION public.iwm_start_activity(
  p_activity_id uuid,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_accuracy numeric DEFAULT NULL,
  p_samples jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := public.jwt_user_id();
  v_activity record;
  v_category record;
  v_project record;
  v_target_lat numeric;
  v_target_lng numeric;
  v_distance numeric;
  v_status text := 'valid';
  v_flags text[] := '{}';
  v_blocking text[];
BEGIN
  IF v_user_id IS NULL OR NOT public.is_authenticated() THEN
    RAISE EXCEPTION 'No identity on token, or account is inactive.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_activity FROM public.activities WHERE id = p_activity_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Activity not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_activity.status <> 'scheduled' THEN
    RAISE EXCEPTION 'Only a scheduled activity can be started.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_category FROM public.activity_categories WHERE id = v_activity.category_id;
  SELECT * INTO v_project FROM public.projects WHERE id = v_activity.project_id;
  v_target_lat := COALESCE(v_activity.target_latitude, v_project.latitude);
  v_target_lng := COALESCE(v_activity.target_longitude, v_project.longitude);

  IF v_category.requires_gps THEN
    IF p_lat IS NULL OR p_lng IS NULL THEN
      v_status := 'unavailable';
    ELSE
      v_flags := public.iwm_gps_risk_flags(v_user_id, p_lat, p_lng, p_accuracy, p_samples);
      v_blocking := public.iwm_gps_blocking(v_flags);
      IF array_length(v_blocking, 1) > 0 THEN
        v_status := 'suspected_mock';
      ELSIF p_accuracy IS NOT NULL AND p_accuracy > v_category.gps_accuracy_threshold_m THEN
        v_status := 'low_accuracy';
      ELSIF v_target_lat IS NULL OR v_target_lng IS NULL THEN
        v_status := 'unavailable';
      ELSE
        v_distance := public.iwm_distance_meters(p_lat, p_lng, v_target_lat, v_target_lng);
        v_status := CASE WHEN v_distance > v_category.gps_radius_m THEN 'outside_radius' ELSE 'valid' END;
      END IF;
    END IF;

    INSERT INTO public.activity_gps_events (
      activity_id, user_id, event_type, latitude, longitude, accuracy_m, distance_m, validation_status, samples, risk_flags
    ) VALUES (
      p_activity_id, v_user_id, 'start', p_lat, p_lng, p_accuracy, v_distance, v_status, p_samples, v_flags
    );

    IF v_status <> 'valid' THEN
      RETURN jsonb_build_object('blocked', true, 'reason', 'gps', 'validation_status', v_status,
        'distance_m', v_distance, 'radius_m', v_category.gps_radius_m, 'signals', to_jsonb(v_blocking));
    END IF;
  END IF;

  -- Lets guard_activity_start_checkin() (025) know this update came through
  -- the checked path. Transaction-local, so it can't leak to another call.
  PERFORM set_config('iwm.start_checked', '1', true);
  UPDATE public.activities SET
    status = 'in_progress',
    started_at = now(),
    start_latitude = p_lat,
    start_longitude = p_lng,
    start_accuracy_m = p_accuracy,
    start_distance_m = v_distance,
    start_gps_flags = COALESCE(v_flags, '{}')
  WHERE id = p_activity_id;
  PERFORM set_config('iwm.start_checked', '', true);

  PERFORM public.log_audit(v_user_id, 'activity.started', 'activity', p_activity_id,
    jsonb_build_object('distance_m', v_distance, 'gps_risk_flags', v_flags));

  RETURN jsonb_build_object('blocked', false, 'distance_m', v_distance, 'risk_flags', to_jsonb(v_flags));
END;
$$;

CREATE OR REPLACE FUNCTION public.iwm_complete_activity(
  p_activity_id uuid,
  p_lat numeric,
  p_lng numeric,
  p_accuracy numeric DEFAULT NULL,
  p_samples jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := public.jwt_user_id();
  v_activity record;
  v_category record;
  v_project record;
  v_target_lat numeric;
  v_target_lng numeric;
  v_distance numeric;
  v_gps_status text;
  v_evidence_count integer;
  v_flags text[] := '{}';
  v_blocking text[];
BEGIN
  IF v_user_id IS NULL OR NOT public.is_authenticated() THEN
    RAISE EXCEPTION 'No identity on token, or account is inactive.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_activity FROM public.activities WHERE id = p_activity_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Activity not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_activity.status NOT IN ('scheduled', 'in_progress') THEN
    RAISE EXCEPTION 'Activity is already completed or cancelled.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_category FROM public.activity_categories WHERE id = v_activity.category_id;
  SELECT * INTO v_project FROM public.projects WHERE id = v_activity.project_id;
  v_target_lat := COALESCE(v_activity.target_latitude, v_project.latitude);
  v_target_lng := COALESCE(v_activity.target_longitude, v_project.longitude);

  IF v_category.requires_gps THEN
    IF p_lat IS NULL OR p_lng IS NULL THEN
      v_gps_status := 'unavailable';
    ELSE
      v_flags := public.iwm_gps_risk_flags(v_user_id, p_lat, p_lng, p_accuracy, p_samples);
      v_blocking := public.iwm_gps_blocking(v_flags);
      IF array_length(v_blocking, 1) > 0 THEN
        v_gps_status := 'suspected_mock';
      ELSIF p_accuracy IS NOT NULL AND p_accuracy > v_category.gps_accuracy_threshold_m THEN
        v_gps_status := 'low_accuracy';
      ELSIF v_target_lat IS NULL OR v_target_lng IS NULL THEN
        v_gps_status := 'unavailable';
      ELSE
        v_distance := public.iwm_distance_meters(p_lat, p_lng, v_target_lat, v_target_lng);
        v_gps_status := CASE WHEN v_distance > v_category.gps_radius_m THEN 'outside_radius' ELSE 'valid' END;
      END IF;
    END IF;
  ELSE
    v_gps_status := 'valid';
  END IF;

  -- Always logged, pass or fail (spec §24), with the raw readings and
  -- flags, so a blocked fake-GPS attempt stays visible to the reviewer.
  INSERT INTO public.activity_gps_events (
    activity_id, user_id, event_type, latitude, longitude, accuracy_m, distance_m, validation_status, samples, risk_flags
  ) VALUES (
    p_activity_id, v_user_id, 'complete', p_lat, p_lng, p_accuracy, v_distance, v_gps_status, p_samples, v_flags
  );

  IF v_category.requires_gps AND v_gps_status <> 'valid' THEN
    RETURN jsonb_build_object('blocked', true, 'reason', 'gps', 'validation_status', v_gps_status,
      'distance_m', v_distance, 'radius_m', v_category.gps_radius_m, 'signals', to_jsonb(v_blocking));
  END IF;

  IF v_category.requires_evidence THEN
    SELECT count(*) INTO v_evidence_count FROM public.activity_evidence WHERE activity_id = p_activity_id;
    IF v_evidence_count < v_category.evidence_min_count THEN
      RETURN jsonb_build_object('blocked', true, 'reason', 'evidence', 'evidence_count', v_evidence_count, 'required', v_category.evidence_min_count);
    END IF;
  END IF;

  IF v_category.requires_personnel AND v_activity.personnel_count < 1 THEN
    RETURN jsonb_build_object('blocked', true, 'reason', 'personnel');
  END IF;

  UPDATE public.activities SET
    status = 'completed',
    completed_at = now(),
    execution_latitude = p_lat,
    execution_longitude = p_lng,
    gps_accuracy_m = p_accuracy,
    gps_captured_at = now(),
    distance_from_target_m = v_distance,
    gps_validation_status = v_gps_status,
    gps_risk_flags = COALESCE(v_flags, '{}')
  WHERE id = p_activity_id;

  PERFORM public.log_audit(v_user_id, 'activity.completed', 'activity', p_activity_id,
    jsonb_build_object('validation_status', v_gps_status, 'distance_m', v_distance, 'gps_risk_flags', v_flags));

  RETURN jsonb_build_object('blocked', false, 'validation_status', v_gps_status, 'distance_m', v_distance, 'risk_flags', to_jsonb(v_flags));
END;
$$;

-- >>>>>>>>>>>>>>>> 027_live_admin_checks.sql >>>>>>>>>>>>>>>>
-- ============================================================================
-- Installer Work Management Platform — Migration 027
-- Run after 026.
--
-- 1. Admin-only settings now check the admin role LIVE, like every other
--    policy (001, 019). The write policies on activity categories, sales
--    divisions, platform settings and notification settings/groups
--    (004, 007, 011, 013) trusted the role written into the login token
--    (jwt_role()), which can be up to 8 hours old. An admin who had been
--    deactivated or demoted could keep changing those settings until the
--    token ran out. They now use current_role_from_db(), which also refuses
--    inactive and unapproved accounts.
--
-- 2. The Telegram bot token was readable by supervisors (007: is_staff()).
--    Whoever holds it can send messages as the bot and read its updates.
--    Only admins manage it (Admin Panel → Notifications), so only admins can
--    read it; the server keeps reading it with the service role.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ── activity_categories (004) ──────────────────────────────────────────────
DROP POLICY IF EXISTS activity_categories_insert ON public.activity_categories;
CREATE POLICY activity_categories_insert ON public.activity_categories
  FOR INSERT TO anon WITH CHECK (public.current_role_from_db() = 'admin');
DROP POLICY IF EXISTS activity_categories_update ON public.activity_categories;
CREATE POLICY activity_categories_update ON public.activity_categories
  FOR UPDATE TO anon USING (public.current_role_from_db() = 'admin') WITH CHECK (public.current_role_from_db() = 'admin');

-- ── sales_divisions (011) ──────────────────────────────────────────────────
DROP POLICY IF EXISTS sales_divisions_insert ON public.sales_divisions;
CREATE POLICY sales_divisions_insert ON public.sales_divisions
  FOR INSERT TO anon WITH CHECK (public.current_role_from_db() = 'admin');
DROP POLICY IF EXISTS sales_divisions_update ON public.sales_divisions;
CREATE POLICY sales_divisions_update ON public.sales_divisions
  FOR UPDATE TO anon USING (public.current_role_from_db() = 'admin') WITH CHECK (public.current_role_from_db() = 'admin');

-- ── platform_settings (013) ────────────────────────────────────────────────
DROP POLICY IF EXISTS platform_settings_update ON public.platform_settings;
CREATE POLICY platform_settings_update ON public.platform_settings
  FOR UPDATE TO anon USING (public.current_role_from_db() = 'admin') WITH CHECK (public.current_role_from_db() = 'admin');

-- ── notification_groups (013) ──────────────────────────────────────────────
DROP POLICY IF EXISTS notification_groups_insert ON public.notification_groups;
CREATE POLICY notification_groups_insert ON public.notification_groups
  FOR INSERT TO anon WITH CHECK (public.current_role_from_db() = 'admin');
DROP POLICY IF EXISTS notification_groups_update ON public.notification_groups;
CREATE POLICY notification_groups_update ON public.notification_groups
  FOR UPDATE TO anon USING (public.current_role_from_db() = 'admin') WITH CHECK (public.current_role_from_db() = 'admin');

-- ── notification_settings (007): bot token, admin only ─────────────────────
DROP POLICY IF EXISTS notification_settings_select ON public.notification_settings;
CREATE POLICY notification_settings_select ON public.notification_settings
  FOR SELECT TO anon USING (public.current_role_from_db() = 'admin');
DROP POLICY IF EXISTS notification_settings_update ON public.notification_settings;
CREATE POLICY notification_settings_update ON public.notification_settings
  FOR UPDATE TO anon USING (public.current_role_from_db() = 'admin') WITH CHECK (public.current_role_from_db() = 'admin');

COMMIT;



-- Selesai. Cek cepat (harus mengembalikan 1 baris berisi true):

SELECT to_regclass('public.gps_challenges') IS NOT NULL AND to_regclass('public.password_reset_requests') IS NOT NULL AS migrasi_021_027_ok;
