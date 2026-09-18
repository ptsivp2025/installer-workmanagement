-- ============================================================================
-- Installer Work Management Platform — Migration 009
-- 1. Activity PIC (Person In Charge) fields — who from the customer/vendor
--    side to coordinate with for that specific activity.
-- 2. Demo -> Instalasi discount eligibility. Not a special-cased link
--    between two activity rows (002's design already covers that: same
--    project_id is the link) — this is a read-only, database-driven signal
--    for the installer team: "this project had a completed Demo at least
--    30 days before this installation activity, so the vendor may be
--    eligible for a discount/waived fee on this install." Eligibility is a
--    computed flag only, never a stored discount value (%, nominal, etc.)
--    — the actual discount/billing decision stays outside this system.
-- ============================================================================

ALTER TABLE public.activities ADD COLUMN pic_name text;
ALTER TABLE public.activities ADD COLUMN pic_phone text;

-- Which categories count as a "Demo" vs. an "Installation" for the
-- eligibility check below — configurable from Admin Panel, not hardcoded
-- to a category code, consistent with activity_categories already being
-- database-driven (002_business_schema.sql).
ALTER TABLE public.activity_categories ADD COLUMN counts_as_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.activity_categories ADD COLUMN counts_as_installation boolean NOT NULL DEFAULT false;

UPDATE public.activity_categories SET counts_as_demo = true WHERE code = 'instalasi_demo';
UPDATE public.activity_categories SET counts_as_installation = true WHERE code = 'instalasi_beli';

-- One row per (installation activity) that has a qualifying prior Demo in
-- the same project — an inner join, so an activity with no eligible Demo
-- simply has no row here (checked with EXISTS / a LEFT JOIN from the app).
-- security_invoker: RLS on the underlying tables is evaluated as the
-- querying role, not the view owner (Postgres 15+; this project runs 17).
CREATE OR REPLACE VIEW public.activity_discount_eligibility
WITH (security_invoker = true) AS
SELECT
  inst.id AS activity_id,
  inst.project_id,
  demo.id AS demo_activity_id,
  demo.completed_at AS demo_completed_at,
  EXTRACT(DAY FROM (COALESCE(inst.completed_at, now()) - demo.completed_at))::int AS days_since_demo
FROM public.activities inst
JOIN public.activity_categories inst_cat ON inst_cat.id = inst.category_id AND inst_cat.counts_as_installation
JOIN LATERAL (
  SELECT d.id, d.completed_at
  FROM public.activities d
  JOIN public.activity_categories d_cat ON d_cat.id = d.category_id AND d_cat.counts_as_demo
  WHERE d.project_id = inst.project_id
    AND d.status = 'completed'
    AND d.completed_at IS NOT NULL
    AND d.completed_at <= COALESCE(inst.completed_at, now()) - interval '30 days'
  ORDER BY d.completed_at DESC
  LIMIT 1
) demo ON true;

GRANT SELECT ON public.activity_discount_eligibility TO anon;
