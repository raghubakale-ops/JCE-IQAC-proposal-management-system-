import { Link } from 'react-router-dom'
import type { Proposal } from '../types'
import { StatusBadge } from './ui'
import { fmtDate } from '../utils/format'

export function ProposalTable({ rows, showFaculty = true }: { rows: Proposal[]; showFaculty?: boolean }) {
  return (
    <div className="tablewrap"><table className="table">
      <thead><tr><th>Title</th>{showFaculty && <th>Faculty</th>}<th>Dept</th><th>Date</th><th>Status</th><th>Filing No.</th><th></th></tr></thead>
      <tbody>{rows.map((p) => (
        <tr key={p.id}>
          <td><Link to={`/proposals/${p.id}`}><b>{p.title}</b></Link><div className="small" style={{ color: 'var(--muted)' }}>{p.activity_type ?? ''}{p.category ? ` · ${p.category}` : ''}</div></td>
          {showFaculty && <td>{p.faculty_name}{p.author_role === 'hod' ? ' (HOD)' : ''}</td>}
          <td>{p.departments?.code ?? ''}</td><td>{fmtDate(p.proposed_date)}</td>
          <td><StatusBadge s={p.status} /></td><td className="mono">{p.filing_number ?? '—'}</td>
          <td><Link className="btn small" to={`/proposals/${p.id}`}>Open</Link></td>
        </tr>))}</tbody>
    </table></div>
  )
}
