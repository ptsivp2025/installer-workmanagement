-- ============================================================================
-- Installer Work Management Platform — Migration 007
-- Notification settings (Telegram, optional). Single-row config table —
-- staff can read it (they configure it from Admin Panel), only admin writes.
-- Actual sending happens server-side (app/api/notifications/*), never from
-- the browser — the bot token never needs to leave the server even though
-- staff can see it in the settings form via a service-role-backed read.
-- ============================================================================

CREATE TABLE public.notification_settings (
  id boolean NOT NULL DEFAULT true,
  telegram_bot_token text,
  telegram_chat_id text,
  notify_on_completion boolean NOT NULL DEFAULT false,
  notify_on_review_decision boolean NOT NULL DEFAULT false,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT notification_settings_singleton CHECK (id = true),
  FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL
);

INSERT INTO public.notification_settings (id) VALUES (true);

CREATE OR REPLACE TRIGGER trg_notification_settings_updated_at
  BEFORE UPDATE ON public.notification_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_settings_select ON public.notification_settings
  FOR SELECT TO anon USING (public.is_staff());
CREATE POLICY notification_settings_update ON public.notification_settings
  FOR UPDATE TO anon USING (public.jwt_role() = 'admin') WITH CHECK (public.jwt_role() = 'admin');
-- No INSERT/DELETE policy: exactly one row, created above, never removed.
