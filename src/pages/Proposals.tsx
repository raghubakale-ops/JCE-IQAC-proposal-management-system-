import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useRef_ } from '../hooks/useReference'
import { useAsync } from '../hooks/useAsync'
import { useToast } from '../hooks/useToast'
import { exportProposalsCsv, queryProposals, type ProposalFilters } from '../services/proposals'
import { Empty, ErrorBox, PageHead, Pager, Spinner } from '../components/ui'
import { ProposalTable } from '../components/ProposalTable'
import { CATEGORIES, STATUS_LABEL } from '../lib/constants'
import { friendlyError } from '../lib/errors'
import { academicYearOptions, academicYearRange } from '../utils/format'
import { downloadText } from '../utils/csv'
import type { ProposalStatus } from '../types'

const PAGE = 15
export default function Proposals() {
  const { profile } = useAuth(); const { departments } = useRef_(); const toast = useToast()
  const role = profile!.role
  const [scope, setScope] = useState<'mine' | 'all'>(role === 'faculty' ? 'mine' : 'all')
  const [q, setQ] = useState(''); const [dq, setDq] = useState(''); const [status, setStatus] = useState(''); const [dept, setDept] = useState('')
  const [cat, setCat] = useState(''); const [ay, setAy] = useState(''); const [page, setPage] = useState(1); const [busy, setBusy] = useState(false)
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1) }, 350); return () => clearTimeout(t) }, [q])
  const filters = useMemo<ProposalFilters>(() => {
    const [from, to] = ay ? academicYearRange(ay) : [undefined, undefined]
    return { q: dq, statuses: status ? [status as ProposalStatus] : undefined, department_id: dept || undefined, category: cat || undefined, from, to,
      facultyId: scope === 'mine' ? profile!.id : undefined }
  }, [dq, status, dept, cat, ay, scope, profile])
  const res = useAsync(() => queryProposals({ ...filters, page, pageSize: PAGE }), [filters, page])
  const reset = () => { setQ(''); setStatus(''); setDept(''); setCat(''); setAy(''); setPage(1) }
  const exportCsv = async () => {
    setBusy(true)
    try { const { csv, count } = await exportProposalsCsv(filters); downloadText(`proposals-${new Date().toISOString().slice(0, 10)}.csv`, csv); toast(`Exported ${count} record(s).`, 'success') }
    catch (e) { toast(friendlyError(e), 'error') } finally { setBusy(false) }
  }
  return (
    <>
      <PageHead title="Proposals" sub={scope === 'mine' ? 'Proposals you created' : role === 'hod' ? 'Proposals from your department(s)' : 'Institutional proposals'}>
        <button className="btn" onClick={exportCsv} disabled={busy}>{busy ? 'Exporting…' : 'Export CSV'}</button>
        <button className="btn" onClick={() => window.print()}>Print</button>
        {(role === 'faculty' || role === 'hod') && <Link className="btn primary" to="/proposals/new">New proposal</Link>}
      </PageHead>
      {role === 'hod' && (
        <div className="tabs no-print" role="tablist">
          <button role="tab" aria-selected={scope === 'all'} onClick={() => { setScope('all'); setPage(1) }}>Department</button>
          <button role="tab" aria-selected={scope === 'mine'} onClick={() => { setScope('mine'); setPage(1) }}>My own proposals</button>
        </div>)}
      <div className="card">
        <div className="toolbar no-print">
          <input aria-label="Search" placeholder="Search title, faculty or filing number" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: '1 1 220px' }} />
          <select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}><option value="">All statuses</option>
            {(Object.keys(STATUS_LABEL) as ProposalStatus[]).filter((s) => role === 'faculty' || role === 'hod' || s !== 'draft').map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
          {role !== 'faculty' && scope === 'all' && <select aria-label="Department" value={dept} onChange={(e) => { setDept(e.target.value); setPage(1) }}><option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}</select>}
          <select aria-label="Category" value={cat} onChange={(e) => { setCat(e.target.value); setPage(1) }}><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          <select aria-label="Academic year" value={ay} onChange={(e) => { setAy(e.target.value); setPage(1) }}><option value="">All years</option>{academicYearOptions().map((y) => <option key={y}>{y}</option>)}</select>
          <button className="btn" onClick={reset}>Reset</button>
        </div>
        {res.loading ? <Spinner /> : res.error ? <ErrorBox message={res.error} onRetry={res.reload} />
          : !res.data || res.data.rows.length === 0
            ? <Empty>No proposals match these filters.{(role === 'faculty' || role === 'hod') && scope === 'mine' && <> <Link to="/proposals/new">Create your first proposal</Link>.</>}</Empty>
            : <><ProposalTable rows={res.data.rows} showFaculty={scope !== 'mine'} /><Pager page={page} pageSize={PAGE} total={res.data.total} onPage={setPage} /></>}
      </div>
    </>
  )
}
