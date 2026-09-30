-- ════════════════════════════════════════════════════════════════════════════
-- 030 · Every project has one clear Sales owner
--
-- A project is born one of two ways: an admin creates it for a vendor, or the
-- vendor's Sales asks for it (Permintaan Proyek) and an admin approves. Either
-- way the project must name its Sales account, because that account decides
-- who on the vendor side sees the project, its schedule and its reviews (029).
--
-- Until now the account (sales_user_id) and the name shown on screens and in
-- exports (sales_person_name) were set separately: a project approved from a
-- request got the account through a trigger but never the name, so the recap
-- said "Sales belum dipilih" for a project that did have one.
--
--  1. sales_person_name now always follows the account: set on insert/update,
--     and when that user's name changes.
--  2. Approving a request records the requester as the owner directly.
--  3. Existing projects get their names filled from the account.
--
-- Re-runnable.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Name (and division) follow the account ─────────────────────────────
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
    NEW.sales_division_id := COALESCE(NEW.sales_division_id, v_division);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_project_sales ON public.projects;
CREATE TRIGGER trg_sync_project_sales
  BEFORE INSERT OR UPDATE OF sales_user_id, sales_person_name ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.iwm_sync_project_sales();

CREATE OR REPLACE FUNCTION public.iwm_sync_sales_name_to_projects()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
    UPDATE public.projects SET sales_person_name = NEW.full_name WHERE sales_user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_sales_name_to_projects ON public.users;
CREATE TRIGGER trg_sync_sales_name_to_projects
  AFTER UPDATE OF full_name ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.iwm_sync_sales_name_to_projects();

-- ── 2. Approving a request: the requester owns the new project ────────────
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

  INSERT INTO public.projects (
    code, name, customer_name, address, latitude, longitude,
    expected_completion, notes, status, sales_division_id, sales_user_id, created_by
  ) VALUES (
    btrim(p_code), v_req.project_name, COALESCE(v_req.customer_name, v_division.name),
    v_req.address, v_req.latitude, v_req.longitude,
    p_expected_completion, v_req.notes, 'active', v_req.sales_division_id, v_req.requested_by, v_user_id
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

-- ── 3. Existing projects ──────────────────────────────────────────────────
UPDATE public.projects p
SET sales_person_name = u.full_name
FROM public.users u
WHERE p.sales_user_id = u.id AND p.sales_person_name IS DISTINCT FROM u.full_name;
