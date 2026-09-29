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
