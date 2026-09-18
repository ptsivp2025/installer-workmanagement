-- ============================================================================
-- Installer Work Management Platform — Migration 009
-- Site PIC contact fields on activities — matches the "PIC Project" fields
-- in the WorkManagementPTSIVP baseline's schedule form (name + phone of the
-- on-site contact, distinct from customer_name).
-- ============================================================================

ALTER TABLE public.activities
  ADD COLUMN pic_name text,
  ADD COLUMN pic_phone text;
