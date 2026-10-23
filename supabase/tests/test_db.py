"""Database-level acceptance tests (real PostgreSQL, real RLS, real triggers).
Run via ./run_db.sh. Each test runs in a rolled-back transaction unless noted."""
import json, sys, threading, traceback, uuid
import psycopg2

DSN = "host=127.0.0.1 user=postgres dbname=jce_test"
U = {}   # email -> uuid

def connect():
    c = psycopg2.connect(DSN); c.autocommit = False; return c

def su(cur):
    cur.execute("reset role"); cur.execute("select set_config('request.jwt.claims','',true)")

def login(cur, email, role="authenticated"):
    su(cur)
    claims = {"sub": str(U[email]), "email": email, "role": role}
    cur.execute("select set_config('request.jwt.claims',%s,true)", [json.dumps(claims)])
    cur.execute(f"set local role {role}")

def anon(cur):
    su(cur); cur.execute("set local role anon")

def q(cur, sql, args=None):
    cur.execute(sql, args); return cur.fetchall() if cur.description else []

def one(cur, sql, args=None):
    r = q(cur, sql, args); return r[0][0] if r else None

class Failed(Exception): pass
def check(cond, msg):
    if not cond: raise Failed(msg)

def fails(cur, sql, args=None, contains=None):
    """Expect the statement to raise; returns message."""
    cur.execute("savepoint s")
    try:
        cur.execute(sql, args)
        if cur.description: cur.fetchall()
    except psycopg2.Error as e:
        cur.execute("rollback to savepoint s"); msg = str(e)
        if contains: check(contains.lower() in msg.lower(), f"expected '{contains}' in error, got: {msg.strip()[:160]}")
        return msg
    cur.execute("release savepoint s")
    raise Failed(f"statement unexpectedly succeeded: {sql[:90]}")

FULL = dict(title="AI Workshop", category="Faculty Development", activity_type="Workshop", proposed_date="2020-01-15",
            start_time="10:00", end_time="13:00", venue="Seminar Hall", objectives="o", description="d",
            expected_outcomes="e", declaration=True)

def new_proposal(cur, email, **over):
    login(cur, email); d = {**FULL, **over}
    cols = ",".join(d); ph = ",".join(["%s"] * len(d))
    return one(cur, f"insert into proposals({cols}) values ({ph}) returning id", list(d.values()))

def to_forwarded(cur, fac="fa@jainbgm.in", hod="hod_cs@jainbgm.in"):
    pid = new_proposal(cur, fac); q(cur, "select submit_proposal(%s)", [pid])
    login(cur, hod); q(cur, "select hod_forward(%s,'ok')", [pid]); return pid

def to_filed(cur):
    pid = to_forwarded(cur); login(cur, "principal@jainbgm.in")
    q(cur, "select principal_approve(%s)", [pid]); return pid

def put_object(cur, bucket, path, size=1000, mime="application/pdf"):
    cur.execute("insert into storage.objects(bucket_id,name,metadata) values (%s,%s,%s)",
                [bucket, path, json.dumps({"size": size, "mimetype": mime})])

TESTS = []
def test(f): TESTS.append(f); return f

# ---------------------------------------------------------------- setup
def setup():
    c = connect(); cur = c.cursor()
    q(cur, "select app.bootstrap_first_iqac('iqac@jainbgm.in','IQAC Coordinator')")
    rows = [("fa@jainbgm.in","Faculty A","faculty","CS","E001"),("fb@jainbgm.in","Faculty B","faculty","CS","E002"),
            ("fc@jainbgm.in","Faculty C","faculty","EC","E003"),("hod_cs@jainbgm.in","HOD CS","hod","CS","H001"),
            ("hod_ec@jainbgm.in","HOD EC","hod","EC","H002"),("principal@jainbgm.in","Principal","principal",None,"P001")]
    for e,n,r,d,emp in rows:
        cur.execute("insert into staff_directory(email,full_name,role,department_id,designation,employee_id) "
                    "values (%s,%s,%s,(select id from departments where code=%s),%s,%s)", [e,n,r,d,r.title(),emp])
    users = [r[0] for r in rows] + ["iqac@jainbgm.in", "stranger@jainbgm.in"]
    for e in users[:4]:     # directory first, then sign-in
        U[e] = one(cur, "insert into auth.users(email,email_confirmed_at) values (%s,now()) returning id", [e])
    for e in users[4:]:
        U[e] = one(cur, "insert into auth.users(email,email_confirmed_at) values (%s,now()) returning id", [e])
    c.commit(); c.close()

# ---------------------------------------------------------------- 1-3 authentication gate
@test
def t01_institutional_user_gets_profile(cur):
    check(one(cur, "select role from profiles where email='fa@jainbgm.in'") == "faculty", "profile not created")
    login(cur, "fa@jainbgm.in"); check(one(cur, "select count(*) from profiles") == 1, "faculty should see only own profile")

@test
def t02_external_and_unverified_rejected(cur):
    fails(cur, "insert into auth.users(email,email_confirmed_at) values ('x@gmail.com',now())", contains="DOMAIN_NOT_ALLOWED")
    fails(cur, "insert into auth.users(email,email_confirmed_at) values ('x@evil.jainbgm.in',now())", contains="DOMAIN_NOT_ALLOWED")
    fails(cur, "insert into auth.users(email,email_confirmed_at) values ('x@jainbgm.in.evil.com',now())", contains="DOMAIN_NOT_ALLOWED")
    fails(cur, "insert into auth.users(email) values ('new@jainbgm.in')", contains="EMAIL_NOT_VERIFIED")
    fails(cur, "update auth.users set email='fa@gmail.com' where email='fa@jainbgm.in'", contains="DOMAIN_NOT_ALLOWED")

