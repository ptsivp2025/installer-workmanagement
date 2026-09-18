-- ============================================================================
-- Installer Work Management Platform — Migration 016
-- Theme/appearance settings on platform_settings (013): a primary/secondary
-- brand color pair and optional login-page background + headline. These
-- drive CSS custom properties written client-side (lib/theme.ts), which the
-- Tailwind "brand" color scale reads from — so one color picker in Admin
-- Panel -> Pengaturan Akun re-themes every bg-brand-*/text-brand-* class in
-- the app (buttons, links, active nav, login hero), on the login page AND
-- every page inside, without a rebuild. Modeled after a "Dashboard Setting"
-- pattern from a sibling PTS platform, scoped down to what this installer
-- tool actually needs (no dashboard background image, no opacity sliders,
-- no separate sales-division list — this app's sales_divisions is already
-- its own proper table from migration 008/011).
-- ============================================================================

ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS primary_color text NOT NULL DEFAULT '#2563eb';
ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS secondary_color text NOT NULL DEFAULT '#1d4ed8';
ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS login_bg_url text;
ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS login_headline text;
ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS login_subheadline text;
