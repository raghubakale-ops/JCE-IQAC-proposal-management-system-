import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useRef_ } from '../hooks/useReference'
import { useAsync } from '../hooks/useAsync'
import { useToast } from '../hooks/useToast'
import { listHodGrants, listStaff, queryAudit, setHodDepartment, updateSetting, upsertStaff } from '../services/misc'
import { ConfirmDialog, Empty, ErrorBox, Modal, PageHead, Pager, Spinner } from '../components/ui'
import { Check, Select, Text } from '../components/fields'
import { DOMAIN, KIND_LABEL, ROLE_LABEL } from '../lib/constants'
import { friendlyError } from '../lib/errors'
import { filingPreview, fmtDateTime } from '../utils/format'
import type { AttachmentKind, ReviewMode, Role, StaffRow } from '../types'

type Tab = 'staff' | 'settings' | 'audit'
export default function Admin() {
  const [tab, setTab] = useState<Tab>('staff')
  return (
    <>
      <PageHead title="Administration" sub="Roles, numbering and system configuration. Every change is recorded in the audit trail." />
      <div className="tabs" role="tablist">{(['staff', 'settings', 'audit'] as Tab[]).map((t) => (
        <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === 'staff' ? 'Staff and roles' : t === 'settings' ? 'Settings' : 'Audit trail'}</button>))}</div>
      {tab === 'staff' ? <Staff /> : tab === 'settings' ? <SettingsTab /> : <Audit />}
    </>
  )
}

