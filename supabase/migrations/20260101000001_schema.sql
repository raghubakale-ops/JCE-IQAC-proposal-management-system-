-- JCE IQAC Proposal Management System — Migration 1: types, tables, reference data
-- Apply to a NEW Supabase project (SQL editor or `supabase db push`).

create schema if not exists app;   -- private helper schema; NOT exposed through the Data API

-- ---------- controlled vocabularies ----------
create type public.app_role as enum ('faculty','hod','principal','iqac');

create type public.proposal_status as enum (
  'draft','hod_review','hod_returned','forwarded','principal_review',
  'principal_returned','disapproved','approved','filed');

create type public.report_status as enum ('draft','submitted','returned','verified');

create type public.approval_action_type as enum (
  'submitted','resubmitted','hod_forwarded','hod_returned','principal_review_started',
  'principal_approved','principal_returned','principal_disapproved','filing_allocated');

create type public.attachment_kind as enum (
  'proposal_document','brochure','attendance_sheet','photograph','feedback_summary',
  'final_report','certificate','bill_receipt','other');

-- ---------- reference data ----------
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(code) and length(code) between 2 and 12),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Department names are a best reading of the codes in the original HTML. VERIFY and edit.
insert into public.departments (code, name) values
 ('AIML','Artificial Intelligence & Machine Learning'),('CHE','Chemistry'),
 ('CS','Computer Science & Engineering'),('CV','Civil Engineering'),
 ('EC','Electronics & Communication Engineering'),('EE','Electrical & Electronics Engineering'),
 ('FY','First Year Engineering'),('MAT','Mathematics'),('MBA','Master of Business Administration'),
 ('MCA','Master of Computer Applications'),('ME','Mechanical Engineering'),('PHY','Physics');

-- Administrative assignment of roles. Source of truth for role/department/designation.
create table public.staff_directory (
  id uuid primary key default gen_random_uuid(),
  email text not null unique
    check (email = lower(email) and email ~ '^[^@[:space:]]+@jainbgm\.in$'),
  full_name text not null,
  role public.app_role not null,
  department_id uuid references public.departments(id),
  designation text,
  employee_id text unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (role not in ('faculty','hod') or department_id is not null)
);

-- Created automatically at first sign-in (or when the directory entry is added). Never client-written.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  email text not null unique check (email = lower(email)),
  full_name text not null,
  role public.app_role not null,
  department_id uuid references public.departments(id),
  designation text,
  employee_id text,
  mobile text check (mobile is null or mobile ~ '^[0-9+() -]{7,20}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Extra departments an HOD may review (explicit administrative grant)
create table public.hod_extra_departments (
  staff_id uuid not null references public.staff_directory(id) on delete cascade,
  department_id uuid not null references public.departments(id),
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  primary key (staff_id, department_id)
);

create table public.system_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

insert into public.system_settings (key, value) values
 ('institution_name', '"Jain College of Engineering, Belagavi"'),
 ('filing_prefix',    '"JCE/IQAC"'),
 ('academic_year',    '"2026-27"'),
 ('filing_digits',    '3'),
 ('filing_start',     '1'),
 ('report_due_days',  '30'),
 ('report_review_required', 'true'),
 ('report_required_kinds', '["final_report","attendance_sheet"]');

-- ---------- proposals ----------
create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  faculty_id uuid not null references public.profiles(id) on delete restrict,
  department_id uuid not null references public.departments(id),
  -- snapshots set by trigger from the trusted profile (client cannot supply them)
  faculty_name text not null,
  faculty_email text not null,
  employee_id text,
  designation text,
  mobile text check (mobile is null or mobile ~ '^[0-9+() -]{7,20}$'),

  status public.proposal_status not null default 'draft',

  title text not null check (length(trim(title)) between 1 and 300),
  category text check (category in ('Academic Activity','Faculty Development','Student Development',
     'Research & Innovation','Industry/Professional Activity','Quality Initiative','Extension/Outreach','Other')),
  activity_type text check (activity_type in ('Workshop','FDP','Seminar','Conference','Expert Talk',
     'Training Programme','Guest Lecture','Industrial Visit','Student Activity','Research Activity',
     'Awareness Programme','Other')),
  proposed_date date,
  start_time time,
  end_time time,
  venue text,
  target_participants text,
  expected_participants integer check (expected_participants is null or expected_participants >= 0),
  objectives text,
  description text,
  expected_outcomes text,
  academic_relevance text,
  iqac_relevance text,
  compliance_mapping text,
  total_budget numeric(12,2) not null default 0 check (total_budget >= 0),
  funding_source text,
  budget_details text,
  resource_name text,
  resource_org text,
  resource_expertise text,
  resource_honorarium numeric(12,2) check (resource_honorarium is null or resource_honorarium >= 0),
  resource_travel numeric(12,2) check (resource_travel is null or resource_travel >= 0),
  resource_accommodation numeric(12,2) check (resource_accommodation is null or resource_accommodation >= 0),
  resource_finance text,
  declaration boolean not null default false,

  -- workflow-controlled (no client write access)
  revision_no integer not null default 0,
  submitted_at timestamptz,
  resubmitted_at timestamptz,
  forwarded_at timestamptz,
  hod_reviewer_id uuid references public.profiles(id),
  hod_reviewed_at timestamptz,
  hod_remarks text,
  principal_reviewer_id uuid references public.profiles(id),
  principal_reviewed_at timestamptz,
  principal_remarks text,
  approved_at timestamptz,
  filing_number text unique,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time is null or end_time is null or end_time > start_time)
);
create index proposals_faculty_idx on public.proposals (faculty_id);
create index proposals_dept_status_idx on public.proposals (department_id, status);
create index proposals_status_idx on public.proposals (status);
create index proposals_date_idx on public.proposals (proposed_date);

