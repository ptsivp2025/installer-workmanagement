-- ============================================================================
-- Installer Work Management Platform — Migration 020
--
-- 1. Sales/customer project requests. A Sales account could review and rate
--    finished work (014) but had no way to ASK for work — every project and
--    activity could only be created by admin/supervisor. This adds a queue a
--    Sales user submits into and an admin/supervisor decides on:
--
--        sales submits  ->  project_requests (pending)
--        admin approves ->  iwm_approve_project_request() creates the real
--                            project, atomically, and marks the request
--                            'approved' with a link to it. Admin then adds
--                            activities/assigns the installer team on the
--                            project the same way as any other project
--                            (Request Schedule already opens straight to a
--                            given project via ?projectId=).
--        admin rejects  ->  iwm_reject_project_request() records why.
--
--    Both decisions are SECURITY DEFINER RPCs, not a raw client UPDATE, so a
--    request can never end up "approved" without a project behind it or vice
--    versa, and only admin/supervisor can decide (checked with is_staff()
--    inside the function, not just by policy).
--
-- 2. Nothing else changes here — nav badge counts (pending registrations,
--    pending requests, pending form reviews, pending sales reviews) are read
--    straight off existing/this table by the client; no new tables needed
--    for that.
-- ============================================================================

CREATE TABLE public.project_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  requested_by uuid NOT NULL,
  sales_division_id uuid NOT NULL,
  project_name text NOT NULL,
  customer_name text,
  customer_phone text,
  address text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  category_id uuid,
  requested_date date,
  notes text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz,
  rejection_reason text,
  resulting_project_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE CASCADE,
  FOREIGN KEY (sales_division_id) REFERENCES public.sales_divisions(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES public.activity_categories(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL,
  FOREIGN KEY (resulting_project_id) REFERENCES public.projects(id) ON DELETE SET NULL,
  CONSTRAINT project_requests_status_check CHECK (status = ANY (ARRAY['pending', 'approved', 'rejected'])),
  CONSTRAINT project_requests_lat_check CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT project_requests_lng_check CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);
CREATE INDEX idx_project_requests_status ON public.project_requests (status);
CREATE INDEX idx_project_requests_division ON public.project_requests (sales_division_id);
CREATE INDEX idx_project_requests_requester ON public.project_requests (requested_by);

ALTER TABLE public.project_requests ENABLE ROW LEVEL SECURITY;

-- Sales sees only their own submissions; staff sees every request so any
-- admin/supervisor can pick it up, not just whoever's division it is.
CREATE POLICY project_requests_select ON public.project_requests FOR SELECT TO anon USING (
  public.is_staff() OR requested_by = public.jwt_user_id()
);

-- INSERT only — a Sales account can submit a request but can never edit or
-- withdraw one afterward (matches the audit trail the rest of the platform
-- keeps: an activity's history doesn't quietly change after the fact
-- either). sales_division_id is pinned to the submitter's own division so
-- nobody can file a request that lands as another division's.
CREATE POLICY project_requests_insert ON public.project_requests FOR INSERT TO anon WITH CHECK (
  public.is_sales()
  AND requested_by = public.jwt_user_id()
  AND sales_division_id = public.current_sales_division_id()
  AND status = 'pending'
);

-- No UPDATE/DELETE policy at all: approving or rejecting only ever happens
-- through the two SECURITY DEFINER functions below, which is what keeps
-- "approved" and "has a resulting project" from ever drifting apart.

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
    expected_completion, notes, status, sales_division_id, created_by
  ) VALUES (
    btrim(p_code), v_req.project_name, COALESCE(v_req.customer_name, v_division.name),
    v_req.address, v_req.latitude, v_req.longitude,
    p_expected_completion, v_req.notes, 'active', v_req.sales_division_id, v_user_id
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

CREATE OR REPLACE FUNCTION public.iwm_reject_project_request(
  p_request_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := public.jwt_user_id();
  v_status text;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only an admin or supervisor may reject a project request.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required so the requester knows why.' USING ERRCODE = 'not_null_violation';
  END IF;

  SELECT status INTO v_status FROM public.project_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'This request was already decided.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE public.project_requests SET
    status = 'rejected',
    reviewed_by = v_user_id,
    reviewed_at = now(),
    rejection_reason = btrim(p_reason)
  WHERE id = p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.iwm_approve_project_request(uuid, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.iwm_reject_project_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.iwm_approve_project_request(uuid, text, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.iwm_reject_project_request(uuid, text) TO anon, authenticated;
