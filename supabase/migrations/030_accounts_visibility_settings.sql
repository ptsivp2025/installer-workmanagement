-- ════════════════════════════════════════════════════════════════════════════
-- 030 · Account types, who sees what, one Sales per project, settings
--
-- Accounts come in four kinds: Admin (Admin Aplikasi), Team (installer /
-- supervisor / reviewer), Admin Sales, and Sales Proyek. A division is a
-- vendor company; its Admin Sales and Sales Proyek are one team.
--
--  1. New role 'sales_admin' (Admin Sales). is_sales() now means "vendor
--     side": sales OR sales_admin, so every "NOT is_sales()" guard written
--     for Sales keeps Admin Sales out of internal work too.
--  2. Visibility: Team sees every project. Admin Sales sees every project of
--     its division. Sales Proyek sees ONLY the projects it owns.
--  3. Every project names one Sales Proyek (sales_user_id); its name and its
--     division follow that account, never typed by hand.
--  4. A request carries the Sales Proyek it is for (Admin Sales asks on a
--     Sales Proyek's behalf); approving it makes that Sales the owner.
--  5. app_settings: business rules editable in Admin Panel → Aturan Sistem
--     instead of hardcoded. The Fake GPS thresholds read them here; the
--     defaults passed in are exactly the values that were hardcoded before.
--
-- Re-runnable.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Roles ────────────────────────────────────────────────────────────────
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role = ANY (ARRAY['admin','supervisor','installer','reviewer','sales_admin','sales']));

CREATE OR REPLACE FUNCTION public.is_sales()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.current_role_from_db() IN ('sales', 'sales_admin');
$$;

CREATE OR REPLACE FUNCTION public.is_sales_admin()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.current_role_from_db() = 'sales_admin';
$$;
GRANT EXECUTE ON FUNCTION public.is_sales_admin() TO anon, authenticated, service_role;

-- ── 2. Who sees which project ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_see_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.is_authenticated() AND (
    NOT public.is_sales()
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = p_project_id AND (
        p.sales_user_id = public.jwt_user_id()
        OR (public.is_sales_admin() AND p.sales_division_id IS NOT NULL
            AND p.sales_division_id = public.current_sales_division_id())
      )
    )
  );