@test
def t03_no_role_user_sees_nothing(cur):
    pid = new_proposal(cur, "fa@jainbgm.in"); login(cur, "stranger@jainbgm.in")
    for t in ["proposals","profiles","departments","system_settings","notifications","audit_logs","filing_register"]:
        check(one(cur, f"select count(*) from {t}") == 0, f"stranger can read {t}")
    fails(cur, "insert into proposals(title) values ('x')", contains="NO_ROLE")
    fails(cur, "select submit_proposal(%s)", [pid], contains="NO_ROLE")
    anon(cur); fails(cur, "select count(*) from proposals", contains="permission denied")
    fails(cur, "select submit_proposal(%s)", [pid], contains="permission denied")

@test
def t03b_deactivated_user_loses_access(cur):
    login(cur, "iqac@jainbgm.in")
    q(cur, "select admin_upsert_staff('fb@jainbgm.in','Faculty B','faculty','CS','Faculty','E002',false)")
    login(cur, "fb@jainbgm.in"); check(one(cur, "select count(*) from departments") == 0, "inactive user still reads data")

# ---------------------------------------------------------------- 4 isolation
@test
def t04_faculty_isolation(cur):
    pid = new_proposal(cur, "fa@jainbgm.in")
    login(cur, "fb@jainbgm.in")
    check(one(cur, "select count(*) from proposals where id=%s", [pid]) == 0, "B can read A's draft")
    cur.execute("update proposals set title='hacked' where id=%s", [pid]); check(cur.rowcount == 0, "B updated A's proposal")
    cur.execute("delete from proposals where id=%s", [pid]); check(cur.rowcount == 0, "B deleted A's proposal")
    fails(cur, "select submit_proposal(%s)", [pid], contains="not your proposal")
    pid2 = new_proposal(cur, "fa@jainbgm.in"); q(cur, "select submit_proposal(%s)", [pid2])
    login(cur, "fb@jainbgm.in"); check(one(cur, "select count(*) from proposals where id=%s", [pid2]) == 0, "B reads A's submitted proposal")

@test
def t04b_client_cannot_forge_identity_or_protected_fields(cur):
    login(cur, "fa@jainbgm.in")
    pid = one(cur, "insert into proposals(title,faculty_id) values ('t', %s) returning id", [str(U['fb@jainbgm.in'])]) if False else None
    fails(cur, "insert into proposals(title,faculty_id) values ('t',%s)", [str(U['fb@jainbgm.in'])], contains="permission denied")
    pid = new_proposal(cur, "fa@jainbgm.in")
    check(one(cur, "select faculty_email||department_id::text from proposals where id=%s", [pid]).startswith("fa@jainbgm.in"), "snapshot wrong")
    check(one(cur, "select d.code from proposals p join departments d on d.id=p.department_id where p.id=%s", [pid]) == "CS", "dept not trusted")
    for col, val in [("status","'filed'"),("filing_number","'JCE/IQAC/2026-27/999'"),("approved_at","now()"),
                     ("hod_reviewer_id","faculty_id"),("principal_reviewer_id","faculty_id"),("faculty_id",f"'{U['fb@jainbgm.in']}'")]:
        fails(cur, f"update proposals set {col}={val} where id=%s", [pid], contains="permission denied")

# ---------------------------------------------------------------- 5-7 role boundaries
@test
def t05_hod_department_scope(cur):
    pid = new_proposal(cur, "fa@jainbgm.in"); q(cur, "select submit_proposal(%s)", [pid])
    login(cur, "hod_ec@jainbgm.in")
    check(one(cur, "select count(*) from proposals where id=%s", [pid]) == 0, "EC HOD reads CS proposal")
    fails(cur, "select hod_forward(%s)", [pid], contains="another department")
    fails(cur, "select hod_return(%s,'x')", [pid], contains="another department")
    login(cur, "hod_cs@jainbgm.in"); check(one(cur, "select count(*) from proposals where id=%s", [pid]) == 1, "CS HOD cannot read own dept")
    # explicit administrative grant
    login(cur, "iqac@jainbgm.in"); q(cur, "select admin_set_hod_department('hod_ec@jainbgm.in','CS',true)")
    login(cur, "hod_ec@jainbgm.in"); check(one(cur, "select count(*) from proposals where id=%s", [pid]) == 1, "grant not honoured")
    login(cur, "iqac@jainbgm.in"); q(cur, "select admin_set_hod_department('hod_ec@jainbgm.in','CS',false)")
    login(cur, "hod_ec@jainbgm.in"); check(one(cur, "select count(*) from proposals where id=%s", [pid]) == 0, "revoked grant still works")

@test
def t05b_hod_cannot_see_drafts(cur):
    pid = new_proposal(cur, "fa@jainbgm.in"); login(cur, "hod_cs@jainbgm.in")
    check(one(cur, "select count(*) from proposals where id=%s", [pid]) == 0, "HOD sees draft")

