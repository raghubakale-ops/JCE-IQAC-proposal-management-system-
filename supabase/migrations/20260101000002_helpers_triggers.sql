-- Migration 2: helpers (private `app` schema), auth gate, integrity triggers

grant usage on schema app to authenticated;

-- ---------- identity helpers (SECURITY DEFINER => no RLS recursion) ----------
create or replace function app.my_profile() returns public.profiles
language sql stable security definer set search_path = '' as $$
  select p.* from public.profiles p
  where p.id = auth.uid()
    and p.is_active
    and p.email = lower(coalesce(auth.jwt() ->> 'email',''))
    and p.email like '%@jainbgm.in'
$$;

create or replace function app.my_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select role from app.my_profile()
$$;

-- departments the caller may review as HOD (own + explicit grants)
create or replace function app.my_depts() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.department_id from app.my_profile() p where p.role = 'hod' and p.department_id is not null
  union
  select e.department_id
  from app.my_profile() p
  join public.staff_directory s on s.email = p.email and s.is_active
  join public.hod_extra_departments e on e.staff_id = s.id
  where p.role = 'hod'
$$;

create or replace function app.hod_ids(p_dept uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p
  where p.is_active and p.role = 'hod' and (
    p.department_id = p_dept or exists (
      select 1 from public.staff_directory s
      join public.hod_extra_departments e on e.staff_id = s.id
      where s.email = p.email and s.is_active and e.department_id = p_dept))
$$;

create or replace function app.require_role(p_role public.app_role) returns public.profiles
language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles;
begin
  me := app.my_profile();
  if me.id is null then
    raise exception 'NO_ROLE: your account has no active role assignment' using errcode = '42501';
  end if;
  if me.role <> p_role then
    raise exception 'FORBIDDEN: requires role %', p_role using errcode = '42501';
  end if;
  return me;
end $$;

create or replace function app.safe_uuid(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin return p::uuid; exception when others then return null; end $$;

create or replace function app.setting_text(p_key text) returns text
language sql stable security definer set search_path = '' as $$
  select value #>> '{}' from public.system_settings where key = p_key
$$;

-- ---------- audit + notification writers (only callable from definer code) ----------
create or replace function app.audit(p_action text, p_entity text, p_id uuid, p_details jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, details)
  values (auth.uid(), lower(auth.jwt() ->> 'email'), p_action, p_entity, p_id, coalesce(p_details,'{}'::jsonb))
$$;

create or replace function app.notify(p_recipient uuid, p_proposal uuid, p_report uuid,
                                      p_type text, p_title text, p_msg text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (recipient_id, proposal_id, report_id, type, title, message)
  values (p_recipient, p_proposal, p_report, p_type, p_title, p_msg)
$$;

create or replace function app.notify_role(p_role public.app_role, p_proposal uuid, p_report uuid,
                                           p_type text, p_title text, p_msg text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (recipient_id, proposal_id, report_id, type, title, message)
  select id, p_proposal, p_report, p_type, p_title, p_msg
  from public.profiles where role = p_role and is_active
$$;

create or replace function app.notify_hods(p_dept uuid, p_proposal uuid, p_report uuid,
                                           p_type text, p_title text, p_msg text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (recipient_id, proposal_id, report_id, type, title, message)
  select h, p_proposal, p_report, p_type, p_title, p_msg from app.hod_ids(p_dept) h
$$;

-- ---------- Auth gate: only verified @jainbgm.in accounts may exist ----------
create or replace function app.auth_user_gate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare em text := lower(coalesce(new.email,''));
begin
  if em !~ '^[^@[:space:]]+@jainbgm\.in$' then
    raise exception 'DOMAIN_NOT_ALLOWED: only @jainbgm.in accounts may sign in';
  end if;
  if new.email_confirmed_at is null
     and coalesce(new.raw_user_meta_data ->> 'email_verified','false') <> 'true' then
    raise exception 'EMAIL_NOT_VERIFIED: the Google account email is not verified';
  end if;
  return new;
end $$;

create trigger auth_users_gate_ins before insert on auth.users
  for each row execute function app.auth_user_gate();
create trigger auth_users_gate_upd before update of email on auth.users
  for each row when (new.email is distinct from old.email)
  execute function app.auth_user_gate();

-- profile materialisation from the administrative directory
create or replace function app.sync_profile(p_dir public.staff_directory) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set full_name = p_dir.full_name, role = p_dir.role,
    department_id = p_dir.department_id, designation = p_dir.designation,
    employee_id = p_dir.employee_id, is_active = p_dir.is_active
  where email = p_dir.email;
  if not found and p_dir.is_active then
    insert into public.profiles (id, email, full_name, role, department_id, designation, employee_id)
    select u.id, p_dir.email, p_dir.full_name, p_dir.role, p_dir.department_id, p_dir.designation, p_dir.employee_id
    from auth.users u where lower(u.email) = p_dir.email;
  end if;
end $$;

create or replace function app.directory_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger directory_touch before update on public.staff_directory
  for each row execute function app.directory_changed();

create or replace function app.directory_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform app.sync_profile(new); return null; end $$;
create trigger directory_sync after insert or update on public.staff_directory
  for each row execute function app.directory_after();

create or replace function app.auth_user_created() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d public.staff_directory;
begin
  select * into d from public.staff_directory where email = lower(new.email) and is_active;
  if found then perform app.sync_profile(d); end if;
  return null;
end $$;
create trigger auth_users_profile after insert on auth.users
  for each row execute function app.auth_user_created();

-- ---------- generic triggers ----------
create or replace function app.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger proposals_touch before update on public.proposals for each row execute function app.touch_updated_at();
create trigger reports_touch   before update on public.activity_reports for each row execute function app.touch_updated_at();
create trigger profiles_touch  before update on public.profiles for each row execute function app.touch_updated_at();

-- append-only / immutable tables
create or replace function app.deny_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'IMMUTABLE: % on % is not permitted', tg_op, tg_table_name using errcode = '42501'; end $$;
create trigger audit_immutable before update or delete on public.audit_logs for each row execute function app.deny_mutation();
create trigger audit_no_truncate before truncate on public.audit_logs for each statement execute function app.deny_mutation();
create trigger actions_immutable before update or delete on public.approval_actions for each row execute function app.deny_mutation();
create trigger actions_no_truncate before truncate on public.approval_actions for each statement execute function app.deny_mutation();
create trigger raction_immutable before update or delete on public.report_actions for each row execute function app.deny_mutation();
create trigger filing_immutable before update or delete on public.filing_register for each row execute function app.deny_mutation();
create trigger filing_no_truncate before truncate on public.filing_register for each statement execute function app.deny_mutation();

-- proposal insert: trusted identity snapshot; client-supplied values are overwritten
create or replace function app.proposal_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me public.profiles;
begin
  me := app.my_profile();
  if me.id is null then
    raise exception 'NO_ROLE: your account has no active role assignment' using errcode = '42501';
  end if;
  new.faculty_id := me.id;  new.faculty_name := me.full_name;  new.faculty_email := me.email;
  new.employee_id := me.employee_id;  new.designation := me.designation;
  new.department_id := me.department_id;
  new.status := 'draft';
  return new;
end $$;
create trigger proposals_ins before insert on public.proposals
  for each row execute function app.proposal_before_insert();

-- proposal state machine (defence in depth: even a buggy function cannot skip a stage)
create or replace function app.proposal_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.filing_number is not null and new.filing_number is distinct from old.filing_number then
    raise exception 'IMMUTABLE: filing number cannot be changed' using errcode = '42501';
  end if;
  if old.status = 'filed' and new.status <> 'filed' then
    raise exception 'INVALID_STATE: filed proposals are final';
  end if;
  if new.status is distinct from old.status
     and (old.status::text || '>' || new.status::text) <> all (array[
       'draft>hod_review','hod_review>forwarded','hod_review>hod_returned','hod_returned>hod_review',
       'forwarded>principal_review','forwarded>principal_returned','forwarded>disapproved','forwarded>approved',
       'principal_review>principal_returned','principal_review>disapproved','principal_review>approved',
       'principal_returned>hod_review','approved>filed']) then
    raise exception 'INVALID_TRANSITION: % -> % is not allowed', old.status, new.status;
  end if;
  if new.status = 'filed' and new.filing_number is null then
    raise exception 'INVALID_STATE: a filed proposal needs a filing number';
  end if;
  return new;
end $$;
create trigger proposals_guard before update on public.proposals
  for each row execute function app.proposal_guard();

create or replace function app.report_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status
     and (old.status::text || '>' || new.status::text) <> all (array[
       'draft>submitted','draft>verified','submitted>verified','submitted>returned',
       'returned>submitted','returned>verified']) then
    raise exception 'INVALID_TRANSITION: report % -> % is not allowed', old.status, new.status;
  end if;
  return new;
end $$;
create trigger reports_guard before update on public.activity_reports
  for each row execute function app.report_guard();

-- report insert: bind to the proposal's trusted owner/department
create or replace function app.report_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.proposals;
begin
  select * into p from public.proposals where id = new.proposal_id;
  if p.id is null or p.status <> 'filed' then
    raise exception 'INVALID_STATE: reports can only be created for filed (approved) proposals';
  end if;
  new.faculty_id := p.faculty_id; new.department_id := p.department_id; new.status := 'draft';
  return new;
end $$;
create trigger reports_ins before insert on public.activity_reports
  for each row execute function app.report_before_insert();

-- audit of direct (draft/correction) edits made by faculty under RLS
create or replace function app.proposal_audit_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cols text[];
begin
  if tg_op = 'INSERT' then
    perform app.audit('proposal_created','proposal',new.id,jsonb_build_object('title',new.title));
  elsif new.status = old.status then
    select array_agg(n.key order by n.key) into cols
    from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value and n.key <> 'updated_at';
    if cols is not null then
      perform app.audit('proposal_edited','proposal',new.id,jsonb_build_object('changed_columns',cols));
    end if;
  end if;
  return null;
end $$;
create trigger proposals_audit after insert or update on public.proposals
  for each row execute function app.proposal_audit_trigger();

create or replace function app.attachment_audit_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform app.audit('attachment_deleted', tg_argv[0], old.id, jsonb_build_object('file',old.file_name,'path',old.storage_path));
    return old;
  end if;
  perform app.audit('attachment_added', tg_argv[0], new.id, jsonb_build_object('file',new.file_name,'kind',new.kind));
  return new;
end $$;
create trigger pa_audit after insert or delete on public.proposal_attachments
  for each row execute function app.attachment_audit_trigger('proposal_attachment');
create trigger ra_audit after insert or delete on public.activity_report_attachments
  for each row execute function app.attachment_audit_trigger('report_attachment');
