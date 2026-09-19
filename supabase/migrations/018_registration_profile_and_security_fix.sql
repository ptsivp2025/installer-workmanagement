-- ============================================================================
-- Installer Work Management Platform — Migration 018
--
-- 1. SECURITY FIX (important): a Sales user could change their OWN
--    sales_division_id and instantly read another division's projects,
--    activities, and evidence photos.
--
--    007_users_notifications.sql grants every user an UPDATE policy on their
--    own row (so they can set their Telegram chat id), and the guard trigger
--    that goes with it only froze role/active/username. sales_division_id
--    didn't exist yet at that point — it arrived later, in 014, where it
--    became the key the whole Sales RLS scoping hangs on
--    (current_sales_division_id() reads it straight off this row). So from
--    014 onward, one PATCH to /rest/v1/users?id=eq.<self> was enough for a
--    Sales account to reassign itself to any division and see everything
--    that division has. The guard now freezes it, plus the approval columns
--    added below, for everyone except an admin.
--
-- 2. Self-registration + admin approval: Sales/customer accounts are the
--    ones who rate installer work, so they need to be able to sign
--    themselves up — but never to walk straight in. A registration lands as
--    active = false + approval_status = 'pending', which every RLS policy
--    already treats as "no access" (is_authenticated() -> current_role_from_db()
--    filters on active), and stays that way until an admin approves it.
--
-- 3. Fuller user records: email + position (job title), so an approving
--    admin has something to judge, and so the platform can show who someone
--    actually is beyond a username.
-- ============================================================================

-- ── 1. profile + registration columns ────────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS position text;
-- Existing accounts predate approval entirely, so they default to approved;
-- only rows created by the public /api/auth/register route start pending.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS registered_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_approval_status_check') THEN
    ALTER TABLE public.users ADD CONSTRAINT users_approval_status_check
      CHECK (approval_status = ANY (ARRAY['pending', 'approved', 'rejected']));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_approved_by_fkey') THEN
    ALTER TABLE public.users ADD CONSTRAINT users_approved_by_fkey
      FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- The pending queue is the only thing that reads this column as a filter.
CREATE INDEX IF NOT EXISTS idx_users_approval_status ON public.users (approval_status)
  WHERE approval_status = 'pending';

-- ── 2. the security fix itself ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_users_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') AND public.current_role_from_db() <> 'admin' THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.active IS DISTINCT FROM OLD.active
       OR NEW.username IS DISTINCT FROM OLD.username
       -- Added in 018: this is the key Sales RLS scoping reads, so letting
       -- a user set it themselves is a read of every other division's data.
       OR NEW.sales_division_id IS DISTINCT FROM OLD.sales_division_id
       OR NEW.approval_status IS DISTINCT FROM OLD.approval_status
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    THEN
      RAISE EXCEPTION 'Only an admin may change role, division, account state, or username.' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_guard_users_privileged_columns
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_users_privileged_columns();

-- ── 3. keep a rejected/pending account out even if it's flipped active ───
-- Belt and braces alongside active = false: current_role_from_db() is what
-- every policy funnels through, so gating it here means a pending row can
-- never satisfy any policy, whatever else is done to the row.
CREATE OR REPLACE FUNCTION public.current_role_from_db()
RETURNS text
LANGUAGE sql STABLE
SECURITY DEFINER  -- see 019: without this the users policy recurses
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT role FROM public.users
  WHERE id = public.jwt_user_id() AND active AND approval_status = 'approved';
$$;
