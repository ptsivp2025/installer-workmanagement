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
