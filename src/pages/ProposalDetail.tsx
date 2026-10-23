import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useRef_ } from '../hooks/useReference'
import { useAsync } from '../hooks/useAsync'
import { useToast } from '../hooks/useToast'
import { deleteDraft, getProposalDetail, proposalAction } from '../services/proposals'
import { Banner, ConfirmDialog, ErrorBox, PageHead, Spinner, StatusBadge } from '../components/ui'
import { ReadBlock } from '../components/fields'
import { AttachmentList } from '../components/Attachments'
import { Timeline, type Step } from '../components/Timeline'
import { EDITABLE, STATUS_LABEL } from '../lib/constants'
import { friendlyError } from '../lib/errors'
import { fmtDate, fmtDateTime, hhmm, inr } from '../utils/format'

type Dlg = null | { kind: 'forward' | 'hodreturn' | 'start' | 'approve' | 'preturn' | 'disapprove' | 'delete' }

export default function ProposalDetail() {
  const { id } = useParams(); const nav = useNavigate(); const toast = useToast()
  const { profile } = useAuth(); const { deptName } = useRef_()
  const [dlg, setDlg] = useState<Dlg>(null)
  const res = useAsync(() => getProposalDetail(id!, profile!.role === 'iqac'), [id])
  if (res.loading) return <Spinner />
  if (res.error || !res.data) return <ErrorBox message={res.error ?? 'Failed to load'} onRetry={res.reload} />
  const { proposal: p, attachments, actions, audit } = res.data
  const role = profile!.role; const own = p.faculty_id === profile!.id
  const hodAuthored = p.author_role === 'hod'
  const run = (fn: Parameters<typeof proposalAction>[0], msg: string, remarks?: string) => async (r: string) => {
    await proposalAction(fn, p.id, remarks === undefined ? undefined : r); toast(msg, 'success'); setDlg(null); res.reload()
  }
  const steps: Step[] = [
    { title: 'Submitted', at: p.submitted_at },
    hodAuthored ? { title: 'HOD review', state: 'done', note: 'Not required (HOD-authored)' } : { title: p.status === 'hod_returned' ? 'Returned by HOD' : 'HOD review', at: p.hod_reviewed_at, state: p.status === 'hod_review' ? 'current' : undefined },
    { title: p.status === 'disapproved' ? 'Disapproved' : p.status === 'principal_returned' ? 'Returned by Principal' : 'Principal decision', at: p.principal_reviewed_at, state: ['forwarded', 'principal_review'].includes(p.status) ? 'current' : undefined },
    { title: 'Approved', at: p.approved_at },
    { title: 'IQAC filed', at: p.status === 'filed' ? p.approved_at : null, note: p.filing_number ?? undefined },
  ]
  const canEdit = own && EDITABLE.includes(p.status) && (role === 'faculty' || role === 'hod')
  const hodCanAct = role === 'hod' && !own && p.status === 'hod_review'
  const prCanAct = role === 'principal' && !own && ['forwarded', 'principal_review'].includes(p.status)
  const returnedNote = p.status === 'hod_returned' ? p.hod_remarks : p.status === 'principal_returned' ? p.principal_remarks : p.status === 'disapproved' ? p.principal_remarks : null

  return (
    <>
      <PageHead title={p.title} sub={`${p.faculty_name} · ${deptName(p.department_id)} · revision ${p.revision_no}`}>
        <StatusBadge s={p.status} />
        {canEdit && <Link className="btn primary" to={`/proposals/${p.id}/edit`}>{p.status === 'draft' ? 'Edit draft' : 'Correct & resubmit'}</Link>}
        {canEdit && p.status === 'draft' && <button className="btn bad" onClick={() => setDlg({ kind: 'delete' })}>Delete draft</button>}
        {hodCanAct && <><button className="btn good" onClick={() => setDlg({ kind: 'forward' })}>Forward to Principal</button><button className="btn warn" onClick={() => setDlg({ kind: 'hodreturn' })}>Return</button></>}
        {prCanAct && <>
          {p.status === 'forwarded' && <button className="btn" onClick={() => setDlg({ kind: 'start' })}>Start review</button>}
          <button className="btn good" onClick={() => setDlg({ kind: 'approve' })}>Approve</button>
          <button className="btn warn" onClick={() => setDlg({ kind: 'preturn' })}>Return</button>
          <button className="btn bad" onClick={() => setDlg({ kind: 'disapprove' })}>Disapprove</button></>}
        {p.status === 'filed' && <Link className="btn" to={`/reports/${p.id}`}>Activity report</Link>}
        <button className="btn" onClick={() => window.print()}>Print</button>
      </PageHead>

      {p.filing_number && <div className="card" style={{ marginBottom: 14 }}><div className="small" style={{ color: 'var(--muted)' }}>Official IQAC filing number</div><div className="filing mono">{p.filing_number}</div></div>}
      {returnedNote && <Banner tone="warn"><b>{STATUS_LABEL[p.status]}:</b> {returnedNote}</Banner>}
      {hodAuthored && p.status !== 'draft' && <Banner tone="info">HOD-authored proposal: routed directly to the Principal.</Banner>}

      <div className="card"><h3>Progress</h3><Timeline steps={steps} /></div>
      <div className="card section"><h3>Activity details</h3>
        <div className="formgrid">
          <ReadBlock label="Category" value={p.category} /><ReadBlock label="Activity type" value={p.activity_type} />
          <ReadBlock label="Proposed date" value={fmtDate(p.proposed_date)} /><ReadBlock label="Time" value={p.start_time ? `${hhmm(p.start_time)} – ${hhmm(p.end_time)}` : '—'} />
          <ReadBlock label="Venue" value={p.venue} /><ReadBlock label="Target participants" value={p.target_participants} />
          <ReadBlock label="Expected participants" value={p.expected_participants} /><ReadBlock label="Compliance mapping" value={p.compliance_mapping} />
          <ReadBlock full label="Objectives" value={p.objectives} /><ReadBlock full label="Description" value={p.description} />
          <ReadBlock full label="Expected outcomes" value={p.expected_outcomes} /><ReadBlock label="Academic relevance" value={p.academic_relevance} /><ReadBlock label="IQAC relevance" value={p.iqac_relevance} />
        </div></div>
      <div className="card section"><h3>Budget and resource person</h3>
        <div className="formgrid">
          <ReadBlock label="Estimated expenditure" value={inr(p.total_budget)} /><ReadBlock label="Funding source" value={p.funding_source} />
          <ReadBlock full label="Budget details" value={p.budget_details} />
          <ReadBlock label="Resource person" value={p.resource_name} /><ReadBlock label="Organisation" value={p.resource_org} /><ReadBlock label="Expertise" value={p.resource_expertise} />
          <ReadBlock label="Honorarium" value={p.resource_honorarium === null ? '—' : inr(p.resource_honorarium)} />
          <ReadBlock label="Travel" value={p.resource_travel === null ? '—' : inr(p.resource_travel)} /><ReadBlock label="Accommodation" value={p.resource_accommodation === null ? '—' : inr(p.resource_accommodation)} />
        </div></div>
      <div className="card section"><h3>Supporting documents</h3><AttachmentList items={attachments} bucket="proposal-docs" /></div>
      <div className="card section"><h3>Workflow history</h3>
        {actions.length === 0 ? <div className="hint">No workflow actions yet.</div> :
          <div className="tablewrap"><table className="table"><thead><tr><th>When</th><th>By</th><th>Action</th><th>Status change</th><th>Remarks</th></tr></thead>
            <tbody>{actions.map((a) => <tr key={a.id}><td>{fmtDateTime(a.created_at)}</td><td>{a.actor_name}<div className="small">{a.actor_role}</div></td><td>{a.action.replace(/_/g, ' ')}</td>
              <td>{a.from_status ? STATUS_LABEL[a.from_status] : '—'} → {STATUS_LABEL[a.to_status]}</td><td>{a.remarks ?? ''}</td></tr>)}</tbody></table></div>}
      </div>
      {role === 'iqac' && <div className="card section"><h3>Audit trail</h3>
        <div className="tablewrap"><table className="table"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>{audit.map((a) => <tr key={a.id}><td>{fmtDateTime(a.created_at)}</td><td>{a.actor_email ?? 'system'}</td><td>{a.action}</td><td className="small mono">{JSON.stringify(a.details)}</td></tr>)}</tbody></table></div></div>}

      {dlg?.kind === 'forward' && <ConfirmDialog title="Forward to Principal" confirmLabel="Forward" tone="good" remarks="optional" onClose={() => setDlg(null)} onConfirm={run('hod_forward', 'Forwarded to the Principal.', '')} message="The proposal will move to the Principal for the final decision." />}
      {dlg?.kind === 'hodreturn' && <ConfirmDialog title="Return to faculty" confirmLabel="Return" tone="warn" remarks="required" onClose={() => setDlg(null)} onConfirm={run('hod_return', 'Returned to the faculty member.', '')} message="Explain what must be corrected." />}
      {dlg?.kind === 'start' && <ConfirmDialog title="Start Principal review" confirmLabel="Start review" onClose={() => setDlg(null)} onConfirm={run('principal_start_review', 'Review started.')} />}
      {dlg?.kind === 'approve' && <ConfirmDialog title="Approve proposal" confirmLabel="Approve and generate filing number" tone="good" remarks="optional" onClose={() => setDlg(null)}
        onConfirm={async (r) => { const out = await proposalAction('principal_approve', p.id, r); toast(`Approved. Filing number ${out.filing_number}`, 'success'); setDlg(null); res.reload() }}
        message="Approval is final and issues the official IQAC filing number. The number is permanent." />}
      {dlg?.kind === 'preturn' && <ConfirmDialog title="Return for correction" confirmLabel="Return" tone="warn" remarks="required" onClose={() => setDlg(null)} onConfirm={run('principal_return', 'Returned for correction.', '')} message="The faculty member will correct it and resubmit it to the HOD." />}
      {dlg?.kind === 'disapprove' && <ConfirmDialog title="Disapprove proposal" confirmLabel="Disapprove" tone="bad" remarks="required" onClose={() => setDlg(null)} onConfirm={run('principal_disapprove', 'Proposal disapproved.', '')} message="Disapproval is final. Please record the reason." />}
      {dlg?.kind === 'delete' && <ConfirmDialog title="Delete draft" confirmLabel="Delete" tone="bad" onClose={() => setDlg(null)}
        onConfirm={async () => { try { await deleteDraft(p.id); toast('Draft deleted.', 'success'); nav('/proposals') } catch (e) { throw new Error(friendlyError(e)) } }} message="This permanently deletes the draft." />}
    </>
  )
}
