import { fetchAll, supabase, unwrap } from './api'
import type { AuditRow, FilingRow, NotificationRow, Settings, StaffRow } from '../types'
import { safeSearch } from '../utils/validation'
import { toCsv } from '../utils/csv'

// ---------- notifications ----------
export async function listNotifications(limit = 100): Promise<NotificationRow[]> {
  return unwrap(await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(limit) as never) ?? []
}
export async function unreadCount(): Promise<number> {
  const r = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('is_read', false)
  if (r.error) throw r.error
  return r.count ?? 0
}
export async function markRead(ids?: string[]): Promise<void> {
  unwrap(await supabase.rpc('mark_notifications_read', { p_ids: ids ?? null }) as never)
}

// ---------- filing register ----------
export interface FilingFilters { q?: string; academic_year?: string; department_id?: string; page?: number; pageSize?: number }
function filingQuery(f: FilingFilters, count: boolean) {
  let q: any = supabase.from('filing_register')
    .select('id,filing_number,academic_year,sequence_no,generated_at,proposal_id,proposals!inner(title,faculty_name,department_id,approved_at,status)', count ? { count: 'exact' } : undefined)
  const s = safeSearch(f.q ?? '')
  if (s) q = q.or(`filing_number.ilike.%${s}%`)
  if (f.academic_year) q = q.eq('academic_year', f.academic_year)
  if (f.department_id) q = q.eq('proposals.department_id', f.department_id)
  return q
}
export async function queryFiling(f: FilingFilters): Promise<{ rows: FilingRow[]; total: number }> {
  const page = f.page ?? 1, size = f.pageSize ?? 20
  const res = await filingQuery(f, true).order('generated_at', { ascending: false }).range((page - 1) * size, page * size - 1)
  const rows = unwrap<FilingRow[]>(res) ?? []
  return { rows, total: res.count ?? rows.length }
}
export async function exportFilingCsv(f: FilingFilters, deptName: (id: string) => string): Promise<{ csv: string; count: number }> {
  const rows = await fetchAll<FilingRow>((from, to) => filingQuery(f, false).order('sequence_no').range(from, to))
  const flat = rows.map((r, i) => ({ sl: i + 1, filing_number: r.filing_number, academic_year: r.academic_year,
    generated_at: r.generated_at, department: r.proposals ? deptName(r.proposals.department_id) : '',
    faculty: r.proposals?.faculty_name, title: r.proposals?.title, approved_at: r.proposals?.approved_at, status: r.proposals?.status }))
  return { count: rows.length, csv: toCsv([{ key: 'sl', label: 'Sl.' }, { key: 'filing_number', label: 'Filing Number' }, { key: 'academic_year', label: 'Academic Year' },
    { key: 'generated_at', label: 'Generated' }, { key: 'department', label: 'Department' }, { key: 'faculty', label: 'Faculty' },
    { key: 'title', label: 'Proposal Title' }, { key: 'approved_at', label: 'Principal Approval' }, { key: 'status', label: 'Status' }], flat) }
}

// ---------- administration (IQAC) ----------
export async function listStaff(): Promise<StaffRow[]> {
  return unwrap(await supabase.from('staff_directory').select('id,email,full_name,role,department_id,designation,employee_id,is_active').order('full_name') as never) ?? []
}
export async function upsertStaff(s: { email: string; full_name: string; role: string; dept_code: string | null; designation: string; employee_id: string; active: boolean }) {
  return unwrap(await supabase.rpc('admin_upsert_staff', { p_email: s.email, p_full_name: s.full_name, p_role: s.role, p_dept_code: s.dept_code,
    p_designation: s.designation || null, p_employee_id: s.employee_id || null, p_active: s.active }) as never)
}
export interface HodGrant { staff_id: string; department_id: string }
export async function listHodGrants(): Promise<HodGrant[]> {
  return unwrap(await supabase.from('hod_extra_departments').select('staff_id,department_id') as never) ?? []
}
export async function setHodDepartment(email: string, deptCode: string, grant: boolean) {
  unwrap(await supabase.rpc('admin_set_hod_department', { p_email: email, p_dept_code: deptCode, p_grant: grant }) as never)
}
export async function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  unwrap(await supabase.rpc('admin_update_setting', { p_key: key, p_value: value }) as never)
}
export interface AuditFilters { action?: string; entity_type?: string; from?: string; to?: string; page?: number; pageSize?: number }
export async function queryAudit(f: AuditFilters): Promise<{ rows: AuditRow[]; total: number }> {
  const page = f.page ?? 1, size = f.pageSize ?? 25
  let q: any = supabase.from('audit_logs').select('*', { count: 'exact' })
  if (f.action) q = q.ilike('action', `%${safeSearch(f.action)}%`)
  if (f.entity_type) q = q.eq('entity_type', f.entity_type)
  if (f.from) q = q.gte('created_at', f.from)
  if (f.to) q = q.lte('created_at', f.to + 'T23:59:59')
  const res = await q.order('id', { ascending: false }).range((page - 1) * size, page * size - 1)
  const rows = unwrap<AuditRow[]>(res) ?? []
  return { rows, total: res.count ?? rows.length }
}

// ---------- dashboards / analytics (rows already limited by RLS) ----------
export interface LightProposal {
  id: string; title: string; status: string; department_id: string; category: string | null; proposed_date: string | null
  created_at: string; updated_at: string; submitted_at: string | null; approved_at: string | null; faculty_id: string
  faculty_name: string; filing_number: string | null; author_role: string
}
export async function fetchLightProposals(): Promise<LightProposal[]> {
  return fetchAll<LightProposal>((from, to) => supabase.from('proposals')
    .select('id,title,status,department_id,category,proposed_date,created_at,updated_at,submitted_at,approved_at,faculty_id,faculty_name,filing_number,author_role')
    .order('created_at', { ascending: false }).range(from, to) as never)
}