@test
def t06_hod_cannot_act_as_principal(cur):
    pid = to_forwarded(cur); login(cur, "hod_cs@jainbgm.in")
    for fn in ["principal_approve(%s)", "principal_return(%s,'x')", "principal_disapprove(%s,'x')", "principal_start_review(%s)"]:
        fails(cur, f"select {fn}", [pid], contains="FORBIDDEN")
    login(cur, "fa@jainbgm.in"); fails(cur, "select principal_approve(%s)", [pid], contains="FORBIDDEN")
    fails(cur, "select hod_forward(%s)", [pid], contains="FORBIDDEN")
    login(cur, "iqac@jainbgm.in"); fails(cur, "select principal_approve(%s)", [pid], contains="FORBIDDEN")

@test
def t07_principal_cannot_bypass_hod(cur):
    pid = new_proposal(cur, "fa@jainbgm.in"); q(cur, "select submit_proposal(%s)", [pid])
    login(cur, "principal@jainbgm.in")
    check(one(cur, "select count(*) from proposals where id=%s", [pid]) == 0, "principal sees pre-HOD proposal")
    fails(cur, "select principal_approve(%s)", [pid], contains="INVALID_STATE")
    fails(cur, "select principal_disapprove(%s,'no')", [pid], contains="INVALID_STATE")
    su(cur); fails(cur, "update proposals set status='approved' where id=%s", [pid], contains="INVALID_TRANSITION")
    fails(cur, "update proposals set status='filed', filing_number='X' where id=%s", [pid], contains="INVALID_TRANSITION")
    d = new_proposal(cur, "fa@jainbgm.in"); login(cur, "principal@jainbgm.in")
    fails(cur, "select principal_approve(%s)", [d], contains="not")      # draft: not found/visible or invalid

# ---------------------------------------------------------------- 8-10 filing numbers
@test
def t08_single_number_and_idempotent_retry(cur):
    pid = to_forwarded(cur); login(cur, "principal@jainbgm.in")
    a = one(cur, "select (principal_approve(%s)).filing_number", [pid])
    check(a == "JCE/IQAC/2026-27/001", f"unexpected first number {a}")
    b = one(cur, "select (principal_approve(%s)).filing_number", [pid])
    check(a == b, "retry produced a different number")
    su(cur)
    check(one(cur, "select count(*) from filing_register where proposal_id=%s", [pid]) == 1, "duplicate register rows")
    check(one(cur, "select last_seq from filing_counters") == 1, "counter advanced on retry")
    check(one(cur, "select count(*) from approval_actions where proposal_id=%s and action='filing_allocated'", [pid]) == 1, "duplicate action")
    check(one(cur, "select count(*) from notifications where proposal_id=%s and type='proposal_approved' and recipient_id=%s",
              [pid, str(U['fa@jainbgm.in'])]) == 1, "duplicate notification on retry")
    fails(cur, "insert into filing_register(proposal_id,filing_number,prefix,academic_year,sequence_no,approval_action_id,generated_by) "
               "select proposal_id,'DUP','p','y',1,approval_action_id,generated_by from filing_register", contains="duplicate key")

@test
def t09_rejected_numbers_not_reused_and_sequence_continues(cur):
    p1 = to_forwarded(cur); p2 = to_forwarded(cur); login(cur, "principal@jainbgm.in")
    q(cur, "select principal_disapprove(%s,'no budget')", [p1])
    n = one(cur, "select (principal_approve(%s)).filing_number", [p2]); check(n.endswith("/001"), n)

@test
def t10_filing_number_immutable(cur):
    pid = to_filed(cur)
    login(cur, "fa@jainbgm.in")
    fails(cur, "update proposals set filing_number='JCE/IQAC/2026-27/777' where id=%s", [pid], contains="permission denied")
    fails(cur, "update filing_register set filing_number='x'", contains="permission denied")
    fails(cur, "delete from filing_register", contains="permission denied")
    su(cur)
    fails(cur, "update proposals set filing_number='x' where id=%s", [pid], contains="IMMUTABLE")
    fails(cur, "update filing_register set filing_number='x'", contains="IMMUTABLE")
    fails(cur, "delete from filing_register", contains="IMMUTABLE")
    fails(cur, "truncate filing_register", contains="IMMUTABLE")
    fails(cur, "update proposals set status='draft' where id=%s", [pid], contains="INVALID")
    fails(cur, "delete from proposals where id=%s", [pid], contains="violates foreign key")

@test
def t10b_academic_year_rollover_and_settings_guard(cur):
    p1 = to_forwarded(cur); p2 = to_forwarded(cur); login(cur, "principal@jainbgm.in")
    n1 = one(cur, "select (principal_approve(%s)).filing_number", [p1])
    login(cur, "fa@jainbgm.in"); fails(cur, "select admin_update_setting('academic_year','\"2027-28\"')", contains="FORBIDDEN")
    fails(cur, "update system_settings set value='\"x\"'", contains="permission denied")
    login(cur, "iqac@jainbgm.in")
    fails(cur, "select admin_update_setting('academic_year','\"2027-29\"')", contains="VALIDATION")
    fails(cur, "select admin_update_setting('filing_prefix','\"a b;drop\"')", contains="VALIDATION")
    fails(cur, "select admin_update_setting('nonsense','1')", contains="unknown setting")
    q(cur, "select admin_update_setting('academic_year','\"2027-28\"')")
    q(cur, "select admin_update_setting('filing_digits','4')")
    login(cur, "principal@jainbgm.in")
    n2 = one(cur, "select (principal_approve(%s)).filing_number", [p2])
    check(n1 == "JCE/IQAC/2026-27/001" and n2 == "JCE/IQAC/2027-28/0001", f"{n1} / {n2}")
    su(cur); check(one(cur, "select filing_number from proposals where id=%s", [p1]) == n1, "historical number changed")
    check(one(cur, "select count(*) from audit_logs where action='setting_changed'") == 2, "settings changes not audited")

