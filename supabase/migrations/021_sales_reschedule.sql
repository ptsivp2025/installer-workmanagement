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
