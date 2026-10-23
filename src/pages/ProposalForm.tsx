import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useRef_ } from '../hooks/useReference'
import { useAsync } from '../hooks/useAsync'
import { useToast } from '../hooks/useToast'
import { getProposalDetail, formFromProposal, proposalAction, saveDraft } from '../services/proposals'
import { uploadAttachment } from '../services/attachments'
import { Banner, ConfirmDialog, ErrorBox, PageHead, Spinner } from '../components/ui'
import { Area, Check, ReadBlock, Select, Text } from '../components/fields'
import { AttachmentList, FilePicker } from '../components/Attachments'
import { ACTIVITY_TYPES, CATEGORIES, EDITABLE, KIND_LABEL, MAX_PROPOSAL_FILES } from '../lib/constants'
import { friendlyError } from '../lib/errors'
import { emptyProposal, validateProposal, type Errors, type ProposalForm as Form } from '../utils/validation'
import type { AttachmentKind } from '../types'

const FRAMEWORKS = ['NAAC', 'NBA', 'AICTE', 'VTU', 'NIRF', 'Other']
interface Pending { file: File; kind: AttachmentKind }

export default function ProposalForm() {
  const { id } = useParams(); const nav = useNavigate(); const toast = useToast()
  const { profile } = useAuth(); const { deptName } = useRef_()
  const [form, setForm] = useState<Form>(() => ({ ...emptyProposal(), mobile: profile?.mobile ?? '' }))
  const [errors, setErrors] = useState<Errors<Form>>({}); const [pending, setPending] = useState<Pending[]>([])
  const [busy, setBusy] = useState(false); const [confirm, setConfirm] = useState(false); const [dirty, setDirty] = useState(false)
  const [formError, setFormError] = useState<string | null>(null); const loaded = useRef(false)

  const detail = useAsync(() => (id ? getProposalDetail(id, false) : Promise.resolve(null)), [id])
  const p = detail.data?.proposal
  useEffect(() => { if (p && !loaded.current) { loaded.current = true; setForm(formFromProposal(p)) } }, [p])
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault() } }
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  if (id && detail.loading) return <Spinner />
  if (id && detail.error) return <ErrorBox message={detail.error} onRetry={detail.reload} />
  if (p && (p.faculty_id !== profile!.id || !EDITABLE.includes(p.status)))
    return <Banner tone="warn">This proposal can no longer be edited. It is either under review or not yours.</Banner>

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined })) }
  const frameworks = form.compliance_mapping.split(',').map((s) => s.trim()).filter(Boolean)
  const toggleFw = (f: string) => set('compliance_mapping', (frameworks.includes(f) ? frameworks.filter((x) => x !== f) : [...frameworks, f]).join(', '))
  const attachments = detail.data?.attachments ?? []
  const remaining = MAX_PROPOSAL_FILES - attachments.length - pending.length

  /** Saves the record, then uploads queued files. Returns the proposal id, or null if anything failed. */
  const persist = async (forSubmit: boolean): Promise<string | null> => {
    const errs = validateProposal(form, forSubmit); setErrors(errs)
    if (Object.keys(errs).length) {
      setFormError(`Please fix ${Object.keys(errs).length} highlighted field(s).`)
      setTimeout(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0); return null
    }
    setFormError(null)
    const saved = await saveDraft(id ?? null, form)
    const failed: Pending[] = []
    for (const pf of pending) {
      try { await uploadAttachment('proposal-docs', saved.id, pf.file, pf.kind) }
      catch (e) { failed.push(pf); toast(`${pf.file.name}: ${friendlyError(e)}`, 'error') }
    }
    setPending(failed); setDirty(false)
    if (failed.length) { setFormError(`Saved, but ${failed.length} file(s) failed to upload. Fix or remove them and try again.`); if (!id) nav(`/proposals/${saved.id}/edit`, { replace: true }); return null }
    return saved.id
  }
  const onSave = async () => {
    setBusy(true)
    try { const sid = await persist(false); if (sid) { toast('Draft saved.', 'success'); if (!id) nav(`/proposals/${sid}/edit`, { replace: true }); else detail.reload() } }
    catch (e) { setFormError(friendlyError(e)) } finally { setBusy(false) }
  }
  const onSubmitClick = async () => { const errs = validateProposal(form, true); setErrors(errs)
    if (Object.keys(errs).length) { setFormError(`Please fix ${Object.keys(errs).length} highlighted field(s) before submitting.`); setTimeout(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0); return }
    setFormError(null); setConfirm(true) }
  const doSubmit = async () => {
    const sid = await persist(true); if (!sid) { setConfirm(false); return }
    await proposalAction('submit_proposal', sid)
    setDirty(false); toast('Proposal submitted.', 'success'); nav(`/proposals/${sid}`)
  }
  const isHod = profile!.role === 'hod'
  const dept = p ? deptName(p.department_id) : deptName(profile!.department_id)
  const remarks = p?.status === 'hod_returned' ? p.hod_remarks : p?.status === 'principal_returned' ? p.principal_remarks : null

  return (
    <>
      <PageHead title={id ? 'Edit proposal' : 'New proposal'} sub="Fields marked * are required to submit. You can save a draft at any time." />
      {remarks && <Banner tone="warn"><b>Returned for correction:</b> {remarks}</Banner>}
      {isHod && <Banner tone="info">As an HOD, your proposal goes directly to the Principal for approval.</Banner>}
      {formError && <div className="errorbox" role="alert" style={{ marginBottom: 14 }}>{formError}</div>}
      <div className="card">
        <h3 className="section-title" style={{ marginTop: 0 }}>Proposer</h3>
        <div className="formgrid">
          <ReadBlock label="Name" value={p?.faculty_name ?? profile!.full_name} /><ReadBlock label="Official email" value={p?.faculty_email ?? profile!.email} />
          <ReadBlock label="Employee ID" value={p?.employee_id ?? profile!.employee_id} /><ReadBlock label="Department" value={dept} />
          <ReadBlock label="Designation" value={p?.designation ?? profile!.designation} />
          <Text id="mobile" label="Mobile number" value={form.mobile} onChange={(v) => set('mobile', v)} error={errors.mobile} />
        </div>
        <div className="hint">Name, email, employee ID, department and designation come from the IQAC staff directory and cannot be edited here.</div>

        <h3 className="section-title">Activity details</h3>
        <div className="formgrid">
          <Text id="title" full required label="Proposal title" value={form.title} onChange={(v) => set('title', v)} error={errors.title} maxLength={300} />
          <Select id="category" required label="Category" value={form.category} onChange={(v) => set('category', v)} options={CATEGORIES} error={errors.category} />
          <Select id="activity_type" required label="Activity type" value={form.activity_type} onChange={(v) => set('activity_type', v)} options={ACTIVITY_TYPES} error={errors.activity_type} />
          <Text id="proposed_date" required type="date" label="Proposed date" value={form.proposed_date} onChange={(v) => set('proposed_date', v)} error={errors.proposed_date} />
          <Text id="venue" required label="Venue" value={form.venue} onChange={(v) => set('venue', v)} error={errors.venue} />
          <Text id="start_time" required type="time" label="Start time" value={form.start_time} onChange={(v) => set('start_time', v)} error={errors.start_time} />
          <Text id="end_time" required type="time" label="End time" value={form.end_time} onChange={(v) => set('end_time', v)} error={errors.end_time} />
          <Text id="target_participants" label="Target participants" value={form.target_participants} onChange={(v) => set('target_participants', v)} hint="e.g. 3rd-semester CSE students" />
          <Text id="expected_participants" type="number" min="0" step="1" label="Expected number of participants" value={form.expected_participants} onChange={(v) => set('expected_participants', v)} error={errors.expected_participants} />
        </div>

        <h3 className="section-title">Purpose and outcomes</h3>
        <div className="formgrid">
          <Area id="objectives" full required label="Objectives" value={form.objectives} onChange={(v) => set('objectives', v)} error={errors.objectives} />
          <Area id="description" full required label="Description of the activity" value={form.description} onChange={(v) => set('description', v)} error={errors.description} />
          <Area id="expected_outcomes" full required label="Expected outcomes" value={form.expected_outcomes} onChange={(v) => set('expected_outcomes', v)} error={errors.expected_outcomes} />
          <Area id="academic_relevance" label="Academic relevance" value={form.academic_relevance} onChange={(v) => set('academic_relevance', v)} />
          <Area id="iqac_relevance" label="IQAC relevance" value={form.iqac_relevance} onChange={(v) => set('iqac_relevance', v)} />
        </div>
        <fieldset style={{ border: '1px solid var(--line)', borderRadius: 10, marginTop: 14 }}>
          <legend style={{ fontSize: 12, fontWeight: 600, padding: '0 6px' }}>Compliance mapping (select all that apply)</legend>
          <div className="actions">{FRAMEWORKS.map((f) => (
            <label key={f} className="check" style={{ display: 'flex', gap: 6, fontSize: 12 }}><input type="checkbox" checked={frameworks.includes(f)} onChange={() => toggleFw(f)} />{f}</label>))}</div>
        </fieldset>

        <h3 className="section-title">Budget</h3>
        <div className="formgrid">
          <Text id="total_budget" type="number" min="0" step="0.01" label="Estimated expenditure (₹)" value={form.total_budget} onChange={(v) => set('total_budget', v)} error={errors.total_budget} />
          <Text id="funding_source" label="Funding source" value={form.funding_source} onChange={(v) => set('funding_source', v)} hint="e.g. Department, IQAC, Sponsor, Self-financed" />
          <Area id="budget_details" full label="Budget details" value={form.budget_details} onChange={(v) => set('budget_details', v)} />
        </div>

        <h3 className="section-title">Resource person (if any)</h3>
        <div className="formgrid">
          <Text id="resource_name" label="Name" value={form.resource_name} onChange={(v) => set('resource_name', v)} />
          <Text id="resource_org" label="Organisation" value={form.resource_org} onChange={(v) => set('resource_org', v)} />
          <Text id="resource_expertise" label="Expertise" value={form.resource_expertise} onChange={(v) => set('resource_expertise', v)} />
          <Text id="resource_honorarium" type="number" min="0" label="Honorarium (₹)" value={form.resource_honorarium} onChange={(v) => set('resource_honorarium', v)} error={errors.resource_honorarium} />
          <Text id="resource_travel" type="number" min="0" label="Travel (₹)" value={form.resource_travel} onChange={(v) => set('resource_travel', v)} error={errors.resource_travel} />
          <Text id="resource_accommodation" type="number" min="0" label="Accommodation (₹)" value={form.resource_accommodation} onChange={(v) => set('resource_accommodation', v)} error={errors.resource_accommodation} />
          <Area id="resource_finance" full label="Other financial notes" value={form.resource_finance} onChange={(v) => set('resource_finance', v)} />
        </div>

        <h3 className="section-title">Supporting documents</h3>
        {id ? <AttachmentList items={attachments} bucket="proposal-docs" canRemove onChanged={detail.reload} /> : <div className="hint">Files you choose below are uploaded when you save the draft.</div>}
        {pending.map((pf, i) => (
          <div className="filechip" key={i}><span>{pf.file.name} <span className="hint">· {KIND_LABEL[pf.kind]} · queued, not uploaded yet</span></span>
            <button type="button" className="btn small" onClick={() => setPending((x) => x.filter((_, j) => j !== i))}>Remove</button></div>))}
        <FilePicker id="proposal-files" defaultKind="proposal_document" kinds={['proposal_document', 'brochure', 'other']} remaining={remaining}
          onPick={(files, kind) => { setPending((x) => [...x, ...files.map((file) => ({ file, kind }))]); setDirty(true) }} />

        <h3 className="section-title">Declaration</h3>
        <Check id="declaration" label="" checked={form.declaration} onChange={(v) => set('declaration', v)} error={errors.declaration}>
          I declare that the information provided is correct, that the activity has the knowledge of my department, and that it will be conducted according to institutional policies.</Check>

        <div className="footeractions">
          <button className="btn" disabled={busy} onClick={() => nav(-1)}>Cancel</button>
          <button className="btn" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : 'Save draft'}</button>
          <button className="btn primary" disabled={busy} onClick={onSubmitClick}>{p && p.status !== 'draft' ? 'Resubmit' : 'Submit for approval'}</button>
        </div>
      </div>
      {confirm && <ConfirmDialog title="Submit proposal?" confirmLabel="Submit" tone="primary" onClose={() => setConfirm(false)} onConfirm={doSubmit}
        message={isHod ? 'It will be sent directly to the Principal. You cannot edit it while it is under review.' : 'It will be sent to your HOD for review. You cannot edit it while it is under review.'} />}
    </>
  )
}
