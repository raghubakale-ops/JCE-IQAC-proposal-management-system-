import { useAuth } from '../hooks/useAuth'
import { useRef_ } from '../hooks/useReference'
import { PageHead } from '../components/ui'

export default function Guide() {
  const { profile } = useAuth(); const { settings } = useRef_(); const role = profile!.role
  const mode = settings?.report_review_mode
  return (
    <>
      <PageHead title="User guide" sub="How proposals move through the system" />
      <div className="card"><h3>The workflow</h3>
        <p>Draft → HOD review → Forwarded to Principal → Principal decision → Approved → IQAC filed. A proposal returned at any stage comes back to its author, who corrects it and resubmits. Proposals written by an HOD go directly to the Principal.</p>
        <p>The official IQAC filing number is generated automatically, once, when the Principal approves. It cannot be edited or reused.</p></div>
      {(role === 'faculty' || role === 'hod') && <div className="card section"><h3>Submitting a proposal</h3>
        <p>Choose <b>New proposal</b>, fill in the details, attach supporting documents and tick the declaration. Save a draft whenever you like; submit when it is complete. Track the status and any remarks on the proposal page and in Notifications.</p>
        <p>After the activity, open the approved proposal and choose <b>Activity report</b>. Enter the actual figures, add the required evidence (attendance sheet and final report unless the IQAC office has changed this), and submit.
          {mode === 'hod_then_iqac' ? ' Your HOD reviews the report first, then IQAC verifies it.' : mode === 'iqac' ? ' IQAC verifies it.' : ''}</p></div>}
      {role === 'hod' && <div className="card section"><h3>Reviewing</h3><p>The <b>Review Queue</b> lists proposals from your department. Open one, read it and its documents, then forward it to the Principal or return it with remarks. You can only review your own department(s) and never your own proposals. Reports from your department appear under <b>Activity Reports</b>.</p></div>}
      {role === 'principal' && <div className="card section"><h3>Deciding</h3><p>The <b>Review Queue</b> lists proposals the HODs have forwarded. You can approve (which issues the filing number), return for correction, or disapprove; remarks are mandatory for the last two.</p></div>}
      {role === 'iqac' && <div className="card section"><h3>IQAC Coordinator</h3><p>Use the <b>Filing Register</b> for issued numbers, <b>Analytics</b> for trends and compliance, <b>Activity Reports</b> to verify evidence, and <b>Administration</b> to manage staff roles, numbering settings and the audit trail. Keep at least two people able to administer the system in practice.</p></div>}
      <div className="card section"><h3>Files</h3><p>PDF, Word, Excel, JPG and PNG files up to 10 MB each. Files are private; links to them expire after a minute and are issued only to people allowed to see the record.</p></div>
    </>
  )
}
