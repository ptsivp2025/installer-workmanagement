-- ============================================================================
-- Installer Work Management Platform — Migration 027
-- Run after 026.
--
-- 1. Admin-only settings now check the admin role LIVE, like every other
--    policy (001, 019). The write policies on activity categories, sales
--    divisions, platform settings and notification settings/groups
--    (004, 007, 011, 013) trusted the role written into the login token
--    (jwt_role()), which can be up to 8 hours old. An admin who had been
--    deactivated or demoted could keep changing those settings until the
--    token ran out. They now use current_role_from_db(), which also refuses
--    inactive and unapproved accounts.
--
-- 2. The Telegram bot token was readable by supervisors (007: is_staff()).
--    Whoever holds it can send messages as the bot and read its updates.
--    Only admins manage it (Admin Panel → Notifications), so only admins can
--    read it; the server keeps reading it with the service role.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ── activity_categories (004) ──────────────────────────────────────────────
DROP POLICY IF EXISTS activity_categories_insert ON public.activity_categories;
CREATE POLICY activity_categories_insert ON public.activity_categories
  FOR INSERT TO anon WITH CHECK (public.current_role_from_db() = 'admin');
DROP POLICY IF EXISTS activity_categories_update ON public.activity_categories;
CREATE POLICY activity_categories_update ON public.activity_categories
  FOR UPDATE TO anon USING (public.current_role_from_db() = 'admin') WITH CHECK (public.current_role_from_db() = 'admin');

-- ── sales_divisions (011) ──────────────────────────────────────────────────
DROP POLICY IF EXISTS sales_divisions_insert ON public.sales_divisions;
CREATE POLICY sales_divisions_insert ON public.sales_divisions
  FOR INSERT TO anon WITH CHECK (public.current_role_from_db() = 'admin');
DROP POLICY IF EXISTS sales_divisions_update ON public.sales_divisions;
CREATE POLICY sales_divisions_update ON public.sales_divisions
  FOR UPDATE TO anon USING (public.current_role_from_db() = 'admin') WITH CHECK (public.current_role_from_db() = 'admin');

-- ── platform_settings (013) ────────────────────────────────────────────────
DROP POLICY IF EXISTS platform_settings_update ON public.platform_settings;
CREATE POLICY platform_settings_update ON public.platform_settings
  FOR UPDATE TO anon USING (public.current_role_from_db() = 'admin') WITH CHECK (public.current_role_from_db() = 'admin');

-- ── notification_groups (013) ──────────────────────────────────────────────
DROP POLICY IF EXISTS notification_groups_insert ON public.notification_groups;
CREATE POLICY notification_groups_insert ON public.notification_groups
  FOR INSERT TO anon WITH CHECK (public.current_role_from_db() = 'admin');
DROP POLICY IF EXISTS notification_groups_update ON public.notification_groups;
CREATE POLICY notification_groups_update ON public.notification_groups
  FOR UPDATE TO anon USING (public.current_role_from_db() = 'admin') WITH CHECK (public.current_role_from_db() = 'admin');

-- ── notification_settings (007): bot token, admin only ─────────────────────
DROP POLICY IF EXISTS notification_settings_select ON public.notification_settings;
CREATE POLICY notification_settings_select ON public.notification_settings
  FOR SELECT TO anon USING (public.current_role_from_db() = 'admin');
DROP POLICY IF EXISTS notification_settings_update ON public.notification_settings;
CREATE POLICY notification_settings_update ON public.notification_settings
  FOR UPDATE TO anon USING (public.current_role_from_db() = 'admin') WITH CHECK (public.current_role_from_db() = 'admin');
