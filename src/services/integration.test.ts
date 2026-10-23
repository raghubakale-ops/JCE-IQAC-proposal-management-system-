// Runs the REAL service modules against PostgREST + the real migrations (see supabase/tests/run_integration.sh).
// Skipped unless INTEGRATION_API_URL is set.
import { createHmac } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const API = process.env.INTEGRATION_API_URL
const SECRET = process.env.INTEGRATION_JWT_SECRET ?? ''
const state = vi.hoisted(() => ({ token: '' }))

vi.mock('../lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { configured: true, supabase: createClient(process.env.INTEGRATION_API_URL ?? 'http://127.0.0.1:1', 'anon', { accessToken: async () => state.token }) }
})

const IDS: Record<string, string> = { 'iqac@jainbgm.in': '00000000-0000-0000-0000-000000000001', 'fa@jainbgm.in': '00000000-0000-0000-0000-000000000002',
  'fb@jainbgm.in': '00000000-0000-0000-0000-000000000003', 'hod_cs@jainbgm.in': '00000000-0000-0000-0000-000000000004',
  'principal@jainbgm.in': '00000000-0000-0000-0000-000000000005', 'hod_ec@jainbgm.in': '00000000-0000-0000-0000-000000000006' }
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
function as(email: string) {
  const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ sub: IDS[email], email, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })
  state.token = `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`
}

