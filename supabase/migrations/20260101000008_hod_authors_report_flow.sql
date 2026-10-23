-- Migration 8: (a) HODs may author proposals (routed straight to the Principal)
--              (b) post-event report review sequence is configurable: none | iqac | hod_then_iqac

alter table public.proposals add column author_role public.app_role not null default 'faculty';
alter table public.activity_reports
  add column hod_reviewer_id uuid references public.profiles(id),
  add column hod_reviewed_at timestamptz,
  add column hod_remarks text,
  add column returned_by public.app_role;
alter table public.report_actions drop constraint report_actions_action_check;
alter table public.report_actions add constraint report_actions_action_check
  check (action in ('submitted','resubmitted','hod_verified','hod_returned','verified','returned','auto_verified'));

delete from public.system_settings where key = 'report_review_required';
insert into public.system_settings (key, value) values ('report_review_mode', '"hod_then_iqac"')
  on conflict (key) do nothing;

create or replace function app.require_any(p_roles public.app_role[]) returns public.profiles
language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles;
begin
  me := app.my_profile();
  if me.id is null then raise exception 'NO_ROLE: your account has no active role assignment' using errcode = '42501'; end if;
  if me.role <> all (p_roles) then raise exception 'FORBIDDEN: requires one of %', p_roles using errcode = '42501'; end if;
  return me;
end $$;

create or replace function app.proposal_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me public.profiles;
begin
  me := app.my_profile();
  if me.id is null then raise exception 'NO_ROLE: your account has no active role assignment' using errcode = '42501'; end if;
  new.faculty_id := me.id;  new.faculty_name := me.full_name;  new.faculty_email := me.email;
  new.employee_id := me.employee_id;  new.designation := me.designation;
  new.department_id := me.department_id;  new.author_role := me.role;
  new.status := 'draft';
  return new;
end $$;

create or replace function app.proposal_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.filing_number is not null and new.filing_number is distinct from old.filing_number then
    raise exception 'IMMUTABLE: filing number cannot be changed' using errcode = '42501';
  end if;
  if old.status = 'filed' and new.status <> 'filed' then raise exception 'INVALID_STATE: filed proposals are final'; end if;
  if new.status is distinct from old.status then
    if (old.status::text || '>' || new.status::text) <> all (array[
       'draft>hod_review','hod_review>forwarded','hod_review>hod_returned','hod_returned>hod_review',
       'forwarded>principal_review','forwarded>principal_returned','forwarded>disapproved','forwarded>approved',
       'principal_review>principal_returned','principal_review>disapproved','principal_review>approved',
       'principal_returned>hod_review','approved>filed','draft>forwarded','principal_returned>forwarded']) then
      raise exception 'INVALID_TRANSITION: % -> % is not allowed', old.status, new.status;
    end if;
    if new.status = 'hod_review' and old.author_role = 'hod' then
      raise exception 'INVALID_TRANSITION: HOD-authored proposals skip HOD review';
    end if;
    if new.status = 'forwarded' and old.status in ('draft','principal_returned') and old.author_role <> 'hod' then
      raise exception 'INVALID_TRANSITION: only HOD-authored proposals may skip HOD review';
    end if;
  end if;
  if new.status = 'filed' and new.filing_number is null then raise exception 'INVALID_STATE: a filed proposal needs a filing number'; end if;
  return new;
end $$;

create or replace function app.report_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status
     and (old.status::text || '>' || new.status::text) <> all (array[
       'draft>submitted','draft>hod_verified','draft>verified','submitted>hod_verified','submitted>verified',
       'submitted>returned','hod_verified>verified','hod_verified>returned','returned>submitted',
       'returned>hod_verified','returned>verified']) then
    raise exception 'INVALID_TRANSITION: report % -> % is not allowed', old.status, new.status;
  end if;
  return new;
end $$;

drop policy proposals_insert on public.proposals;
drop policy proposals_update on public.proposals;
create policy proposals_insert on public.proposals for insert to authenticated
  with check (app.my_role() in ('faculty','hod') and faculty_id = auth.uid() and status = 'draft');
create policy proposals_update on public.proposals for update to authenticated
  using (faculty_id = auth.uid() and app.my_role() in ('faculty','hod') and status in ('draft','hod_returned','principal_returned'))
  with check (faculty_id = auth.uid() and status in ('draft','hod_returned','principal_returned'));

