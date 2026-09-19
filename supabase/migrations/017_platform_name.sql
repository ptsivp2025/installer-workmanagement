-- ============================================================================
-- Installer Work Management Platform — Migration 017
-- Splits the sidebar/login header into two lines, matching the reference
-- "Dashboard Setting" pattern: a bold platform_name (the big title) and the
-- existing company_name as the smaller subtitle underneath it — previously
-- company_name alone had to serve both roles.
-- ============================================================================

ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS platform_name text NOT NULL DEFAULT 'Installer Work Management';