# ---------------------------------------------------------------- 11 returns & resubmission
@test
def t11_return_correct_resubmit(cur):
    pid = new_proposal(cur, "fa@jainbgm.in"); q(cur, "select submit_proposal(%s)", [pid])
    login(cur, "hod_cs@jainbgm.in")
    fails(cur, "select hod_return(%s,'  ')", [pid], contains="remarks are mandatory")
    q(cur, "select hod_return(%s,'Add budget breakup')", [pid])
    login(cur, "fa@jainbgm.in")
    check(one(cur, "select hod_remarks from proposals where id=%s", [pid]) == "Add budget breakup", "remarks missing")
    cur.execute("update proposals set budget_details='Breakup...' , total_budget=5000 where id=%s", [pid]); check(cur.rowcount == 1, "cannot edit returned proposal")
    q(cur, "select submit_proposal(%s)", [pid])
    check(one(cur, "select revision_no from proposals where id=%s", [pid]) == 1, "revision not incremented")
    cur.execute("update proposals set title='sneaky' where id=%s", [pid]); check(cur.rowcount == 0, "edit allowed while under review")
    login(cur, "hod_cs@jainbgm.in"); q(cur, "select hod_forward(%s)", [pid])
    login(cur, "principal@jainbgm.in"); q(cur, "select principal_return(%s,'Clarify venue')", [pid])
    login(cur, "fa@jainbgm.in"); q(cur, "select submit_proposal(%s)", [pid])
    check(one(cur, "select status from proposals where id=%s", [pid]) == "hod_review", "principal return must re-enter HOD review")
    acts = [r[0] for r in q(cur, "select action from approval_actions where proposal_id=%s", [pid])]
    check(sorted(acts) == sorted(["submitted","hod_returned","resubmitted","hod_forwarded","principal_returned","resubmitted"]), str(acts))

@test
def t11b_submit_validation(cur):
    pid = new_proposal(cur, "fa@jainbgm.in", declaration=False, venue="")
    fails(cur, "select submit_proposal(%s)", [pid], contains="declaration")
    login(cur, "fa@jainbgm.in"); fails(cur, "update proposals set end_time='09:00', start_time='10:00' where id=%s", [pid], contains="check")

# ---------------------------------------------------------------- 12 reports
@test
def t12_reports_linked_and_isolated(cur):
    login(cur, "fa@jainbgm.in")
    early = new_proposal(cur, "fa@jainbgm.in"); fails(cur, "select start_report(%s)", [early], contains="INVALID_STATE")
    fails(cur, "insert into activity_reports(proposal_id) values (%s)", [early], contains="permission denied")
    pid = to_filed(cur); login(cur, "fa@jainbgm.in")
    r = one(cur, "select (start_report(%s)).id", [pid]); check(r == one(cur, "select (start_report(%s)).id", [pid]), "start_report not idempotent")
    login(cur, "fb@jainbgm.in"); fails(cur, "select start_report(%s)", [pid], contains="not your proposal")
    check(one(cur, "select count(*) from activity_reports") == 0, "B reads A's report")
    login(cur, "fa@jainbgm.in")
    fails(cur, "select submit_report(%s)", [r], contains="actual_date")
    cur.execute("update activity_reports set actual_date='2020-01-15', actual_participants=60, actual_expenditure=4000, proceedings='p', outcomes='o' where id=%s", [r])
    fails(cur, "select submit_report(%s)", [r], contains="attachment:final_report")
    fails(cur, "update activity_reports set status='verified' where id=%s", [r], contains="permission denied")
    for kind, ext in [("final_report","pdf"),("attendance_sheet","pdf")]:
        path = f"{r}/{uuid.uuid4()}.{ext}"; put_object(cur, "report-evidence", path)
        q(cur, "select register_report_attachment(%s,%s,%s,%s)", [r, path, "x."+ext, kind])
    cur.execute("insert into activity_report_expenses(report_id,head,amount) values (%s,'Honorarium',2500)", [r])
    q(cur, "select submit_report(%s)", [r])
    login(cur, "fa@jainbgm.in"); cur.execute("update activity_reports set outcomes='changed' where id=%s", [r]); check(cur.rowcount == 0, "edit after submit")
    login(cur, "hod_cs@jainbgm.in"); check(one(cur, "select count(*) from activity_reports where id=%s", [r]) == 1, "HOD cannot see report")
    login(cur, "hod_ec@jainbgm.in"); check(one(cur, "select count(*) from activity_reports where id=%s", [r]) == 0, "other HOD sees report")
    login(cur, "fa@jainbgm.in"); fails(cur, "select iqac_verify_report(%s)", [r], contains="FORBIDDEN")
    login(cur, "iqac@jainbgm.in"); fails(cur, "select iqac_verify_report(%s)", [r], contains="not awaiting IQAC")   # HOD step first
    login(cur, "hod_ec@jainbgm.in"); fails(cur, "select hod_review_report(%s,true)", [r], contains="another department")
    login(cur, "hod_cs@jainbgm.in"); fails(cur, "select hod_review_report(%s,false,'')", [r], contains="remarks")
    q(cur, "select hod_review_report(%s,true,'looks good')", [r])
    login(cur, "iqac@jainbgm.in"); fails(cur, "select iqac_return_report(%s,'')", [r], contains="remarks")
    q(cur, "select iqac_return_report(%s,'Attendance unclear')", [r])
    login(cur, "fa@jainbgm.in"); cur.execute("update activity_reports set outcomes='fixed' where id=%s", [r]); check(cur.rowcount == 1, "cannot edit returned report")
    q(cur, "select submit_report(%s)", [r]); login(cur, "hod_cs@jainbgm.in"); q(cur, "select hod_review_report(%s,true)", [r])
    login(cur, "iqac@jainbgm.in"); q(cur, "select iqac_verify_report(%s,'ok')", [r])
    su(cur); check(one(cur, "select proposal_id from activity_reports where id=%s", [r]) == pid, "report not linked")
    check(one(cur, "select status from proposals where id=%s", [pid]) == "filed", "approved proposal was altered")
    check(one(cur, "select count(*) from report_actions where report_id=%s", [r]) == 6, "report history incomplete")

