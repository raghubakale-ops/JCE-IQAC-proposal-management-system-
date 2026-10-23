import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useRef_ } from '../hooks/useReference'
import { useAsync } from '../hooks/useAsync'
import { useToast } from '../hooks/useToast'
import { exportFilingCsv, queryFiling, type FilingFilters } from '../services/misc'
import { Empty, ErrorBox, PageHead, Pager, Spinner, StatusBadge } from '../components/ui'
import { friendlyError } from '../lib/errors'
import { academicYearOptions, fmtDate, fmtDateTime } from '../utils/format'
import { downloadText } from '../utils/csv'

const PAGE = 20
export default function Filing() {
  const { departments, deptCode, deptName, settings } = useRef_(); const toast = useToast()
  const [q, setQ] = useState(''); const [dq, setDq] = useState(''); const [ay, setAy] = useState(''); const [dept, setDept] = useState(''); const [page, setPage] = useState(1)
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1) }, 350); return () => clearTimeout(t) }, [q])
  const f = useMemo<FilingFilters>(() => ({ q: dq, academic_year: ay || undefined, department_id: dept || undefined }), [dq, ay, dept])
  const res = useAsync(() => queryFiling({ ...f, page, pageSize: PAGE }), [f, page])
  const years = Array.from(new Set([settings?.academic_year ?? '', ...academicYearOptions()])).filter(Boolean)
  const exp = async () => { try { const { csv, count } = await exportFilingCsv(f, deptName); downloadText('iqac-filing-register.csv', csv); toast(`Exported ${count} entries.`, 'success') } catch (e) { toast(friendlyError(e), 'error') } }
  return (
    <>
      <PageHead title="IQAC filing register" sub="Official filing numbers issued after Principal approval. Entries are permanent.">
        <button className="btn" onClick={exp}>Export CSV</button><button className="btn" onClick={() => window.print()}>Print</button>
      </PageHead>
      <div className="card">
        <div className="toolbar no-print">
          <input aria-label="Search filing number" placeholder="Search filing number" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: '1 1 220px' }} />
          <select aria-label="Academic year" value={ay} onChange={(e) => { setAy(e.target.value); setPage(1) }}><option value="">All academic years</option>{years.map((y) => <option key={y}>{y}</option>)}</select>
          <select aria-label="Department" value={dept} onChange={(e) => { setDept(e.target.value); setPage(1) }}><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}</select>
        </div>
        {res.loading ? <Spinner /> : res.error ? <ErrorBox message={res.error} onRetry={res.reload} /> : !res.data?.rows.length ? <Empty>No filing entries yet.</Empty> : (
          <><div className="tablewrap"><table className="table"><thead><tr><th>Filing No.</th><th>Year</th><th>Proposal</th><th>Faculty</th><th>Dept</th><th>Approved</th><th>Generated</th><th>Status</th></tr></thead>
            <tbody>{res.data.rows.map((r) => (
              <tr key={r.id}><td className="mono"><b>{r.filing_number}</b></td><td>{r.academic_year}</td><td><Link to={`/proposals/${r.proposal_id}`}>{r.proposals?.title}</Link></td>
                <td>{r.proposals?.faculty_name}</td><td>{deptCode(r.proposals?.department_id)}</td><td>{fmtDate(r.proposals?.approved_at)}</td><td>{fmtDateTime(r.generated_at)}</td>
                <td>{r.proposals && <StatusBadge s={r.proposals.status} />}</td></tr>))}</tbody></table></div>
            <Pager page={page} pageSize={PAGE} total={res.data.total} onPage={setPage} /></>)}
      </div>
    </>
  )
}
