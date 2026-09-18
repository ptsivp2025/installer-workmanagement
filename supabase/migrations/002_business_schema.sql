-- ============================================================================
-- Installer Work Management Platform — Migration 002
-- Core business schema: projects (parent entity), database-driven activity
-- categories, activities, personnel, evidence, GPS events, form reviews,
-- audit log.
--
-- PROJECT is the parent/source of truth: every activity (Survey & Meeting,
-- Instalasi Demo, Instalasi Beli, Bongkar Demo, ...) belongs to exactly one
-- project and stays in that project's history — Demo and Beli under the
-- same project is not a special case, it's just two activities with the
-- same project_id.
-- ============================================================================

-- ── activity_categories — database-driven, NOT hardcoded in React ────────
CREATE TABLE public.activity_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  requires_gps boolean NOT NULL DEFAULT true,
  requires_evidence boolean NOT NULL DEFAULT true,
  requires_personnel boolean NOT NULL DEFAULT true,
  evidence_min_count integer NOT NULL DEFAULT 1,
  gps_radius_m integer NOT NULL DEFAULT 100,
  -- Max acceptable GPS accuracy reading (meters) before a capture is treated
  -- as 'low_accuracy' and completion is blocked. Configurable per category
  -- because a tight gps_radius_m (e.g. 20m) needs a tighter accuracy bar
  -- than a loose one (e.g. 150m) — a single hardcoded threshold for both
  -- would either be too lax for the strict category or too strict to ever
  -- pass for the lenient one.
  gps_accuracy_threshold_m integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (code),
  CONSTRAINT activity_categories_evidence_check CHECK (evidence_min_count >= 0),
  CONSTRAINT activity_categories_radius_check CHECK (gps_radius_m > 0),
  CONSTRAINT activity_categories_accuracy_check CHECK (gps_accuracy_threshold_m > 0)
);
CREATE INDEX idx_activity_categories_active_sort ON public.activity_categories USING btree (active, sort_order);

CREATE OR REPLACE TRIGGER trg_activity_categories_updated_at
  BEFORE UPDATE ON public.activity_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── projects — the parent/source of truth ─────────────────────────────────
CREATE TABLE public.projects (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  customer_name text,
  address text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  status text NOT NULL DEFAULT 'active',
  notes text,
  expected_completion date,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (code),
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT projects_status_check CHECK (status = ANY (ARRAY['active','on_hold','completed','cancelled'])),
  CONSTRAINT projects_lat_check CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT projects_lng_check CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);
CREATE INDEX idx_projects_status ON public.projects USING btree (status);

CREATE OR REPLACE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── activities — Request Schedule; belongs to a project + category ───────
CREATE TABLE public.activities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  request_number text NOT NULL,
  project_id uuid NOT NULL,
  category_id uuid NOT NULL,
  title text NOT NULL,
  customer_name text,
  location_address text,
  scheduled_date date NOT NULL,
  start_time time,
  end_time time,
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'scheduled',
  personnel_count integer NOT NULL DEFAULT 0,
  notes text,

  -- Target = where the project/location says work should happen; falls back
  -- to the parent project's coordinates when not set per-activity.
  target_latitude numeric(9,6),
  target_longitude numeric(9,6),

  -- Execution = captured live at completion time, never trusted from an
  -- earlier record (spec §11) — written only by iwm_complete_activity()
  -- (003_functions.sql), not by direct client UPDATE (guard trigger).
  execution_latitude numeric(9,6),
  execution_longitude numeric(9,6),
  gps_accuracy_m numeric,
  gps_captured_at timestamptz,
  distance_from_target_m numeric,
  gps_validation_status text,

  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  PRIMARY KEY (id),
  UNIQUE (request_number),
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES public.activity_categories(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT activities_status_check CHECK (status = ANY (ARRAY['scheduled','in_progress','completed','cancelled'])),
  CONSTRAINT activities_priority_check CHECK (priority = ANY (ARRAY['low','normal','high','urgent'])),
  CONSTRAINT activities_gps_validation_check CHECK (
    gps_validation_status IS NULL OR gps_validation_status = ANY (ARRAY['valid','outside_radius','low_accuracy','unavailable','denied'])
  )
);
CREATE INDEX idx_activities_project ON public.activities USING btree (project_id, scheduled_date);
CREATE INDEX idx_activities_category ON public.activities USING btree (category_id);
CREATE INDEX idx_activities_status ON public.activities USING btree (status);
CREATE INDEX idx_activities_scheduled_date ON public.activities USING btree (scheduled_date);