@test
def t12b_overdue_view(cur):
    pid = to_filed(cur)       # proposed_date 2020 => overdue with no report
    login(cur, "iqac@jainbgm.in"); check(one(cur, "select is_overdue from v_report_compliance where proposal_id=%s", [pid]) is True, "not flagged overdue")
    login(cur, "fb@jainbgm.in"); check(one(cur, "select count(*) from v_report_compliance") == 0, "view leaks across users")

# ---------------------------------------------------------------- 13 storage
@test
def t13_storage_access_control(cur):
    pid = new_proposal(cur, "fa@jainbgm.in"); path = f"{pid}/{uuid.uuid4()}.pdf"
    put_object(cur, "proposal-docs", path)                                   # owner may upload to draft
    q(cur, "select register_proposal_attachment(%s,%s,'brief.pdf')", [pid, path])
    login(cur, "fb@jainbgm.in")
    check(one(cur, "select count(*) from storage.objects where name=%s", [path]) == 0, "B can read A's object")
    check(one(cur, "select count(*) from proposal_attachments") == 0, "B reads attachment metadata")
    fails(cur, "insert into storage.objects(bucket_id,name,metadata) values ('proposal-docs',%s,'{}')", [f"{pid}/{uuid.uuid4()}.pdf"], contains="row-level security")
    cur.execute("delete from storage.objects where name=%s", [path]); check(cur.rowcount == 0, "B deleted A's object")
    login(cur, "fa@jainbgm.in")
    fails(cur, "insert into storage.objects(bucket_id,name,metadata) values ('proposal-docs',%s,'{}')", [f"{pid}/{uuid.uuid4()}.exe"], contains="row-level security")
    fails(cur, "insert into storage.objects(bucket_id,name,metadata) values ('proposal-docs',%s,'{}')", [f"{pid}/../x.pdf"], contains="row-level security")
    cur.execute("update storage.objects set name=name||'x'"); check(cur.rowcount == 0, "objects can be overwritten/renamed")
    login(cur, "hod_cs@jainbgm.in"); check(one(cur, "select count(*) from storage.objects where name=%s", [path]) == 0, "HOD reads draft doc")
    login(cur, "fa@jainbgm.in"); q(cur, "select submit_proposal(%s)", [pid])
    login(cur, "hod_cs@jainbgm.in"); check(one(cur, "select count(*) from storage.objects where name=%s", [path]) == 1, "HOD cannot read submitted doc")
    login(cur, "hod_ec@jainbgm.in"); check(one(cur, "select count(*) from storage.objects where name=%s", [path]) == 0, "other HOD reads doc")
    login(cur, "fa@jainbgm.in")                                              # frozen after submit
    fails(cur, "insert into storage.objects(bucket_id,name,metadata) values ('proposal-docs',%s,'{}')", [f"{pid}/{uuid.uuid4()}.pdf"], contains="row-level security")
    cur.execute("delete from storage.objects where name=%s", [path]); check(cur.rowcount == 0, "deleted doc of submitted proposal")

@test
def t13b_register_requires_real_valid_upload(cur):
    pid = new_proposal(cur, "fa@jainbgm.in")
    fails(cur, "select register_proposal_attachment(%s,%s,'ghost.pdf')", [pid, f"{pid}/{uuid.uuid4()}.pdf"], contains="UPLOAD_MISSING")
    p = f"{pid}/{uuid.uuid4()}.pdf"; put_object(cur, "proposal-docs", p, size=20_000_000)
    fails(cur, "select register_proposal_attachment(%s,%s,'big.pdf')", [pid, p], contains="10 MB")
    p = f"{pid}/{uuid.uuid4()}.pdf"; put_object(cur, "proposal-docs", p, mime="application/x-msdownload")
    fails(cur, "select register_proposal_attachment(%s,%s,'bad.pdf')", [pid, p], contains="not allowed")
    other = new_proposal(cur, "fa@jainbgm.in"); p = f"{other}/{uuid.uuid4()}.pdf"; put_object(cur, "proposal-docs", p)
    fails(cur, "select register_proposal_attachment(%s,%s,'x.pdf')", [pid, p], contains="invalid storage path")
    pid = new_proposal(cur, "fa@jainbgm.in")
    for i in range(10):
        p = f"{pid}/{uuid.uuid4()}.png"; put_object(cur, "proposal-docs", p, mime="image/png")
        q(cur, "select register_proposal_attachment(%s,%s,'i.png')", [pid, p])
    fails(cur, "select register_proposal_attachment(%s,%s,'i.png')", [pid, f"{pid}/{uuid.uuid4()}.png"], contains="maximum 10 files")
    fails(cur, "insert into storage.objects(bucket_id,name,metadata) values ('proposal-docs',%s,'{}')", [f"{pid}/{uuid.uuid4()}.pdf"], contains="row-level security")

