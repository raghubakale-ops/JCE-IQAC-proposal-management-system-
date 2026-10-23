import { fetchAll, supabase, unwrap } from './api'
import type { ActivityReport, Attachment, ComplianceRow, Proposal, ReportAction, ReportExpense } from '../types'
import { hhmm } from '../utils/format'
import type { ReportForm } from '../utils/validation'

export interface ReportBundle {
  proposal: Proposal; report: ActivityReport | null; expenses: ReportExpense[]; attachments: Attachment[]; actions: ReportAction[]
}

export async function getReportBundle(proposalId: string): Promise<ReportBundle> {
  const pr = unwrap<Proposal | null>(await supabase.from('proposals').select('*, departments(code,name)').eq('id', proposalId).maybeSingle() as never)
  if (!pr) throw { message: 'Proposal not found, or you do not have access to it.' }
  const report = unwrap<ActivityReport | null>(await supabase.from('activity_reports').select('*').eq('proposal_id', proposalId).maybeSingle() as never)
  if (!report) return { proposal: pr, report: null, expenses: [], attachments: [], actions: [] }
  const [e, a, h] = await Promise.all([
    supabase.from('activity_report_expenses').select('id,head,amount,notes').eq('report_id', report.id).order('head'),
    supabase.from('activity_report_attachments').select('id,storage_path,file_name,mime_type,size_bytes,kind,created_at').eq('report_id', report.id).order('created_at'),
    supabase.from('report_actions').select('id,action,from_status,to_status,actor_name,remarks,created_at').eq('report_id', report.id).order('created_at'),
  ])
  return { proposal: pr, report, expenses: unwrap(e as never) ?? [], attachments: unwrap(a as never) ?? [], actions: unwrap(h as never) ?? [] }
}

export const startReport = async (proposalId: string) =>
  unwrap<ActivityReport>(await supabase.rpc('start_report', { p_proposal_id: proposalId }) as never)

export function reportFormFrom(r: ActivityReport | null): ReportForm {
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))
  return { actual_date: s(r?.actual_date), actual_start_time: hhmm(r?.actual_start_time), actual_end_time: hhmm(r?.actual_end_time),
    actual_participants: s(r?.actual_participants), actual_expenditure: s(r?.actual_expenditure),
    resource_person_details: s(r?.resource_person_details), sessions_conducted: s(r?.sessions_conducted),
    proceedings: s(r?.proceedings), outcomes: s(r?.outcomes), feedback_summary: s(r?.feedback_summary), deviations: s(r?.deviations) }
}

export async function saveReport(id: string, f: ReportForm, expenses: ReportExpense[], existing: ReportExpense[]): Promise<void> {
  const t = (v: string) => (v.trim() === '' ? null : v.trim())
  const payload = { actual_date: t(f.actual_date), actual_start_time: t(f.actual_start_time), actual_end_time: t(f.actual_end_time),
    actual_participants: f.actual_participants.trim() === '' ? null : Number(f.actual_participants),
    actual_expenditure: f.actual_expenditure.trim() === '' ? null : Number(f.actual_expenditure),
    resource_person_details: t(f.resource_person_details), sessions_conducted: t(f.sessions_conducted), proceedings: t(f.proceedings),
    outcomes: t(f.outcomes), feedback_summary: t(f.feedback_summary), deviations: t(f.deviations) }
  const rows = unwrap<{ id: string }[]>(await supabase.from('activity_reports').update(payload).eq('id', id).select('id') as never)
  if (!rows?.length) throw { message: 'This report can no longer be edited.' }
  // expenses: insert new, update changed, delete removed (in that order so a failure never loses data)
  const keep = new Set(expenses.filter((x) => x.id).map((x) => x.id))
  for (const x of expenses.filter((x) => !x.id && x.head.trim()))
    unwrap(await supabase.from('activity_report_expenses').insert({ report_id: id, head: x.head.trim(), amount: Number(x.amount) || 0, notes: x.notes ?? null }) as never)
  for (const x of expenses.filter((x) => x.id))
    unwrap(await supabase.from('activity_report_expenses').update({ head: x.head.trim(), amount: Number(x.amount) || 0, notes: x.notes ?? null }).eq('id', x.id!) as never)
  for (const x of existing.filter((x) => x.id && !keep.has(x.id)))
    unwrap(await supabase.from('activity_report_expenses').delete().eq('id', x.id!) as never)
}

export const submitReport = async (id: string) => unwrap<ActivityReport>(await supabase.rpc('submit_report', { p_id: id }) as never)
export const hodReviewReport = async (id: string, verify: boolean, remarks?: string) =>
  unwrap<ActivityReport>(await supabase.rpc('hod_review_report', { p_id: id, p_verify: verify, p_remarks: remarks ?? null }) as never)
export const iqacReviewReport = async (id: string, verify: boolean, remarks?: string) =>
  verify ? unwrap<ActivityReport>(await supabase.rpc('iqac_verify_report', { p_id: id, p_remarks: remarks ?? null }) as never)
         : unwrap<ActivityReport>(await supabase.rpc('iqac_return_report', { p_id: id, p_remarks: remarks ?? '' }) as never)

export async function listCompliance(): Promise<ComplianceRow[]> {
  return fetchAll<ComplianceRow>((from, to) => supabase.from('v_report_compliance').select('*').order('proposed_date', { ascending: false }).range(from, to) as never)
}
