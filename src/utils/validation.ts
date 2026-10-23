import { ALLOWED_EXT, MAX_FILE_BYTES } from '../lib/constants'

export interface ProposalForm {
  title: string; category: string; activity_type: string; proposed_date: string; start_time: string; end_time: string
  venue: string; target_participants: string; expected_participants: string; objectives: string; description: string
  expected_outcomes: string; academic_relevance: string; iqac_relevance: string; compliance_mapping: string
  total_budget: string; funding_source: string; budget_details: string; resource_name: string; resource_org: string
  resource_expertise: string; resource_honorarium: string; resource_travel: string; resource_accommodation: string
  resource_finance: string; mobile: string; declaration: boolean
}
export type Errors<T> = Partial<Record<keyof T, string>>

export const emptyProposal = (): ProposalForm => ({
  title: '', category: '', activity_type: '', proposed_date: '', start_time: '', end_time: '', venue: '',
  target_participants: '', expected_participants: '', objectives: '', description: '', expected_outcomes: '',
  academic_relevance: '', iqac_relevance: '', compliance_mapping: '', total_budget: '', funding_source: '',
  budget_details: '', resource_name: '', resource_org: '', resource_expertise: '', resource_honorarium: '',
  resource_travel: '', resource_accommodation: '', resource_finance: '', mobile: '', declaration: false,
})

const num = (s: string) => s.trim() !== '' && Number.isFinite(Number(s))

export function validateProposal(f: ProposalForm, forSubmit: boolean): Errors<ProposalForm> {
  const e: Errors<ProposalForm> = {}
  if (!f.title.trim()) e.title = 'Title is required'
  else if (f.title.length > 300) e.title = 'Title must be 300 characters or fewer'
  if (f.start_time && f.end_time && f.end_time <= f.start_time) e.end_time = 'End time must be after the start time'
  for (const k of ['expected_participants', 'total_budget', 'resource_honorarium', 'resource_travel', 'resource_accommodation'] as const) {
    if (f[k].trim() !== '' && (!num(f[k]) || Number(f[k]) < 0)) e[k] = 'Enter a number of 0 or more'
  }
  if (f.expected_participants.trim() !== '' && num(f.expected_participants) && !Number.isInteger(Number(f.expected_participants))) e.expected_participants = 'Enter a whole number'
  if (f.mobile.trim() && !/^[0-9+() -]{7,20}$/.test(f.mobile.trim())) e.mobile = 'Enter a valid mobile number'
  if (forSubmit) {
    const req: [keyof ProposalForm, string][] = [['category', 'Select a category'], ['activity_type', 'Select an activity type'],
      ['proposed_date', 'Proposed date is required'], ['start_time', 'Start time is required'], ['end_time', 'End time is required'],
      ['venue', 'Venue is required'], ['objectives', 'Objectives are required'], ['description', 'Description is required'],
      ['expected_outcomes', 'Expected outcomes are required']]
    for (const [k, m] of req) if (!String(f[k]).trim()) e[k] = m
    if (!f.declaration) e.declaration = 'You must accept the declaration before submitting'
  }
  return e
}

export function validateFile(file: { name: string; size: number }): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!(ALLOWED_EXT as readonly string[]).includes(ext)) return `${file.name}: only PDF, DOC/DOCX, XLS/XLSX, JPG and PNG files are allowed`
  if (file.size <= 0) return `${file.name}: the file is empty`
  if (file.size > MAX_FILE_BYTES) return `${file.name}: exceeds the 10 MB limit`
  return null
}

export interface ReportForm {
  actual_date: string; actual_start_time: string; actual_end_time: string; actual_participants: string
  actual_expenditure: string; resource_person_details: string; sessions_conducted: string; proceedings: string
  outcomes: string; feedback_summary: string; deviations: string
}
export const emptyReport = (): ReportForm => ({ actual_date: '', actual_start_time: '', actual_end_time: '', actual_participants: '',
  actual_expenditure: '', resource_person_details: '', sessions_conducted: '', proceedings: '', outcomes: '', feedback_summary: '', deviations: '' })

export function validateReport(f: ReportForm, forSubmit: boolean): Errors<ReportForm> {
  const e: Errors<ReportForm> = {}
  if (f.actual_start_time && f.actual_end_time && f.actual_end_time <= f.actual_start_time) e.actual_end_time = 'End time must be after the start time'
  if (f.actual_participants.trim() !== '' && (!num(f.actual_participants) || Number(f.actual_participants) < 0 || !Number.isInteger(Number(f.actual_participants)))) e.actual_participants = 'Enter a whole number'
  if (f.actual_expenditure.trim() !== '' && (!num(f.actual_expenditure) || Number(f.actual_expenditure) < 0)) e.actual_expenditure = 'Enter a number of 0 or more'
  if (forSubmit) {
    if (!f.actual_date) e.actual_date = 'Actual date is required'
    if (!f.actual_participants.trim()) e.actual_participants = e.actual_participants ?? 'Actual participants is required'
    if (!f.actual_expenditure.trim()) e.actual_expenditure = e.actual_expenditure ?? 'Actual expenditure is required (enter 0 if none)'
    if (!f.proceedings.trim()) e.proceedings = 'Proceedings are required'
    if (!f.outcomes.trim()) e.outcomes = 'Outcomes are required'
  }
  return e
}

export const safeSearch = (q: string) => q.replace(/[,()%*\\:"']/g, ' ').replace(/\s+/g, ' ').trim()