create or replace function public.submit_proposal(p_id uuid) returns public.proposals
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.proposals; missing text[]; was_returned boolean;
        prev public.proposal_status; target public.proposal_status;
begin
  me := app.require_any(array['faculty','hod']::public.app_role[]);
  r := app.lock_proposal(p_id);
  if r.faculty_id <> me.id then raise exception 'FORBIDDEN: not your proposal' using errcode = '42501'; end if;
  target := case when me.role = 'hod' then 'forwarded' else 'hod_review' end;
  if r.status = target then return r; end if;                       -- retry-safe
  if r.status not in ('draft','hod_returned','principal_returned') then
    raise exception 'INVALID_STATE: a % proposal cannot be submitted', r.status;
  end if;
  missing := array_remove(array[
    case when coalesce(trim(r.title),'') = '' then 'title' end,
    case when r.category is null then 'category' end,
    case when r.activity_type is null then 'activity_type' end,
    case when r.proposed_date is null then 'proposed_date' end,
    case when r.start_time is null then 'start_time' end,
    case when r.end_time is null then 'end_time' end,
    case when coalesce(trim(r.venue),'') = '' then 'venue' end,
    case when coalesce(trim(r.objectives),'') = '' then 'objectives' end,
    case when coalesce(trim(r.description),'') = '' then 'description' end,
    case when coalesce(trim(r.expected_outcomes),'') = '' then 'expected_outcomes' end,
    case when not r.declaration then 'declaration' end], null);
  if coalesce(array_length(missing,1),0) > 0 then
    raise exception 'VALIDATION: missing required fields: %', array_to_string(missing, ', ');
  end if;
  prev := r.status; was_returned := prev <> 'draft';
  update public.proposals set status = target,
    submitted_at = coalesce(submitted_at, now()),
    resubmitted_at = case when was_returned then now() else resubmitted_at end,
    forwarded_at = case when target = 'forwarded' then now() else forwarded_at end,
    revision_no = revision_no + case when was_returned then 1 else 0 end
  where id = p_id returning * into r;
  perform app.log_action(p_id, case when was_returned then 'resubmitted' else 'submitted' end::public.approval_action_type,
                         prev, target, me,
                         case when me.role = 'hod' then 'Authored by HOD: routed directly to the Principal' end);
  perform app.notify(me.id, p_id, null, 'proposal_submitted', 'Proposal submitted',
    case when me.role = 'hod' then 'Your proposal "' || r.title || '" was sent to the Principal.'
         else 'Your proposal "' || r.title || '" was submitted for HOD review.' end);
  if me.role = 'hod' then
    perform app.notify_role('principal', p_id, null, 'review_pending', 'Proposal awaiting Principal review', '"' || r.title || '" (HOD: ' || r.faculty_name || ')');
  else
    perform app.notify_hods(r.department_id, p_id, null, 'review_pending', 'Proposal awaiting HOD review', '"' || r.title || '" by ' || r.faculty_name);
  end if;
  return r;
end $$;

create or replace function public.submit_report(p_id uuid) returns public.activity_reports
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.activity_reports; missing text[]; req text[]; k text;
        was_returned boolean; mode text; pr public.proposals; new_st public.report_status; prev public.report_status;
