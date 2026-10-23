-- Test-only fixtures with fixed ids (used by the integration test)
select app.bootstrap_first_iqac('iqac@jainbgm.in','IQAC Coordinator');
insert into staff_directory(email,full_name,role,department_id,designation,employee_id) values
 ('fa@jainbgm.in','Faculty A','faculty',(select id from departments where code='CS'),'Assistant Professor','E001'),
 ('fb@jainbgm.in','Faculty B','faculty',(select id from departments where code='CS'),'Professor','E002'),
 ('hod_cs@jainbgm.in','HOD CS','hod',(select id from departments where code='CS'),'HOD','H001'),
 ('hod_ec@jainbgm.in','HOD EC','hod',(select id from departments where code='EC'),'HOD','H002'),
 ('principal@jainbgm.in','Principal','principal',null,'Principal','P001');
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-000000000001','iqac@jainbgm.in',now()),('00000000-0000-0000-0000-000000000002','fa@jainbgm.in',now()),
 ('00000000-0000-0000-0000-000000000003','fb@jainbgm.in',now()),('00000000-0000-0000-0000-000000000004','hod_cs@jainbgm.in',now()),
 ('00000000-0000-0000-0000-000000000005','principal@jainbgm.in',now()),('00000000-0000-0000-0000-000000000006','hod_ec@jainbgm.in',now());
