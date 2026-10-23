import { useMemo, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useRef_ } from '../hooks/useReference'
import { useAsync } from '../hooks/useAsync'
import { fetchLightProposals } from '../services/misc'
import { listCompliance } from '../services/reports'
import { Empty, ErrorBox, Kpi, PageHead, Spinner } from '../components/ui'
import { Bars, Donut, Trend } from '../components/Charts'
import { CATEGORIES, STATUS_LABEL } from '../lib/constants'
import { academicYearOf, academicYearOptions } from '../utils/format'
import { downloadText, toCsv } from '../utils/csv'
import type { ProposalStatus } from '../types'

export default function Analytics() {
  const { profile } = useAuth(); const { departments, deptCode } = useRef_()
  const res = useAsync(async () => ({ props: await fetchLightProposals(), comp: await listCompliance() }), [])
  const [ay, setAy] = useState(''); const [dept, setDept] = useState(''); const [cat, setCat] = useState(''); const [status, setStatus] = useState('')
  const a = useMemo(() => {
    if (!res.data) return null
    const props = res.data.props.filter((p) => p.status !== 'draft' &&
      (!ay || (p.proposed_date && academicYearOf(p.proposed_date) === ay)) && (!dept || p.department_id === dept) && (!cat || p.category === cat) && (!status || p.status === status))
    const comp = res.data.comp.filter((c) => (!ay || (c.proposed_date && academicYearOf(c.proposed_date) === ay)) && (!dept || c.department_id === dept))
    const cnt = <T,>(items: T[], key: (x: T) => string) => { const m = new Map<string, number>(); items.forEach((i) => m.set(key(i), (m.get(key(i)) ?? 0) + 1)); return m }
    const monthly = [...cnt(props, (p) => (p.proposed_date ?? p.created_at).slice(0, 7))].sort(([x], [y]) => x.localeCompare(y)).map(([name, value]) => ({ name, value }))
    const days = props.filter((p) => p.submitted_at && p.approved_at).map((p) => (new Date(p.approved_at!).getTime() - new Date(p.submitted_at!).getTime()) / 86400000)
    const reported = (s: string | null) => s === 'submitted' || s === 'hod_verified' || s === 'verified'
    const compliance = departments.map((d) => { const rows = comp.filter((c) => c.department_id === d.id)
      return { dept: d.code, filed: rows.length, reported: rows.filter((r) => reported(r.report_status)).length, overdue: rows.filter((r) => r.is_overdue).length } }).filter((r) => r.filed > 0)
    return { props, comp, monthly, compliance, avgDays: days.length ? days.reduce((s, x) => s + x, 0) / days.length : null,
      byStatus: (Object.keys(STATUS_LABEL) as ProposalStatus[]).map((s) => ({ name: STATUS_LABEL[s], value: props.filter((p) => p.status === s).length })),
      byDept: [...cnt(props, (p) => deptCode(p.department_id))].map(([name, value]) => ({ name, value })).sort((x, y) => y.value - x.value),
      byCat: [...cnt(props, (p) => p.category ?? 'Uncategorised')].map(([name, value]) => ({ name, value })) }
  }, [res.data, ay, dept, cat, status, departments, deptCode])
  if (res.loading) return <Spinner />
  if (res.error || !a) return <ErrorBox message={res.error ?? 'Failed'} onRetry={res.reload} />
  const n = (s: ProposalStatus[]) => a.props.filter((p) => s.includes(p.status as ProposalStatus)).length
  const exportCsv = () => downloadText('department-compliance.csv', toCsv([{ key: 'dept', label: 'Department' }, { key: 'filed', label: 'Filed activities' }, { key: 'reported', label: 'Reports submitted' }, { key: 'overdue', label: 'Overdue' }, { key: 'pct', label: 'Compliance %' }],
    a.compliance.map((c) => ({ ...c, pct: c.filed ? Math.round((c.reported / c.filed) * 100) : 0 }))))
  return (
    <>
      <PageHead title="Analytics" sub={profile!.role === 'hod' ? 'Your department(s)' : 'Institution-wide, drawn from live records'}><button className="btn" onClick={exportCsv} disabled={!a.compliance.length}>Export compliance CSV</button><button className="btn" onClick={() => window.print()}>Print</button></PageHead>
      <div className="card" style={{ marginBottom: 14 }}><div className="toolbar no-print" style={{ margin: 0 }}>
        <select aria-label="Academic year" value={ay} onChange={(e) => setAy(e.target.value)}><option value="">All academic years</option>{academicYearOptions().map((y) => <option key={y}>{y}</option>)}</select>
        {profile!.role !== 'hod' && <select aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}</select>}
        <select aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{(Object.keys(STATUS_LABEL) as ProposalStatus[]).filter((s) => s !== 'draft').map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
        <button className="btn" onClick={() => { setAy(''); setDept(''); setCat(''); setStatus('') }}>Reset</button></div></div>
      {a.props.length === 0 ? <div className="card"><Empty>No proposals match these filters.</Empty></div> : <>
        <div className="cards">
          <Kpi label="Proposals" value={a.props.length} sub="Submitted or later" /><Kpi label="Pending HOD" value={n(['hod_review'])} sub="Awaiting review" /><Kpi label="Pending Principal" value={n(['forwarded', 'principal_review'])} sub="Awaiting decision" />
          <Kpi label="Filed" value={n(['filed'])} sub="Numbers issued" /><Kpi label="Avg. approval time" value={a.avgDays === null ? '—' : a.avgDays.toFixed(1) + ' d'} sub="Submission → approval" />
          <Kpi label="Reports overdue" value={a.comp.filter((c) => c.is_overdue).length} sub={`${a.comp.filter((c) => c.report_status === null || c.report_status === 'draft' || c.report_status === 'returned').length} not yet submitted`} /></div>
        <div className="grid2"><div className="card"><h3>By status</h3><Donut data={a.byStatus} /></div><div className="card"><h3>By department</h3><Bars data={a.byDept} /></div></div>
        <div className="grid2 section"><div className="card"><h3>By category</h3><Bars data={a.byCat} horizontal color="#0e2340" /></div><div className="card"><h3>Activities by month</h3><Trend data={a.monthly} /></div></div>
        <div className="card section"><h3>Report compliance by department</h3>{a.compliance.length === 0 ? <Empty>No filed activities in this selection.</Empty> :
          <div className="tablewrap"><table className="table"><thead><tr><th>Department</th><th>Filed activities</th><th>Reports submitted</th><th>Overdue</th><th>Compliance</th></tr></thead>
            <tbody>{a.compliance.map((c) => <tr key={c.dept}><td>{c.dept}</td><td>{c.filed}</td><td>{c.reported}</td><td>{c.overdue}</td><td>{Math.round((c.reported / c.filed) * 100)}%</td></tr>)}</tbody></table></div>}</div></>}
    </>
  )
}
