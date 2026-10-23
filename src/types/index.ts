export type Role = 'faculty' | 'hod' | 'principal' | 'iqac'
export type ProposalStatus = 'draft' | 'hod_review' | 'hod_returned' | 'forwarded' | 'principal_review'
  | 'principal_returned' | 'disapproved' | 'approved' | 'filed'
export type ReportStatus = 'draft' | 'submitted' | 'hod_verified' | 'returned' | 'verified'
export type ReviewMode = 'none' | 'iqac' | 'hod_then_iqac'
export type AttachmentKind = 'proposal_document' | 'brochure' | 'attendance_sheet' | 'photograph'
  | 'feedback_summary' | 'final_report' | 'certificate' | 'bill_receipt' | 'other'

export interface Department { id: string; code: string; name: string; is_active: boolean }
export interface Profile {
  id: string; email: string; full_name: string; role: Role; department_id: string | null
  designation: string | null; employee_id: string | null; mobile: string | null; is_active: boolean
}
export interface Proposal {
  id: string; faculty_id: string; department_id: string; faculty_name: string; faculty_email: string
  employee_id: string | null; designation: string | null; mobile: string | null; status: ProposalStatus
  author_role: Role; title: string; category: string | null; activity_type: string | null
  proposed_date: string | null; start_time: string | null; end_time: string | null; venue: string | null
  target_participants: string | null; expected_participants: number | null; objectives: string | null
  description: string | null; expected_outcomes: string | null; academic_relevance: string | null
  iqac_relevance: string | null; compliance_mapping: string | null; total_budget: number
  funding_source: string | null; budget_details: string | null; resource_name: string | null
  resource_org: string | null; resource_expertise: string | null; resource_honorarium: number | null
  resource_travel: number | null; resource_accommodation: number | null; resource_finance: string | null
  declaration: boolean; revision_no: number; submitted_at: string | null; resubmitted_at: string | null
  forwarded_at: string | null; hod_reviewer_id: string | null; hod_reviewed_at: string | null
  hod_remarks: string | null; principal_reviewer_id: string | null; principal_reviewed_at: string | null
  principal_remarks: string | null; approved_at: string | null; filing_number: string | null
  created_at: string; updated_at: string
  departments?: { code: string; name: string } | null
}
export interface Attachment {
  id: string; storage_path: string; file_name: string; mime_type: string; size_bytes: number
  kind: AttachmentKind; created_at: string
}
export interface ApprovalAction {
  id: string; action: string; from_status: ProposalStatus | null; to_status: ProposalStatus
  actor_name: string; actor_role: Role; remarks: string | null; created_at: string
}
export interface ActivityReport {
  id: string; proposal_id: string; faculty_id: string; department_id: string; status: ReportStatus
  actual_date: string | null; actual_start_time: string | null; actual_end_time: string | null
  actual_participants: number | null; actual_expenditure: number | null
  resource_person_details: string | null; sessions_conducted: string | null; proceedings: string | null
  outcomes: string | null; feedback_summary: string | null; deviations: string | null
  submitted_at: string | null; reviewed_at: string | null; review_remarks: string | null
  returned_by: Role | null; hod_reviewed_at: string | null; hod_remarks: string | null; revision_no: number
}
export interface ReportExpense { id?: string; head: string; amount: number | string; notes?: string | null }
export interface ReportAction {
  id: string; action: string; from_status: ReportStatus | null; to_status: ReportStatus
  actor_name: string; remarks: string | null; created_at: string
}
export interface ComplianceRow {
  proposal_id: string; department_id: string; title: string; proposed_date: string | null
  filing_number: string | null; report_id: string | null; report_status: ReportStatus | null
  report_due_date: string | null; is_overdue: boolean
}
export interface NotificationRow {
  id: string; proposal_id: string | null; report_id: string | null; type: string; title: string
  message: string; is_read: boolean; created_at: string
}
export interface StaffRow {
  id: string; email: string; full_name: string; role: Role; department_id: string | null
  designation: string | null; employee_id: string | null; is_active: boolean
}
export interface AuditRow {
  id: number; actor_email: string | null; action: string; entity_type: string; entity_id: string | null
  details: Record<string, unknown>; created_at: string
}
export interface Settings {
  institution_name: string; filing_prefix: string; academic_year: string; filing_digits: number
  filing_start: number; report_due_days: number; report_review_mode: ReviewMode
  report_required_kinds: AttachmentKind[]
}
export interface FilingRow {
  id: string; filing_number: string; academic_year: string; sequence_no: number; generated_at: string
  proposal_id: string
  proposals: { title: string; faculty_name: string; department_id: string; approved_at: string | null; status: ProposalStatus } | null
}