$$;
REVOKE ALL ON FUNCTION public.can_see_project(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_see_project(uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS projects_select ON public.projects;
CREATE POLICY projects_select ON public.projects FOR SELECT TO anon USING (
  public.is_authenticated() AND (
    NOT public.is_sales()
    OR sales_user_id = public.jwt_user_id()
    OR (public.is_sales_admin() AND sales_division_id IS NOT NULL AND sales_division_id = public.current_sales_division_id())
  )
);

-- ── 3. One Sales Proyek per project; name & division follow the account ───
CREATE OR REPLACE FUNCTION public.iwm_sync_project_sales()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_name text;
  v_division uuid;
BEGIN
  IF NEW.sales_user_id IS NOT NULL THEN
    SELECT full_name, sales_division_id INTO v_name, v_division FROM public.users WHERE id = NEW.sales_user_id;
    NEW.sales_person_name := COALESCE(NULLIF(btrim(v_name), ''), NEW.sales_person_name);
    NEW.sales_division_id := COALESCE(v_division, NEW.sales_division_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_project_sales ON public.projects;
CREATE TRIGGER trg_sync_project_sales
  BEFORE INSERT OR UPDATE OF sales_user_id, sales_person_name, sales_division_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.iwm_sync_project_sales();

CREATE OR REPLACE FUNCTION public.iwm_sync_sales_to_projects()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.full_name IS DISTINCT FROM OLD.full_name OR NEW.sales_division_id IS DISTINCT FROM OLD.sales_division_id THEN
    UPDATE public.projects SET sales_person_name = NEW.full_name, sales_division_id = COALESCE(NEW.sales_division_id, sales_division_id)
    WHERE sales_user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_sales_name_to_projects ON public.users;
DROP TRIGGER IF EXISTS trg_sync_sales_to_projects ON public.users;
CREATE TRIGGER trg_sync_sales_to_projects
  AFTER UPDATE OF full_name, sales_division_id ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.iwm_sync_sales_to_projects();

UPDATE public.projects p
SET sales_person_name = u.full_name, sales_division_id = COALESCE(u.sales_division_id, p.sales_division_id)
FROM public.users u
WHERE p.sales_user_id = u.id
  AND (p.sales_person_name IS DISTINCT FROM u.full_name OR p.sales_division_id IS DISTINCT FROM COALESCE(u.sales_division_id, p.sales_division_id));

/** The Sales Proyek accounts the caller may pick: all for Team, the
 *  division's for Admin Sales, only itself for a Sales Proyek. */
CREATE OR REPLACE FUNCTION public.iwm_sales_choices()
RETURNS TABLE (id uuid, full_name text, username text, sales_division_id uuid, division_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT u.id, u.full_name, u.username, u.sales_division_id, d.name
  FROM public.users u
  LEFT JOIN public.sales_divisions d ON d.id = u.sales_division_id
  WHERE public.is_authenticated()
    AND u.role = 'sales' AND u.active AND u.approval_status = 'approved'
    AND (
      NOT public.is_sales()
      OR (public.is_sales_admin() AND u.sales_division_id = public.current_sales_division_id())
      OR u.id = public.jwt_user_id()
    )
  ORDER BY u.full_name;
$$;
REVOKE ALL ON FUNCTION public.iwm_sales_choices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.iwm_sales_choices() TO anon, authenticated;

-- ── 4. Requests carry the Sales Proyek they are for ───────────────────────
ALTER TABLE public.project_requests ADD COLUMN IF NOT EXISTS sales_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_project_requests_sales_user ON public.project_requests (sales_user_id);

-- A Sales Proyek asks for itself; an Admin Sales must name one of its
-- division's Sales Proyek (checked here, not trusted from the page).
CREATE OR REPLACE FUNCTION public.iwm_request_sales_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_requester_role text;
BEGIN
  SELECT role INTO v_requester_role FROM public.users WHERE id = NEW.requested_by;
  IF v_requester_role = 'sales' THEN
    NEW.sales_user_id := NEW.requested_by;
  ELSIF NEW.sales_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = NEW.sales_user_id AND u.role = 'sales' AND u.sales_division_id = NEW.sales_division_id
  ) THEN
    RAISE EXCEPTION 'The Sales Proyek must be a Sales account of the same division.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_requester_role = 'sales_admin' AND NEW.sales_user_id IS NULL THEN
    RAISE EXCEPTION 'Choose the Sales Proyek this request is for.' USING ERRCODE = 'not_null_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_request_sales_owner ON public.project_requests;
CREATE TRIGGER trg_request_sales_owner
  BEFORE INSERT ON public.project_requests
  FOR EACH ROW EXECUTE FUNCTION public.iwm_request_sales_owner();

UPDATE public.project_requests r SET sales_user_id = r.requested_by
FROM public.users u WHERE u.id = r.requested_by AND u.role = 'sales' AND r.sales_user_id IS NULL;

DROP POLICY IF EXISTS project_requests_select ON public.project_requests;
CREATE POLICY project_requests_select ON public.project_requests FOR SELECT TO anon USING (
  public.is_staff()
  OR requested_by = public.jwt_user_id()
  OR sales_user_id = public.jwt_user_id()
  OR (public.is_sales_admin() AND sales_division_id = public.current_sales_division_id())
);

DROP POLICY IF EXISTS project_requests_insert ON public.project_requests;
CREATE POLICY project_requests_insert ON public.project_requests FOR INSERT TO anon WITH CHECK (
  public.is_sales()
  AND requested_by = public.jwt_user_id()
  AND sales_division_id = public.current_sales_division_id()
  AND status = 'pending'
);

CREATE OR REPLACE FUNCTION public.iwm_approve_project_request(
  p_request_id uuid,
  p_code text,
  p_expected_completion date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := public.jwt_user_id();
  v_req record;
  v_project_id uuid;
  v_division record;
  v_owner uuid;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only an admin or supervisor may approve a project request.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RAISE EXCEPTION 'A project code is required.' USING ERRCODE = 'not_null_violation';
  END IF;

  SELECT * INTO v_req FROM public.project_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'This request was already decided.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_division FROM public.sales_divisions WHERE id = v_req.sales_division_id;
  v_owner := COALESCE(v_req.sales_user_id,
    (SELECT id FROM public.users WHERE id = v_req.requested_by AND role = 'sales'));

  INSERT INTO public.projects (
    code, name, customer_name, address, latitude, longitude,
    expected_completion, notes, status, sales_division_id, sales_user_id, created_by
  ) VALUES (
    btrim(p_code), v_req.project_name, COALESCE(v_req.customer_name, v_division.name),
    v_req.address, v_req.latitude, v_req.longitude,
    p_expected_completion, v_req.notes, 'active', v_req.sales_division_id, v_owner, v_user_id
  )
  RETURNING id INTO v_project_id;

  UPDATE public.project_requests SET
    status = 'approved',
    reviewed_by = v_user_id,
    reviewed_at = now(),
    resulting_project_id = v_project_id
  WHERE id = p_request_id;

  RETURN jsonb_build_object('project_id', v_project_id, 'category_id', v_req.category_id);
END;
$$;
REVOKE ALL ON FUNCTION public.iwm_approve_project_request(uuid, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.iwm_approve_project_request(uuid, text, date) TO anon, authenticated;

-- 029's fallback: the request's Sales Proyek, or its requester if that is one.
CREATE OR REPLACE FUNCTION public.iwm_claim_request_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.status = 'approved' AND NEW.resulting_project_id IS NOT NULL
     AND (OLD.status IS DISTINCT FROM 'approved' OR OLD.resulting_project_id IS DISTINCT FROM NEW.resulting_project_id) THEN
    UPDATE public.projects SET sales_user_id = COALESCE(sales_user_id, NEW.sales_user_id,
      (SELECT id FROM public.users WHERE id = NEW.requested_by AND role = 'sales'))
    WHERE id = NEW.resulting_project_id;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 5. Settings instead of hardcoded rules ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Nothing secret lives here; the sign-up page reads a few before login.
DROP POLICY IF EXISTS app_settings_select ON public.app_settings;
CREATE POLICY app_settings_select ON public.app_settings FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS app_settings_write ON public.app_settings;
CREATE POLICY app_settings_write ON public.app_settings FOR ALL TO anon
  USING (public.current_role_from_db() = 'admin') WITH CHECK (public.current_role_from_db() = 'admin');
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;

DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER trg_app_settings_updated_at BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

/** A numeric setting, or the given default when unset or not a number. */
CREATE OR REPLACE FUNCTION public.setting_num(p_key text, p_default numeric)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v numeric;
BEGIN
  SELECT (value #>> '{}')::numeric INTO v FROM public.app_settings WHERE key = p_key;
  RETURN COALESCE(v, p_default);
EXCEPTION WHEN others THEN
  RETURN p_default;
END;
$$;
GRANT EXECUTE ON FUNCTION public.setting_num(text, numeric) TO anon, authenticated, service_role;

/** A text-array setting, or the default. */
CREATE OR REPLACE FUNCTION public.setting_list(p_key text, p_default text[])
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v text[];
BEGIN
  SELECT ARRAY(SELECT jsonb_array_elements_text(value)) INTO v
  FROM public.app_settings WHERE key = p_key AND jsonb_typeof(value) = 'array';
  RETURN COALESCE(v, p_default);
EXCEPTION WHEN others THEN
  RETURN p_default;
END;
$$;
GRANT EXECUTE ON FUNCTION public.setting_list(text, text[]) TO anon, authenticated, service_role;

-- Which Fake GPS signals stop a start/completion: now a setting.
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
      public.setting_list('gps.blocking_flags',
        ARRAY['zero_accuracy', 'frozen_precise', 'sample_jump', 'no_samples', 'mock_provider',
              'bad_challenge', 'stale_reading', 'bad_signature', 'emulator', 'virtual_env'])
      || CASE WHEN COALESCE((SELECT require_native_app FROM public.platform_settings WHERE id = true), false)
              THEN ARRAY['web_browser', 'rooted'] ELSE ARRAY[]::text[] END
      || CASE WHEN EXISTS (SELECT 1 FROM public.app_attestation_keys WHERE active)
              THEN ARRAY['no_challenge'] ELSE ARRAY[]::text[] END
    )
  );
$$;
REVOKE ALL ON FUNCTION public.iwm_gps_blocking(text[]) FROM PUBLIC, anon, authenticated;

-- The checks of 026, with every threshold read from settings.
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
  -- thresholds (Admin Panel → Aturan Sistem → Deteksi Fake GPS)
  c_challenge_min numeric := public.setting_num('gps.challenge_minutes', 15);
  c_min_samples   numeric := public.setting_num('gps.check_min_samples', 3);
  c_frozen_span   numeric := public.setting_num('gps.frozen_min_span_ms', 2500);
  c_precise_acc   numeric := public.setting_num('gps.frozen_precise_acc_m', 10);
  c_noalt_acc     numeric := public.setting_num('gps.no_altitude_max_acc_m', 20);
  c_jump_acc      numeric := public.setting_num('gps.jump_min_acc_m', 50);
  c_jump_window   numeric := public.setting_num('gps.jump_window_s', 10);
  c_jump_m        numeric := public.setting_num('gps.jump_max_m', 300);
  c_travel_hours  numeric := public.setting_num('gps.travel_window_hours', 6);
  c_travel_acc    numeric := public.setting_num('gps.travel_min_acc_m', 100);
  c_travel_km     numeric := public.setting_num('gps.travel_min_km', 20);
  c_travel_kmh    numeric := public.setting_num('gps.travel_max_kmh', 200);
BEGIN
  IF p_accuracy IS NOT NULL AND p_accuracy <= 0 THEN
    v_flags := array_append(v_flags, 'zero_accuracy');
  END IF;

  IF p_samples IS NULL OR jsonb_typeof(p_samples) <> 'array' OR jsonb_array_length(p_samples) = 0 THEN
    v_flags := array_append(v_flags, 'no_samples');
    v_flags := array_append(v_flags, 'web_browser');
  ELSE
    v_n := jsonb_array_length(p_samples);

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
      ELSIF v_challenge_at < now() - make_interval(mins => c_challenge_min::int) THEN
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

    IF v_n >= c_min_samples AND COALESCE(v_span_ms, 0) >= c_frozen_span AND v_distinct_pos = 1 AND v_distinct_acc = 1 THEN
      v_flags := array_append(v_flags, CASE WHEN v_max_acc <= c_precise_acc THEN 'frozen_precise' ELSE 'frozen' END);
    END IF;

    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_samples) s
               WHERE (s->>'mock')::boolean IS TRUE OR (s->>'mockApp')::boolean IS TRUE) THEN
      v_flags := array_append(v_flags, 'mock_provider');
    END IF;

    FOR v_sample IN SELECT value FROM jsonb_array_elements(p_samples) LOOP
      CONTINUE WHEN v_sample->>'src' IS DISTINCT FROM 'native';
      IF NOT v_has_key THEN
        v_native_ok := true;
        CONTINUE;
      END IF;
      CONTINUE WHEN v_sample->>'att' IS NULL OR v_sample->>'sig' IS NULL;
      v_att := string_to_array(v_sample->>'att', '|');
      BEGIN
        v_sig_ok := public.iwm_attestation_valid(v_sample->>'att', v_sample->>'sig', v_sample->>'kid')
          AND array_length(v_att, 1) = 11 AND v_att[1] = 'v1'
          AND COALESCE(v_att[2], '') = COALESCE(v_nonce, '')
          AND abs(v_att[3]::numeric - (v_sample->>'lat')::numeric) < 0.000001
          AND abs(v_att[4]::numeric - (v_sample->>'lng')::numeric) < 0.000001;
      EXCEPTION WHEN others THEN
        v_sig_ok := false;
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

    IF v_n >= c_min_samples AND v_all_int THEN
      v_flags := array_append(v_flags, 'integer_accuracy');
    END IF;

    IF v_n >= c_min_samples AND v_no_alt AND v_max_acc <= c_noalt_acc THEN
      v_flags := array_append(v_flags, 'no_altitude');
    END IF;

    FOR i IN 1 .. v_n - 1 LOOP
      a := p_samples -> (i - 1);
      b := p_samples -> i;
      v_dt := abs(COALESCE((b->>'at')::numeric, (b->>'ts')::numeric) - COALESCE((a->>'at')::numeric, (a->>'ts')::numeric)) / 1000.0;
      IF (a->>'acc')::numeric <= c_jump_acc AND (b->>'acc')::numeric <= c_jump_acc AND v_dt < c_jump_window THEN
        v_step := public.iwm_distance_meters((a->>'lat')::numeric, (a->>'lng')::numeric, (b->>'lat')::numeric, (b->>'lng')::numeric);
        IF v_step > c_jump_m THEN
          v_flags := array_append(v_flags, 'sample_jump');
          EXIT;
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    SELECT latitude, longitude, created_at INTO v_prev
    FROM public.activity_gps_events
    WHERE user_id = p_user_id AND latitude IS NOT NULL AND accuracy_m <= c_travel_acc
      AND created_at > now() - make_interval(secs => c_travel_hours * 3600)
    ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      v_prev_dist := public.iwm_distance_meters(v_prev.latitude, v_prev.longitude, p_lat, p_lng);
      v_prev_hours := GREATEST(extract(epoch FROM now() - v_prev.created_at) / 3600.0, 1.0 / 3600);
      IF v_prev_dist > c_travel_km * 1000 AND v_prev_dist / 1000.0 / v_prev_hours > c_travel_kmh THEN
        v_flags := array_append(v_flags, 'impossible_travel');
      END IF;
    END IF;
  END IF;

  RETURN v_flags;
END;
$$;
