-- ============================================================================
-- Installer Work Management Platform — Migration 003
-- Server-side GPS validation, completion workflow, and review decisions.
--
-- The client NEVER decides whether a GPS reading is valid or whether an
-- activity is allowed to complete — these SECURITY DEFINER functions are the
-- single place that happens (spec §11, §13, §21). Every capture attempt is
-- logged to activity_gps_events even when it's rejected, so denials stay
-- auditable instead of silently disappearing.
-- ============================================================================

-- ── Haversine distance (meters) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.iwm_distance_meters(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
RETURNS numeric
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT 6371000 * acos(
    LEAST(1.0, GREATEST(-1.0,
      cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2) - radians(lng1))
      + sin(radians(lat1)) * sin(radians(lat2))
    ))
  );
$$;

-- ── iwm_set_activity_status — manual, non-completion transitions ─────────
-- scheduled <-> in_progress, and cancellation. Completion has its own
-- function below because it has real preconditions (GPS/evidence/personnel).
CREATE OR REPLACE FUNCTION public.iwm_set_activity_status(p_activity_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := public.jwt_user_id();
  v_activity record;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_authenticated() THEN
    RAISE EXCEPTION 'No identity on token, or account is inactive.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_status NOT IN ('scheduled', 'in_progress', 'cancelled') THEN
    RAISE EXCEPTION 'Use iwm_complete_activity() to mark an activity completed.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- FOR UPDATE: serializes two concurrent calls against the same activity
  -- (e.g. a double-tapped button) so the second waits for the first's
  -- status change to commit instead of reading stale pre-transition state.
  SELECT * INTO v_activity FROM public.activities WHERE id = p_activity_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Activity not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_activity.status = 'completed' THEN
    RAISE EXCEPTION 'Completed activities cannot change status.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Any authenticated user may operate the execution flow (start/cancel) —
  -- this is a small internal ops tool, not a multi-tenant system; the
  -- meaningful boundary is "has a valid session" (checked above), not a
  -- per-activity assignment record. Schedule-defining fields are still
  -- staff-only via the activities_update RLS policy (004_rls.sql).

  UPDATE public.activities SET status = p_status WHERE id = p_activity_id;
  PERFORM public.log_audit(v_user_id, 'activity.status_changed', 'activity', p_activity_id,
    jsonb_build_object('from', v_activity.status, 'to', p_status));

  RETURN jsonb_build_object('status', p_status);
END;
$$;

-- ── iwm_complete_activity — the ONE path to status = 'completed' ─────────
-- Returns a result object rather than raising on a failed GPS/evidence/
-- personnel check, so the denied attempt still gets written to
-- activity_gps_events (an exception would roll that insert back too).
-- { blocked: false, validation_status, distance_m }
-- { blocked: true, reason: 'gps'|'evidence'|'personnel', ... }
CREATE OR REPLACE FUNCTION public.iwm_complete_activity(
  p_activity_id uuid,
  p_lat numeric,
  p_lng numeric,
  p_accuracy numeric DEFAULT NULL
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

  -- See the same note in iwm_set_activity_status() above: any authenticated,
  -- still-active user may complete an activity in this platform's flow.

  SELECT * INTO v_category FROM public.activity_categories WHERE id = v_activity.category_id;
  SELECT * INTO v_project FROM public.projects WHERE id = v_activity.project_id;
  v_target_lat := COALESCE(v_activity.target_latitude, v_project.latitude);
  v_target_lng := COALESCE(v_activity.target_longitude, v_project.longitude);

  IF v_category.requires_gps THEN
    IF p_lat IS NULL OR p_lng IS NULL THEN
      v_gps_status := 'unavailable';
    ELSIF p_accuracy IS NOT NULL AND p_accuracy > v_category.gps_accuracy_threshold_m THEN
      v_gps_status := 'low_accuracy';
    ELSIF v_target_lat IS NULL OR v_target_lng IS NULL THEN
      v_gps_status := 'unavailable';
    ELSE
      v_distance := public.iwm_distance_meters(p_lat, p_lng, v_target_lat, v_target_lng);
      v_gps_status := CASE WHEN v_distance > v_category.gps_radius_m THEN 'outside_radius' ELSE 'valid' END;
    END IF;
  ELSE
    v_gps_status := 'valid';
  END IF;

  -- Always logged, pass or fail — this is what makes a blocked attempt
  -- auditable instead of invisible (spec §24).
  INSERT INTO public.activity_gps_events (
    activity_id, user_id, event_type, latitude, longitude, accuracy_m, distance_m, validation_status
  ) VALUES (
    p_activity_id, v_user_id, 'complete', p_lat, p_lng, p_accuracy, v_distance, v_gps_status
  );

  IF v_category.requires_gps AND v_gps_status <> 'valid' THEN
    RETURN jsonb_build_object('blocked', true, 'reason', 'gps', 'validation_status', v_gps_status, 'distance_m', v_distance, 'radius_m', v_category.gps_radius_m);
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
    gps_validation_status = v_gps_status
  WHERE id = p_activity_id;

  PERFORM public.log_audit(v_user_id, 'activity.completed', 'activity', p_activity_id,
    jsonb_build_object('validation_status', v_gps_status, 'distance_m', v_distance));

  RETURN jsonb_build_object('blocked', false, 'validation_status', v_gps_status, 'distance_m', v_distance);
END;
$$;

-- ── iwm_review_activity — Form Review approve/reject ──────────────────────
CREATE OR REPLACE FUNCTION public.iwm_review_activity(p_review_id uuid, p_decision text, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := public.jwt_user_id();
  v_review record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No identity on token.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.is_reviewer() THEN
    RAISE EXCEPTION 'Not authorized to review.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_review FROM public.form_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_review.status <> 'pending' THEN
    RAISE EXCEPTION 'This review was already decided.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE public.form_reviews SET
    status = p_decision, reviewer_id = v_user_id, reviewed_at = now(), notes = p_notes
  WHERE id = p_review_id;

  PERFORM public.log_audit(v_user_id, ('review.' || p_decision)::text, 'form_review', p_review_id,
    jsonb_build_object('activity_id', v_review.activity_id, 'notes', p_notes));

  RETURN jsonb_build_object('status', p_decision);
END;
$$;

-- ── iwm_reopen_activity — the only way out of a rejected dead-end ────────
-- A rejected review previously had no way back: iwm_set_activity_status()
-- refuses any change once status = 'completed', so the activity just sat
-- rejected forever with no resubmission path. Staff-only (this is a manual
-- override of a completed record, not part of the normal field flow) and
-- only for an activity whose most recent review was actually rejected.
-- Reopening drops it back to 'in_progress': personnel/evidence become
-- editable again (their guard triggers key off status), and a fresh
-- iwm_complete_activity() call opens a new pending form_reviews row.
CREATE OR REPLACE FUNCTION public.iwm_reopen_activity(p_activity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := public.jwt_user_id();
  v_activity record;
  v_latest_review record;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only staff may reopen a rejected activity.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_activity FROM public.activities WHERE id = p_activity_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Activity not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_activity.status <> 'completed' THEN
    RAISE EXCEPTION 'Only a completed activity can be reopened.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_latest_review FROM public.form_reviews
    WHERE activity_id = p_activity_id ORDER BY created_at DESC LIMIT 1;
  IF v_latest_review IS NULL OR v_latest_review.status <> 'rejected' THEN
    RAISE EXCEPTION 'Only an activity with a rejected review can be reopened.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE public.activities SET status = 'in_progress', completed_at = NULL WHERE id = p_activity_id;

  PERFORM public.log_audit(v_user_id, 'activity.status_changed', 'activity', p_activity_id,
    jsonb_build_object('from', 'completed', 'to', 'in_progress', 'reason', 'reopened_after_rejection'));

  RETURN jsonb_build_object('status', 'in_progress');
END;
$$;

-- ── log_audit — callable from SECURITY DEFINER functions above ───────────
CREATE OR REPLACE FUNCTION public.log_audit(p_actor_id uuid, p_action text, p_entity_type text, p_entity_id uuid, p_meta jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE sql
SET search_path TO 'public', 'pg_temp'
AS $$
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, meta)
  VALUES (p_actor_id, p_action, p_entity_type, p_entity_id, p_meta);
$$;

-- ============================================================================
-- Guard triggers — freeze columns/rows that must only change through the
-- functions above or that must never change once historical (spec §26).
-- current_user is 'anon' for ordinary PostgREST/client calls; inside a
-- SECURITY DEFINER function it's the function owner, so these guards let the
-- functions above through while still blocking a direct client PATCH.
-- ============================================================================

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

CREATE OR REPLACE TRIGGER trg_guard_activity_protected_columns
  BEFORE UPDATE ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.guard_activity_protected_columns();

-- Personnel/evidence on a completed activity are historical records — lock
-- them from everyone except staff correcting a mistake (spec §10, §26).
CREATE OR REPLACE FUNCTION public.guard_completed_activity_children()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_activity_id uuid := COALESCE(NEW.activity_id, OLD.activity_id);
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.activities WHERE id = v_activity_id;
  IF v_status = 'completed' AND current_user IN ('anon', 'authenticated') AND NOT public.is_staff() THEN
    RAISE EXCEPTION 'Records on a completed activity are locked.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE TRIGGER trg_guard_personnel_completed
  BEFORE UPDATE OR DELETE ON public.activity_personnel
  FOR EACH ROW EXECUTE FUNCTION public.guard_completed_activity_children();

-- Evidence: block insert/delete once the activity is completed or cancelled
-- (upload window is only while work is scheduled/in progress; spec §12).
CREATE OR REPLACE FUNCTION public.guard_evidence_activity_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_activity_id uuid := COALESCE(NEW.activity_id, OLD.activity_id);
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.activities WHERE id = v_activity_id;
  IF v_status IN ('completed', 'cancelled') AND current_user IN ('anon', 'authenticated') AND NOT public.is_staff() THEN
    RAISE EXCEPTION 'Evidence can only be added or removed while the activity is scheduled or in progress.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE TRIGGER trg_guard_evidence_state
  BEFORE INSERT OR DELETE ON public.activity_evidence
  FOR EACH ROW EXECUTE FUNCTION public.guard_evidence_activity_state();
