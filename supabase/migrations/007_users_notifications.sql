-- ============================================================================
-- Installer Work Management Platform — Migration 007
-- Telegram notification target per user, and Admin Panel → User Management.
-- ============================================================================

ALTER TABLE public.users ADD COLUMN telegram_chat_id text;

-- ── Admin-only user management RPCs ───────────────────────────────────────
-- Creating/editing users and resetting passwords go through
-- app/api/admin/users/** (service-role + bcrypt), not these — but the
-- ordinary users table columns (role, active, telegram_chat_id, phone) can
-- be updated directly by admins via RLS below, no RPC needed for those.

CREATE POLICY users_update_by_admin ON public.users FOR UPDATE TO anon
  USING (public.current_role_from_db() = 'admin')
  WITH CHECK (public.current_role_from_db() = 'admin');

-- A user may set their own Telegram chat id (from their profile / after
-- messaging the bot) without needing admin to do it for them — but only
-- that one column; role/active stay admin-only via the guard trigger below.
CREATE POLICY users_update_own_telegram ON public.users FOR UPDATE TO anon
  USING (id = public.jwt_user_id())
  WITH CHECK (id = public.jwt_user_id());

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
    THEN
      RAISE EXCEPTION 'Only an admin may change role, active state, or username.' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_guard_users_privileged_columns
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_users_privileged_columns();
