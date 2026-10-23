import { fetchAll, supabase, unwrap } from './api'
import type { ApprovalAction, Attachment, AuditRow, Proposal, ProposalStatus } from '../types'
import { hhmm } from '../utils/format'
import { safeSearch, type ProposalForm } from '../utils/validation'
import { toCsv } from '../utils/csv'
import { STATUS_LABEL } from '../lib/constants'

export interface ProposalFilters {
  q?: string; statuses?: ProposalStatus[]; department_id?: string; category?: string; from?: string; to?: string
  facultyId?: string; page?: number; pageSize?: number
}

function applyFilters<Q extends { or: Function; in: Function; eq: Function; gte: Function; lte: Function }>(query: Q, f: ProposalFilters): Q {
  let q: any = query
  const s = safeSearch(f.q ?? '')
  if (s) q = q.or(`title.ilike.%${s}%,faculty_name.ilike.%${s}%,filing_number.ilike.%${s}%`)
  if (f.statuses?.length) q = q.in('status', f.statuses)
  if (f.department_id) q = q.eq('department_id', f.department_id)
  if (f.category) q = q.eq('category', f.category)
  if (f.facultyId) q = q.eq('faculty_id', f.facultyId)
  if (f.from) q = q.gte('proposed_date', f.from)
  if (f.to) q = q.lte('proposed_date', f.to)
  return q
}

export async function queryProposals(f: ProposalFilters): Promise<{ rows: Proposal[]; total: number }> {
  const page = f.page ?? 1, size = f.pageSize ?? 15
  const res = await applyFilters(supabase.from('proposals').select('*, departments(code,name)', { count: 'exact' }), f)
    .order('updated_at', { ascending: false }).range((page - 1) * size, page * size - 1)
  const rows = unwrap<Proposal[]>(res as never) ?? []
  return { rows, total: (res as { count: number | null }).count ?? rows.length }
}

export const EXPORT_COLUMNS = [
  { key: 'filing_number', label: 'Filing Number' }, { key: 'faculty_name', label: 'Faculty' }, { key: 'faculty_email', label: 'Email' },
  { key: 'department', label: 'Department' }, { key: 'title', label: 'Title' }, { key: 'category', label: 'Category' },
  { key: 'activity_type', label: 'Activity Type' }, { key: 'proposed_date', label: 'Proposed Date' }, { key: 'venue', label: 'Venue' },
  { key: 'status', label: 'Status' }, { key: 'submitted_at', label: 'Submitted' }, { key: 'forwarded_at', label: 'Forwarded' },
  { key: 'approved_at', label: 'Approved' }, { key: 'total_budget', label: 'Estimated Budget (INR)' },
]

/** Exports go through the same RLS-protected query as the screen, so they can never exceed the user's access. */
export async function exportProposalsCsv(f: ProposalFilters): Promise<{ csv: string; count: number }> {
  const rows = await fetchAll<Proposal>((from, to) =>
    applyFilters(supabase.from('proposals').select('*, departments(code,name)'), f).order('created_at').range(from, to) as never)
  const flat = rows.map((p) => ({ ...p, department: p.departments?.code ?? '', status: STATUS_LABEL[p.status] }))
  return { csv: toCsv(EXPORT_COLUMNS, flat), count: rows.length }
}

const EDIT_COLS = ['title', 'category', 'activity_type', 'proposed_date', 'start_time', 'end_time', 'venue', 'target_participants',
  'expected_participants', 'objectives', 'description', 'expected_outcomes', 'academic_relevance', 'iqac_relevance',
  'compliance_mapping', 'total_budget', 'funding_source', 'budget_details', 'resource_name', 'resource_org', 'resource_expertise',
  'resource_honorarium', 'resource_travel', 'resource_accommodation', 'resource_finance', 'mobile', 'declaration'] as const
const NUMERIC = new Set(['expected_participants', 'total_budget', 'resource_honorarium', 'resource_travel', 'resource_accommodation'])

