# Installer Work Management Platform

A standalone platform for managing installer field operations: **projects** as
the parent/source of truth, with **activities** (Survey & Meeting, Instalasi
Demo, Instalasi Beli, Bongkar Demo, or any category you configure) scheduled
underneath them — each with personnel, server-validated GPS execution, photo
evidence, and a review workflow.

Built with Next.js 14 (App Router, TypeScript), Tailwind CSS, and Supabase
(Postgres + Row Level Security + Storage). It reuses the proven
custom-session/JWT-for-PostgREST auth pattern and image-compression approach
from the WorkManagementPTSIVP baseline, and the server-validated GPS/distance
pattern from the fieldserviceplatform baseline — but ships as its own
independent codebase with no runtime dependency on either.

---

## 1. Requirements

- Node.js 18.18+ (Next.js 14 requirement)
- npm
- A Supabase account (free tier is enough to start)
- A GitHub account (to host the repo)
- A Vercel account (to deploy)

## 2. Local Installation

```bash
npm install
cp .env.example .env.local   # fill in the values — see §3
npm run dev
```

Open http://localhost:3000. You'll land on `/login`. The database migrations
(§4) seed a bootstrap account: username `admin`, password `ChangeMe123!` —
**change it immediately** after your first login (there is no in-app "forgot
password" flow yet for a user's *own* password; changing it requires
`/api/auth/change-password`, which any logged-in page can call. Admins can
reset anyone else's password from Admin Panel → User Management, or by
resetting `user_credentials` directly in the SQL editor).

Other useful commands:

```bash
npm run build       # production build
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
```

