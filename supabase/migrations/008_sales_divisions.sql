-- ============================================================================
-- Installer Work Management Platform — Migration 008
-- Sales Division: an admin-managed list (Admin Panel → Sales Divisions),
-- mirroring the WorkManagementPTSIVP baseline's "Divisi Sales" — there it's
-- a JSON blob in a key/value settings table; here it's a proper table with
-- a real foreign key, so "delete a division still in use" is rejected by
-- the database itself instead of needing a hand-rolled usage-count check.
-- ============================================================================

CREATE TABLE public.sales_divisions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (name)
);
CREATE INDEX idx_sales_divisions_sort ON public.sales_divisions USING btree (sort_order);

ALTER TABLE public.users
  ADD COLUMN sales_division text,
  ADD CONSTRAINT users_sales_division_fkey FOREIGN KEY (sales_division)
    REFERENCES public.sales_divisions(name) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public.projects
  ADD COLUMN sales_division text,
  ADD CONSTRAINT projects_sales_division_fkey FOREIGN KEY (sales_division)
    REFERENCES public.sales_divisions(name) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public.sales_divisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY sales_divisions_select ON public.sales_divisions FOR SELECT TO anon USING (public.is_authenticated());
CREATE POLICY sales_divisions_insert ON public.sales_divisions FOR INSERT TO anon WITH CHECK (public.current_role_from_db() = 'admin');
CREATE POLICY sales_divisions_delete ON public.sales_divisions FOR DELETE TO anon USING (public.current_role_from_db() = 'admin');
-- No UPDATE policy: a division is renamed by deleting and re-adding (ON
-- UPDATE CASCADE exists for completeness, not because renaming is exposed
-- in the UI) — keeps this table as simple as activity_categories' sibling
-- pattern instead of growing its own edit form.