create table public.proposal_attachments (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (length(file_name) between 1 and 200),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  kind public.attachment_kind not null default 'proposal_document',
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index proposal_attachments_prop_idx on public.proposal_attachments (proposal_id);

create table public.approval_actions (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete restrict,
  action public.approval_action_type not null,
  from_status public.proposal_status,
  to_status public.proposal_status not null,
  actor_id uuid not null references public.profiles(id),
  actor_name text not null,
  actor_role public.app_role not null,
  remarks text,
  created_at timestamptz not null default now()
);
create index approval_actions_prop_idx on public.approval_actions (proposal_id, created_at);

-- Allocation counters: one row per (prefix, academic year). Row-locked during allocation.
create table public.filing_counters (
  prefix text not null,
  academic_year text not null,
  last_seq integer not null,
  primary key (prefix, academic_year)
);

create table public.filing_register (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null unique references public.proposals(id) on delete restrict,
  filing_number text not null unique,
  prefix text not null,
  academic_year text not null,
  sequence_no integer not null check (sequence_no >= 1),
  approval_action_id uuid not null references public.approval_actions(id),
  generated_by uuid not null references public.profiles(id),
  generated_at timestamptz not null default now(),
  unique (prefix, academic_year, sequence_no)
);

-- ---------- post-event reports ----------
create table public.activity_reports (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null unique references public.proposals(id) on delete restrict,
  faculty_id uuid not null references public.profiles(id),
  department_id uuid not null references public.departments(id),
  status public.report_status not null default 'draft',
  actual_date date,
  actual_start_time time,
  actual_end_time time,
  actual_participants integer check (actual_participants is null or actual_participants >= 0),
  actual_expenditure numeric(12,2) check (actual_expenditure is null or actual_expenditure >= 0),
  resource_person_details text,
  sessions_conducted text,
  proceedings text,
  outcomes text,
  feedback_summary text,
  deviations text,
  submitted_at timestamptz,
  reviewer_id uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_remarks text,
  revision_no integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (actual_start_time is null or actual_end_time is null or actual_end_time > actual_start_time)
);
create index activity_reports_dept_idx on public.activity_reports (department_id, status);

create table public.activity_report_expenses (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.activity_reports(id) on delete cascade,
  head text not null check (length(trim(head)) > 0),
  amount numeric(12,2) not null check (amount >= 0),
  notes text
);
create index report_expenses_idx on public.activity_report_expenses (report_id);

create table public.activity_report_attachments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.activity_reports(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (length(file_name) between 1 and 200),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  kind public.attachment_kind not null default 'other',
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index report_attachments_idx on public.activity_report_attachments (report_id);

create table public.report_actions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.activity_reports(id) on delete restrict,
  action text not null check (action in ('submitted','resubmitted','verified','returned','auto_verified')),
  from_status public.report_status,
  to_status public.report_status not null,
  actor_id uuid not null references public.profiles(id),
  actor_name text not null,
  remarks text,
  created_at timestamptz not null default now()
);

-- ---------- notifications & audit ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  proposal_id uuid references public.proposals(id) on delete cascade,
  report_id uuid references public.activity_reports(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_id, is_read, created_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_email text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_created_idx on public.audit_logs (created_at desc);