export function toPayload(f: ProposalForm): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of EDIT_COLS) {
    const v = f[k]
    if (k === 'declaration') out[k] = v
    else if (NUMERIC.has(k)) out[k] = String(v).trim() === '' ? (k === 'total_budget' ? 0 : null) : Number(v)
    else out[k] = String(v).trim() === '' ? null : String(v).trim()
  }
  return out
}
export function formFromProposal(p: Proposal): ProposalForm {
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))
  return {
    title: s(p.title), category: s(p.category), activity_type: s(p.activity_type), proposed_date: s(p.proposed_date),
    start_time: hhmm(p.start_time), end_time: hhmm(p.end_time), venue: s(p.venue), target_participants: s(p.target_participants),
    expected_participants: s(p.expected_participants), objectives: s(p.objectives), description: s(p.description),
    expected_outcomes: s(p.expected_outcomes), academic_relevance: s(p.academic_relevance), iqac_relevance: s(p.iqac_relevance),
    compliance_mapping: s(p.compliance_mapping), total_budget: p.total_budget ? s(p.total_budget) : '', funding_source: s(p.funding_source),
    budget_details: s(p.budget_details), resource_name: s(p.resource_name), resource_org: s(p.resource_org),
    resource_expertise: s(p.resource_expertise), resource_honorarium: s(p.resource_honorarium), resource_travel: s(p.resource_travel),
    resource_accommodation: s(p.resource_accommodation), resource_finance: s(p.resource_finance), mobile: s(p.mobile),
    declaration: p.declaration,
  }
}

export async function saveDraft(id: string | null, form: ProposalForm): Promise<Proposal> {
  const payload = toPayload(form)
  if (id) {
    const rows = unwrap<Proposal[]>(await supabase.from('proposals').update(payload).eq('id', id).select('*, departments(code,name)') as never)
    if (!rows?.length) throw { message: 'This proposal can no longer be edited (it may have been submitted or you lack access).' }
    return rows[0]
  }
  return unwrap<Proposal>(await supabase.from('proposals').insert(payload).select('*, departments(code,name)').single() as never)
}

export async function deleteDraft(id: string): Promise<void> {
  const rows = unwrap<{ id: string }[]>(await supabase.from('proposals').delete().eq('id', id).select('id') as never)
  if (!rows?.length) throw { message: 'Only your own drafts can be deleted.' }
}

export interface ProposalDetail { proposal: Proposal; attachments: Attachment[]; actions: ApprovalAction[]; audit: AuditRow[] }

export async function getProposalDetail(id: string, withAudit: boolean): Promise<ProposalDetail> {
  const [p, att, act, aud] = await Promise.all([
    supabase.from('proposals').select('*, departments(code,name)').eq('id', id).maybeSingle(),
    supabase.from('proposal_attachments').select('id,storage_path,file_name,mime_type,size_bytes,kind,created_at').eq('proposal_id', id).order('created_at'),
    supabase.from('approval_actions').select('id,action,from_status,to_status,actor_name,actor_role,remarks,created_at').eq('proposal_id', id).order('created_at'),
    withAudit ? supabase.from('audit_logs').select('*').eq('entity_id', id).order('id', { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
  ])
  const proposal = unwrap<Proposal | null>(p as never)
  if (!proposal) throw { message: 'Proposal not found, or you do not have access to it.' }
  return { proposal, attachments: unwrap(att as never) ?? [], actions: unwrap(act as never) ?? [], audit: unwrap(aud as never) ?? [] }
}

type Rpc = 'submit_proposal' | 'hod_forward' | 'hod_return' | 'principal_start_review' | 'principal_return' | 'principal_disapprove' | 'principal_approve'
export async function proposalAction(fn: Rpc, id: string, remarks?: string): Promise<Proposal> {
  const args: Record<string, unknown> = { p_id: id }
  if (remarks !== undefined) args.p_remarks = remarks
  return unwrap<Proposal>(await supabase.rpc(fn, args) as never)
}
