-- Migration 3: transactional workflow functions (the ONLY way status/filing data changes)

create or replace function app.lock_proposal(p_id uuid) returns public.proposals
language plpgsql security definer set search_path = '' as $$
declare r public.proposals;
begin
  select * into r from public.proposals where id = p_id for update;
  if r.id is null then raise exception 'NOT_FOUND: proposal does not exist'; end if;
  return r;
end $$;

create or replace function app.log_action(p_prop uuid, p_action public.approval_action_type,
  p_from public.proposal_status, p_to public.proposal_status, p_actor public.profiles, p_remarks text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.approval_actions (proposal_id, action, from_status, to_status, actor_id, actor_name, actor_role, remarks)
  values (p_prop, p_action, p_from, p_to, p_actor.id, p_actor.full_name, p_actor.role, p_remarks)
  returning id into v_id;
  perform app.audit('proposal_' || p_action::text, 'proposal', p_prop,
    jsonb_build_object('from', p_from, 'to', p_to, 'remarks', p_remarks));
  return v_id;
end $$;

-- ---------------- faculty: submit / resubmit ----------------
create or replace function public.submit_proposal(p_id uuid) returns public.proposals
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.proposals; missing text[]; was_returned boolean;
begin
  me := app.require_role('faculty');
  r := app.lock_proposal(p_id);
  if r.faculty_id <> me.id then raise exception 'FORBIDDEN: not your proposal' using errcode = '42501'; end if;
  if r.status = 'hod_review' then return r; end if;               -- retry-safe
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
  was_returned := r.status <> 'draft';
  update public.proposals set status = 'hod_review',
    submitted_at = coalesce(submitted_at, now()),
    resubmitted_at = case when was_returned then now() else resubmitted_at end,
    revision_no = revision_no + case when was_returned then 1 else 0 end
  where id = p_id returning * into r;
  perform app.log_action(p_id, case when was_returned then 'resubmitted' else 'submitted' end::public.approval_action_type,
                         case when was_returned then 'hod_returned' else 'draft' end::public.proposal_status, 'hod_review', me, null);
  perform app.notify(me.id, p_id, null, 'proposal_submitted', 'Proposal submitted', 'Your proposal "' || r.title || '" was submitted for HOD review.');
  perform app.notify_hods(r.department_id, p_id, null, 'review_pending', 'Proposal awaiting HOD review', '"' || r.title || '" by ' || r.faculty_name);
  return r;
end $$;

-- ---------------- HOD ----------------
create or replace function app.hod_gate(p_id uuid, out me public.profiles, out r public.proposals)
language plpgsql security definer set search_path = '' as $$
begin
  me := app.require_role('hod');
  r := app.lock_proposal(p_id);
  if r.faculty_id = me.id then raise exception 'FORBIDDEN: you cannot review your own proposal' using errcode = '42501'; end if;
  if not exists (select 1 from app.my_depts() d where d = r.department_id) then
    raise exception 'FORBIDDEN: proposal belongs to another department' using errcode = '42501';
  end if;
end $$;

create or replace function public.hod_forward(p_id uuid, p_remarks text default null) returns public.proposals
language plpgsql security definer set search_path = '' as $$
declare g record; me public.profiles; r public.proposals;
begin
  select * into g from app.hod_gate(p_id); me := g.me; r := g.r;
  if r.status = 'forwarded' and r.hod_reviewer_id = me.id then return r; end if;   -- retry-safe
  if r.status <> 'hod_review' then raise exception 'INVALID_STATE: only proposals under HOD review can be forwarded (current: %)', r.status; end if;
  update public.proposals set status = 'forwarded', forwarded_at = now(), hod_reviewer_id = me.id,
    hod_reviewed_at = now(), hod_remarks = nullif(trim(p_remarks),'') where id = p_id returning * into r;
  perform app.log_action(p_id, 'hod_forwarded', 'hod_review', 'forwarded', me, p_remarks);
  perform app.notify(r.faculty_id, p_id, null, 'hod_forwarded', 'Forwarded to Principal', '"' || r.title || '" was forwarded to the Principal by the HOD.');
  perform app.notify_role('principal', p_id, null, 'review_pending', 'Proposal awaiting Principal review', '"' || r.title || '" (' || r.faculty_name || ')');
  return r;
end $$;

create or replace function public.hod_return(p_id uuid, p_remarks text) returns public.proposals
language plpgsql security definer set search_path = '' as $$
declare g record; me public.profiles; r public.proposals;
begin
  if coalesce(trim(p_remarks),'') = '' then raise exception 'VALIDATION: remarks are mandatory when returning a proposal'; end if;
  select * into g from app.hod_gate(p_id); me := g.me; r := g.r;
  if r.status = 'hod_returned' and r.hod_reviewer_id = me.id then return r; end if;
  if r.status <> 'hod_review' then raise exception 'INVALID_STATE: only proposals under HOD review can be returned (current: %)', r.status; end if;
  update public.proposals set status = 'hod_returned', hod_reviewer_id = me.id, hod_reviewed_at = now(),
    hod_remarks = trim(p_remarks) where id = p_id returning * into r;
  perform app.log_action(p_id, 'hod_returned', 'hod_review', 'hod_returned', me, p_remarks);
  perform app.notify(r.faculty_id, p_id, null, 'hod_returned', 'Returned by HOD', '"' || r.title || '": ' || trim(p_remarks));
  return r;
end $$;

-- ---------------- Principal ----------------
create or replace function app.principal_gate(p_id uuid, out me public.profiles, out r public.proposals)
language plpgsql security definer set search_path = '' as $$
begin
  me := app.require_role('principal');
  r := app.lock_proposal(p_id);
  if r.faculty_id = me.id then raise exception 'FORBIDDEN: you cannot decide your own proposal' using errcode = '42501'; end if;
end $$;

create or replace function public.principal_start_review(p_id uuid) returns public.proposals
language plpgsql security definer set search_path = '' as $$
declare g record; me public.profiles; r public.proposals;
begin
  select * into g from app.principal_gate(p_id); me := g.me; r := g.r;
  if r.status = 'principal_review' then return r; end if;
  if r.status <> 'forwarded' then raise exception 'INVALID_STATE: proposal has not been forwarded by the HOD (current: %)', r.status; end if;
  update public.proposals set status = 'principal_review', principal_reviewer_id = me.id where id = p_id returning * into r;
  perform app.log_action(p_id, 'principal_review_started', 'forwarded', 'principal_review', me, null);
  return r;
end $$;

create or replace function public.principal_return(p_id uuid, p_remarks text) returns public.proposals
language plpgsql security definer set search_path = '' as $$
declare g record; me public.profiles; r public.proposals; from_st public.proposal_status;
begin
  if coalesce(trim(p_remarks),'') = '' then raise exception 'VALIDATION: remarks are mandatory when returning a proposal'; end if;
  select * into g from app.principal_gate(p_id); me := g.me; r := g.r; from_st := r.status;
  if r.status = 'principal_returned' then return r; end if;
  if r.status not in ('forwarded','principal_review') then raise exception 'INVALID_STATE: proposal is not awaiting Principal review (current: %)', r.status; end if;
  update public.proposals set status = 'principal_returned', principal_reviewer_id = me.id,
    principal_reviewed_at = now(), principal_remarks = trim(p_remarks) where id = p_id returning * into r;
  perform app.log_action(p_id, 'principal_returned', from_st, 'principal_returned', me, p_remarks);
  perform app.notify(r.faculty_id, p_id, null, 'principal_returned', 'Returned by Principal', '"' || r.title || '": ' || trim(p_remarks));
  perform app.notify_hods(r.department_id, p_id, null, 'principal_returned', 'Principal returned a proposal', '"' || r.title || '"');
  return r;
end $$;

create or replace function public.principal_disapprove(p_id uuid, p_remarks text) returns public.proposals
language plpgsql security definer set search_path = '' as $$
declare g record; me public.profiles; r public.proposals; from_st public.proposal_status;
begin
  if coalesce(trim(p_remarks),'') = '' then raise exception 'VALIDATION: remarks are mandatory when disapproving a proposal'; end if;
  select * into g from app.principal_gate(p_id); me := g.me; r := g.r; from_st := r.status;
  if r.status = 'disapproved' then return r; end if;
  if r.status not in ('forwarded','principal_review') then raise exception 'INVALID_STATE: proposal is not awaiting Principal review (current: %)', r.status; end if;
  update public.proposals set status = 'disapproved', principal_reviewer_id = me.id,
    principal_reviewed_at = now(), principal_remarks = trim(p_remarks) where id = p_id returning * into r;
  perform app.log_action(p_id, 'principal_disapproved', from_st, 'disapproved', me, p_remarks);
  perform app.notify(r.faculty_id, p_id, null, 'principal_disapproved', 'Proposal disapproved', '"' || r.title || '": ' || trim(p_remarks));
  perform app.notify_hods(r.department_id, p_id, null, 'principal_disapproved', 'Principal disapproved a proposal', '"' || r.title || '"');
  return r;
end $$;

-- Approval + filing-number allocation: one transaction, row-locked, idempotent.
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
  if r.hod_reviewer_id is null then raise exception 'INVALID_STATE: HOD review is missing'; end if;
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

-- ---------------- attachments (server-verified) ----------------
create or replace function app.check_upload(p_bucket text, p_path text, out v_size bigint, out v_mime text)
language plpgsql security definer set search_path = '' as $$
begin
  select (metadata ->> 'size')::bigint, metadata ->> 'mimetype' into v_size, v_mime
  from storage.objects where bucket_id = p_bucket and name = p_path;
  if v_size is null then raise exception 'UPLOAD_MISSING: the file was not found in storage; upload it first'; end if;
  if v_size <= 0 or v_size > 10485760 then raise exception 'VALIDATION: file exceeds the 10 MB limit'; end if;
  if v_mime is null or v_mime <> all (array['application/pdf','application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png']) then
    raise exception 'VALIDATION: file type % is not allowed', coalesce(v_mime,'unknown');
  end if;
end $$;

create or replace function public.register_proposal_attachment(p_proposal_id uuid, p_path text, p_file_name text,
  p_kind public.attachment_kind default 'proposal_document') returns public.proposal_attachments
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.proposals; u record; a public.proposal_attachments;
begin
  me := app.require_role('faculty');
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

-- ---------------- post-event reports ----------------
create or replace function public.start_report(p_proposal_id uuid) returns public.activity_reports
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; p public.proposals; r public.activity_reports;
begin
  me := app.require_role('faculty');
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
  me := app.require_role('faculty');
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

create or replace function public.submit_report(p_id uuid) returns public.activity_reports
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.activity_reports; missing text[]; req text[]; k text;
        was_returned boolean; auto boolean; pr public.proposals; new_st public.report_status;
begin
  me := app.require_role('faculty');
  select * into r from public.activity_reports where id = p_id for update;
  if r.id is null or r.faculty_id <> me.id then raise exception 'FORBIDDEN: not your report' using errcode = '42501'; end if;
  if r.status in ('submitted','verified') then return r; end if;       -- retry-safe
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
  was_returned := r.status = 'returned';
  auto := app.setting_text('report_review_required') = 'false';
  new_st := case when auto then 'verified' else 'submitted' end;
  update public.activity_reports set status = new_st, submitted_at = now(),
    revision_no = revision_no + case when was_returned then 1 else 0 end,
    reviewed_at = case when auto then now() end, reviewer_id = null, review_remarks = null
  where id = p_id returning * into r;
  insert into public.report_actions (report_id, action, from_status, to_status, actor_id, actor_name)
  values (p_id, case when auto then 'auto_verified' when was_returned then 'resubmitted' else 'submitted' end,
          case when was_returned then 'returned' else 'draft' end::public.report_status, new_st, me.id, me.full_name);
  perform app.audit('report_submitted', 'activity_report', p_id, jsonb_build_object('auto_verified', auto));
  select * into pr from public.proposals where id = r.proposal_id;
  perform app.notify(me.id, r.proposal_id, p_id, 'report_submitted', 'Report submitted', 'Your activity report for "' || pr.title || '" was submitted.');
  if not auto then
    perform app.notify_role('iqac', r.proposal_id, p_id, 'report_pending', 'Activity report awaiting verification', pr.filing_number || ' — "' || pr.title || '"');
  end if;
  return r;
end $$;

create or replace function app.review_report(p_id uuid, p_verify boolean, p_remarks text) returns public.activity_reports
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; r public.activity_reports; pr public.proposals; new_st public.report_status;
begin
  me := app.require_role('iqac');
  if not p_verify and coalesce(trim(p_remarks),'') = '' then raise exception 'VALIDATION: remarks are mandatory when returning a report'; end if;
  select * into r from public.activity_reports where id = p_id for update;
  if r.id is null then raise exception 'NOT_FOUND: report does not exist'; end if;
  new_st := case when p_verify then 'verified' else 'returned' end;
  if r.status = new_st then return r; end if;                           -- retry-safe
  if r.status <> 'submitted' then raise exception 'INVALID_STATE: only submitted reports can be reviewed (current: %)', r.status; end if;
  update public.activity_reports set status = new_st, reviewer_id = me.id, reviewed_at = now(),
    review_remarks = nullif(trim(p_remarks),'') where id = p_id returning * into r;
  insert into public.report_actions (report_id, action, from_status, to_status, actor_id, actor_name, remarks)
  values (p_id, case when p_verify then 'verified' else 'returned' end, 'submitted', new_st, me.id, me.full_name, p_remarks);
  perform app.audit(case when p_verify then 'report_verified' else 'report_returned' end, 'activity_report', p_id, jsonb_build_object('remarks', p_remarks));
  select * into pr from public.proposals where id = r.proposal_id;
  perform app.notify(r.faculty_id, r.proposal_id, p_id, case when p_verify then 'report_verified' else 'report_returned' end,
    case when p_verify then 'Report verified' else 'Report returned for correction' end,
    '"' || pr.title || '"' || coalesce(': ' || nullif(trim(p_remarks),''), ''));
  return r;
end $$;

create or replace function public.iqac_verify_report(p_id uuid, p_remarks text default null) returns public.activity_reports
language sql security definer set search_path = '' as $$ select app.review_report(p_id, true, p_remarks) $$;
create or replace function public.iqac_return_report(p_id uuid, p_remarks text) returns public.activity_reports
language sql security definer set search_path = '' as $$ select app.review_report(p_id, false, p_remarks) $$;

-- own profile: only the mobile number is user-editable
create or replace function public.update_my_mobile(p_mobile text) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles;
begin
  me := app.my_profile();
  if me.id is null then raise exception 'NO_ROLE: your account has no active role assignment' using errcode = '42501'; end if;
  update public.profiles set mobile = nullif(trim(p_mobile),'') where id = me.id;
end $$;

-- mark-read helper
create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'NO_AUTH' using errcode = '42501'; end if;
  update public.notifications set is_read = true
  where recipient_id = auth.uid() and not is_read and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count; return n;
end $$;

-- compliance view (RLS applies to the caller)
create or replace view public.v_report_compliance with (security_invoker = true) as
select p.id as proposal_id, p.department_id, p.title, p.proposed_date, p.filing_number,
       r.id as report_id, r.status as report_status,
       (p.proposed_date + (select (value #>> '{}')::int from public.system_settings where key = 'report_due_days')) as report_due_date,
       (coalesce(r.status::text,'none') not in ('submitted','verified')
        and current_date > p.proposed_date + (select (value #>> '{}')::int from public.system_settings where key = 'report_due_days')) as is_overdue
from public.proposals p
left join public.activity_reports r on r.proposal_id = p.id
where p.status = 'filed';