begin
  me := app.require_any(array['faculty','hod']::public.app_role[]);
  select * into r from public.activity_reports where id = p_id for update;
  if r.id is null or r.faculty_id <> me.id then raise exception 'FORBIDDEN: not your report' using errcode = '42501'; end if;
  if r.status in ('submitted','hod_verified','verified') then return r; end if;       -- retry-safe
  missing := array_remove(array[
    case when r.actual_date is null then 'actual_date' end,
    case when r.actual_participants is null then 'actual_participants' end,
    case when r.actual_expenditure is null then 'actual_expenditure' end,
    case when coalesce(trim(r.proceedings),'') = '' then 'proceedings' end,
    case when coalesce(trim(r.outcomes),'') = '' then 'outcomes' end], null);
  select array(select jsonb_array_elements_text(value) from public.system_settings where key = 'report_required_kinds') into req;
  foreach k in array coalesce(req, '{}') loop
    if not exists (select 1 from public.activity_report_attachments where report_id = p_id and kind::text = k) then
      missing := missing || ('attachment:' || k);
    end if;
  end loop;
  if coalesce(array_length(missing,1),0) > 0 then raise exception 'VALIDATION: missing required items: %', array_to_string(missing, ', '); end if;
  mode := app.setting_text('report_review_mode');
  was_returned := r.status = 'returned'; prev := r.status;
  new_st := case when mode = 'none' then 'verified'
                 when mode = 'hod_then_iqac' and me.role = 'hod' then 'hod_verified'   -- an HOD cannot review their own report
                 else 'submitted' end;
  update public.activity_reports set status = new_st, submitted_at = now(),
    revision_no = revision_no + case when was_returned then 1 else 0 end,
    reviewed_at = case when new_st = 'verified' then now() end, reviewer_id = null, review_remarks = null, returned_by = null,
    hod_reviewer_id = null, hod_reviewed_at = null, hod_remarks = null
  where id = p_id returning * into r;
  insert into public.report_actions (report_id, action, from_status, to_status, actor_id, actor_name)
  values (p_id, case when new_st = 'verified' then 'auto_verified' when was_returned then 'resubmitted' else 'submitted' end,
          prev, new_st, me.id, me.full_name);
  perform app.audit('report_submitted', 'activity_report', p_id, jsonb_build_object('mode', mode, 'status', new_st));
  select * into pr from public.proposals where id = r.proposal_id;
  perform app.notify(me.id, r.proposal_id, p_id, 'report_submitted', 'Report submitted', 'Your activity report for "' || pr.title || '" was submitted.');
  if new_st = 'submitted' and mode = 'hod_then_iqac' then
    perform app.notify_hods(r.department_id, r.proposal_id, p_id, 'report_pending', 'Activity report awaiting HOD review', pr.filing_number || ' — "' || pr.title || '"');
  elsif new_st in ('submitted','hod_verified') then
    perform app.notify_role('iqac', r.proposal_id, p_id, 'report_pending', 'Activity report awaiting verification', pr.filing_number || ' — "' || pr.title || '"');
  end if;
  return r;
end $$;

create or replace function public.hod_review_report(p_id uuid, p_verify boolean, p_remarks text default null) returns public.activity_reports
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.activity_reports; pr public.proposals; new_st public.report_status;
begin
  me := app.require_role('hod');
  if app.setting_text('report_review_mode') <> 'hod_then_iqac' then raise exception 'INVALID_STATE: HOD report review is not enabled'; end if;
  if not p_verify and coalesce(trim(p_remarks),'') = '' then raise exception 'VALIDATION: remarks are mandatory when returning a report'; end if;
  select * into r from public.activity_reports where id = p_id for update;
  if r.id is null then raise exception 'NOT_FOUND: report does not exist'; end if;
  if r.faculty_id = me.id then raise exception 'FORBIDDEN: you cannot review your own report' using errcode = '42501'; end if;
  if not exists (select 1 from app.my_depts() d where d = r.department_id) then
    raise exception 'FORBIDDEN: report belongs to another department' using errcode = '42501'; end if;
  new_st := case when p_verify then 'hod_verified' else 'returned' end;
  if r.status = new_st and r.hod_reviewer_id = me.id then return r; end if;
  if r.status <> 'submitted' then raise exception 'INVALID_STATE: only submitted reports can be reviewed by the HOD (current: %)', r.status; end if;
  update public.activity_reports set status = new_st, hod_reviewer_id = me.id, hod_reviewed_at = now(),
    hod_remarks = nullif(trim(p_remarks),''),
    returned_by = case when p_verify then null else 'hod'::public.app_role end,
    review_remarks = case when p_verify then null else trim(p_remarks) end
  where id = p_id returning * into r;
  insert into public.report_actions (report_id, action, from_status, to_status, actor_id, actor_name, remarks)
  values (p_id, case when p_verify then 'hod_verified' else 'hod_returned' end, 'submitted', new_st, me.id, me.full_name, p_remarks);
  perform app.audit(case when p_verify then 'report_hod_verified' else 'report_hod_returned' end, 'activity_report', p_id, jsonb_build_object('remarks', p_remarks));
  select * into pr from public.proposals where id = r.proposal_id;
  if p_verify then
    perform app.notify_role('iqac', r.proposal_id, p_id, 'report_pending', 'Activity report awaiting IQAC verification', pr.filing_number || ' — "' || pr.title || '"');
    perform app.notify(r.faculty_id, r.proposal_id, p_id, 'report_hod_verified', 'Report verified by HOD', '"' || pr.title || '" has gone to IQAC.');
  else
    perform app.notify(r.faculty_id, r.proposal_id, p_id, 'report_returned', 'Report returned by HOD', '"' || pr.title || '": ' || trim(p_remarks));
  end if;
  return r;
