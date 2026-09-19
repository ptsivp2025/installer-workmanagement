-- ============================================================================
-- Installer Work Management Platform — Migration 019
--
-- FIX: "stack depth limit exceeded" on every single query.
--
-- 004_rls.sql protects the users table with:
--
--     CREATE POLICY users_select ON public.users
--       FOR SELECT TO anon USING (public.is_authenticated());
--
-- and is_authenticated() -> current_role_from_db() ends in:
--
--     SELECT role FROM public.users WHERE id = public.jwt_user_id() AND active;
--
-- That SELECT is itself a read of public.users, so Postgres evaluates
-- users_select on it, which calls is_authenticated() again, which reads
-- public.users again... until the backend runs out of stack and raises
-- "stack depth limit exceeded". Postgres's built-in policy-recursion
-- detector doesn't catch this one: it only sees a policy calling a function,
-- not that the function reads the very table being protected.
--
-- Every policy in the schema funnels through these helpers, so while this is
-- tripping, NOTHING is readable — projects, activities, categories, the lot.
--
-- The fix is the standard one for an RLS helper that has to read the table
-- it guards: SECURITY DEFINER, so the lookup inside runs as the function's
-- owner (the table owner, who is not subject to RLS) and the cycle is cut
-- after exactly one hop.
--
-- Safe to define these as SECURITY DEFINER:
--   * neither takes an argument — there is no caller-supplied value to
--     smuggle in, and nothing is concatenated into SQL;
--   * both are keyed strictly on jwt_user_id(), which reads the signed
--     request.jwt.claims setting, so a caller can only ever resolve to the
--     user their own token names;
--   * both keep `SET search_path TO 'public', 'pg_temp'`, which is what
--     stops a SECURITY DEFINER function from being hijacked by a shadowed
--     table or operator;
--   * both stay read-only (LANGUAGE sql STABLE) — they return a role and a
--     division id, and cannot write anything.
--
-- Idempotent: re-running this is a no-op.
-- ============================================================================

-- Keeps 018's approval_status gate — a pending or rejected account still
-- resolves to NULL here and therefore satisfies no policy at all.
CREATE OR REPLACE FUNCTION public.current_role_from_db()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT role FROM public.users
  WHERE id = public.jwt_user_id() AND active AND approval_status = 'approved';
$$;

-- Same recursion, same fix: 014's Sales scoping reads users from inside the
-- policies that guard users.
CREATE OR REPLACE FUNCTION public.current_sales_division_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT sales_division_id FROM public.users
  WHERE id = public.jwt_user_id() AND active AND approval_status = 'approved';
$$;

-- jwt_user_id(), is_authenticated(), is_staff(), is_reviewer() and is_sales()
-- are deliberately left as-is: none of them touches a table, so none of them
-- is part of the cycle. They only need the two functions above to return.

REVOKE ALL ON FUNCTION public.current_role_from_db() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_sales_division_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_role_from_db() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_sales_division_id() TO anon, authenticated, service_role;
