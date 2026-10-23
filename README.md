# JCE IQAC Proposal Management System

**Status: Stage 2 of 3 — database layer + React/TypeScript front-end.** Stage 3 (hosting config polish, GitHub Actions, orphan-upload cleanup function, deployment guide) is still to come.

## Quick start (development)
```bash
npm install
cp .env.example .env        # fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (public values only)
npm run dev                 # http://localhost:5173
npm run build               # type-check + production build
npm test                    # unit tests (14)
npm run test:db             # 32 database/RLS tests   (needs local PostgreSQL + psycopg2)
npm run test:integration    # 12 service-layer tests against PostgREST (needs PostgREST binary at /tmp/postgrest)
```
Without the two environment variables the app shows a "not configured" screen instead of a fake demo.

## Business rules implemented (your decisions)
* **HOD-authored proposals** skip HOD review and go straight to the Principal (also on resubmission after a Principal return). An HOD can never review their own proposal or report.
* **Principal approval and filing are one atomic step** (history records both "approved" and "filed").
* **Report review is configurable** (Administration → Settings): `HOD then IQAC` (default), `IQAC only`, or `none`. HOD-authored reports skip the HOD step.
* **Required report evidence** defaults to final report + attendance sheet (editable in Settings).


## What exists now
`supabase/migrations/` — apply in order to a *new* Supabase project:

| File | Purpose |
|---|---|
| `…01_schema.sql` | enums, tables, constraints, indexes, departments, default settings |
| `…02_helpers_triggers.sql` | `@jainbgm.in` verified-email gate on `auth.users`, identity helpers, state-machine guard, immutability triggers, audit triggers |
| `…03_workflow.sql` | submit / HOD forward-return / Principal start-return-disapprove-approve, atomic filing-number allocation, attachments, post-event reports, notifications |
| `…04_admin.sql` | role/department assignment, HOD extra departments, settings changes, first-admin bootstrap |
| `…05_rls_grants.sql` | grants (default-deny) and Row Level Security for every table |
| `…06_storage.sql` | private buckets `proposal-docs`, `report-evidence` and storage policies |

## Security model in one page
* **Who may exist:** a trigger on `auth.users` rejects any email that is not exactly `@jainbgm.in` or is unverified.
* **Who has a role:** only rows in `staff_directory`, written by IQAC through `admin_upsert_staff`. A signed-in user with no directory row has *no* profile and sees nothing (`NO_ROLE`).
* **Status & filing data:** clients have no UPDATE right on status, reviewers, timestamps or `filing_number` (column-level grants). They change only via `SECURITY DEFINER` functions, which lock the row, check role/department/state, write history + audit + notifications in one transaction. A trigger additionally rejects any out-of-order transition.
* **Filing numbers:** allocated from `filing_counters` (one row per prefix+academic year) using `INSERT … ON CONFLICT DO UPDATE`, which serialises concurrent approvals. Retried approvals return the existing number. `filing_register` cannot be updated, deleted or truncated.
* **Audit:** `audit_logs`, `approval_actions`, `report_actions` are append-only (triggers) and unreadable except by IQAC (audit) / via proposal visibility (actions).
* **Files:** private buckets, path `<proposal-or-report-uuid>/<file-uuid>.<ext>`, 10 MB + MIME allow-list enforced by the bucket, extension/count enforced by storage policy, and `register_*_attachment` verifies the object really exists in storage before saving metadata. Read access follows proposal/report visibility. No overwrite; replace = delete + upload.

### Visibility matrix (rows returned by `select`)
| Role | Proposals |
|---|---|
| Faculty | own (incl. drafts) |
| HOD | own department(s) + admin-granted extras; never drafts |
| Principal | forwarded, under review, returned by Principal, disapproved, approved, filed |
| IQAC | everything except other people's drafts |

## Run the database tests
```bash
sudo apt-get install postgresql   # PostgreSQL 15/16
pip install psycopg2-binary
cd supabase/tests && ./run_db.sh   # rebuilds a scratch DB, applies migrations, runs 26 tests
```
`00_supabase_stub.sql` is **test-only** (fakes `auth.*`/`storage.*`); never run it on Supabase.

## First IQAC administrator (secure bootstrap)
1. Apply all migrations.
2. In the Supabase **SQL Editor** (runs as `postgres`), run once:
   `select app.bootstrap_first_iqac('coordinator@jainbgm.in', 'Full Name');`
   (refuses if any IQAC user already exists; cannot be called through the API).
3. That person signs in with Google. Their profile is created automatically; they then add everyone else with `admin_upsert_staff` (admin screen arrives in Stage 2).

## Supabase settings you must apply in the dashboard
* Authentication → Providers: enable **Google** only; disable Email, Phone and all other providers; disable "Allow new users to sign up" for email.
* Settings → API → **Exposed schemas**: `public` only (keep `app` and `storage` helper schema private).
* Never expose the service-role key in the browser.

## Front-end map
`src/pages` Login, Dashboard (per role), Proposals, ProposalForm, ProposalDetail, Review, Reports, ReportPage, Filing, Analytics, Notifications, Admin (staff/settings/audit), Guide ·
`src/services` Supabase calls (every call throws on error; nothing reports success unless the server confirmed) · `src/utils` validation, CSV (formula-injection safe), academic-year helpers · `src/components` shared UI.
Faculty identity fields (name, email, employee ID, department, designation) are read-only in the form: they come from the staff directory, not from the browser.

## Known limits (be aware)
* Not yet exercised in a real browser or against real Supabase/Google sign-in or the real Storage API (uploads, signed URLs).
* Dashboards and analytics aggregate in the browser from role-filtered rows; fine for an institution's yearly volume, revisit above ~50,000 proposals.
* Academic-year filters group by proposed date with a June start (`AY_START_MONTH` in `src/lib/constants.ts`).
* No email notifications (in-app only). Orphan-upload cleanup function is Stage 3.