end $$;

create or replace function app.review_report(p_id uuid, p_verify boolean, p_remarks text) returns public.activity_reports
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.activity_reports; pr public.proposals; new_st public.report_status;
        allowed public.report_status[]; mode text; prev public.report_status;
begin
  me := app.require_role('iqac');
  if not p_verify and coalesce(trim(p_remarks),'') = '' then raise exception 'VALIDATION: remarks are mandatory when returning a report'; end if;
  mode := app.setting_text('report_review_mode');
  allowed := case when mode = 'iqac' then array['submitted','hod_verified']::public.report_status[]
                  else array['hod_verified']::public.report_status[] end;
  select * into r from public.activity_reports where id = p_id for update;
  if r.id is null then raise exception 'NOT_FOUND: report does not exist'; end if;
  new_st := case when p_verify then 'verified' else 'returned' end;
  if r.status = new_st and r.reviewer_id = me.id then return r; end if;                -- retry-safe
  if r.status <> all (allowed) then
    raise exception 'INVALID_STATE: report is not awaiting IQAC review (current: %)', r.status; end if;
  prev := r.status;
  update public.activity_reports set status = new_st, reviewer_id = me.id, reviewed_at = now(),
    review_remarks = nullif(trim(p_remarks),''), returned_by = case when p_verify then null else 'iqac'::public.app_role end
  where id = p_id returning * into r;
  insert into public.report_actions (report_id, action, from_status, to_status, actor_id, actor_name, remarks)
  values (p_id, case when p_verify then 'verified' else 'returned' end, prev, new_st, me.id, me.full_name, p_remarks);
  perform app.audit(case when p_verify then 'report_verified' else 'report_returned' end, 'activity_report', p_id, jsonb_build_object('remarks', p_remarks));
  select * into pr from public.proposals where id = r.proposal_id;
  perform app.notify(r.faculty_id, r.proposal_id, p_id, case when p_verify then 'report_verified' else 'report_returned' end,
    case when p_verify then 'Report verified' else 'Report returned for correction' end,
    '"' || pr.title || '"' || coalesce(': ' || nullif(trim(p_remarks),''), ''));
  return r;
end $$;

