-- ============================================================================
-- Installer Work Management Platform — Migration 013
-- 1. platform_settings — singleton like notification_settings (007):
--    company identity shown in the app shell, plus a Dashboard toggle.
-- 2. notification_groups — replaces the single chat_id/toggles on
--    notification_settings with many named Telegram destinations, each with
--    its own event toggles (the bot token stays global — one Telegram bot
--    can post to many chats, only the chat_id differs per group).
-- ============================================================================

CREATE TABLE public.platform_settings (
  id boolean NOT NULL DEFAULT true,
  company_name text NOT NULL DEFAULT 'Installer Work Management',
  logo_url text,
  timezone text NOT NULL DEFAULT 'Asia/Jakarta',
  date_format text NOT NULL DEFAULT 'DD/MM/YYYY',
  show_dashboard_category_breakdown boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT platform_settings_singleton CHECK (id = true),
  FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL
);

INSERT INTO public.platform_settings (id) VALUES (true);

CREATE OR REPLACE TRIGGER trg_platform_settings_updated_at
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Readable by anyone logged in — it drives app-shell branding everywhere,
-- not just an admin screen.
CREATE POLICY platform_settings_select ON public.platform_settings
  FOR SELECT TO anon USING (public.is_authenticated());
CREATE POLICY platform_settings_update ON public.platform_settings
  FOR UPDATE TO anon USING (public.jwt_role() = 'admin') WITH CHECK (public.jwt_role() = 'admin');

-- ── notification_groups ──────────────────────────────────────────────────
CREATE TABLE public.notification_groups (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  telegram_chat_id text NOT NULL,
  notify_on_completion boolean NOT NULL DEFAULT false,
  notify_on_review_decision boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX idx_notification_groups_active ON public.notification_groups USING btree (active);

CREATE OR REPLACE TRIGGER trg_notification_groups_updated_at
  BEFORE UPDATE ON public.notification_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.notification_groups ENABLE ROW LEVEL SECURITY;

-- Group chat IDs are internal ops detail, not app-wide branding — staff only.
CREATE POLICY notification_groups_select ON public.notification_groups
  FOR SELECT TO anon USING (public.is_staff());
CREATE POLICY notification_groups_insert ON public.notification_groups
  FOR INSERT TO anon WITH CHECK (public.jwt_role() = 'admin');
CREATE POLICY notification_groups_update ON public.notification_groups
  FOR UPDATE TO anon USING (public.jwt_role() = 'admin') WITH CHECK (public.jwt_role() = 'admin');

-- Migrate the one existing chat_id (007) into a group, then drop the
-- now-redundant columns — the bot token column stays (global secret).
INSERT INTO public.notification_groups (name, telegram_chat_id, notify_on_completion, notify_on_review_decision)
SELECT 'Default', telegram_chat_id, notify_on_completion, notify_on_review_decision
FROM public.notification_settings
WHERE id = true AND telegram_chat_id IS NOT NULL;

ALTER TABLE public.notification_settings DROP COLUMN telegram_chat_id;
ALTER TABLE public.notification_settings DROP COLUMN notify_on_completion;
ALTER TABLE public.notification_settings DROP COLUMN notify_on_review_decision;
