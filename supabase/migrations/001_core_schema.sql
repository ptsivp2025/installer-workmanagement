-- ============================================================================
-- Installer Work Management Platform — Migration 001
-- Core auth schema: users, credentials, sessions, login throttling.
--
-- This platform does NOT use Supabase Auth. Login is custom (bcrypt password
-- + httpOnly session cookie); PostgREST identity comes from a short-lived JWT
-- issued at login (lib/db-token.ts) and read back via request.jwt.claims in
-- RLS policies (004_rls.sql) — see jwt_user_id()/jwt_role() below.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  username text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL DEFAULT 'installer',
  phone text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (username),
  CONSTRAINT users_role_check CHECK (role = ANY (ARRAY['admin','supervisor','installer','reviewer']))
);

CREATE TABLE public.user_credentials (
  user_id uuid NOT NULL,
  password_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id),
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE TABLE public.user_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  token_hash text NOT NULL,
  ip_address text,
  user_agent text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (token_hash),
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);
CREATE INDEX idx_user_sessions_expires ON public.user_sessions USING btree (expires_at);

CREATE TABLE public.login_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  username text NOT NULL,
  ip_address text,
  success boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX idx_login_attempts_username ON public.login_attempts USING btree (username, attempted_at);
CREATE INDEX idx_login_attempts_ip ON public.login_attempts USING btree (ip_address, attempted_at);

-- ── JWT claim helpers (used throughout 004_rls.sql) ─────────────────────
CREATE OR REPLACE FUNCTION public.jwt_user_id()
RETURNS uuid
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'user_id', '')::uuid;
$$;

CREATE OR REPLACE FUNCTION public.jwt_role()
RETURNS text
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'user_role', '');
$$;

-- Re-derives role from the users table (id + active) on every call instead of
-- trusting the JWT's user_role claim at face value. The claim is only ever
-- as fresh as the token's issue time (up to TOKEN_HOURS old); a role change
-- or account deactivation must take effect on the NEXT request, not the next
-- login — so every authorization check below reads live state here rather
-- than the stale claim. STABLE (not IMMUTABLE) so it re-evaluates per query.
CREATE OR REPLACE FUNCTION public.current_role_from_db()
RETURNS text
LANGUAGE sql STABLE
-- SECURITY DEFINER is load-bearing, not hardening: users_select (004_rls.sql)
-- guards public.users with is_authenticated(), which lands here, which reads
-- public.users — so without the owner's RLS bypass this recurses until the
-- backend dies with "stack depth limit exceeded". See 019.
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT role FROM public.users WHERE id = public.jwt_user_id() AND active;
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.current_role_from_db() IN ('admin', 'supervisor');
$$;

CREATE OR REPLACE FUNCTION public.is_reviewer()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.current_role_from_db() IN ('admin', 'supervisor', 'reviewer');
$$;

-- ── updated_at maintenance ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
