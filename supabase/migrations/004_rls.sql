-- ============================================================================
-- Installer Work Management Platform — Migration 004
-- Row Level Security. Enforced in Postgres, not just in the Next.js app —
-- an IDOR or a direct PostgREST call must be denied here regardless of what
-- the UI would have allowed (spec §21).
--
-- Tables that are only ever written through a SECURITY DEFINER function
-- (form_reviews, activity_gps_events, audit_logs, user_sessions,
-- user_credentials, login_attempts) get RLS enabled with NO client write
-- policy at all — default-deny, exactly as intended.
-- ============================================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_personnel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_gps_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Live check, not a JWT-claim check: a deactivated account is locked out of
-- every policy below on its very next request, regardless of how much of
-- its 8-hour token lifetime remains (see current_role_from_db(), 001).
CREATE OR REPLACE FUNCTION public.is_authenticated()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.current_role_from_db() IS NOT NULL;
$$;

-- ── users — readable by any logged-in user (personnel/reviewer pickers),
-- no client write policy: accounts are provisioned via SQL (see README).
CREATE POLICY users_select ON public.users FOR SELECT TO anon USING (public.is_authenticated());

-- user_credentials / user_sessions / login_attempts: service-role only, no
-- policy needed for anon — RLS enabled with zero policies = default deny.

-- ── activity_categories — read by anyone logged in; only admin writes ────
CREATE POLICY activity_categories_select ON public.activity_categories
  FOR SELECT TO anon USING (public.is_authenticated());
CREATE POLICY activity_categories_insert ON public.activity_categories
  FOR INSERT TO anon WITH CHECK (public.jwt_role() = 'admin');
CREATE POLICY activity_categories_update ON public.activity_categories
  FOR UPDATE TO anon USING (public.jwt_role() = 'admin') WITH CHECK (public.jwt_role() = 'admin');
-- No DELETE policy: deactivate (active = false), never destroy a category
-- that historical activities reference.

-- ── projects — read by anyone logged in; admin/supervisor manage ─────────
CREATE POLICY projects_select ON public.projects FOR SELECT TO anon USING (public.is_authenticated());
CREATE POLICY projects_insert ON public.projects FOR INSERT TO anon WITH CHECK (public.is_staff());
CREATE POLICY projects_update ON public.projects FOR UPDATE TO anon USING (public.is_staff()) WITH CHECK (public.is_staff());
-- No DELETE policy: close a project via status, never remove project history.

-- ── activities — read by anyone logged in; schedule fields by staff only.
-- Execution/status fields are further frozen by the guard trigger in
-- 003_functions.sql regardless of this policy.
CREATE POLICY activities_select ON public.activities FOR SELECT TO anon USING (public.is_authenticated());
CREATE POLICY activities_insert ON public.activities FOR INSERT TO anon WITH CHECK (public.is_staff());
CREATE POLICY activities_update ON public.activities FOR UPDATE TO anon USING (public.is_staff()) WITH CHECK (public.is_staff());

-- ── activity_personnel — anyone logged in can read/record for an active
-- activity (field team adding who's on site); staff correct mistakes.
CREATE POLICY activity_personnel_select ON public.activity_personnel FOR SELECT TO anon USING (public.is_authenticated());
-- Staff may add a personnel record on a completed activity too (correcting a
-- miss after the fact), matching the same bypass activity_evidence's guard
-- trigger already grants them — everyone else only while it's still open.
CREATE POLICY activity_personnel_insert ON public.activity_personnel FOR INSERT TO anon WITH CHECK (
  public.is_authenticated() AND (
    public.is_staff() OR EXISTS (
      SELECT 1 FROM public.activities a WHERE a.id = activity_id AND a.status IN ('scheduled', 'in_progress')
    )
  )
);
CREATE POLICY activity_personnel_update ON public.activity_personnel FOR UPDATE TO anon
  USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY activity_personnel_delete ON public.activity_personnel FOR DELETE TO anon USING (public.is_staff());

-- ── activity_evidence — reading is scoped, not blanket: reviewers/staff see
-- everything (they have to, to review/manage); anyone else only their own
-- upload or an activity they're personnel on. Photos can be of a customer's
-- premises, so "any logged-in installer can browse the whole company's job
-- photos" was judged too broad — tightened deliberately (uploading/deleting
-- stays open to any authenticated user on an open activity, same as before).
CREATE POLICY activity_evidence_select ON public.activity_evidence FOR SELECT TO anon USING (
  public.is_reviewer()
  OR uploader_id = public.jwt_user_id()
  OR EXISTS (SELECT 1 FROM public.activity_personnel p WHERE p.activity_id = activity_evidence.activity_id AND p.user_id = public.jwt_user_id())
);
CREATE POLICY activity_evidence_insert ON public.activity_evidence FOR INSERT TO anon WITH CHECK (public.is_authenticated());
CREATE POLICY activity_evidence_delete ON public.activity_evidence FOR DELETE TO anon USING (
  public.is_staff() OR uploader_id = public.jwt_user_id()
);

-- ── activity_gps_events — audit trail: reviewers/staff see everything,
-- others only their own capture attempts. Insert only via
-- iwm_complete_activity() (SECURITY DEFINER — no client INSERT policy).
CREATE POLICY activity_gps_events_select ON public.activity_gps_events FOR SELECT TO anon USING (
  public.is_reviewer() OR user_id = public.jwt_user_id()
);

-- ── form_reviews — the review queue is a reviewer-facing workspace, not a
-- general activity feed; scoped to reviewers/staff plus whoever is personnel
-- on the activity being reviewed (so a field team can see their own
-- approve/reject outcome). Writes only via the completion trigger and
-- iwm_review_activity()/iwm_reopen_activity() (all SECURITY DEFINER).
CREATE POLICY form_reviews_select ON public.form_reviews FOR SELECT TO anon USING (
  public.is_reviewer()
  OR EXISTS (SELECT 1 FROM public.activity_personnel p WHERE p.activity_id = form_reviews.activity_id AND p.user_id = public.jwt_user_id())
);

-- ── audit_logs — staff only; immutable (no update/delete policy at all).
CREATE POLICY audit_logs_select ON public.audit_logs FOR SELECT TO anon USING (public.is_staff());