# ---------------------------------------------------------------- 14 audit
@test
def t14_audit_protected(cur):
    pid = to_filed(cur)
    login(cur, "fa@jainbgm.in")
    check(one(cur, "select count(*) from audit_logs") == 0, "faculty reads audit")
    for sql in ["insert into audit_logs(action,entity_type) values ('x','y')", "update audit_logs set action='z'", "delete from audit_logs"]:
        fails(cur, sql, contains="permission denied")
    login(cur, "iqac@jainbgm.in"); check(one(cur, "select count(*) from audit_logs") > 5, "iqac cannot read audit")
    fails(cur, "delete from audit_logs", contains="permission denied")
    fails(cur, "select app.audit('x','y',null)", contains="permission denied")
    su(cur)
    fails(cur, "update audit_logs set action='z'", contains="IMMUTABLE"); fails(cur, "delete from audit_logs", contains="IMMUTABLE")
    fails(cur, "truncate audit_logs", contains="IMMUTABLE"); fails(cur, "delete from approval_actions", contains="IMMUTABLE")
    acts = {r[0] for r in q(cur, "select action from audit_logs where entity_id=%s", [pid])}
    for a in ["proposal_created","proposal_submitted","proposal_hod_forwarded","proposal_principal_approved","filing_number_generated"]:
        check(a in acts, f"audit missing {a}")
    login(cur, "fa@jainbgm.in"); fails(cur, "select app.notify(auth.uid(),null,null,'a','b','c')", contains="permission denied")

@test
def t14b_edit_audited(cur):
    pid = new_proposal(cur, "fa@jainbgm.in"); cur.execute("update proposals set venue='Hall 2' where id=%s", [pid]); su(cur)
    check(one(cur, "select details->'changed_columns' ? 'venue' from audit_logs where action='proposal_edited' and entity_id=%s", [pid]), "edit not audited")

# ---------------------------------------------------------------- notifications
@test
def t15_notifications_private_and_server_made(cur):
    pid = to_forwarded(cur)
    login(cur, "fa@jainbgm.in"); n = one(cur, "select count(*) from notifications")
    check(n >= 2 and one(cur, "select count(*) from notifications where recipient_id<>auth.uid()") == 0, "faculty notifications wrong")
    fails(cur, "insert into notifications(recipient_id,type,title,message) values (auth.uid(),'a','b','c')", contains="permission denied")
    fails(cur, "update notifications set message='forged'", contains="permission denied")
    check(one(cur, "select mark_notifications_read()") == n, "mark read failed")
    login(cur, "fb@jainbgm.in"); check(one(cur, "select count(*) from notifications") == 0, "B reads A's notifications")
    login(cur, "principal@jainbgm.in"); check(one(cur, "select count(*) from notifications where proposal_id=%s", [pid]) == 1, "principal not notified")
    login(cur, "hod_ec@jainbgm.in"); check(one(cur, "select count(*) from notifications") == 0, "wrong HOD notified")

# ---------------------------------------------------------------- role-scoped reads (what CSV export uses)
@test
def t16_scoped_reads_for_export(cur):
    ids = [to_filed(cur)]; d = new_proposal(cur, "fc@jainbgm.in")                 # EC draft
    e = new_proposal(cur, "fc@jainbgm.in"); q(cur, "select submit_proposal(%s)", [e])
    exp = {"fa@jainbgm.in": 1, "fb@jainbgm.in": 0, "fc@jainbgm.in": 2, "hod_cs@jainbgm.in": 1, "hod_ec@jainbgm.in": 1,
           "principal@jainbgm.in": 1, "iqac@jainbgm.in": 2}
    for em, n in exp.items():
        login(cur, em); got = one(cur, "select count(*) from proposals"); check(got == n, f"{em}: expected {n} got {got}")
    login(cur, "fa@jainbgm.in"); check(one(cur, "select count(*) from filing_register") == 1, "filing visibility (faculty)")
    login(cur, "hod_ec@jainbgm.in"); check(one(cur, "select count(*) from filing_register") == 0, "filing visibility (other HOD)")
    login(cur, "iqac@jainbgm.in"); check(one(cur, "select count(*) from filing_register") == 1, "filing visibility (iqac)")

