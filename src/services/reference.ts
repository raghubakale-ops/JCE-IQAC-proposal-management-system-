import { supabase, unwrap } from './api'
import type { Department, Settings } from '../types'

export async function loadDepartments(): Promise<Department[]> {
  return unwrap(await supabase.from('departments').select('id,code,name,is_active').order('code')) ?? []
}
export async function loadSettings(): Promise<Settings> {
  const rows = unwrap(await supabase.from('system_settings').select('key,value')) ?? []
  const m = Object.fromEntries(rows.map((r: { key: string; value: unknown }) => [r.key, r.value]))
  return {
    institution_name: String(m.institution_name ?? 'Jain College of Engineering, Belagavi'),
    filing_prefix: String(m.filing_prefix ?? 'JCE/IQAC'), academic_year: String(m.academic_year ?? ''),
    filing_digits: Number(m.filing_digits ?? 3), filing_start: Number(m.filing_start ?? 1),
    report_due_days: Number(m.report_due_days ?? 30),
    report_review_mode: (m.report_review_mode ?? 'hod_then_iqac') as Settings['report_review_mode'],
    report_required_kinds: (m.report_required_kinds ?? []) as Settings['report_required_kinds'],
  }
}
