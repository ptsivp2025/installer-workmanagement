-- ============================================================================
-- Installer Work Management Platform — Migration 015
-- 1. Product identity on activities — kept deliberately coarse: Installer
--    Group only tracks Brand (Maxhub, Promethean, Panasonic, ...) and
--    Install Type (Videowall, Signage, Projector LED, ...); exact Model is
--    optional and there is no Serial Number / Qty — this platform tracks
--    installer work, not inventory. Brand + Install Type are required for
--    Demo and Instalasi Beli categories, so a later purchase can be matched
--    back to the demo of the SAME kind of product, not just the same
--    project/customer (spec §5, §6).
-- 2. Primary PIC vs Support Team: activity_personnel gains is_primary, with
--    exactly one primary enforced per activity (spec §7). The customer/
--    vendor-side pic_name/pic_phone columns from 009 are a different concept
--    (who to coordinate with on site) and are unchanged.
-- 3. Atomic activity + team creation (iwm_create_activity) and a staff-only
--    atomic primary-PIC reassignment (iwm_set_primary_personnel), so a
--    partial write can never leave an activity half-configured (spec §21).
-- 4. activity_discount_eligibility now matches Demo -> Purchase by Brand +
--    Install Type, not project alone, and drops the old 30-day minimum —
--    the platform only surfaces the fact, never a financial decision (§5).
-- ============================================================================

-- ── product identity — Brand + Install Type required, Model optional ─────
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS product_brand text;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS product_type text;
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS product_model text;

-- Enforced on write only — existing historical rows are never retroactively
-- invalidated by this (spec §22), only a future INSERT/UPDATE is checked.
CREATE OR REPLACE FUNCTION public.guard_activity_product_required()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_needs_product boolean;
BEGIN
  SELECT (counts_as_demo OR counts_as_installation) INTO v_needs_product
  FROM public.activity_categories WHERE id = NEW.category_id;

  IF v_needs_product AND (
    NEW.product_brand IS NULL OR btrim(NEW.product_brand) = ''
    OR NEW.product_type IS NULL OR btrim(NEW.product_type) = ''
  ) THEN
    RAISE EXCEPTION 'Brand and Install Type are required for this activity category.' USING ERRCODE = 'not_null_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_guard_activity_product_required
  BEFORE INSERT OR UPDATE ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.guard_activity_product_required();

-- ── primary PIC vs support team ───────────────────────────────────────────
ALTER TABLE public.activity_personnel ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

-- Backfill: the earliest-added person on each existing activity becomes its
-- Primary PIC, so historical data isn't left with zero PICs (spec §22).
WITH first_person AS (
  SELECT DISTINCT ON (activity_id) id
  FROM public.activity_personnel
  ORDER BY activity_id, created_at ASC
)
UPDATE public.activity_personnel p
SET is_primary = true
FROM first_person f
WHERE p.id = f.id;

-- At most one primary per activity — a second concurrent attempt fails
-- loudly instead of silently overwriting the existing PIC.
CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_personnel_one_primary
  ON public.activity_personnel (activity_id) WHERE is_primary;

-- ── iwm_create_activity — atomic Activity + PIC + support team ───────────
-- Replaces "insert activity, then insert personnel rows" from the client:
-- if the personnel insert fails, the whole activity insert rolls back too,
-- instead of leaving a scheduled activity with nobody assigned (spec §21).
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
  p_personnel jsonb DEFAULT '[]'::jsonb
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
    product_brand, product_type, product_model, created_by
  ) VALUES (
    v_request_number, p_project_id, p_category_id, btrim(p_title), p_customer_name, p_location_address,
    p_scheduled_date, p_start_time, p_end_time, COALESCE(p_priority, 'normal'), p_notes,
    p_target_latitude, p_target_longitude, p_pic_name, p_pic_phone,
    p_product_brand, p_product_type, p_product_model, v_user_id
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

-- ── iwm_set_primary_personnel — atomic PIC reassignment, staff only ──────
-- Correcting who the Primary PIC is on an already-recorded activity is a
-- staff decision (like reopening a rejected review), not something the
-- field team self-serves — consistent with activity_personnel_update
-- already being staff-only in RLS (004_rls.sql).
CREATE OR REPLACE FUNCTION public.iwm_set_primary_personnel(p_activity_id uuid, p_personnel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid := public.jwt_user_id();
BEGIN
  IF v_user_id IS NULL OR NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only staff may reassign the Primary PIC.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.activity_personnel WHERE id = p_personnel_id AND activity_id = p_activity_id) THEN
    RAISE EXCEPTION 'That person is not recorded on this activity.' USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE public.activity_personnel SET is_primary = false WHERE activity_id = p_activity_id AND is_primary AND id <> p_personnel_id;
  UPDATE public.activity_personnel SET is_primary = true WHERE id = p_personnel_id;

  PERFORM public.log_audit(v_user_id, 'activity.primary_pic_changed', 'activity', p_activity_id,
    jsonb_build_object('personnel_id', p_personnel_id));

  RETURN jsonb_build_object('personnel_id', p_personnel_id);
END;
$$;

-- ── activity_discount_eligibility — Demo -> Purchase, matched by product ─
-- Matching requires the same project AND the same Brand + Install Type —
-- two different brands/types under the same project must never be linked
-- (spec §5's explicit counter-example). Model is optional on both sides, so
-- it's used only as a tie-breaker (preferred when it matches too), never a
-- requirement. The 30-day minimum from migration 009 is dropped: the
-- platform only reports "a completed Demo exists before this Purchase,"
-- never a policy about how long is long enough — that stays a human
-- decision.
CREATE OR REPLACE VIEW public.activity_discount_eligibility
WITH (security_invoker = true) AS
SELECT
  inst.id AS activity_id,
  inst.project_id,
  demo.id AS demo_activity_id,
  demo.completed_at AS demo_completed_at,
  demo.product_brand AS demo_product_brand,
  demo.product_type AS demo_product_type,
  demo.product_model AS demo_product_model,
  EXTRACT(DAY FROM (COALESCE(inst.completed_at, now()) - demo.completed_at))::int AS days_since_demo
FROM public.activities inst
JOIN public.activity_categories inst_cat ON inst_cat.id = inst.category_id AND inst_cat.counts_as_installation
JOIN LATERAL (
  SELECT d.id, d.completed_at, d.product_brand, d.product_type, d.product_model
  FROM public.activities d
  JOIN public.activity_categories d_cat ON d_cat.id = d.category_id AND d_cat.counts_as_demo
  WHERE d.project_id = inst.project_id
    AND d.status = 'completed'
    AND d.completed_at IS NOT NULL
    AND d.completed_at <= COALESCE(inst.completed_at, now())
    AND d.product_brand IS NOT NULL AND btrim(d.product_brand) <> ''
    AND inst.product_brand IS NOT NULL AND btrim(inst.product_brand) <> ''
    AND lower(btrim(d.product_brand)) = lower(btrim(inst.product_brand))
    AND d.product_type IS NOT NULL AND btrim(d.product_type) <> ''
    AND inst.product_type IS NOT NULL AND btrim(inst.product_type) <> ''
    AND lower(btrim(d.product_type)) = lower(btrim(inst.product_type))
  ORDER BY
    -- Prefer a Demo whose (optional) Model also matches, then most recent.
    CASE WHEN d.product_model IS NOT NULL AND inst.product_model IS NOT NULL
      AND lower(btrim(d.product_model)) = lower(btrim(inst.product_model)) THEN 0 ELSE 1 END,
    d.completed_at DESC
  LIMIT 1
) demo ON true;

GRANT SELECT ON public.activity_discount_eligibility TO anon;