describe.skipIf(!API)('service layer against the real database', () => {
  let S: typeof import('./proposals'), R: typeof import('./reports'), M: typeof import('./misc'), REF: typeof import('./reference')
  let E: typeof import('../lib/errors'), V: typeof import('../utils/validation')
  beforeAll(async () => { S = await import('./proposals'); R = await import('./reports'); M = await import('./misc'); REF = await import('./reference'); E = await import('../lib/errors'); V = await import('../utils/validation') })

  const form = () => ({ ...V.emptyProposal(), title: 'Deep Learning Workshop', category: 'Faculty Development', activity_type: 'Workshop', proposed_date: '2020-02-10',
    start_time: '10:00', end_time: '13:00', venue: 'Seminar Hall', objectives: 'o', description: 'd', expected_outcomes: 'e', declaration: true, total_budget: '5000', expected_participants: '60' })
  let pid = ''

  it('reference data loads', async () => {
    as('fa@jainbgm.in'); const s = await REF.loadSettings(); const d = await REF.loadDepartments()
    expect(s.filing_prefix).toBe('JCE/IQAC'); expect(s.report_review_mode).toBe('hod_then_iqac'); expect(d.length).toBeGreaterThanOrEqual(12)
  })
  it('faculty creates a draft, lists and opens it', async () => {
    as('fa@jainbgm.in'); const p = await S.saveDraft(null, form()); pid = p.id
    expect(p.status).toBe('draft'); expect(p.faculty_email).toBe('fa@jainbgm.in'); expect(p.departments?.code).toBe('CS')
    const q = await S.queryProposals({ q: 'deep', page: 1, pageSize: 10 }); expect(q.total).toBe(1)
    const d = await S.getProposalDetail(pid, false); expect(d.proposal.title).toBe('Deep Learning Workshop')
    expect(S.formFromProposal(d.proposal).start_time).toBe('10:00')
  })
  it('other faculty and other-department HOD cannot see it', async () => {
    as('fb@jainbgm.in'); expect((await S.queryProposals({})).total).toBe(0); await expect(S.getProposalDetail(pid, false)).rejects.toBeTruthy()
    await expect(S.saveDraft(pid, form())).rejects.toBeTruthy()
  })
  it('submit moves to HOD review; HOD sees it, other HOD does not', async () => {
    as('fa@jainbgm.in'); expect((await S.proposalAction('submit_proposal', pid)).status).toBe('hod_review')
    as('hod_ec@jainbgm.in'); expect((await S.queryProposals({ statuses: ['hod_review'] })).total).toBe(0)
    as('hod_cs@jainbgm.in'); expect((await S.queryProposals({ statuses: ['hod_review'] })).total).toBe(1)
  })
  it('return requires remarks (message is friendly), then correct and resubmit', async () => {
    as('hod_cs@jainbgm.in')
    const e = await S.proposalAction('hod_return', pid, '  ').catch((x) => x); expect(E.friendlyError(e)).toMatch(/remarks are mandatory/)
    expect((await S.proposalAction('hod_return', pid, 'Add budget breakup')).status).toBe('hod_returned')
    as('fa@jainbgm.in'); const edited = await S.saveDraft(pid, { ...form(), budget_details: 'Breakup' }); expect(edited.budget_details).toBe('Breakup')
    expect((await S.proposalAction('submit_proposal', pid)).revision_no).toBe(1)
    await expect(S.saveDraft(pid, form())).rejects.toBeTruthy()      // locked while under review
  })
  it('Principal cannot approve before HOD forwards; then approval issues the number', async () => {
    as('principal@jainbgm.in'); const early = await S.proposalAction('principal_approve', pid).catch((x) => x)
    expect(E.friendlyError(early)).toMatch(/not allowed in the current state|not found|forwarded/i)
    as('hod_cs@jainbgm.in'); expect((await S.proposalAction('hod_forward', pid, 'ok')).status).toBe('forwarded')
    as('principal@jainbgm.in'); expect((await S.queryProposals({ statuses: ['forwarded', 'principal_review'] })).total).toBe(1)
    const a = await S.proposalAction('principal_approve', pid, 'Approved'); expect(a.status).toBe('filed'); expect(a.filing_number).toBe('JCE/IQAC/2026-27/001')
    expect((await S.proposalAction('principal_approve', pid)).filing_number).toBe('JCE/IQAC/2026-27/001')   // retry safe
  })
  it('filing register, CSV exports and role scoping', async () => {
    as('iqac@jainbgm.in'); const f = await M.queryFiling({ page: 1 }); expect(f.total).toBe(1); expect(f.rows[0].proposals?.title).toBe('Deep Learning Workshop')
    const csv = await M.exportFilingCsv({}, () => 'CS'); expect(csv.count).toBe(1); expect(csv.csv).toContain('JCE/IQAC/2026-27/001')
    const pe = await S.exportProposalsCsv({}); expect(pe.csv).toContain('IQAC Filed')
    as('fb@jainbgm.in'); expect((await S.exportProposalsCsv({})).count).toBe(0); expect((await M.queryFiling({})).total).toBe(0)
    as('hod_ec@jainbgm.in'); expect((await M.queryFiling({})).total).toBe(0)
    as('iqac@jainbgm.in'); expect((await M.queryAudit({ action: 'filing' })).total).toBeGreaterThan(0)
    as('fa@jainbgm.in'); await expect(M.queryAudit({})).resolves.toMatchObject({ total: 0 })
  })
  it('notifications are private and can be marked read', async () => {
    as('fa@jainbgm.in'); const n = await M.listNotifications(); expect(n.length).toBeGreaterThanOrEqual(3); expect(await M.unreadCount()).toBe(n.filter((x) => !x.is_read).length)
    await M.markRead(); expect(await M.unreadCount()).toBe(0)
    as('fb@jainbgm.in'); expect((await M.listNotifications()).length).toBe(0)
  })
  it('report flow: start, save with expenses, required evidence enforced, HOD then IQAC', async () => {
    as('fa@jainbgm.in'); let b = await R.getReportBundle(pid); expect(b.report).toBeNull()
    const rep = await R.startReport(pid)
    const f = { ...V.emptyReport(), actual_date: '2020-02-10', actual_participants: '58', actual_expenditure: '4800', proceedings: 'p', outcomes: 'o' }
    await R.saveReport(rep.id, f, [{ head: 'Honorarium', amount: 3000 }, { head: 'Snacks', amount: 1800 }], [])
    b = await R.getReportBundle(pid); expect(b.expenses.length).toBe(2); expect(b.report?.actual_participants).toBe(58)
    const miss = await R.submitReport(rep.id).catch((x) => x); expect(E.friendlyError(miss)).toMatch(/attachment:final_report/)
    await R.saveReport(rep.id, f, [{ ...b.expenses[0], amount: 3100 }], b.expenses)            // update one, delete one
    expect((await R.getReportBundle(pid)).expenses.map((e) => Number(e.amount))).toEqual([3100])
    as('iqac@jainbgm.in'); await M.updateSetting('report_required_kinds', [])                   // policy change via admin service
    as('fa@jainbgm.in'); expect((await R.submitReport(rep.id)).status).toBe('submitted')
    as('iqac@jainbgm.in'); expect(E.friendlyError(await R.iqacReviewReport(rep.id, true).catch((x) => x))).toMatch(/not allowed|not awaiting/i)
    as('hod_ec@jainbgm.in'); await expect(R.hodReviewReport(rep.id, true)).rejects.toBeTruthy()
    as('hod_cs@jainbgm.in'); expect((await R.hodReviewReport(rep.id, true, 'good')).status).toBe('hod_verified')
    as('iqac@jainbgm.in'); expect((await R.iqacReviewReport(rep.id, true, 'verified')).status).toBe('verified')
    const comp = await R.listCompliance(); expect(comp[0].report_status).toBe('verified'); expect(comp[0].is_overdue).toBe(false)
  })
  it('administration: staff, grants, settings validation and audit', async () => {
    as('fa@jainbgm.in'); await expect(M.listStaff()).resolves.toEqual([]); await expect(M.upsertStaff({ email: 'x@jainbgm.in', full_name: 'X', role: 'iqac', dept_code: null, designation: '', employee_id: '', active: true })).rejects.toBeTruthy()
    as('iqac@jainbgm.in'); expect((await M.listStaff()).length).toBe(6)
    await M.upsertStaff({ email: 'new@jainbgm.in', full_name: 'New Person', role: 'faculty', dept_code: 'EC', designation: 'Lecturer', employee_id: 'E100', active: true })
    await M.setHodDepartment('hod_ec@jainbgm.in', 'CS', true); expect((await M.listHodGrants()).length).toBe(1)
    as('hod_ec@jainbgm.in'); expect((await S.queryProposals({})).total).toBe(1)               // now sees CS proposals
    as('iqac@jainbgm.in'); await M.setHodDepartment('hod_ec@jainbgm.in', 'CS', false)
    expect(E.friendlyError(await M.updateSetting('academic_year', '2027-29' as never).catch((x) => x))).toMatch(/2026-27/)
    expect(E.friendlyError(await M.upsertStaff({ email: 'iqac@jainbgm.in', full_name: 'I', role: 'faculty', dept_code: 'CS', designation: '', employee_id: '', active: true }).catch((x) => x))).toMatch(/at least one active IQAC/)
  })
  it('dashboards data respects RLS', async () => {
    as('iqac@jainbgm.in'); expect((await M.fetchLightProposals()).length).toBe(1)
    as('fb@jainbgm.in'); expect((await M.fetchLightProposals()).length).toBe(0)
  })
  it('network failure is reported, never as success', async () => {
    const dead = createClient('http://127.0.0.1:1', 'anon'); const r = await dead.from('proposals').select('*')
    expect(r.error).toBeTruthy(); expect(E.friendlyError(r.error)).toMatch(/Nothing was saved/)
  }, 30000)   // supabase-js retries failed reads with backoff before giving up
})