# ---------------------------------------------------------------- admin
@test
def t17_admin_controls(cur):
    login(cur, "fa@jainbgm.in")
    fails(cur, "select admin_upsert_staff('z@jainbgm.in','Z','iqac',null)", contains="FORBIDDEN")
    fails(cur, "select app.bootstrap_first_iqac('z@jainbgm.in','Z')", contains="permission denied")
    fails(cur, "insert into staff_directory(email,full_name,role) values ('z@jainbgm.in','Z','iqac')", contains="permission denied")
    fails(cur, "update profiles set role='iqac' where id=auth.uid()", contains="permission denied")
    check(one(cur, "select count(*) from staff_directory") == 0, "faculty reads directory")
    login(cur, "iqac@jainbgm.in")
    fails(cur, "select admin_upsert_staff('z@gmail.com','Z','faculty','CS')", contains="VALIDATION")
    fails(cur, "select admin_upsert_staff('z@jainbgm.in','Z','faculty',null)", contains="department")
    fails(cur, "select admin_upsert_staff('iqac@jainbgm.in','I','faculty','CS')", contains="at least one active IQAC")
    fails(cur, "select admin_upsert_staff('iqac@jainbgm.in','I','iqac',null,null,null,false)", contains="at least one active IQAC")
    q(cur, "select admin_upsert_staff('late@jainbgm.in','Late Joiner','faculty','EC','Lecturer','E099')")
    su(cur); fails(cur, "select app.bootstrap_first_iqac('z@jainbgm.in','Z')", contains="BOOTSTRAP_REFUSED")
    U["late@jainbgm.in"] = one(cur, "insert into auth.users(email,email_confirmed_at) values ('late@jainbgm.in',now()) returning id")
    login(cur, "late@jainbgm.in"); check(one(cur, "select role from profiles") == "faculty", "profile not materialised after directory add")
    login(cur, "iqac@jainbgm.in"); q(cur, "select admin_upsert_staff('late@jainbgm.in','Late Joiner','hod','EC','HOD','E099')")
    login(cur, "late@jainbgm.in"); check(one(cur, "select role from profiles") == "hod", "role change not propagated")
    su(cur); check(one(cur, "select count(*) from audit_logs where action='staff_assignment_changed'") == 2, "role changes not audited")


# ---------------------------------------------------------------- HOD-authored proposals (decision 1)
@test
def t19_hod_authored_proposal_goes_to_principal(cur):
    pid = new_proposal(cur, "hod_cs@jainbgm.in")
    check(one(cur, "select author_role from proposals where id=%s", [pid]) == "hod", "author_role")
    st = one(cur, "select (submit_proposal(%s)).status", [pid]); check(st == "forwarded", f"status {st}")
    check(one(cur, "select (submit_proposal(%s)).status", [pid]) == "forwarded", "retry not idempotent")
    fails(cur, "select hod_forward(%s)", [pid], contains="your own proposal")      # HOD cannot review own
    fails(cur, "select hod_return(%s,'x')", [pid], contains="your own proposal")
    login(cur, "hod_ec@jainbgm.in"); check(one(cur, "select count(*) from proposals where id=%s", [pid]) == 0, "other HOD sees it")
    login(cur, "fb@jainbgm.in"); check(one(cur, "select count(*) from proposals where id=%s", [pid]) == 0, "colleague sees HOD proposal")
    login(cur, "principal@jainbgm.in"); check(one(cur, "select count(*) from notifications where proposal_id=%s", [pid]) == 1, "principal not notified")
    q(cur, "select principal_return(%s,'Revise budget')", [pid])
    login(cur, "hod_cs@jainbgm.in"); cur.execute("update proposals set total_budget=100 where id=%s", [pid]); check(cur.rowcount == 1, "HOD cannot edit own returned proposal")
    check(one(cur, "select (submit_proposal(%s)).status", [pid]) == "forwarded", "resubmit must skip HOD review")
    login(cur, "principal@jainbgm.in"); n = one(cur, "select (principal_approve(%s)).filing_number", [pid]); check(n.endswith("/001"), n)
    su(cur); check(one(cur, "select hod_reviewer_id is null from proposals where id=%s", [pid]), "no HOD reviewer expected")

@test
def t19b_faculty_cannot_skip_hod_and_hod_cannot_review_own(cur):
    pid = new_proposal(cur, "fa@jainbgm.in"); su(cur)
    fails(cur, "update proposals set status='forwarded' where id=%s", [pid], contains="only HOD-authored")
    login(cur, "iqac@jainbgm.in"); fails(cur, "insert into proposals(title) values ('x')", contains="row-level security")
    h = new_proposal(cur, "hod_cs@jainbgm.in"); su(cur)
    fails(cur, "update proposals set status='hod_review' where id=%s", [h], contains="INVALID_TRANSITION")
    login(cur, "hod_cs@jainbgm.in"); q(cur, "select submit_proposal(%s)", [new_proposal(cur, "hod_cs@jainbgm.in")])

# ---------------------------------------------------------------- report review modes (decision 3)
def make_ready_report(cur, author="fa@jainbgm.in"):
    pid = to_filed(cur) if author == "fa@jainbgm.in" else None
    if pid is None:
        pid = new_proposal(cur, author); q(cur, "select submit_proposal(%s)", [pid])
        login(cur, "principal@jainbgm.in"); q(cur, "select principal_approve(%s)", [pid]); login(cur, author)
    login(cur, author); r = one(cur, "select (start_report(%s)).id", [pid])
    cur.execute("update activity_reports set actual_date='2020-01-15', actual_participants=5, actual_expenditure=1, proceedings='p', outcomes='o' where id=%s", [r])
    for kind in ("final_report", "attendance_sheet"):
        path = f"{r}/{uuid.uuid4()}.pdf"; put_object(cur, "report-evidence", path)
        q(cur, "select register_report_attachment(%s,%s,'f.pdf',%s)", [r, path, kind])
    return r

def set_mode(cur, mode):
    login(cur, "iqac@jainbgm.in"); q(cur, "select admin_update_setting('report_review_mode',%s)", [json.dumps(mode)])