function Staff() {
  const { departments, deptCode } = useRef_(); const { profile } = useAuth(); const toast = useToast()
  const staff = useAsync(listStaff, []); const grants = useAsync(listHodGrants, [])
  const [edit, setEdit] = useState<Partial<StaffRow> | null>(null); const [q, setQ] = useState('')
  if (staff.loading || grants.loading) return <Spinner />
  if (staff.error || grants.error) return <ErrorBox message={staff.error ?? grants.error ?? ''} onRetry={() => { staff.reload(); grants.reload() }} />
  const rows = (staff.data ?? []).filter((s) => `${s.full_name} ${s.email}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="card">
      <div className="toolbar"><input aria-label="Search staff" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: '1 1 220px' }} />
        <button className="btn primary" onClick={() => setEdit({ role: 'faculty', is_active: true })}>Add staff member</button></div>
      <div className="hint" style={{ marginBottom: 8 }}>Only people listed here can use the system, and only with their @{DOMAIN} Google account. A role takes effect the next time they load the app.</div>
      {rows.length === 0 ? <Empty>No staff found.</Empty> :
        <div className="tablewrap"><table className="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Dept</th><th>Extra depts</th><th>Status</th><th></th></tr></thead>
          <tbody>{rows.map((s) => (
            <tr key={s.id}><td>{s.full_name}</td><td>{s.email}</td><td>{ROLE_LABEL[s.role]}</td><td>{deptCode(s.department_id)}</td>
              <td>{s.role === 'hod' ? (grants.data ?? []).filter((g) => g.staff_id === s.id).map((g) => deptCode(g.department_id)).join(', ') || '—' : ''}</td>
              <td>{s.is_active ? <span className="badge approved">Active</span> : <span className="badge draft">Inactive</span>}</td>
              <td><button className="btn small" onClick={() => setEdit(s)}>Edit</button></td></tr>))}</tbody></table></div>}
      {edit && <StaffDialog init={edit} self={profile!.email} grants={(grants.data ?? []).filter((g) => g.staff_id === edit.id).map((g) => g.department_id)} departments={departments}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); staff.reload(); grants.reload(); toast('Saved.', 'success') }} onGrantChanged={grants.reload} />}
    </div>
  )
}

function StaffDialog({ init, self, grants, departments, onClose, onSaved, onGrantChanged }: {
  init: Partial<StaffRow>; self: string; grants: string[]; departments: { id: string; code: string; name: string }[]; onClose: () => void; onSaved: () => void; onGrantChanged: () => void
}) {
  const toast = useToast(); const isNew = !init.id
  const [f, setF] = useState({ email: init.email ?? '', full_name: init.full_name ?? '', role: (init.role ?? 'faculty') as Role, dept: departments.find((d) => d.id === init.department_id)?.code ?? '',
    designation: init.designation ?? '', employee_id: init.employee_id ?? '', active: init.is_active ?? true })
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [errs, setErrs] = useState<Record<string, string>>({})
  const needsDept = f.role === 'faculty' || f.role === 'hod'
  const save = async () => {
    const e: Record<string, string> = {}
    if (!new RegExp(`^[^@\\s]+@${DOMAIN.replace('.', '\\.')}$`, 'i').test(f.email.trim())) e.email = `Use an @${DOMAIN} address`
    if (!f.full_name.trim()) e.full_name = 'Name is required'
    if (needsDept && !f.dept) e.dept = 'Department is required for this role'
    setErrs(e); if (Object.keys(e).length) return
    setBusy(true); setErr(null)
    try { await upsertStaff({ email: f.email.trim().toLowerCase(), full_name: f.full_name, role: f.role, dept_code: needsDept ? f.dept : null, designation: f.designation, employee_id: f.employee_id, active: f.active }); onSaved() }
    catch (x) { setErr(friendlyError(x)); setBusy(false) }
  }
  return (
    <Modal title={isNew ? 'Add staff member' : 'Edit staff member'} onClose={onClose} wide>
      {err && <div className="errorbox" role="alert" style={{ marginBottom: 10 }}>{err}</div>}
      <div className="formgrid">
        <Text id="s_email" label="Institutional email" required value={f.email} onChange={(v) => setF({ ...f, email: v })} readOnly={!isNew} error={errs.email} />
        <Text id="s_name" label="Full name" required value={f.full_name} onChange={(v) => setF({ ...f, full_name: v })} error={errs.full_name} />
        <Select id="s_role" label="Role" required value={f.role} onChange={(v) => setF({ ...f, role: (v || 'faculty') as Role })} options={(Object.keys(ROLE_LABEL) as Role[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
        {needsDept && <Select id="s_dept" label="Department" required value={f.dept} onChange={(v) => setF({ ...f, dept: v })} options={departments.map((d) => ({ value: d.code, label: `${d.code} — ${d.name}` }))} error={errs.dept} />}
        <Text id="s_des" label="Designation" value={f.designation} onChange={(v) => setF({ ...f, designation: v })} />
        <Text id="s_emp" label="Employee ID" value={f.employee_id} onChange={(v) => setF({ ...f, employee_id: v })} />
        <Check id="s_act" label="" checked={f.active} onChange={(v) => setF({ ...f, active: v })}>Active (untick to remove access immediately)</Check>
      </div>
      {!isNew && f.role === 'hod' && init.role === 'hod' && (
        <fieldset style={{ border: '1px solid var(--line)', borderRadius: 10, marginTop: 12 }}><legend style={{ fontSize: 12, fontWeight: 600, padding: '0 6px' }}>Additional departments this HOD may review</legend>
          <div className="actions">{departments.filter((d) => d.code !== f.dept).map((d) => (
            <label key={d.id} style={{ display: 'flex', gap: 5, fontSize: 12 }}><input type="checkbox" checked={grants.includes(d.id)}
              onChange={async (e) => { try { await setHodDepartment(init.email!, d.code, e.target.checked); onGrantChanged(); toast('Access updated.', 'success') } catch (x) { toast(friendlyError(x), 'error') } }} />{d.code}</label>))}</div></fieldset>)}
      {init.email === self && <div className="hint" style={{ marginTop: 8 }}>You are editing your own account. The system always keeps at least one active IQAC Coordinator.</div>}
      <div className="footeractions"><button className="btn" onClick={onClose} disabled={busy}>Cancel</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
    </Modal>
  )
}

function SettingsTab() {
  const { settings, refreshSettings } = useRef_(); const toast = useToast()
  const [v, setV] = useState(settings!); const [pending, setPending] = useState<null | { key: keyof typeof v; label: string; warn?: string }>(null)
  useEffect(() => { if (settings) setV(settings) }, [settings])
  const s = settings!
  const row = (key: keyof typeof v, label: string, node: React.ReactNode, warn?: string) => (
    <div className="card" style={{ marginBottom: 10 }}><div className="formgrid" style={{ alignItems: 'end' }}>{node}
      <div><button className="btn primary" disabled={JSON.stringify(v[key]) === JSON.stringify(s[key])} onClick={() => setPending({ key, label, warn })}>Save {label.toLowerCase()}</button></div></div></div>)
  return (
    <>
      <div className="banner info">Filing number preview: <b className="mono">{filingPreview(v.filing_prefix, v.academic_year, v.filing_digits, v.filing_start)}</b>. Already-issued numbers never change. Each academic year (and each prefix) keeps its own sequence.</div>
      {row('filing_prefix', 'Filing prefix', <Text id="st_p" label="Filing prefix" value={v.filing_prefix} onChange={(x) => setV({ ...v, filing_prefix: x })} hint="Letters, digits, / _ - only" />, 'New approvals will use this prefix and start a separate sequence.')}
      {row('academic_year', 'Academic year', <Text id="st_y" label="Current academic year (e.g. 2026-27)" value={v.academic_year} onChange={(x) => setV({ ...v, academic_year: x })} />, `Rolling over starts a new sequence at ${v.filing_start}. Existing records and numbers are preserved.`)}
      {row('filing_digits', 'Sequence length', <Text id="st_d" type="number" min="1" label="Sequence digits (1–8)" value={String(v.filing_digits)} onChange={(x) => setV({ ...v, filing_digits: Number(x) })} />)}
      {row('filing_start', 'Initial sequence', <Text id="st_s" type="number" min="1" label="Initial sequence number" value={String(v.filing_start)} onChange={(x) => setV({ ...v, filing_start: Number(x) })} hint="Applies when a new prefix/year sequence starts; has no effect on an existing one." />)}
      {row('report_due_days', 'Report due days', <Text id="st_r" type="number" min="1" label="Report due (days after the activity)" value={String(v.report_due_days)} onChange={(x) => setV({ ...v, report_due_days: Number(x) })} />)}
      {row('report_review_mode', 'Report review sequence', <Select id="st_m" label="Post-event report review" value={v.report_review_mode} onChange={(x) => setV({ ...v, report_review_mode: (x || 'hod_then_iqac') as ReviewMode })}
        options={[{ value: 'hod_then_iqac', label: 'HOD review, then IQAC verification' }, { value: 'iqac', label: 'IQAC verification only' }, { value: 'none', label: 'No review (auto-verified)' }]} />, 'Reports already in review continue under the new rule.')}
      {row('report_required_kinds', 'Required evidence', <fieldset style={{ border: '1px solid var(--line)', borderRadius: 10 }}><legend style={{ fontSize: 12, fontWeight: 600 }}>Evidence required to submit a report</legend>
        <div className="actions">{(Object.keys(KIND_LABEL) as AttachmentKind[]).filter((k) => k !== 'proposal_document').map((k) => (
          <label key={k} style={{ display: 'flex', gap: 5, fontSize: 12 }}><input type="checkbox" checked={v.report_required_kinds.includes(k)}
            onChange={(e) => setV({ ...v, report_required_kinds: e.target.checked ? [...v.report_required_kinds, k] : v.report_required_kinds.filter((x) => x !== k) })} />{KIND_LABEL[k]}</label>))}</div></fieldset>)}
      {pending && <ConfirmDialog title={`Save ${pending.label.toLowerCase()}?`} confirmLabel="Save" tone="primary" onClose={() => setPending(null)} message={pending.warn ?? 'This change is recorded in the audit trail.'}
        onConfirm={async () => { await updateSetting(pending.key, v[pending.key] as never); refreshSettings(); setPending(null); toast('Setting saved.', 'success') }} />}
    </>
  )
}

function Audit() {
  const [action, setAction] = useState(''); const [ent, setEnt] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [page, setPage] = useState(1)
  const res = useAsync(() => queryAudit({ action, entity_type: ent || undefined, from: from || undefined, to: to || undefined, page }), [action, ent, from, to, page])
  return (
    <div className="card">
      <div className="toolbar"><input aria-label="Action" placeholder="Action contains…" value={action} onChange={(e) => { setAction(e.target.value); setPage(1) }} />
        <select aria-label="Entity" value={ent} onChange={(e) => { setEnt(e.target.value); setPage(1) }}><option value="">All records</option>
          {['proposal', 'activity_report', 'staff_directory', 'system_settings', 'proposal_attachment', 'report_attachment'].map((x) => <option key={x}>{x}</option>)}</select>
        <input aria-label="From date" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} /><input aria-label="To date" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} /></div>
      {res.loading ? <Spinner /> : res.error ? <ErrorBox message={res.error} onRetry={res.reload} /> : !res.data?.rows.length ? <Empty>No audit entries.</Empty> :
        <><div className="tablewrap"><table className="table"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Record</th><th>Details</th></tr></thead>
          <tbody>{res.data.rows.map((r) => <tr key={r.id}><td>{fmtDateTime(r.created_at)}</td><td>{r.actor_email ?? 'system'}</td><td>{r.action}</td><td>{r.entity_type}<div className="small mono">{r.entity_id?.slice(0, 8)}</div></td><td className="small mono" style={{ maxWidth: 360, wordBreak: 'break-all' }}>{JSON.stringify(r.details)}</td></tr>)}</tbody></table></div>
          <Pager page={page} pageSize={25} total={res.data.total} onPage={setPage} /></>}
    </div>
  )
}