create or replace function public.admin_update_setting(p_key text, p_value jsonb) returns public.system_settings
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; old jsonb; s public.system_settings; yr text;
begin
  me := app.require_role('iqac');
  if p_key not in ('institution_name','filing_prefix','academic_year','filing_digits','filing_start',
                   'report_due_days','report_review_mode','report_required_kinds') then
    raise exception 'VALIDATION: unknown setting %', p_key;
  end if;
  case p_key
    when 'filing_prefix' then
      if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^[A-Za-z0-9/_-]{1,40}$' then raise exception 'VALIDATION: invalid filing prefix'; end if;
    when 'academic_year' then
      yr := p_value #>> '{}';
      if jsonb_typeof(p_value) <> 'string' or yr !~ '^[0-9]{4}-[0-9]{2}$'
         or substr(yr,6,2)::int <> (substr(yr,1,4)::int + 1) % 100 then raise exception 'VALIDATION: academic year must look like 2026-27'; end if;
    when 'filing_digits' then
      if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric not between 1 and 8 or (p_value #>> '{}')::numeric <> floor((p_value #>> '{}')::numeric) then raise exception 'VALIDATION: digits must be an integer 1-8'; end if;
    when 'filing_start' then
      if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric < 1 or (p_value #>> '{}')::numeric <> floor((p_value #>> '{}')::numeric) then raise exception 'VALIDATION: start must be an integer >= 1'; end if;
    when 'report_due_days' then
      if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric not between 1 and 365 then raise exception 'VALIDATION: due days must be 1-365'; end if;
    when 'report_review_mode' then
      if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') not in ('none','iqac','hod_then_iqac') then raise exception 'VALIDATION: mode must be none, iqac or hod_then_iqac'; end if;
    when 'report_required_kinds' then
      if jsonb_typeof(p_value) <> 'array' then raise exception 'VALIDATION: must be an array'; end if;
      for yr in select jsonb_array_elements_text(p_value) loop
        if yr not in ('proposal_document','brochure','attendance_sheet','photograph','feedback_summary','final_report','certificate','bill_receipt','other') then
          raise exception 'VALIDATION: unknown attachment kind %', yr; end if;
      end loop;
    else null;
  end case;
  select value into old from public.system_settings where key = p_key;
  update public.system_settings set value = p_value, updated_by = me.id, updated_at = now() where key = p_key returning * into s;
  perform app.audit('setting_changed', 'system_settings', null, jsonb_build_object('key', p_key, 'old', old, 'new', p_value));
  return s;
end $$;

drop view public.v_report_compliance;
create view public.v_report_compliance with (security_invoker = true) as
select p.id as proposal_id, p.department_id, p.title, p.proposed_date, p.filing_number,
       r.id as report_id, r.status as report_status,
       (p.proposed_date + (select (value #>> '{}')::int from public.system_settings where key = 'report_due_days')) as report_due_date,
       (coalesce(r.status::text,'none') not in ('submitted','hod_verified','verified')
        and current_date > p.proposed_date + (select (value #>> '{}')::int from public.system_settings where key = 'report_due_days')) as is_overdue
from public.proposals p
left join public.activity_reports r on r.proposal_id = p.id
where p.status = 'filed';
grant select on public.v_report_compliance to authenticated;


create or replace function public.principal_approve(p_id uuid, p_remarks text default null) returns public.proposals
language plpgsql security definer set search_path = '' as $$
declare g record; me public.profiles; r public.proposals; from_st public.proposal_status;
        v_prefix text; v_year text; v_digits int; v_start int; v_seq int; v_no text;
        a_approved uuid; a_filing uuid;
begin
  select * into g from app.principal_gate(p_id); me := g.me; r := g.r;
  if r.status = 'filed' then return r; end if;                      -- retry after network error: no 2nd number
  if r.status not in ('forwarded','principal_review') then
    raise exception 'INVALID_STATE: proposal has not been forwarded by the HOD (current: %)', r.status;
  end if;
  if r.hod_reviewer_id is null and r.author_role <> 'hod' then raise exception 'INVALID_STATE: HOD review is missing'; end if;
  from_st := r.status;

  v_prefix := app.setting_text('filing_prefix');
  v_year   := app.setting_text('academic_year');
  v_digits := app.setting_text('filing_digits')::int;
  v_start  := app.setting_text('filing_start')::int;

  -- Atomic allocation: concurrent approvals serialise on this row lock.
  insert into public.filing_counters as c (prefix, academic_year, last_seq)
  values (v_prefix, v_year, v_start)
  on conflict (prefix, academic_year) do update set last_seq = c.last_seq + 1
  returning last_seq into v_seq;
  v_no := v_prefix || '/' || v_year || '/' || lpad(v_seq::text, v_digits, '0');

  update public.proposals set status = 'approved', principal_reviewer_id = me.id,
    principal_reviewed_at = now(), approved_at = now(), principal_remarks = nullif(trim(p_remarks),'')
  where id = p_id;
  a_approved := app.log_action(p_id, 'principal_approved', from_st, 'approved', me, p_remarks);

  insert into public.filing_register (proposal_id, filing_number, prefix, academic_year, sequence_no, approval_action_id, generated_by)
  values (p_id, v_no, v_prefix, v_year, v_seq, a_approved, me.id);

  update public.proposals set status = 'filed', filing_number = v_no where id = p_id returning * into r;
  a_filing := app.log_action(p_id, 'filing_allocated', 'approved', 'filed', me, v_no);
  perform app.audit('filing_number_generated', 'proposal', p_id, jsonb_build_object('filing_number', v_no, 'sequence', v_seq));

  perform app.notify(r.faculty_id, p_id, null, 'proposal_approved', 'Proposal approved', '"' || r.title || '" approved. IQAC Filing No: ' || v_no);
  perform app.notify_hods(r.department_id, p_id, null, 'proposal_approved', 'Proposal approved', '"' || r.title || '" — ' || v_no);
  perform app.notify_role('iqac', p_id, null, 'filing_generated', 'Filing number generated', v_no || ' — "' || r.title || '"');
  return r;
end $$;

create or replace function public.register_proposal_attachment(p_proposal_id uuid, p_path text, p_file_name text,
  p_kind public.attachment_kind default 'proposal_document') returns public.proposal_attachments
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.proposals; u record; a public.proposal_attachments;
begin
  me := app.require_any(array['faculty','hod']::public.app_role[]);
  r := app.lock_proposal(p_proposal_id);
  if r.faculty_id <> me.id then raise exception 'FORBIDDEN: not your proposal' using errcode = '42501'; end if;
  if r.status not in ('draft','hod_returned','principal_returned') then raise exception 'INVALID_STATE: documents can only be changed on drafts or returned proposals'; end if;
  if p_path !~* ('^' || p_proposal_id::text || '/[0-9a-f-]{36}\.(pdf|docx?|xlsx?|jpe?g|png)$') then raise exception 'VALIDATION: invalid storage path'; end if;
  if (select count(*) from public.proposal_attachments where proposal_id = p_proposal_id) >= 10 then raise exception 'VALIDATION: maximum 10 files per proposal'; end if;
  select * into u from app.check_upload('proposal-docs', p_path);
  insert into public.proposal_attachments (proposal_id, storage_path, file_name, mime_type, size_bytes, kind, uploaded_by)
  values (p_proposal_id, p_path, left(trim(p_file_name),200), u.v_mime, u.v_size, p_kind, me.id)
  on conflict (storage_path) do update set kind = excluded.kind   -- retry-safe
  returning * into a;
  return a;
end $$;

create or replace function public.start_report(p_proposal_id uuid) returns public.activity_reports
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; p public.proposals; r public.activity_reports;
begin
  me := app.require_any(array['faculty','hod']::public.app_role[]);
  select * into p from public.proposals where id = p_proposal_id;
  if p.id is null or p.faculty_id <> me.id then raise exception 'FORBIDDEN: not your proposal' using errcode = '42501'; end if;
  if p.status <> 'filed' then raise exception 'INVALID_STATE: a report can only be started for an approved and filed proposal'; end if;
  select * into r from public.activity_reports where proposal_id = p_proposal_id;
  if r.id is not null then return r; end if;
  insert into public.activity_reports (proposal_id, faculty_id, department_id)
  values (p_proposal_id, me.id, p.department_id) returning * into r;
  perform app.audit('report_started', 'activity_report', r.id, jsonb_build_object('proposal_id', p_proposal_id));
  return r;
end $$;

create or replace function public.register_report_attachment(p_report_id uuid, p_path text, p_file_name text,
  p_kind public.attachment_kind default 'other') returns public.activity_report_attachments
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.activity_reports; u record; a public.activity_report_attachments;
begin
  me := app.require_any(array['faculty','hod']::public.app_role[]);
  select * into r from public.activity_reports where id = p_report_id for update;
  if r.id is null or r.faculty_id <> me.id then raise exception 'FORBIDDEN: not your report' using errcode = '42501'; end if;
  if r.status not in ('draft','returned') then raise exception 'INVALID_STATE: evidence can only be changed on drafts or returned reports'; end if;
  if p_path !~* ('^' || p_report_id::text || '/[0-9a-f-]{36}\.(pdf|docx?|xlsx?|jpe?g|png)$') then raise exception 'VALIDATION: invalid storage path'; end if;
  if (select count(*) from public.activity_report_attachments where report_id = p_report_id) >= 25 then raise exception 'VALIDATION: maximum 25 files per report'; end if;
  select * into u from app.check_upload('report-evidence', p_path);
  insert into public.activity_report_attachments (report_id, storage_path, file_name, mime_type, size_bytes, kind, uploaded_by)
  values (p_report_id, p_path, left(trim(p_file_name),200), u.v_mime, u.v_size, p_kind, me.id)
  on conflict (storage_path) do update set kind = excluded.kind
  returning * into a;
  return a;
end $$;

-- re-apply API privileges to (re)created functions
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f'
  loop execute format('revoke all on function %s from public, anon', f.sig);
       execute format('grant execute on function %s to authenticated', f.sig); end loop; end $$;
revoke all on function app.require_any(public.app_role[]) from public, anon, authenticated;
