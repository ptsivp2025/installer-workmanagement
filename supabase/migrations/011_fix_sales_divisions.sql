-- ============================================================================
-- Installer Work Management Platform — Migration 011
-- Repair: an empty `sales_divisions` table with a different, unrelated shape
-- (id, name, sort_order, created_at — no code/active/updated_at) already
-- existed in this database before 008 ran, so 008's CREATE TABLE silently
-- didn't match what the app expects. Table is empty (confirmed: 0 rows) —
-- safe to drop and recreate to match 008's intended schema exactly.
-- ============================================================================

DROP TABLE IF EXISTS public.sales_divisions CASCADE;

CREATE TABLE public.sales_divisions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (code)
);
CREATE INDEX idx_sales_divisions_active_sort ON public.sales_divisions USING btree (active, sort_order);

CREATE OR REPLACE TRIGGER trg_sales_divisions_updated_at
  BEFORE UPDATE ON public.sales_divisions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.projects DROP COLUMN IF EXISTS sales_division_id;
ALTER TABLE public.projects ADD COLUMN sales_division_id uuid;
ALTER TABLE public.projects ADD CONSTRAINT projects_sales_division_fkey
  FOREIGN KEY (sales_division_id) REFERENCES public.sales_divisions(id) ON DELETE SET NULL;
CREATE INDEX idx_projects_sales_division ON public.projects USING btree (sales_division_id);

ALTER TABLE public.sales_divisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY sales_divisions_select ON public.sales_divisions
  FOR SELECT TO anon USING (public.is_authenticated());
CREATE POLICY sales_divisions_insert ON public.sales_divisions
  FOR INSERT TO anon WITH CHECK (public.jwt_role() = 'admin');
CREATE POLICY sales_divisions_update ON public.sales_divisions
  FOR UPDATE TO anon USING (public.jwt_role() = 'admin') WITH CHECK (public.jwt_role() = 'admin');
