-- ============================================================================
-- Installer Work Management Platform — Migration 014
-- 'sales' role: a Sales Division's own account, scoped to only its own
-- division's projects/activities, to check progress and rate the
-- installer team's work per completed activity (sales_reviews) — separate
-- from the internal Form Review QC gate (GPS/evidence/personnel), which
-- stays staff/reviewer-only.
-- ============================================================================

ALTER TABLE public.users DROP CONSTRAINT users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role = ANY (ARRAY['admin','supervisor','installer','reviewer','sales']));

ALTER TABLE public.users ADD COLUMN sales_division_id uuid;
ALTER TABLE public.users ADD CONSTRAINT users_sales_division_fkey
  FOREIGN KEY (sales_division_id) REFERENCES public.sales_divisions(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.is_sales()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.current_role_from_db() = 'sales';
$$;

CREATE OR REPLACE FUNCTION public.current_sales_division_id()
RETURNS uuid
LANGUAGE sql STABLE
-- Reads public.users from inside the policies that guard public.users — see
-- the note in 001 and migration 019.
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT sales_division_id FROM public.users WHERE id = public.jwt_user_id() AND active;
$$;

-- ── Scope projects/activities/evidence/personnel to a sales user's own
-- division. Every other role keeps its existing unrestricted read (the
-- added clause is a no-op for them: "NOT is_sales()" short-circuits true).
DROP POLICY IF EXISTS projects_select ON public.projects;
CREATE POLICY projects_select ON public.projects FOR SELECT TO anon USING (
  public.is_authenticated() AND (
    NOT public.is_sales() OR sales_division_id = public.current_sales_division_id()
  )
);

DROP POLICY IF EXISTS activities_select ON public.activities;
CREATE POLICY activities_select ON public.activities FOR SELECT TO anon USING (
  public.is_authenticated() AND (
    NOT public.is_sales() OR EXISTS (
      SELECT 1 FROM public.projects p WHERE p.id = activities.project_id AND p.sales_division_id = public.current_sales_division_id()
    )
  )
);

DROP POLICY IF EXISTS activity_evidence_select ON public.activity_evidence;
CREATE POLICY activity_evidence_select ON public.activity_evidence FOR SELECT TO anon USING (
  public.is_reviewer()
  OR uploader_id = public.jwt_user_id()
  OR EXISTS (SELECT 1 FROM public.activity_personnel p WHERE p.activity_id = activity_evidence.activity_id AND p.user_id = public.jwt_user_id())
  OR (public.is_sales() AND EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = activity_evidence.project_id AND p.sales_division_id = public.current_sales_division_id()
  ))
);

DROP POLICY IF EXISTS activity_personnel_select ON public.activity_personnel;
CREATE POLICY activity_personnel_select ON public.activity_personnel FOR SELECT TO anon USING (
  public.is_authenticated() AND (
    NOT public.is_sales() OR EXISTS (
      SELECT 1 FROM public.activities a JOIN public.projects p ON p.id = a.project_id
      WHERE a.id = activity_personnel.activity_id AND p.sales_division_id = public.current_sales_division_id()
    )
  )
);

-- ── sales_reviews — one row per completed activity, auto-opened exactly
-- like form_reviews (003's open_form_review_on_completion, extended below).
CREATE TABLE public.sales_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  rating integer,
  comment text,
  reviewer_id uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_id) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT sales_reviews_status_check CHECK (status = ANY (ARRAY['pending','submitted'])),
  CONSTRAINT sales_reviews_rating_check CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)
);
CREATE INDEX idx_sales_reviews_activity ON public.sales_reviews USING btree (activity_id);
CREATE INDEX idx_sales_reviews_status ON public.sales_reviews USING btree (status);

ALTER TABLE public.sales_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY sales_reviews_select ON public.sales_reviews FOR SELECT TO anon USING (
  public.is_staff() OR (
    public.is_sales() AND EXISTS (
      SELECT 1 FROM public.activities a JOIN public.projects p ON p.id = a.project_id
      WHERE a.id = sales_reviews.activity_id AND p.sales_division_id = public.current_sales_division_id()
    )
  )
);
-- Sales fills in their own division's pending review — no separate RPC
-- needed, this is feedback, not a gate the rest of the app depends on.
CREATE POLICY sales_reviews_update ON public.sales_reviews FOR UPDATE TO anon USING (
  public.is_sales() AND EXISTS (
    SELECT 1 FROM public.activities a JOIN public.projects p ON p.id = a.project_id
    WHERE a.id = sales_reviews.activity_id AND p.sales_division_id = public.current_sales_division_id()
  )
) WITH CHECK (
  public.is_sales() AND EXISTS (
    SELECT 1 FROM public.activities a JOIN public.projects p ON p.id = a.project_id
    WHERE a.id = sales_reviews.activity_id AND p.sales_division_id = public.current_sales_division_id()
  )
);
-- No INSERT policy: rows are only created by the trigger below, which runs
-- inside iwm_complete_activity()'s SECURITY DEFINER context (same pattern
-- as form_reviews — see 003_functions.sql's header comment).

CREATE OR REPLACE FUNCTION public.open_form_review_on_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    IF NOT EXISTS (SELECT 1 FROM public.form_reviews WHERE activity_id = NEW.id AND status = 'pending') THEN
      INSERT INTO public.form_reviews (activity_id, status) VALUES (NEW.id, 'pending');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sales_reviews WHERE activity_id = NEW.id AND status = 'pending') THEN
      INSERT INTO public.sales_reviews (activity_id, status) VALUES (NEW.id, 'pending');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
