import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useRef_ } from '../hooks/useReference'
import { useAsync } from '../hooks/useAsync'
import { useToast } from '../hooks/useToast'
import { getReportBundle, hodReviewReport, iqacReviewReport, reportFormFrom, saveReport, startReport, submitReport } from '../services/reports'
import { uploadAttachment } from '../services/attachments'
import { Banner, ConfirmDialog, ErrorBox, PageHead, Empty, ReportBadge, Spinner } from '../components/ui'
import { Area, ReadBlock, Text } from '../components/fields'
import { AttachmentList, FilePicker } from '../components/Attachments'
import { KIND_LABEL, MAX_REPORT_FILES } from '../lib/constants'
import { friendlyError } from '../lib/errors'
import { fmtDate, fmtDateTime, hhmm, inr } from '../utils/format'
import { emptyReport, validateReport, type Errors, type ReportForm } from '../utils/validation'
import type { AttachmentKind, ReportExpense } from '../types'

const KINDS: AttachmentKind[] = ['final_report', 'attendance_sheet', 'photograph', 'brochure', 'feedback_summary', 'bill_receipt', 'certificate', 'other']
type Dlg = null | 'submit' | 'hodverify' | 'hodreturn' | 'verify' | 'return'

export default function ReportPage() {
  const { proposalId } = useParams(); const nav = useNavigate(); const toast = useToast()
  const { profile } = useAuth(); const { settings } = useRef_()
  const res = useAsync(() => getReportBundle(proposalId!), [proposalId])
  const [form, setForm] = useState<ReportForm>(emptyReport()); const [exp, setExp] = useState<ReportExpense[]>([]); const [errors, setErrors] = useState<Errors<ReportForm>>({})
  const [busy, setBusy] = useState(false); const [dlg, setDlg] = useState<Dlg>(null); const [err, setErr] = useState<string | null>(null)
  const rid = res.data?.report?.id
  useEffect(() => { if (res.data?.report) { setForm(reportFormFrom(res.data.report)); setExp(res.data.expenses.map((e) => ({ ...e }))) } }, [rid, res.data?.report?.status, res.data?.report?.revision_no])  // eslint-disable-line react-hooks/exhaustive-deps

  if (res.loading) return <Spinner />
  if (res.error || !res.data) return <ErrorBox message={res.error ?? 'Failed'} onRetry={res.reload} />
  const { proposal: p, report, expenses, attachments, actions } = res.data
  const role = profile!.role; const mode = settings?.report_review_mode ?? 'hod_then_iqac'
  const own = p.faculty_id === profile!.id
  const editable = own && !!report && ['draft', 'returned'].includes(report.status)
  const hodReview = role === 'hod' && !own && mode === 'hod_then_iqac' && report?.status === 'submitted'
  const iqacReview = role === 'iqac' && !!report && (report.status === 'hod_verified' || (mode === 'iqac' && report.status === 'submitted'))
  const required = settings?.report_required_kinds ?? []
  const have = new Set(attachments.map((a) => a.kind))
  const set = <K extends keyof ReportForm>(k: K, v: string) => { setForm((f) => ({ ...f, [k]: v })); if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined })) }
  const breakdown = exp.reduce((s, e) => s + (Number(e.amount) || 0), 0)

  const persist = async (forSubmit: boolean) => {
    const errs = validateReport(form, forSubmit); setErrors(errs)
    if (Object.keys(errs).length) { setErr(`Please fix ${Object.keys(errs).length} highlighted field(s).`); return false }
    setErr(null); await saveReport(report!.id, form, exp.filter((e) => e.head.trim()), expenses); return true
  }
  const onSave = async () => { setBusy(true); try { if (await persist(false)) { toast('Report draft saved.', 'success'); res.reload() } } catch (e) { setErr(friendlyError(e)) } finally { setBusy(false) } }
  const onSubmit = async () => {
    setBusy(true)
    try { if (!(await persist(true))) return
      const miss = required.filter((k) => !have.has(k)); if (miss.length) { setErr(`Upload the required evidence first: ${miss.map((k) => KIND_LABEL[k]).join(', ')}.`); return }
      setDlg('submit') } catch (e) { setErr(friendlyError(e)) } finally { setBusy(false) }
  }
  const upload = async (files: File[], kind: AttachmentKind) => {
    setBusy(true)
    for (const f of files) { try { await uploadAttachment('report-evidence', report!.id, f, kind); toast(`${f.name} uploaded.`, 'success') } catch (e) { toast(`${f.name}: ${friendlyError(e)}`, 'error') } }
    setBusy(false); res.reload()
  }
  const done = (m: string) => { toast(m, 'success'); setDlg(null); res.reload() }

  return (
    <>
      <PageHead title="Activity report" sub={`${p.title} · ${p.filing_number ?? ''}`}>
        <Link className="btn" to={`/proposals/${p.id}`}>Proposal</Link>{report && <ReportBadge s={report.status} />}
        {hodReview && <><button className="btn good" onClick={() => setDlg('hodverify')}>Verify and send to IQAC</button><button className="btn warn" onClick={() => setDlg('hodreturn')}>Return</button></>}
        {iqacReview && <><button className="btn good" onClick={() => setDlg('verify')}>Verify</button><button className="btn warn" onClick={() => setDlg('return')}>Return</button></>}
        <button className="btn" onClick={() => window.print()}>Print</button>
      </PageHead>
      <div className="card"><h3>As approved</h3><div className="formgrid">
        <ReadBlock label="Date" value={fmtDate(p.proposed_date)} /><ReadBlock label="Time" value={`${hhmm(p.start_time)} – ${hhmm(p.end_time)}`} />
        <ReadBlock label="Expected participants" value={p.expected_participants} /><ReadBlock label="Estimated expenditure" value={inr(p.total_budget)} /></div></div>

      {!report ? (
        <div className="card section">{own && p.status === 'filed'
          ? <><p>The activity report has not been started. Submit it after the activity has been conducted.</p>
              <button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); try { await startReport(p.id); res.reload() } catch (e) { toast(friendlyError(e), 'error') } finally { setBusy(false) } }}>Start activity report</button></>
          : <Empty>No report has been submitted for this activity yet.</Empty>}</div>
      ) : (
        <>
          {report.status === 'returned' && <Banner tone="warn"><b>Returned by {report.returned_by === 'hod' ? 'HOD' : 'IQAC'}:</b> {report.review_remarks}</Banner>}
          {report.status === 'submitted' && <Banner tone="info">Submitted {fmtDateTime(report.submitted_at)}. {mode === 'hod_then_iqac' ? 'Awaiting HOD review, then IQAC verification.' : mode === 'iqac' ? 'Awaiting IQAC verification.' : ''}</Banner>}
          {report.status === 'hod_verified' && <Banner tone="info">Verified by the HOD. Awaiting IQAC verification.</Banner>}
          {report.status === 'verified' && <Banner tone="good">Verified {fmtDateTime(report.reviewed_at)}.</Banner>}
          {err && <div className="errorbox" role="alert" style={{ margin: '12px 0' }}>{err}</div>}
          <div className="card section"><h3>What actually happened</h3>
            <div className="formgrid">
              <Text id="r_date" required type="date" label="Actual date" value={form.actual_date} onChange={(v) => set('actual_date', v)} readOnly={!editable} error={errors.actual_date} />
              <Text id="r_part" required type="number" min="0" step="1" label="Actual participants" value={form.actual_participants} onChange={(v) => set('actual_participants', v)} readOnly={!editable} error={errors.actual_participants} />
              <Text id="r_st" type="time" label="Actual start time" value={form.actual_start_time} onChange={(v) => set('actual_start_time', v)} readOnly={!editable} />
              <Text id="r_et" type="time" label="Actual end time" value={form.actual_end_time} onChange={(v) => set('actual_end_time', v)} readOnly={!editable} error={errors.actual_end_time} />
              <Text id="r_exp" required type="number" min="0" step="0.01" label="Actual expenditure (₹)" value={form.actual_expenditure} onChange={(v) => set('actual_expenditure', v)} readOnly={!editable} error={errors.actual_expenditure} />
              <Area id="r_rp" label="Resource person and sessions" value={form.resource_person_details} onChange={(v) => set('resource_person_details', v)} readOnly={!editable} />
              <Area id="r_ses" full label="Sessions conducted" value={form.sessions_conducted} onChange={(v) => set('sessions_conducted', v)} readOnly={!editable} />
              <Area id="r_proc" full required label="Programme proceedings and activities completed" value={form.proceedings} onChange={(v) => set('proceedings', v)} readOnly={!editable} error={errors.proceedings} />
              <Area id="r_out" full required label="Outcomes and benefits" value={form.outcomes} onChange={(v) => set('outcomes', v)} readOnly={!editable} error={errors.outcomes} />
              <Area id="r_fb" full label="Participant feedback and evaluation" value={form.feedback_summary} onChange={(v) => set('feedback_summary', v)} readOnly={!editable} />
              <Area id="r_dev" full label="Deviations from the approved proposal (and reasons)" value={form.deviations} onChange={(v) => set('deviations', v)} readOnly={!editable} />
            </div></div>
          <div className="card section"><h3>Expenditure breakdown</h3>
            {exp.length === 0 && <div className="hint">No items added.</div>}
            {exp.map((e, i) => (
              <div className="rowform" key={e.id ?? `n${i}`}>
                <Text id={`e_h${i}`} label="Head" value={e.head} readOnly={!editable} onChange={(v) => setExp((x) => x.map((r, j) => j === i ? { ...r, head: v } : r))} />
                <Text id={`e_a${i}`} label="Amount (₹)" type="number" min="0" value={String(e.amount)} readOnly={!editable} onChange={(v) => setExp((x) => x.map((r, j) => j === i ? { ...r, amount: v } : r))} />
                {editable && <button type="button" className="btn small bad" onClick={() => setExp((x) => x.filter((_, j) => j !== i))}>Remove</button>}
              </div>))}
            {editable && <button type="button" className="btn small" onClick={() => setExp((x) => [...x, { head: '', amount: '' }])}>Add item</button>}
            <div className="hint" style={{ marginTop: 8 }}>Breakdown total: {inr(breakdown)}{form.actual_expenditure && Math.abs(breakdown - Number(form.actual_expenditure)) > 0.005 && exp.length > 0 ? ' — differs from the actual expenditure above' : ''}</div></div>
          <div className="card section"><h3>Evidence</h3>
            {required.length > 0 && <div className="hint" style={{ marginBottom: 8 }}>Required before submitting: {required.map((k) => `${KIND_LABEL[k]} ${have.has(k) ? '✓' : '✗'}`).join(' · ')}</div>}
            <AttachmentList items={attachments} bucket="report-evidence" canRemove={editable} onChanged={res.reload} />
            {editable && <FilePicker id="report-files" kinds={KINDS} defaultKind="final_report" remaining={MAX_REPORT_FILES - attachments.length} disabled={busy} onPick={upload} />}</div>
          {editable && <div className="footeractions"><button className="btn" disabled={busy} onClick={() => nav(-1)}>Back</button><button className="btn" disabled={busy} onClick={onSave}>{busy ? 'Working…' : 'Save draft'}</button>
            <button className="btn primary" disabled={busy} onClick={onSubmit}>{report.status === 'returned' ? 'Resubmit report' : 'Submit report'}</button></div>}
          <div className="card section"><h3>Report history</h3>{actions.length === 0 ? <div className="hint">Nothing yet.</div> :
            <div className="tablewrap"><table className="table"><thead><tr><th>When</th><th>By</th><th>Action</th><th>Remarks</th></tr></thead>
              <tbody>{actions.map((a) => <tr key={a.id}><td>{fmtDateTime(a.created_at)}</td><td>{a.actor_name}</td><td>{a.action.replace(/_/g, ' ')}</td><td>{a.remarks ?? ''}</td></tr>)}</tbody></table></div>}</div>
        </>)}

      {dlg === 'submit' && <ConfirmDialog title="Submit activity report?" confirmLabel="Submit" onClose={() => setDlg(null)} message="You cannot edit the report while it is under review."
        onConfirm={async () => { await submitReport(report!.id); done('Report submitted.') }} />}
      {dlg === 'hodverify' && <ConfirmDialog title="Verify report" confirmLabel="Verify" tone="good" remarks="optional" onClose={() => setDlg(null)} onConfirm={async (r) => { await hodReviewReport(report!.id, true, r); done('Sent to IQAC.') }} />}
      {dlg === 'hodreturn' && <ConfirmDialog title="Return report" confirmLabel="Return" tone="warn" remarks="required" onClose={() => setDlg(null)} onConfirm={async (r) => { await hodReviewReport(report!.id, false, r); done('Returned to the faculty member.') }} />}
      {dlg === 'verify' && <ConfirmDialog title="Verify report" confirmLabel="Verify" tone="good" remarks="optional" onClose={() => setDlg(null)} onConfirm={async (r) => { await iqacReviewReport(report!.id, true, r); done('Report verified.') }} />}
      {dlg === 'return' && <ConfirmDialog title="Return report" confirmLabel="Return" tone="warn" remarks="required" onClose={() => setDlg(null)} onConfirm={async (r) => { await iqacReviewReport(report!.id, false, r); done('Returned for correction.') }} />}
    </>
  )
}