## 3. Environment Variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Where to find it | Exposed to browser? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Project Settings → API → Project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API → `anon` `public` key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` key | **No — server only** |
| `SUPABASE_JWT_SECRET` | Project Settings → API → JWT Settings → JWT Secret | **No — server only** |
| `NEXT_PUBLIC_EVIDENCE_BUCKET` | Fixed value: `activity-evidence` (created by the migrations) | Yes |
| `TELEGRAM_BOT_TOKEN` | Optional. From [@BotFather](https://t.me/BotFather) on Telegram (`/newbot`) | **No — server only** |

Never commit `.env.local`. Never put `SUPABASE_SERVICE_ROLE_KEY` or
`SUPABASE_JWT_SECRET` behind a `NEXT_PUBLIC_` prefix.

## 4. Supabase Setup

1. Create a new project at supabase.com.
2. Open **SQL Editor**.
3. Run each file in `supabase/migrations/` **in order** (001 → 006), each as
   its own query:
   - `001_core_schema.sql` — users/sessions/credentials, JWT claim helpers
   - `002_business_schema.sql` — projects, activity_categories, activities,
     personnel, evidence, GPS events, form_reviews, audit_logs
   - `003_functions.sql` — GPS distance/validation, completion workflow,
     review decisions, and the guard triggers that lock down what a plain
     client `UPDATE` is allowed to touch
   - `004_rls.sql` — Row Level Security policies (default-deny for anything
     not explicitly granted)
   - `005_storage.sql` — creates the private `activity-evidence` bucket and
     its upload/delete policies
   - `006_seed.sql` — default activity categories + the bootstrap `admin`
     account
4. Confirm RLS is enabled: **Database → Tables** — every table listed in the
   migrations should show a "RLS enabled" badge (the migrations turn this on
   for you; this is just a sanity check).
5. Confirm the bucket: **Storage** — you should see `activity-evidence`,
   private, with a file size limit of 8MB and JPEG/PNG/WebP only.
6. Grab your API URL/keys (§3) and put them in `.env.local` (local dev) and
   later in Vercel's environment variables (§6).

If you ever need to re-run this on a second environment (staging, a fresh
Supabase project), the migrations are idempotent enough to re-run safely
except `006_seed.sql`'s category inserts, which use `ON CONFLICT DO NOTHING`
and are safe to re-run too.

## 5. GitHub Manual Setup

```bash
# from this project's root
git init                              # if not already a repo
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

(Create the empty repository on GitHub first, without a README, so the push
above doesn't conflict.)

## 6. Vercel Manual Setup

1. vercel.com → **Add New… → Project → Import Git Repository** → select the
   repo you just pushed.
2. Framework preset: Next.js (auto-detected via `vercel.json`).
3. **Environment Variables** — add all five from §3 (Production, and
   Preview if you want preview deployments to work against the same or a
   separate Supabase project).
4. Deploy.
5. Once live, log in with the seeded `admin` account and change the password
   immediately (§2).

## 7. Supabase ↔ Vercel

Production's Vercel environment variables must point at the **same**
Supabase project whose migrations you ran (§4) — mixing a preview
deployment's env vars with a different Supabase project than the one you
migrated is the most common "login works locally but not in prod" mistake.
If you use separate Supabase projects per environment, re-run all six
migrations against each one.

## 8. First Setup Checklist

- [ ] Supabase project created
- [ ] Migrations 001–006 applied in order
- [ ] RLS confirmed enabled on all tables
- [ ] `activity-evidence` storage bucket confirmed private
- [ ] `.env.local` filled in and app runs locally (`npm run dev`)
- [ ] Logged in as `admin` / `ChangeMe123!` and changed the password
- [ ] GitHub repository created and code pushed
- [ ] Vercel project connected to the repository
- [ ] Production environment variables added in Vercel
- [ ] Production deployed and login tested
- [ ] Project creation tested (Projects → New Project)
- [ ] Activity creation tested (Request Schedule → New Activity)
- [ ] GPS capture tested on the activity's Execution panel (allow location
      permission; try both inside and outside the configured radius)
- [ ] Evidence upload tested (photo appears, thumbnail loads)
- [ ] Completion tested (blocked correctly when GPS/evidence/personnel are
      missing; succeeds once all are satisfied)
- [ ] Form Review tested (approve and reject both work, activity's review
      status updates)
- [ ] Admin Panel → User Management tested (create a user, log in as them,
      reset their password)
- [ ] (Optional) `TELEGRAM_BOT_TOKEN` set and a user's `telegram_chat_id`
      linked — schedule an activity or decide a review and confirm the
      message arrives
- [ ] Admin Panel → Activity Categories tested (add a category, confirm it
      appears in Request Schedule's "New Activity" dropdown without any code
      change; deactivate one, confirm it disappears from that dropdown but
      historical activities using it still display correctly)

---

## Architecture Notes

### Auth
No Supabase Auth. Login is bcrypt + an httpOnly session cookie
(`app/api/auth/login`, `lib/server-auth.ts`). Because Postgres/PostgREST
never sees that cookie, login also issues a short-lived JWT
(`lib/db-token.ts`) carrying the user's id/username/role as custom claims;
the browser Supabase client (`lib/supabase.ts`) attaches it to every
PostgREST request so Row Level Security policies can read
`request.jwt.claims` instead of falling back to `USING (true)`.

Authorization never trusts that claim on its own, though.
`is_staff()`/`is_reviewer()`/`is_authenticated()` (`supabase/migrations/001_core_schema.sql`,
`004_rls.sql`) re-read the caller's role and `active` flag from the `users`
table on every policy check via `current_role_from_db()`. A JWT can be up to
8 hours old, so if that token's `user_role` claim were trusted directly, a
deactivated account or a demoted admin would keep their old access until the
token expired. With the live re-check, deactivation/role changes take effect
on the *next request*, not the next login.

### Read visibility
`projects` and `activities` are readable by any logged-in user (this is a
shared operational schedule/dashboard, not a multi-tenant app). Photos
(`activity_evidence`) and raw GPS captures (`activity_gps_events`) are
scoped tighter — visible to reviewers/staff, the uploader/capturer
themselves, or personnel linked to that activity, not to every logged-in
account by default. `form_reviews` is a reviewer-facing queue for the same
reason. Uploading evidence and recording personnel on an open activity stays
open to any authenticated user, since that's the field-execution flow
itself.

### Data access pattern
Most pages call `supabase.from(...)` directly from Client Components and
rely on RLS for authorization — there is no parallel REST API layer
duplicating every table's CRUD. The only server API routes are: auth
(login/session/logout/change-password, which need the service-role key and
the httpOnly cookie) and `/api/evidence/signed-urls` (batched signed URLs so
a list of historical photos never has to be public or downloaded full-size
just to render a thumbnail grid).

### GPS validation
Never trusted from the client. `iwm_complete_activity()` (a `SECURITY
DEFINER` Postgres function, `supabase/migrations/003_functions.sql`)
re-derives the distance from the browser's reported coordinates to the
project/activity's target coordinates using a server-side Haversine
function, decides `valid` / `outside_radius` / `low_accuracy` /
`unavailable`, and only marks the activity `completed` if that — plus the
category's evidence and personnel requirements — all pass. Every capture
attempt is logged to `activity_gps_events`, including blocked ones, so a
denied completion is auditable rather than invisible. Browser GPS is not a
perfect anti-spoofing mechanism — this validates against a stated radius and
records accuracy/timestamp/distance for review, not a cryptographic
guarantee of physical presence.

### Rejected reviews aren't a dead end
Completion always opens exactly one `form_reviews` row; a rejection alone
doesn't give the activity anywhere to go, since `iwm_complete_activity()`
refuses to touch a `completed` activity again. `iwm_reopen_activity()`
(staff-only, only on an activity whose latest review is `rejected`) drops
the activity back to `in_progress` so personnel/evidence can be corrected
and it can be completed again, which opens a fresh pending review.

### Demo → Beli, and any other cross-category relationship
There's no special-cased relationship in the schema. Every activity has a
single `project_id`; Instalasi Demo, Instalasi Beli, Bongkar Demo, and
Survey & Meeting are simply four activities (or however many categories you
configure) sharing that same `project_id`, all visible together on the
project's timeline (`/projects/[id]`) and progress view
(`/project-progress/[id]`).

### Activity categories
Fully database-driven (`activity_categories` table, managed from Admin Panel
→ Activity Categories). Each category configures its own `requires_gps`,
`requires_evidence` (+ minimum photo count), `requires_personnel`,
`gps_radius_m`, active state, and sort order. Deactivating a category hides
it from the "New Activity" picker without touching any activity that
already references it — categories are never hard-deleted from the app.

### Personnel
`activity_personnel` rows are the source of truth (name + role,
free text — not required to be a platform user account); `activities.
personnel_count` is a denormalized count kept in sync by a trigger, never
edited directly, so the count and the list can't drift apart. Once an
activity is `completed`, its personnel rows are locked (only staff can
correct them) so history doesn't quietly change after the fact.

### Storage / egress
Photos are resized and JPEG-recompressed in the browser before upload
(`lib/image-compress.ts`, ~1600px/quality 0.75 for the full photo, ~320px/
quality 0.6 for a matching thumbnail). List views only ever load the
thumbnail variant via short-lived signed URLs fetched in one batched request
per page (`/api/evidence/signed-urls`) — never a public bucket, never the
full-size original just to render a grid.

### User Management
Admin Panel → User Management (`app/(app)/admin/users`) creates accounts,
changes role/active state, resets passwords, and links a Telegram chat id —
all server-side (`app/api/admin/users/**`, service-role + bcrypt), since
`user_credentials` intentionally has no client INSERT/UPDATE policy. Role,
`active`, and `username` are further locked down by a guard trigger
(`guard_users_privileged_columns`, migration 007) so only an admin can
change them even via a direct RLS-permitted update — a user can self-edit
their own `telegram_chat_id` (from wherever they'd naturally set it up) but
nothing else about their own account.

### Telegram notifications
Optional (`TELEGRAM_BOT_TOKEN`) and best-effort — a failed send never blocks
or fails the action that triggered it (`lib/telegram.ts`). Two triggers:
staff scheduling a new activity notifies every active installer with a
linked chat id (`/api/notifications/activity-scheduled`); a review being
approved/rejected notifies that activity's personnel who are linked to a
real account (`/api/notifications/review-decided`, via
`activity_personnel.user_id`). Personnel added as free text (no linked
account — the default) simply receive nothing, since there's no chat id to
send to; linking is optional in `PersonnelPanel`'s "pick an existing user"
selector.

### Sales Division
`sales_divisions` is an admin-managed list (Admin Panel → Sales Divisions),
mirroring the WorkManagementPTSIVP baseline's "Divisi Sales" — there it's a
JSON blob in a key/value settings table; here it's a real table with a
foreign key from `users.sales_division` and `projects.sales_division`, so a
division still assigned to someone can't be deleted (the database rejects
it, no hand-rolled usage-count check needed).

### Request Schedule form
Three sections — Schedule Info, Time & Schedule, Project Info — matching the
baseline's layout, with category picked as a chip grid instead of a
dropdown (it's the highest-signal field on the form) and a site PIC
name/phone distinct from the customer contact. Two behaviors *new activity*
creation has that the baseline's didn't map 1:1, added deliberately: "Add
other dates" creates one activity per date from a single submission instead
of a recurring-schedule engine (out of scope for this platform's size), and
personnel can be assigned right at creation (checkboxes over active users)
instead of only after the fact on the activity's own page — both write
through the same tables Request Schedule already used, nothing new to
validate. Deliberately not carried over: product/brand pickers and the
guest/sales satisfaction review panel — those are specific to the
baseline's AV equipment and multi-brand business, not this platform's.

### Interactive maps
`components/shared/MapPicker.tsx` (address search via Nominatim/
OpenStreetMap — free, no API key — plus a draggable pin) replaces typing
raw coordinates in the Project form; `components/shared/LocationMap.tsx`
is the read-only counterpart, plotting a project's location and, on the
Execution panel, the target vs. captured GPS position side by side so the
field team can see placement, not just read a distance in meters. Leaflet
is dynamically imported inside `useEffect` in both — it touches `window` at
import time and breaks server-side rendering if imported statically.

### What's intentionally not here
Per the build brief: no Incentive, Request Design, Picket, Movement Logs,
PTS Database, Tech Note, Learning Center, or PIC Brand admin screens.
