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
