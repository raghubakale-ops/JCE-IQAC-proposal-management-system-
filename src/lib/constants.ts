import type { AttachmentKind, ProposalStatus, ReportStatus, Role } from '../types'

export const DOMAIN = 'jainbgm.in'
export const ROLE_LABEL: Record<Role, string> = { faculty: 'Faculty', hod: 'HOD', principal: 'Principal', iqac: 'IQAC Coordinator' }
export const CATEGORIES = ['Academic Activity','Faculty Development','Student Development','Research & Innovation',
  'Industry/Professional Activity','Quality Initiative','Extension/Outreach','Other'] as const
export const ACTIVITY_TYPES = ['Workshop','FDP','Seminar','Conference','Expert Talk','Training Programme','Guest Lecture',
  'Industrial Visit','Student Activity','Research Activity','Awareness Programme','Other'] as const

export const STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: 'Draft', hod_review: 'Under HOD Review', hod_returned: 'Returned by HOD', forwarded: 'Forwarded to Principal',
  principal_review: 'Under Principal Review', principal_returned: 'Returned by Principal', disapproved: 'Disapproved',
  approved: 'Approved', filed: 'IQAC Filed',
}
export const STATUS_CLASS: Record<ProposalStatus, string> = {
  draft: 'draft', hod_review: 'review', hod_returned: 'returned', forwarded: 'forward', principal_review: 'review',
  principal_returned: 'returned', disapproved: 'disapproved', approved: 'approved', filed: 'filed',
}
export const EDITABLE: ProposalStatus[] = ['draft', 'hod_returned', 'principal_returned']
export const PENDING: ProposalStatus[] = ['hod_review', 'forwarded', 'principal_review']

export const REPORT_LABEL: Record<ReportStatus | 'none', string> = {
  none: 'Not started', draft: 'Draft', submitted: 'Submitted', hod_verified: 'HOD verified', returned: 'Returned', verified: 'Verified',
}
export const REPORT_CLASS: Record<ReportStatus | 'none', string> = {
  none: 'draft', draft: 'draft', submitted: 'submitted', hod_verified: 'forward', returned: 'returned', verified: 'verified',
}
export const KIND_LABEL: Record<AttachmentKind, string> = {
  proposal_document: 'Supporting document', brochure: 'Brochure / invitation', attendance_sheet: 'Attendance sheet',
  photograph: 'Photograph', feedback_summary: 'Feedback summary', final_report: 'Final activity report',
  certificate: 'Certificate', bill_receipt: 'Bill / receipt', other: 'Other',
}
export const ALLOWED_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png'] as const
export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_PROPOSAL_FILES = 10
export const MAX_REPORT_FILES = 25
export const ACCEPT = ALLOWED_EXT.map((e) => '.' + e).join(',')
// First month of the academic year (June). Used only for filtering/grouping dates.
export const AY_START_MONTH = 6
