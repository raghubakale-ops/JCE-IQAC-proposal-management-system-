-- Migration 4: administrative functions (IQAC Coordinator only) + secure bootstrap

create or replace function public.admin_upsert_staff(p_email text, p_full_name text, p_role public.app_role,
  p_dept_code text, p_designation text default null, p_employee_id text default null, p_active boolean default true)
returns public.staff_directory language plpgsql security definer set search_path = '' as $$
declare me public.profiles; v_email text := lower(trim(p_email)); v_dept uuid; old public.staff_directory; d public.staff_directory;
begin
  me := app.require_role('iqac');
  if v_email !~ '^[^@[:space:]]+@jainbgm\.in$' then raise exception 'VALIDATION: email must be a @jainbgm.in address'; end if;
  if p_dept_code is not null then
    select id into v_dept from public.departments where code = upper(p_dept_code) and is_active;
    if v_dept is null then raise exception 'VALIDATION: unknown department %', p_dept_code; end if;
  end if;
  if p_role in ('faculty','hod') and v_dept is null then raise exception 'VALIDATION: department is required for faculty and HOD'; end if;
  select * into old from public.staff_directory where email = v_email;
  -- never allow the last active IQAC administrator to be removed or demoted
  if old.id is not null and old.role = 'iqac' and old.is_active and (p_role <> 'iqac' or not p_active)
     and not exists (select 1 from public.staff_directory where role = 'iqac' and is_active and id <> old.id) then
    raise exception 'VALIDATION: at least one active IQAC Coordinator must remain';
  end if;
  insert into public.staff_directory (email, full_name, role, department_id, designation, employee_id, is_active)
  values (v_email, trim(p_full_name), p_role, v_dept, p_designation, p_employee_id, p_active)
  on conflict (email) do update set full_name = excluded.full_name, role = excluded.role,
    department_id = excluded.department_id, designation = excluded.designation,
    employee_id = excluded.employee_id, is_active = excluded.is_active
  returning * into d;
  perform app.audit('staff_assignment_changed', 'staff_directory', d.id,
    jsonb_build_object('email', v_email, 'old', to_jsonb(old), 'new', to_jsonb(d)));
  return d;
end $$;

create or replace function public.admin_set_hod_department(p_email text, p_dept_code text, p_grant boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles; s public.staff_directory; v_dept uuid;
begin
  me := app.require_role('iqac');
  select * into s from public.staff_directory where email = lower(trim(p_email)) and role = 'hod';
  if s.id is null then raise exception 'VALIDATION: no HOD with that email'; end if;
  select id into v_dept from public.departments where code = upper(p_dept_code);
  if v_dept is null then raise exception 'VALIDATION: unknown department'; end if;
  if p_grant then
    insert into public.hod_extra_departments (staff_id, department_id, granted_by) values (s.id, v_dept, me.id) on conflict do nothing;
  else
    delete from public.hod_extra_departments where staff_id = s.id and department_id = v_dept;
  end if;
  perform app.audit('hod_department_grant_changed', 'staff_directory', s.id, jsonb_build_object('department', p_dept_code, 'granted', p_grant));
end $$;

create or replace function public.admin_update_setting(p_key text, p_value jsonb) returns public.system_settings
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; old jsonb; s public.system_settings; yr text; n int;
begin
  me := app.require_role('iqac');
  if p_key not in ('institution_name','filing_prefix','academic_year','filing_digits','filing_start',
                   'report_due_days','report_review_required','report_required_kinds') then
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
    when 'report_review_required' then
      if jsonb_typeof(p_value) <> 'boolean' then raise exception 'VALIDATION: must be true or false'; end if;
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

-- One-time bootstrap of the very first IQAC administrator.
-- Run from the Supabase SQL editor (as postgres). NOT callable through the API.
create or replace function app.bootstrap_first_iqac(p_email text, p_full_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.staff_directory where role = 'iqac') then
    raise exception 'BOOTSTRAP_REFUSED: an IQAC Coordinator already exists';
  end if;
  insert into public.staff_directory (email, full_name, role, designation)
  values (lower(trim(p_email)), trim(p_full_name), 'iqac', 'IQAC Coordinator');
  insert into public.audit_logs (actor_email, action, entity_type, details)
  values ('bootstrap', 'bootstrap_first_iqac', 'staff_directory', jsonb_build_object('email', lower(trim(p_email))));
end $$;
revoke all on function app.bootstrap_first_iqac(text, text) from public, anon, authenticated;
