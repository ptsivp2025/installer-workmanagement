-- ============================================================================
-- Installer Work Management Platform — Migration 022
--
-- Found in the platform audit. Run after 021.
--
-- 1. Sales could operate the execution flow on ANY activity. The two
--    execution RPCs (003) are SECURITY DEFINER and only check "has a valid
--    session", a rule written before the Sales role existed (014). So a Sales
--    account could start, cancel or complete an activity in another
--    division just by knowing its id. Now:
--      - Sales can't change an activity's status at all.
--      - Cancelling is admin/supervisor only, which matches what the UI
--        already offered.
--    This is enforced as a trigger on the status column itself, so it holds
--    for iwm_set_activity_status(), iwm_complete_activity() and any future
--    path. Server-side calls with no user on the token (service role, cron)
--    are unaffected.
--
-- 2. Sales could add evidence photos and personnel to any activity, in any
--    division. Both are field work, so both are now closed to Sales, and
--    evidence must be recorded under the uploader's own id. That id is what
--    decides who may delete a photo later, so it can no longer be spoofed.
--
-- 3. Any logged-in account could delete any evidence FILE from Storage,
--    including another installer's. The activity_evidence row was
--    protected; the file behind it was not. A file is now deletable by
--    staff, by its uploader, or by anyone when nothing references it (the
--    client's own cleanup of a half-finished upload).
--
-- 4. Sales accounts, who are external, could read the whole user directory:
--    every employee's name, email, phone and role, plus the accounts of
--    other divisions. They now see only their own row, which is all the
--    Sales screens ever read.
--
-- 5. Bug: personnel an INSTALLER added on site never counted. The trigger
--    that keeps activities.personnel_count in sync ran under the installer's
--    RLS, and installers can't UPDATE activities, so its UPDATE matched zero
--    rows without any error. The count stayed at 0, and on categories that
--    require personnel "Complete" was refused ("needs personnel") even with
--    the team listed on screen. The trigger is now SECURITY DEFINER, and
--    every stale count is repaired once below.
-- ============================================================================

-- ── 1. Who may change an activity's status ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_activities_status_by_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- No user on the token = a server-side job (service role); not our concern.
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR public.jwt_user_id() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.is_sales() THEN
    RAISE EXCEPTION 'Sales accounts cannot start, cancel or complete an activity.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status = 'cancelled' AND NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only an admin or supervisor can cancel an activity.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_guard_activities_status_by_role
  BEFORE UPDATE OF status ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.guard_activities_status_by_role();

-- ── 2. Field work stays with field accounts ─────────────────────────────────
DROP POLICY IF EXISTS activity_evidence_insert ON public.activity_evidence;
CREATE POLICY activity_evidence_insert ON public.activity_evidence FOR INSERT TO anon WITH CHECK (
  public.is_authenticated()
  AND NOT public.is_sales()
  AND uploader_id = public.jwt_user_id()
);

DROP POLICY IF EXISTS activity_personnel_insert ON public.activity_personnel;
CREATE POLICY activity_personnel_insert ON public.activity_personnel FOR INSERT TO anon WITH CHECK (
  public.is_authenticated() AND NOT public.is_sales() AND (
    public.is_staff() OR EXISTS (
      SELECT 1 FROM public.activities a WHERE a.id = activity_id AND a.status IN ('scheduled', 'in_progress')
    )
  )
);

DROP POLICY IF EXISTS activity_evidence_storage_insert ON storage.objects;
CREATE POLICY activity_evidence_storage_insert ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'activity-evidence' AND public.is_authenticated() AND NOT public.is_sales());

-- ── 3. Evidence files: only yours, or staff, or unreferenced ───────────────
-- SECURITY DEFINER so the check sees every activity_evidence row, not just
-- the ones the caller's own RLS lets them read. Otherwise "no other
-- uploader's row points at this file" would be trivially true for a photo
-- the caller simply can't see.
CREATE OR REPLACE FUNCTION public.can_delete_evidence_object(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.is_authenticated() AND NOT public.is_sales() AND (
    public.is_staff() OR NOT EXISTS (
      SELECT 1 FROM public.activity_evidence e
      WHERE (e.storage_path = p_name OR e.thumbnail_path = p_name)
        AND e.uploader_id IS DISTINCT FROM public.jwt_user_id()
    )
  );
$$;

REVOKE ALL ON FUNCTION public.can_delete_evidence_object(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_delete_evidence_object(text) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS activity_evidence_storage_delete ON storage.objects;
CREATE POLICY activity_evidence_storage_delete ON storage.objects
  FOR DELETE TO anon
  USING (bucket_id = 'activity-evidence' AND public.can_delete_evidence_object(name));

-- ── 4. User directory: not for external Sales accounts ─────────────────────
-- current_role_from_db() is SECURITY DEFINER since 019, so calling
-- is_sales() here can't recurse back into this policy.
DROP POLICY IF EXISTS users_select ON public.users;
CREATE POLICY users_select ON public.users FOR SELECT TO anon USING (
  id = public.jwt_user_id()
  OR (public.is_authenticated() AND NOT public.is_sales())
);

-- ── 5. personnel_count sync runs with the owner's rights ───────────────────
-- It only ever writes a count derived from activity_personnel, a row the
-- caller was already allowed to insert or delete, so running it as the
-- owner grants nothing new. The guard triggers on activities skip it
-- (current_user is no longer anon), same as for the other SECURITY DEFINER
-- paths.
CREATE OR REPLACE FUNCTION public.sync_activity_personnel_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_activity_id uuid := COALESCE(NEW.activity_id, OLD.activity_id);
BEGIN
  UPDATE public.activities
    SET personnel_count = (SELECT count(*) FROM public.activity_personnel WHERE activity_id = v_activity_id)
    WHERE id = v_activity_id;
  RETURN NULL;
END;
$$;

-- One-off repair of every count the old trigger left behind.
UPDATE public.activities a
SET personnel_count = c.n
FROM (
  SELECT a2.id, (SELECT count(*) FROM public.activity_personnel p WHERE p.activity_id = a2.id) AS n
  FROM public.activities a2
) c
WHERE c.id = a.id AND a.personnel_count IS DISTINCT FROM c.n;
