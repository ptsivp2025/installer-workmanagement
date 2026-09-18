-- ============================================================================
-- Installer Work Management Platform — Migration 012
-- Individual sales person name on a project, alongside sales_division_id
-- (008) which now doubles as the project's customer/company identity —
-- the "Customer / Company" field is no longer separate free text (see
-- ProjectFormModal.tsx: customer_name is set from the chosen division).
-- ============================================================================

ALTER TABLE public.projects ADD COLUMN sales_person_name text;
