-- Migration 5: grants + Row Level Security. Default-deny, then minimal grants.

-- Supabase grants broad default privileges; strip them first.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon;
revoke all on all functions in schema app from public, anon;
revoke all on all functions in schema app from authenticated;
-- only what RLS policy evaluation needs; writers (audit/notify/log) stay definer-internal
grant execute on function app.my_profile(), app.my_role(), app.my_depts(), app.safe_uuid(text) to authenticated;

do $$ declare t text; begin
  foreach t in array array['departments','staff_directory','profiles','hod_extra_departments','system_settings',
    'proposals','proposal_attachments','approval_actions','filing_counters','filing_register','activity_reports',
    'activity_report_expenses','activity_report_attachments','report_actions','notifications','audit_logs']
  loop execute format('alter table public.%I enable row level security', t); end loop; end $$;

-- public RPC surface: authenticated only
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f'
  loop execute format('revoke all on function %s from public, anon', f.sig);
       execute format('grant execute on function %s to authenticated', f.sig); end loop; end $$;

-- ---- reference / config (read-only for any active user)
grant select on public.departments, public.system_settings to authenticated;
create policy departments_read on public.departments for select to authenticated using (app.my_role() is not null);
create policy settings_read on public.system_settings for select to authenticated using (app.my_role() is not null);

-- ---- identity (IQAC administers through functions only)
grant select on public.staff_directory, public.hod_extra_departments, public.profiles to authenticated;
create policy directory_iqac on public.staff_directory for select to authenticated using (app.my_role() = 'iqac');
create policy hodx_iqac on public.hod_extra_departments for select to authenticated using (app.my_role() = 'iqac');
create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or app.my_role() = 'iqac');

-- ---- proposals
grant select, delete on public.proposals to authenticated;
grant insert (title, category, activity_type, proposed_date, start_time, end_time, venue, target_participants,
  expected_participants, objectives, description, expected_outcomes, academic_relevance, iqac_relevance,
  compliance_mapping, total_budget, funding_source, budget_details, resource_name, resource_org, resource_expertise,
  resource_honorarium, resource_travel, resource_accommodation, resource_finance, mobile, declaration)
  on public.proposals to authenticated;
grant update (title, category, activity_type, proposed_date, start_time, end_time, venue, target_participants,
  expected_participants, objectives, description, expected_outcomes, academic_relevance, iqac_relevance,
  compliance_mapping, total_budget, funding_source, budget_details, resource_name, resource_org, resource_expertise,
  resource_honorarium, resource_travel, resource_accommodation, resource_finance, mobile, declaration)
  on public.proposals to authenticated;

create policy proposals_select on public.proposals for select to authenticated using (
  faculty_id = auth.uid()
  or (app.my_role() = 'iqac' and status <> 'draft')
  or (app.my_role() = 'principal' and status in ('forwarded','principal_review','principal_returned','disapproved','approved','filed'))
  or (app.my_role() = 'hod' and status <> 'draft' and department_id in (select app.my_depts())));
create policy proposals_insert on public.proposals for insert to authenticated
  with check (app.my_role() = 'faculty' and faculty_id = auth.uid() and status = 'draft');
create policy proposals_update on public.proposals for update to authenticated
  using (faculty_id = auth.uid() and app.my_role() = 'faculty' and status in ('draft','hod_returned','principal_returned'))
  with check (faculty_id = auth.uid() and status in ('draft','hod_returned','principal_returned'));
create policy proposals_delete on public.proposals for delete to authenticated
  using (faculty_id = auth.uid() and status = 'draft');

-- ---- attachments / history / filing: visibility inherits proposal visibility
grant select on public.proposal_attachments, public.approval_actions, public.filing_register to authenticated;
grant delete on public.proposal_attachments to authenticated;
create policy pa_select on public.proposal_attachments for select to authenticated
  using (exists (select 1 from public.proposals p where p.id = proposal_id));
create policy pa_delete on public.proposal_attachments for delete to authenticated
  using (exists (select 1 from public.proposals p where p.id = proposal_id and p.faculty_id = auth.uid()
                 and p.status in ('draft','hod_returned','principal_returned')));
create policy actions_select on public.approval_actions for select to authenticated
  using (exists (select 1 from public.proposals p where p.id = proposal_id));
create policy filing_select on public.filing_register for select to authenticated
  using (exists (select 1 from public.proposals p where p.id = proposal_id));
-- filing_counters: RLS on, no policy, no grant => inaccessible to API roles

-- ---- activity reports
grant select on public.activity_reports, public.report_actions to authenticated;
grant update (actual_date, actual_start_time, actual_end_time, actual_participants, actual_expenditure,
  resource_person_details, sessions_conducted, proceedings, outcomes, feedback_summary, deviations)
  on public.activity_reports to authenticated;
create policy reports_select on public.activity_reports for select to authenticated using (
  faculty_id = auth.uid()
  or (status <> 'draft' and app.my_role() in ('iqac','principal'))
  or (status <> 'draft' and app.my_role() = 'hod' and department_id in (select app.my_depts())));
create policy reports_update on public.activity_reports for update to authenticated
  using (faculty_id = auth.uid() and status in ('draft','returned'))
  with check (faculty_id = auth.uid() and status in ('draft','returned'));
create policy raction_select on public.report_actions for select to authenticated
  using (exists (select 1 from public.activity_reports r where r.id = report_id));

grant select, insert, update, delete on public.activity_report_expenses to authenticated;
create policy exp_select on public.activity_report_expenses for select to authenticated
  using (exists (select 1 from public.activity_reports r where r.id = report_id));
create policy exp_write on public.activity_report_expenses for all to authenticated
  using (exists (select 1 from public.activity_reports r where r.id = report_id and r.faculty_id = auth.uid() and r.status in ('draft','returned')))
  with check (exists (select 1 from public.activity_reports r where r.id = report_id and r.faculty_id = auth.uid() and r.status in ('draft','returned')));

grant select, delete on public.activity_report_attachments to authenticated;
create policy ra_select on public.activity_report_attachments for select to authenticated
  using (exists (select 1 from public.activity_reports r where r.id = report_id));
create policy ra_delete on public.activity_report_attachments for delete to authenticated
  using (exists (select 1 from public.activity_reports r where r.id = report_id and r.faculty_id = auth.uid() and r.status in ('draft','returned')));

-- ---- notifications (read own; no client inserts)
grant select on public.notifications to authenticated;
grant update (is_read) on public.notifications to authenticated;
create policy notif_select on public.notifications for select to authenticated using (recipient_id = auth.uid());
create policy notif_update on public.notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- ---- audit (IQAC read-only; nobody writes through the API)
grant select on public.audit_logs to authenticated;
create policy audit_select on public.audit_logs for select to authenticated using (app.my_role() = 'iqac');

grant select on public.v_report_compliance to authenticated;
