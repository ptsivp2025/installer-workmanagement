-- ============================================================================
-- Installer Work Management Platform — Migration 029
-- Run after 028.
--
-- What this platform is actually for: the vendor pays the installer a fee for
-- an Instalasi Demo, and pays AGAIN when that same demo turns into an
-- Instalasi Beli — where the intent was a discount or a waived fee the second
-- time. Nothing recorded that link, so there was never any evidence to bill
-- against. This migration makes the Demo → Bongkar Demo → Beli chain a
-- recorded, measurable fact.
--
-- 1. Room / spot on an activity (`room_name`).
--    A project has several installation points, and the product at one point
--    can legitimately change between the demo and the purchase (the customer
--    or the sales person asks for a different unit of the same kind). So the
--    ROOM is the more reliable anchor than the product. Free text with
--    suggestions in the UI, normalised here (`room_key`) so "Ruang Rapat 1"
--    and "ruang rapat  1" count as the same spot.
--
-- 2. `activity_demo_links` — the permanent, confirmed link.
--    One row per purchase activity, naming the demo it came from, WHY they
--    were matched (same room / same product / chosen by hand), and how the
--    claim against the installer is going (billing_status). Suggestions are
--    computed (4.), but what a claim rests on is this stored row, confirmed
--    by a human — never a view that could silently change its mind later.
--
-- 3. Projects belong to ONE sales account (`sales_user_id`), not just a
--    division. Sales A must not see Sales B's projects, reviews or photos
--    even inside the same division. Projects with nobody assigned yet stay
--    invisible to every sales account until an admin picks one.
--
-- 4. `activity_demo_suggestions` — what to propose, never what to bill:
--    for each purchase activity without a confirmed link, the candidate
--    demos in the same project, ranked (same room + same product first),
--    with the reason and the elapsed days. No time limit at all: the days
--    are recorded and the billing decision stays with the vendor.
-- ============================================================================

-- ── 1. Room / installation spot ───────────────────────────────────────────
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS room_name text;

-- Case- and spacing-insensitive form used for matching. GENERATED: it can
-- never drift from room_name, and no trigger or app code has to remember it.
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS room_key text
  GENERATED ALWAYS AS (NULLIF(lower(regexp_replace(btrim(COALESCE(room_name, '')), '\s+', ' ', 'g')), '')) STORED;

CREATE INDEX IF NOT EXISTS idx_activities_room ON public.activities (project_id, room_key);

