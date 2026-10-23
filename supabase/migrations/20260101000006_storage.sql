-- Migration 6: private buckets + storage policies (Supabase Storage)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
 ('proposal-docs',   'proposal-docs',   false, 10485760, array['application/pdf','application/msword',
   'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel',
   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png']),
 ('report-evidence','report-evidence', false, 10485760, array['application/pdf','application/msword',
   'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel',
   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- helpers (invoker: they inherit the caller's RLS on proposals / reports)
create or replace function app.can_read_proposal(pid uuid) returns boolean language sql stable
set search_path = '' as $$ select pid is not null and exists (select 1 from public.proposals where id = pid) $$;
create or replace function app.can_edit_proposal_files(pid uuid) returns boolean language sql stable
set search_path = '' as $$ select pid is not null and exists (select 1 from public.proposals
  where id = pid and faculty_id = auth.uid() and status in ('draft','hod_returned','principal_returned')) $$;
create or replace function app.can_read_report(rid uuid) returns boolean language sql stable
set search_path = '' as $$ select rid is not null and exists (select 1 from public.activity_reports where id = rid) $$;
create or replace function app.can_edit_report_files(rid uuid) returns boolean language sql stable
set search_path = '' as $$ select rid is not null and exists (select 1 from public.activity_reports
  where id = rid and faculty_id = auth.uid() and status in ('draft','returned')) $$;
create or replace function app.count_objects(p_bucket text, p_folder text) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int from storage.objects where bucket_id = p_bucket and name like p_folder || '/%' $$;
grant execute on function app.can_read_proposal(uuid), app.can_edit_proposal_files(uuid), app.can_read_report(uuid),
  app.can_edit_report_files(uuid), app.count_objects(text, text) to authenticated;

-- Path convention: <proposal_or_report_uuid>/<file_uuid>.<ext>
create policy proposal_docs_select on storage.objects for select to authenticated
  using (bucket_id = 'proposal-docs' and app.can_read_proposal(app.safe_uuid((storage.foldername(name))[1])));
create policy proposal_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'proposal-docs'
    and lower(name) ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|docx?|xlsx?|jpe?g|png)$'
    and app.can_edit_proposal_files(app.safe_uuid((storage.foldername(name))[1]))
    and app.count_objects('proposal-docs', (storage.foldername(name))[1]) < 10);
create policy proposal_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'proposal-docs' and app.can_edit_proposal_files(app.safe_uuid((storage.foldername(name))[1])));

create policy report_ev_select on storage.objects for select to authenticated
  using (bucket_id = 'report-evidence' and app.can_read_report(app.safe_uuid((storage.foldername(name))[1])));
create policy report_ev_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'report-evidence'
    and lower(name) ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|docx?|xlsx?|jpe?g|png)$'
    and app.can_edit_report_files(app.safe_uuid((storage.foldername(name))[1]))
    and app.count_objects('report-evidence', (storage.foldername(name))[1]) < 25);
create policy report_ev_delete on storage.objects for delete to authenticated
  using (bucket_id = 'report-evidence' and app.can_edit_report_files(app.safe_uuid((storage.foldername(name))[1])));
-- No UPDATE policy: files cannot be overwritten in place; replace = delete + upload new.

-- Orphan detection (for the scheduled cleanup Edge Function, Stage 3): objects with no metadata row older than 1 day
create or replace function app.orphan_uploads() returns table (bucket_id text, name text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.bucket_id, o.name, o.created_at from storage.objects o
  where o.created_at < now() - interval '1 day' and (
    (o.bucket_id = 'proposal-docs' and not exists (select 1 from public.proposal_attachments a where a.storage_path = o.name)) or
    (o.bucket_id = 'report-evidence' and not exists (select 1 from public.activity_report_attachments a where a.storage_path = o.name)))
$$;
revoke all on function app.orphan_uploads() from public, anon, authenticated;
