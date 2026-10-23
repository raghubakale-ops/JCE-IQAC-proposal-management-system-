import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useRef_ } from '../hooks/useReference'
import { useAsync } from '../hooks/useAsync'
import { listCompliance } from '../services/reports'
import { Empty, ErrorBox, PageHead, Pager, ReportBadge, Spinner } from '../components/ui'
import { REPORT_LABEL } from '../lib/constants'
import { fmtDate } from '../utils/format'
import { downloadText, toCsv } from '../utils/csv'
import type { ComplianceRow, ReportStatus } from '../types'

const PAGE = 15
export default function Reports() {
  const { profile } = useAuth(); const { departments, deptCode, settings } = useRef_()
  const res = useAsync(listCompliance, [])
  const [q, setQ] = useState(''); const [st, setSt] = useState(''); const [dept, setDept] = useState(''); const [overdue, setOverdue] = useState(false)
  const [mine, setMine] = useState(false); const [page, setPage] = useState(1)
  const role = profile!.role; const mode = settings?.report_review_mode
  const awaiting = (r: ComplianceRow) => (role === 'hod' ? mode === 'hod_then_iqac' && r.report_status === 'submitted'
    : role === 'iqac' ? r.report_status === 'hod_verified' || (mode === 'iqac' && r.report_status === 'submitted') : false)
  const rows = useMemo(() => (res.data ?? []).filter((r) => {
    if (q && !(`${r.title} ${r.filing_number ?? ''}`.toLowerCase().includes(q.toLowerCase()))) return false
    if (st === 'none' ? r.report_status !== null : st && r.report_status !== st) return false
    if (dept && r.department_id !== dept) return false
    if (overdue && !r.is_overdue) return false
    if (mine && !awaiting(r)) return false
    return true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [res.data, q, st, dept, overdue, mine, role, mode])
  const queue = (res.data ?? []).filter(awaiting).length
  const exportCsv = () => downloadText('activity-reports.csv', toCsv(
    [{ key: 'filing_number', label: 'Filing Number' }, { key: 'title', label: 'Proposal' }, { key: 'dept', label: 'Department' }, { key: 'proposed_date', label: 'Activity Date' },
      { key: 'due', label: 'Report Due' }, { key: 'status', label: 'Report Status' }, { key: 'overdue', label: 'Overdue' }],
    rows.map((r) => ({ ...r, dept: deptCode(r.department_id), due: r.report_due_date, status: REPORT_LABEL[r.report_status ?? 'none'], overdue: r.is_overdue ? 'Yes' : 'No' }))))
  return (
    <>
      <PageHead title="Activity reports" sub="Post-event reports for approved and filed proposals">
        <button className="btn" onClick={exportCsv} disabled={!rows.length}>Export CSV</button><button className="btn" onClick={() => window.print()}>Print</button>
      </PageHead>
      {(role === 'hod' || role === 'iqac') && queue > 0 && <div className="banner info">{queue} report(s) are waiting for your review. <button className="btn link" onClick={() => { setMine(true); setPage(1) }}>Show only these</button></div>}
      <div className="card">
        <div className="toolbar no-print">
          <input aria-label="Search" placeholder="Search proposal or filing number" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} style={{ flex: '1 1 220px' }} />
          <select aria-label="Report status" value={st} onChange={(e) => { setSt(e.target.value); setPage(1) }}><option value="">All report statuses</option>
            {(Object.keys(REPORT_LABEL) as (ReportStatus | 'none')[]).map((s) => <option key={s} value={s}>{REPORT_LABEL[s]}</option>)}</select>
          {role !== 'faculty' && <select aria-label="Department" value={dept} onChange={(e) => { setDept(e.target.value); setPage(1) }}><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}</select>}
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}><input type="checkbox" checked={overdue} onChange={(e) => { setOverdue(e.target.checked); setPage(1) }} />Overdue only</label>
          {mine && <button className="btn small" onClick={() => setMine(false)}>Clear “awaiting me”</button>}
        </div>
        {res.loading ? <Spinner /> : res.error ? <ErrorBox message={res.error} onRetry={res.reload} /> : rows.length === 0 ? <Empty>No reports match.</Empty> : (
          <><div className="tablewrap"><table className="table"><thead><tr><th>Filing No.</th><th>Proposal</th><th>Dept</th><th>Activity date</th><th>Report due</th><th>Status</th><th></th></tr></thead>
            <tbody>{rows.slice((page - 1) * PAGE, page * PAGE).map((r) => (
              <tr key={r.proposal_id}><td className="mono">{r.filing_number}</td><td><Link to={`/proposals/${r.proposal_id}`}>{r.title}</Link></td><td>{deptCode(r.department_id)}</td>
                <td>{fmtDate(r.proposed_date)}</td><td>{fmtDate(r.report_due_date)}{r.is_overdue && <span className="badge returned" style={{ marginLeft: 6 }}>Overdue</span>}</td>
                <td><ReportBadge s={r.report_status} /></td><td><Link className="btn small" to={`/reports/${r.proposal_id}`}>{awaiting(r) ? 'Review' : 'Open'}</Link></td></tr>))}</tbody></table></div>
            <Pager page={page} pageSize={PAGE} total={rows.length} onPage={setPage} /></>)}
      </div>
    </>
  )
}