-- iwm_create_activity gains the room. Added as a trailing DEFAULT parameter,
-- so this REPLACEs the 015 function rather than creating a second overload,
-- and any caller that doesn't pass it still works.
CREATE OR REPLACE FUNCTION public.iwm_create_activity(
  p_project_id uuid,
  p_category_id uuid,
  p_title text,
  p_customer_name text,
  p_location_address text,
  p_scheduled_date date,
  p_start_time time,
  p_end_time time,
  p_priority text,
  p_notes text,
  p_target_latitude numeric,
  p_target_longitude numeric,
  p_pic_name text,
  p_pic_phone text,
  p_product_brand text,
  p_product_type text,
  p_product_model text,
  p_personnel jsonb DEFAULT '[]'::jsonb,
  p_room_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := public.jwt_user_id();
  v_category record;
  v_activity_id uuid;
  v_request_number text;
  v_personnel_count integer;
  v_primary_count integer;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only staff may create activities.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_project_id IS NULL OR p_category_id IS NULL OR p_title IS NULL OR btrim(p_title) = '' OR p_scheduled_date IS NULL THEN
    RAISE EXCEPTION 'Project, category, title, and scheduled date are required.' USING ERRCODE = 'not_null_violation';
  END IF;

  SELECT * INTO v_category FROM public.activity_categories WHERE id = p_category_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category not found.' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT count(*) INTO v_personnel_count FROM jsonb_array_elements(p_personnel);
  IF v_category.requires_personnel AND v_personnel_count < 1 THEN
    RAISE EXCEPTION 'This category requires at least one team member.' USING ERRCODE = 'not_null_violation';
  END IF;

  SELECT count(*) INTO v_primary_count FROM jsonb_array_elements(p_personnel) el WHERE (el.value ->> 'is_primary')::boolean IS TRUE;
  IF v_personnel_count > 0 AND v_primary_count <> 1 THEN
    RAISE EXCEPTION 'Exactly one team member must be the Primary PIC.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_request_number := 'REQ-' || upper(to_hex((extract(epoch FROM clock_timestamp()) * 1000)::bigint));

  INSERT INTO public.activities (
    request_number, project_id, category_id, title, customer_name, location_address,
    scheduled_date, start_time, end_time, priority, notes,
    target_latitude, target_longitude, pic_name, pic_phone,
    product_brand, product_type, product_model, room_name, created_by
  ) VALUES (
    v_request_number, p_project_id, p_category_id, btrim(p_title), p_customer_name, p_location_address,
    p_scheduled_date, p_start_time, p_end_time, COALESCE(p_priority, 'normal'), p_notes,
    p_target_latitude, p_target_longitude, p_pic_name, p_pic_phone,
    p_product_brand, p_product_type, p_product_model, NULLIF(btrim(COALESCE(p_room_name, '')), ''), v_user_id
  ) RETURNING id INTO v_activity_id;

  IF v_personnel_count > 0 THEN
    INSERT INTO public.activity_personnel (activity_id, user_id, name, role, is_primary)
    SELECT
      v_activity_id,
      NULLIF(el.value ->> 'user_id', '')::uuid,
      el.value ->> 'name',
      NULLIF(el.value ->> 'role', ''),
      COALESCE((el.value ->> 'is_primary')::boolean, false)
    FROM jsonb_array_elements(p_personnel) el;
  END IF;

  PERFORM public.log_audit(v_user_id, 'activity.created', 'activity', v_activity_id,
    jsonb_build_object('project_id', p_project_id, 'category_id', p_category_id, 'personnel_count', v_personnel_count));

  RETURN jsonb_build_object('activity_id', v_activity_id, 'request_number', v_request_number);
END;
$$;

GRANT EXECUTE ON FUNCTION public.iwm_create_activity(uuid, uuid, text, text, text, date, time, time, text, text, numeric, numeric, text, text, text, text, text, jsonb, text) TO anon, authenticated;

-- ── 2. Confirmed Demo → Purchase link ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activity_demo_links (
  purchase_activity_id uuid NOT NULL PRIMARY KEY REFERENCES public.activities(id) ON DELETE CASCADE,
  demo_activity_id uuid NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  -- Why these two were matched, kept for the record: the product may well
  -- have changed between them, and that is exactly what needs explaining
  -- when the claim is presented to the installer.
  match_reason text NOT NULL DEFAULT 'manual'
    CHECK (match_reason = ANY (ARRAY['room_and_product', 'room', 'product', 'manual'])),
  -- Claim state. 'not_billed' is where every confirmed link starts.
  billing_status text NOT NULL DEFAULT 'not_billed'
    CHECK (billing_status = ANY (ARRAY['not_billed', 'billed', 'accepted', 'rejected'])),
  billing_note text,
  confirmed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- An activity can't be its own demo.
  CONSTRAINT activity_demo_links_distinct CHECK (purchase_activity_id <> demo_activity_id)
);
-- One demo backs ONE purchase. The demo fee was waived once; a second
-- purchase in the same room (another unit, a second phase) must not be able
-- to claim the same demo again. Enforced here, not just hidden in the UI,
-- because this is the number a claim against the installer rests on.
-- Dropped first so a database that already has this migration's earlier,
-- non-unique index of the same name gets the unique one, not a silent skip.
DROP INDEX IF EXISTS public.idx_demo_links_demo;
CREATE UNIQUE INDEX idx_demo_links_demo ON public.activity_demo_links (demo_activity_id);
CREATE INDEX IF NOT EXISTS idx_demo_links_billing ON public.activity_demo_links (billing_status);

CREATE OR REPLACE TRIGGER trg_demo_links_updated_at
  BEFORE UPDATE ON public.activity_demo_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.activity_demo_links ENABLE ROW LEVEL SECURITY;

-- Readable by anyone who can read the purchase activity itself — which for a
-- sales account means their own projects only (3.). Written by staff: the
-- link is the basis of a claim against the installer, so confirming one is
-- an admin/supervisor decision, not something the field or sales side does.
DROP POLICY IF EXISTS activity_demo_links_select ON public.activity_demo_links;
CREATE POLICY activity_demo_links_select ON public.activity_demo_links FOR SELECT TO anon USING (
  EXISTS (SELECT 1 FROM public.activities a WHERE a.id = activity_demo_links.purchase_activity_id)
);
DROP POLICY IF EXISTS activity_demo_links_insert ON public.activity_demo_links;
CREATE POLICY activity_demo_links_insert ON public.activity_demo_links FOR INSERT TO anon
  WITH CHECK (public.is_staff() AND confirmed_by = public.jwt_user_id());
DROP POLICY IF EXISTS activity_demo_links_update ON public.activity_demo_links;
CREATE POLICY activity_demo_links_update ON public.activity_demo_links FOR UPDATE TO anon
  USING (public.is_staff()) WITH CHECK (public.is_staff());
DROP POLICY IF EXISTS activity_demo_links_delete ON public.activity_demo_links;
CREATE POLICY activity_demo_links_delete ON public.activity_demo_links FOR DELETE TO anon
  USING (public.is_staff());

-- ── 3. A project belongs to one sales account ─────────────────────────────
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS sales_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_projects_sales_user ON public.projects (sales_user_id);

COMMENT ON COLUMN public.projects.sales_user_id IS
  'The sales account this project belongs to. NULL = not assigned yet: staff still see it, no sales account does.';

/**
 * True when the caller may see this project. Staff/reviewer/installer: yes.
 * A sales account: only its own projects.
 *
 * SECURITY DEFINER, and deliberately so: it is called from policies ON
 * public.projects, and reads that same table. Without the owner's RLS bypass
 * that recurses (the same trap 019 fixed). It takes only a project id, is
 * read-only, and keeps an explicit search_path.
 */
CREATE OR REPLACE FUNCTION public.can_see_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.is_authenticated() AND (
    NOT public.is_sales()
    OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_project_id AND p.sales_user_id = public.jwt_user_id())
  );