CREATE OR REPLACE TRIGGER trg_activities_updated_at
  BEFORE UPDATE ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── activity_personnel — historical, never deleted on user change ────────
-- name/role are denormalized at time of assignment on purpose: if a user's
-- name changes later, or the user_id link is cleared, the record on this
-- historical activity must stay exactly as it was (spec §10, §26).
CREATE TABLE public.activity_personnel (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL,
  user_id uuid,
  name text NOT NULL,
  role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE INDEX idx_activity_personnel_activity ON public.activity_personnel USING btree (activity_id);
CREATE INDEX idx_activity_personnel_user ON public.activity_personnel USING btree (user_id);

-- personnel_count on the activity is always derived from this table —
-- never edited directly by the client (spec §10: "do not make personnel
-- count and personnel list inconsistent").
CREATE OR REPLACE FUNCTION public.sync_activity_personnel_count()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_activity_id uuid := COALESCE(NEW.activity_id, OLD.activity_id);
BEGIN
  UPDATE public.activities
    SET personnel_count = (SELECT count(*) FROM public.activity_personnel WHERE activity_id = v_activity_id)
    WHERE id = v_activity_id;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_sync_personnel_count
  AFTER INSERT OR UPDATE OR DELETE ON public.activity_personnel
  FOR EACH ROW EXECUTE FUNCTION public.sync_activity_personnel_count();

-- ── activity_evidence — photo evidence, metadata only (files live in Storage) ─
CREATE TABLE public.activity_evidence (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL,
  project_id uuid NOT NULL,
  uploader_id uuid,
  storage_path text NOT NULL,
  thumbnail_path text,
  evidence_type text NOT NULL DEFAULT 'completion',
  latitude numeric(9,6),
  longitude numeric(9,6),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  FOREIGN KEY (uploader_id) REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE INDEX idx_activity_evidence_activity ON public.activity_evidence USING btree (activity_id);
CREATE INDEX idx_activity_evidence_project ON public.activity_evidence USING btree (project_id);

-- ── activity_gps_events — every capture attempt, valid or not (auditable) ─
-- event_type is a closed set of one right now ('complete' — the only moment
-- GPS is captured, at completion). Kept as a column rather than dropped so a
-- future capture point (e.g. at start-of-execution) doesn't need a schema
-- migration, just a CHECK constraint update and a new INSERT call site.
CREATE TABLE public.activity_gps_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL,
  user_id uuid,
  event_type text NOT NULL,
  latitude numeric(9,6),
  longitude numeric(9,6),
  accuracy_m numeric,
  distance_m numeric,
  validation_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT activity_gps_events_type_check CHECK (event_type = ANY (ARRAY['complete']))
);
CREATE INDEX idx_activity_gps_events_activity ON public.activity_gps_events USING btree (activity_id, created_at);

-- ── form_reviews — one row per completed activity awaiting/decided review ─
CREATE TABLE public.form_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reviewer_id uuid,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_id) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT form_reviews_status_check CHECK (status = ANY (ARRAY['pending','approved','rejected']))
);
CREATE INDEX idx_form_reviews_activity ON public.form_reviews USING btree (activity_id);
CREATE INDEX idx_form_reviews_status ON public.form_reviews USING btree (status);

-- Completion always opens exactly one pending review — this is the trigger
-- that makes Form Review a queue of real work instead of a page someone has
-- to remember to add rows to.
CREATE OR REPLACE FUNCTION public.open_form_review_on_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    IF NOT EXISTS (SELECT 1 FROM public.form_reviews WHERE activity_id = NEW.id AND status = 'pending') THEN
      INSERT INTO public.form_reviews (activity_id, status) VALUES (NEW.id, 'pending');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_open_form_review
  AFTER UPDATE ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.open_form_review_on_completion();

-- ── audit_logs ─────────────────────────────────────────────────────────────
CREATE TABLE public.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE INDEX idx_audit_logs_entity ON public.audit_logs USING btree (entity_type, entity_id);
CREATE INDEX idx_audit_logs_created ON public.audit_logs USING btree (created_at DESC);