@test
def t20_report_mode_iqac_only(cur):
    set_mode(cur, "iqac"); r = make_ready_report(cur)
    check(one(cur, "select (submit_report(%s)).status", [r]) == "submitted", "should wait for IQAC")
    login(cur, "hod_cs@jainbgm.in"); fails(cur, "select hod_review_report(%s,true)", [r], contains="not enabled")
    login(cur, "iqac@jainbgm.in"); check(one(cur, "select (iqac_verify_report(%s)).status", [r]) == "verified", "iqac verify")
    check(one(cur, "select (iqac_verify_report(%s)).status", [r]) == "verified", "retry")

@test
def t20b_report_mode_none_autoverifies(cur):
    set_mode(cur, "none"); r = make_ready_report(cur); login(cur, "fa@jainbgm.in")
    check(one(cur, "select (submit_report(%s)).status", [r]) == "verified", "auto verify")
    login(cur, "iqac@jainbgm.in"); fails(cur, "select admin_update_setting('report_review_mode','\"bogus\"')", contains="VALIDATION")

@test
def t20c_hod_authored_report_skips_hod_stage(cur):
    set_mode(cur, "hod_then_iqac"); r = make_ready_report(cur, "hod_cs@jainbgm.in"); login(cur, "hod_cs@jainbgm.in")
    check(one(cur, "select (submit_report(%s)).status", [r]) == "hod_verified", "HOD report should go straight to IQAC")
    fails(cur, "select hod_review_report(%s,true)", [r], contains="own report")
    login(cur, "iqac@jainbgm.in"); check(one(cur, "select (iqac_verify_report(%s)).status", [r]) == "verified", "iqac verify")

@test
def t20d_hod_return_then_correction(cur):
    set_mode(cur, "hod_then_iqac"); r = make_ready_report(cur); login(cur, "fa@jainbgm.in"); q(cur, "select submit_report(%s)", [r])
    login(cur, "hod_cs@jainbgm.in"); q(cur, "select hod_review_report(%s,false,'Photos missing')", [r])
    login(cur, "fa@jainbgm.in"); check(one(cur, "select review_remarks from activity_reports where id=%s", [r]) == "Photos missing", "HOD remarks not visible to author")
    check(one(cur, "select returned_by from activity_reports where id=%s", [r]) == "hod", "returned_by")
    q(cur, "select submit_report(%s)", [r]); check(one(cur, "select status from activity_reports where id=%s", [r]) == "submitted", "re-enters HOD stage")
    login(cur, "iqac@jainbgm.in"); fails(cur, "select iqac_verify_report(%s)", [r], contains="not awaiting IQAC")

# ---------------------------------------------------------------- concurrency (committed; own cleanup)
def t18_concurrent_approvals():
    c = connect(); cur = c.cursor(); ids = []
    for _ in range(12):
        ids.append(to_forwarded(cur))
    c.commit()
    results, errs = [], []
    barrier = threading.Barrier(12)
    def worker(pid, dup):
        try:
            cc = connect(); cu = cc.cursor(); login(cu, "principal@jainbgm.in"); barrier.wait()
            results.append((pid, one(cu, "select (principal_approve(%s)).filing_number", [pid]))); cc.commit(); cc.close()
        except Exception as e: errs.append(repr(e))
    ts = [threading.Thread(target=worker, args=(p, False)) for p in ids]
    [t.start() for t in ts]; [t.join() for t in ts]
    check(not errs, f"errors: {errs[:2]}")
    nums = sorted(n for _, n in results)
    check(len(set(nums)) == 12, f"duplicate numbers: {nums}")
    check([int(n.rsplit('/',1)[1]) for n in nums] == list(range(1, 13)), f"not contiguous: {nums}")
    # concurrent double-click on the SAME proposal
    cur2 = connect(); c2 = cur2.cursor(); pid = to_forwarded(c2); cur2.commit()
    out = []; b2 = threading.Barrier(6)
    def dbl():
        cc = connect(); cu = cc.cursor(); login(cu, "principal@jainbgm.in"); b2.wait()
        out.append(one(cu, "select (principal_approve(%s)).filing_number", [pid])); cc.commit(); cc.close()
    ts = [threading.Thread(target=dbl) for _ in range(6)]; [t.start() for t in ts]; [t.join() for t in ts]
    check(len(set(out)) == 1 and len(out) == 6, f"same proposal got different numbers: {out}")
    su(c2); check(one(c2, "select count(*) from filing_register") == 13, "register count wrong")
    check(one(c2, "select count(*) from notifications where type='proposal_approved' and proposal_id=%s and recipient_id=%s", [pid, str(U['fa@jainbgm.in'])]) == 1, "duplicate notifications under concurrency")
    cur2.commit()

def main():
    setup(); failed = 0
    for t in TESTS:
        c = connect(); cur = c.cursor()
        try:
            t(cur); print(f"PASS  {t.__name__}")
        except Exception as e:
            failed += 1; print(f"FAIL  {t.__name__}: {e}")
            if not isinstance(e, Failed): traceback.print_exc(limit=3)
        finally:
            c.rollback(); c.close()
    # concurrency test last (commits data)
    try: t18_concurrent_approvals(); print("PASS  t18_concurrent_approvals")
    except Exception as e: failed += 1; print(f"FAIL  t18_concurrent_approvals: {e}"); traceback.print_exc(limit=3)
    print(f"\n{len(TESTS)+1-failed}/{len(TESTS)+1} passed"); sys.exit(1 if failed else 0)

if __name__ == "__main__": main()
