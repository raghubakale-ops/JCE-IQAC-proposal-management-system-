import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useRef_ } from '../hooks/useReference'
import { useAsync } from '../hooks/useAsync'
import { fetchLightProposals } from '../services/misc'
import { listCompliance } from '../services/reports'
import { Empty, ErrorBox, Kpi, PageHead, Spinner, StatusBadge } from '../components/ui'
import { Donut } from '../components/Charts'
import { Timeline } from '../components/Timeline'
import { PENDING, STATUS_LABEL } from '../lib/constants'
import { fmtDate } from '../utils/format'
import type { ProposalStatus } from '../types'

export default function Dashboard() {
  const { profile } = useAuth(); const { settings, deptCode } = useRef_(); const nav = useNavigate()
  const data = useAsync(async () => ({ props: await fetchLightProposals(), comp: await listCompliance() }), [])
  if (data.loading) return <Spinner />
  if (data.error || !data.data || !profile) return <ErrorBox message={data.error ?? 'Failed to load'} onRetry={data.reload} />
  const { props, comp } = data.data
  const role = profile.role; const mode = settings?.report_review_mode
  const mine = props.filter((p) => p.faculty_id === profile.id)
  const by = (s: ProposalStatus[], list = props) => list.filter((p) => s.includes(p.status as ProposalStatus))
  const myComp = comp.filter((c) => props.some((p) => p.id === c.proposal_id && p.faculty_id === profile.id))
  const reportsDue = (list: typeof comp) => list.filter((c) => !c.report_status || c.report_status === 'draft' || c.report_status === 'returned')
  const hodQueue = by(['hod_review'])
  const prQueue = by(['forwarded', 'principal_review'])
  const hodReports = comp.filter((c) => c.report_status === 'submitted' && mode === 'hod_then_iqac')
  const iqacReports = comp.filter((c) => c.report_status === 'hod_verified' || (c.report_status === 'submitted' && mode === 'iqac'))
  const overdue = comp.filter((c) => c.is_overdue)
  const dist = (Object.keys(STATUS_LABEL) as ProposalStatus[]).map((s) => ({ name: STATUS_LABEL[s], value: props.filter((p) => p.status === s).length }))
  const go = (to: string) => () => nav(to)

  let cards: { label: string; value: number; sub: string; to?: string }[] = []
  if (role === 'faculty' || role === 'hod') cards = [
    { label: 'My proposals', value: mine.length, sub: 'All records', to: '/proposals' },
    { label: 'Drafts', value: by(['draft'], mine).length, sub: 'Not yet submitted' },
    { label: 'Pending review', value: by(PENDING, mine).length, sub: 'In the workflow' },
    { label: 'Need correction', value: by(['hod_returned', 'principal_returned'], mine).length, sub: 'Returned to you' },
    { label: 'Approved & filed', value: by(['filed'], mine).length, sub: 'IQAC numbers issued' },
    { label: 'Reports to submit', value: reportsDue(myComp).length, sub: 'After the activity', to: '/reports' }]
  if (role === 'hod') cards = [
    { label: 'Awaiting my review', value: hodQueue.length, sub: 'Department proposals', to: '/review' },
    { label: 'Returned by me', value: by(['hod_returned']).length, sub: 'With faculty' },
    { label: 'Forwarded', value: by(['forwarded', 'principal_review', 'filed', 'approved', 'principal_returned', 'disapproved']).filter((p) => p.author_role !== 'hod').length, sub: 'Reached the Principal' },
    { label: 'Reports to review', value: hodReports.length, sub: 'Post-event', to: '/reports' },
    { label: 'Overdue reports', value: overdue.length, sub: 'Department compliance', to: '/reports' },
    { label: 'My own proposals', value: mine.length, sub: 'Go directly to Principal', to: '/proposals' }]
  if (role === 'principal') cards = [
    { label: 'Awaiting decision', value: prQueue.length, sub: 'Forwarded by HODs', to: '/review' },
    { label: 'Approved & filed', value: by(['filed']).length, sub: 'Institution', to: '/filing' },
    { label: 'Returned', value: by(['principal_returned']).length, sub: 'For correction' },
    { label: 'Disapproved', value: by(['disapproved']).length, sub: 'Decisions' },
    { label: 'Total visible', value: props.length, sub: 'Reached Principal stage' },
    { label: 'Overdue reports', value: overdue.length, sub: 'Institution', to: '/reports' }]
  if (role === 'iqac') cards = [
    { label: 'Proposals', value: props.length, sub: 'Excluding drafts', to: '/proposals' },
    { label: 'Pending HOD', value: by(['hod_review']).length, sub: 'Awaiting review' },
    { label: 'Pending Principal', value: prQueue.length, sub: 'Awaiting decision' },
    { label: 'Filed', value: by(['filed']).length, sub: 'Official numbers', to: '/filing' },
    { label: 'Reports to verify', value: iqacReports.length, sub: 'Awaiting IQAC', to: '/reports' },
    { label: 'Overdue reports', value: overdue.length, sub: 'Past due date', to: '/reports' }]

  const attention = role === 'principal' ? prQueue : role === 'faculty' || role === 'hod' ? by(['hod_returned', 'principal_returned'], mine) : []
  const queueLink = (role === 'hod' && hodQueue.length > 0) || (role === 'principal' && prQueue.length > 0) || (role === 'iqac' && iqacReports.length > 0)
  const recent = (role === 'faculty' ? mine : props).slice(0, 8)
  return (
    <>
      <PageHead title={`Welcome, ${profile.full_name.split(' ')[0]}`} sub={`${settings?.institution_name} · Academic year ${settings?.academic_year}`}>
        {(role === 'faculty' || role === 'hod') && <Link className="btn primary" to="/proposals/new">New proposal</Link>}
      </PageHead>
      <div className="cards">{cards.map((c) => <Kpi key={c.label} label={c.label} value={c.value} sub={c.sub} onClick={c.to ? go(c.to) : undefined} />)}</div>
      <div className="grid2">
        <div className="card"><h3>Needs your attention</h3>
          {role === 'hod' && hodQueue.length > 0 && <p><Link to="/review">{hodQueue.length} proposal(s) awaiting your review →</Link></p>}
          {role === 'principal' && prQueue.length > 0 && <p><Link to="/review">{prQueue.length} proposal(s) awaiting your decision →</Link></p>}
          {role === 'iqac' && iqacReports.length > 0 && <p><Link to="/reports">{iqacReports.length} report(s) awaiting verification →</Link></p>}
          {attention.length === 0 && !queueLink
            ? <Empty>Nothing needs your attention right now.</Empty>
            : attention.slice(0, 6).map((p) => (
              <div className="filechip" key={p.id}><span><Link to={`/proposals/${p.id}`}><b>{p.title}</b></Link> <span className="hint">{deptCode(p.department_id)} · {fmtDate(p.proposed_date)}</span></span><StatusBadge s={p.status as ProposalStatus} /></div>))}
          <h3 style={{ marginTop: 18 }}>Recent proposals</h3>
          {recent.length === 0 ? <Empty>No proposals yet.</Empty> : recent.map((p) => (
            <div className="filechip" key={p.id}><span><Link to={`/proposals/${p.id}`}>{p.title}</Link> <span className="hint">{p.faculty_name}</span></span><StatusBadge s={p.status as ProposalStatus} /></div>))}
        </div>
        <div className="card"><h3>{role === 'faculty' ? 'My proposals by status' : 'Proposals by status'}</h3>
          {(role === 'faculty' ? mine : props).length === 0 ? <Empty>No data yet.</Empty> : <Donut data={role === 'faculty' ? (Object.keys(STATUS_LABEL) as ProposalStatus[]).map((s) => ({ name: STATUS_LABEL[s], value: mine.filter((p) => p.status === s).length })) : dist} />}
        </div>
      </div>
      <div className="card section"><h3>Approval workflow</h3>
        <Timeline steps={[{ title: 'Draft', state: 'done' }, { title: 'HOD review', state: 'done' }, { title: 'Principal review', state: 'done' }, { title: 'Approved', state: 'done' }, { title: 'IQAC filed', state: 'done' }]} />
        <p className="hint">HOD-authored proposals go directly to the Principal. After the activity, an activity report is submitted{mode === 'hod_then_iqac' ? ', reviewed by the HOD, then verified by IQAC' : mode === 'iqac' ? ' and verified by IQAC' : ''}.</p></div>
    </>
  )
}