$$;

REVOKE ALL ON FUNCTION public.can_see_project(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_see_project(uuid) TO anon, authenticated, service_role;

-- Projects: own projects only for sales (was: the whole division).
DROP POLICY IF EXISTS projects_select ON public.projects;
CREATE POLICY projects_select ON public.projects FOR SELECT TO anon USING (
  public.is_authenticated() AND (NOT public.is_sales() OR sales_user_id = public.jwt_user_id())
);

DROP POLICY IF EXISTS activities_select ON public.activities;
CREATE POLICY activities_select ON public.activities FOR SELECT TO anon USING (
  public.can_see_project(activities.project_id)
);

DROP POLICY IF EXISTS activity_evidence_select ON public.activity_evidence;
CREATE POLICY activity_evidence_select ON public.activity_evidence FOR SELECT TO anon USING (
  public.is_reviewer()
  OR uploader_id = public.jwt_user_id()
  OR EXISTS (SELECT 1 FROM public.activity_personnel p WHERE p.activity_id = activity_evidence.activity_id AND p.user_id = public.jwt_user_id())
  OR (public.is_sales() AND public.can_see_project(activity_evidence.project_id))
);

DROP POLICY IF EXISTS activity_personnel_select ON public.activity_personnel;
CREATE POLICY activity_personnel_select ON public.activity_personnel FOR SELECT TO anon USING (
  public.is_authenticated() AND (
    NOT public.is_sales() OR EXISTS (
      SELECT 1 FROM public.activities a
      WHERE a.id = activity_personnel.activity_id AND public.can_see_project(a.project_id)
    )
  )
);

-- Sales reviews: a sales account rates the work on ITS OWN projects.
DROP POLICY IF EXISTS sales_reviews_select ON public.sales_reviews;
CREATE POLICY sales_reviews_select ON public.sales_reviews FOR SELECT TO anon USING (
  public.is_staff() OR (
    public.is_sales() AND EXISTS (
      SELECT 1 FROM public.activities a WHERE a.id = sales_reviews.activity_id AND public.can_see_project(a.project_id)
    )
  )
);
DROP POLICY IF EXISTS sales_reviews_update ON public.sales_reviews;
CREATE POLICY sales_reviews_update ON public.sales_reviews FOR UPDATE TO anon USING (
  public.is_sales() AND EXISTS (
    SELECT 1 FROM public.activities a WHERE a.id = sales_reviews.activity_id AND public.can_see_project(a.project_id)
  )
) WITH CHECK (
  public.is_sales() AND EXISTS (
    SELECT 1 FROM public.activities a WHERE a.id = sales_reviews.activity_id AND public.can_see_project(a.project_id)
  )
);

-- Approving a project request now also records WHO asked for it as the
-- project's sales owner — otherwise every approved request would land
-- unassigned and be invisible to the very person who filed it.
CREATE OR REPLACE FUNCTION public.iwm_claim_request_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.status = 'approved' AND NEW.resulting_project_id IS NOT NULL
     AND (OLD.status IS DISTINCT FROM 'approved' OR OLD.resulting_project_id IS DISTINCT FROM NEW.resulting_project_id) THEN
    UPDATE public.projects SET sales_user_id = COALESCE(sales_user_id, NEW.requested_by)
    WHERE id = NEW.resulting_project_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_claim_request_project
  AFTER UPDATE ON public.project_requests
  FOR EACH ROW EXECUTE FUNCTION public.iwm_claim_request_project();

-- Existing projects that came from a request get their owner now; the rest
-- are left NULL on purpose, for an admin to assign (there is no reliable way
-- to guess an account from the free-text sales_person_name).
UPDATE public.projects p
SET sales_user_id = r.requested_by
FROM public.project_requests r
WHERE r.resulting_project_id = p.id AND r.requested_by IS NOT NULL AND p.sales_user_id IS NULL;

-- ── 4. Timeline + suggestions ─────────────────────────────────────────────

/**
 * Every Demo / Bongkar / Purchase activity in a project, in order, with the
 * confirmed link and the elapsed days. This is the "linimasa" the project
 * page and the recap page read; it computes nothing about money.
 */
CREATE OR REPLACE VIEW public.activity_demo_timeline
WITH (security_invoker = true) AS
SELECT
  a.id AS activity_id,
  a.project_id,
  a.request_number,
  a.title,
  a.room_name,
  a.room_key,
  a.status,
  a.scheduled_date,
  a.completed_at,
  a.product_brand,
  a.product_type,
  a.product_model,
  c.name AS category_name,
  c.counts_as_demo,
  c.counts_as_installation,
  l.demo_activity_id,
  l.match_reason,
  l.billing_status,
  l.billing_note,
  d.completed_at AS demo_completed_at,
  d.request_number AS demo_request_number,
  d.room_name AS demo_room_name,
  d.product_brand AS demo_product_brand,
  d.product_type AS demo_product_type,
  d.product_model AS demo_product_model,
  CASE WHEN l.demo_activity_id IS NOT NULL AND d.completed_at IS NOT NULL
    THEN EXTRACT(DAY FROM (COALESCE(a.completed_at, now()) - d.completed_at))::int END AS days_since_demo
FROM public.activities a
JOIN public.activity_categories c ON c.id = a.category_id
LEFT JOIN public.activity_demo_links l ON l.purchase_activity_id = a.id
LEFT JOIN public.activities d ON d.id = l.demo_activity_id
WHERE c.counts_as_demo OR c.counts_as_installation;

/**
 * Candidate demos for a purchase activity that has no confirmed link yet.
 *
 * Ranked, not decided: same room AND same product first, then same room
 * (the product was swapped — the common case), then same product in another
 * room, and the most recent demo before the purchase wins the tie. Staff
 * confirms one, which writes activity_demo_links.
 */
CREATE OR REPLACE VIEW public.activity_demo_suggestions
WITH (security_invoker = true) AS
SELECT
  inst.id AS purchase_activity_id,
  inst.project_id,
  demo.id AS demo_activity_id,
  demo.request_number AS demo_request_number,
  demo.title AS demo_title,
  demo.room_name AS demo_room_name,
  demo.completed_at AS demo_completed_at,
  demo.product_brand AS demo_product_brand,
  demo.product_type AS demo_product_type,
  demo.product_model AS demo_product_model,
  CASE
    WHEN inst.room_key IS NOT NULL AND inst.room_key = demo.room_key AND same_product THEN 'room_and_product'
    WHEN inst.room_key IS NOT NULL AND inst.room_key = demo.room_key THEN 'room'
    ELSE 'product'
  END AS match_reason,
  EXTRACT(DAY FROM (COALESCE(inst.completed_at, now()) - demo.completed_at))::int AS days_since_demo,
  ROW_NUMBER() OVER (
    PARTITION BY inst.id
    ORDER BY
      CASE
        WHEN inst.room_key IS NOT NULL AND inst.room_key = demo.room_key AND same_product THEN 0
        WHEN inst.room_key IS NOT NULL AND inst.room_key = demo.room_key THEN 1
        ELSE 2
      END,
      demo.completed_at DESC
  ) AS rank
FROM public.activities inst
JOIN public.activity_categories inst_cat ON inst_cat.id = inst.category_id AND inst_cat.counts_as_installation
JOIN LATERAL (
  SELECT d.*,
    (d.product_brand IS NOT NULL AND btrim(d.product_brand) <> ''
     AND inst.product_brand IS NOT NULL AND btrim(inst.product_brand) <> ''
     AND lower(btrim(d.product_brand)) = lower(btrim(inst.product_brand))
     AND d.product_type IS NOT NULL AND btrim(d.product_type) <> ''
     AND inst.product_type IS NOT NULL AND btrim(inst.product_type) <> ''
     AND lower(btrim(d.product_type)) = lower(btrim(inst.product_type))) AS same_product
  FROM public.activities d
  JOIN public.activity_categories dc ON dc.id = d.category_id AND dc.counts_as_demo
  WHERE d.project_id = inst.project_id
    AND d.status = 'completed'
    AND d.completed_at IS NOT NULL
    AND d.completed_at <= COALESCE(inst.completed_at, now())
    -- A demo already backing another purchase is spent: never proposed again.
    AND NOT EXISTS (SELECT 1 FROM public.activity_demo_links used WHERE used.demo_activity_id = d.id)
) demo ON true
WHERE NOT EXISTS (SELECT 1 FROM public.activity_demo_links l WHERE l.purchase_activity_id = inst.id)
  -- Only a real connection is worth proposing: the same room, or the same
  -- product. A demo elsewhere in the project, of something else, is not one.
  AND ((inst.room_key IS NOT NULL AND inst.room_key = demo.room_key) OR demo.same_product);

/**
 * Confirm a suggested (or hand-picked) demo as the source of a purchase.
 * Staff only. Idempotent: confirming again just updates the reason, which is
 * what happens when someone corrects a wrong pick.
 */
CREATE OR REPLACE FUNCTION public.iwm_link_demo(
  p_purchase_activity_id uuid,
  p_demo_activity_id uuid,
  p_match_reason text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := public.jwt_user_id();
  v_purchase record;
  v_demo record;
BEGIN
  IF v_user_id IS NULL OR NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only an admin or supervisor can link a purchase to its demo.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT a.*, c.counts_as_installation INTO v_purchase
  FROM public.activities a JOIN public.activity_categories c ON c.id = a.category_id
  WHERE a.id = p_purchase_activity_id;
  IF NOT FOUND OR NOT v_purchase.counts_as_installation THEN
    RAISE EXCEPTION 'That activity is not an installation/purchase.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT a.*, c.counts_as_demo INTO v_demo
  FROM public.activities a JOIN public.activity_categories c ON c.id = a.category_id
  WHERE a.id = p_demo_activity_id;
  IF NOT FOUND OR NOT v_demo.counts_as_demo THEN
    RAISE EXCEPTION 'That activity is not a demo.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_demo.project_id <> v_purchase.project_id THEN
    RAISE EXCEPTION 'The demo must belong to the same project.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Friendlier than the unique-index error, and it names the purchase.
  IF EXISTS (SELECT 1 FROM public.activity_demo_links
             WHERE demo_activity_id = p_demo_activity_id AND purchase_activity_id <> p_purchase_activity_id) THEN
    RAISE EXCEPTION 'That demo is already linked to another purchase. One demo can back only one purchase.'
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO public.activity_demo_links (purchase_activity_id, demo_activity_id, match_reason, confirmed_by)
  VALUES (p_purchase_activity_id, p_demo_activity_id, COALESCE(p_match_reason, 'manual'), v_user_id)
  ON CONFLICT (purchase_activity_id) DO UPDATE
    SET demo_activity_id = EXCLUDED.demo_activity_id,
        match_reason = EXCLUDED.match_reason,
        confirmed_by = EXCLUDED.confirmed_by,
        confirmed_at = now();

  PERFORM public.log_audit(v_user_id, 'activity.demo_linked', 'activity', p_purchase_activity_id,
    jsonb_build_object('demo_activity_id', p_demo_activity_id, 'match_reason', p_match_reason));

  RETURN jsonb_build_object('linked', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.iwm_link_demo(uuid, uuid, text) TO anon, authenticated;

-- The old view (015) stays for anything still reading it, but the dashboard
-- and the recap now read the confirmed links above: a claim has to rest on a
-- human decision, not on a view that can change its answer as data changes.
COMMENT ON VIEW public.activity_discount_eligibility IS
  'Superseded by activity_demo_links + activity_demo_suggestions (029). Kept for backwards compatibility.';
