import { supabase } from './api'
import type { Department, Settings } from '../types'
import { DEMO_DEPARTMENTS } from '../lib/demoStore'

export async function loadDepartments(): Promise<Department[]> {
  try {
    const res = await supabase.from('departments').select('id,code,name,is_active').order('code')
    if (res.error) {
      if (res.error.message.includes('schema cache') || res.error.code === 'PGRST205') {
        return DEMO_DEPARTMENTS
      }
      throw res.error
    }
    return res.data ?? DEMO_DEPARTMENTS
  } catch (err: any) {
    if (err?.message?.includes('schema cache') || err?.code === 'PGRST205' || err?.message?.includes('relation')) {
      return DEMO_DEPARTMENTS
    }
    return DEMO_DEPARTMENTS
  }
}

export async function loadSettings(): Promise<Settings> {
  try {
    const res = await supabase.from('system_settings').select('key,value')
    if (res.error || !res.data?.length) {
      return {
        institution_name: 'Jain College of Engineering, Belagavi',
        filing_prefix: 'JCE/IQAC', academic_year: '2025-2026',
        filing_digits: 3, filing_start: 1,
        report_due_days: 30,
        report_review_mode: 'hod_then_iqac',
        report_required_kinds: [],
      }
    }
    const m = Object.fromEntries(res.data.map((r: { key: string; value: unknown }) => [r.key, r.value]))
    return {
      institution_name: String(m.institution_name ?? 'Jain College of Engineering, Belagavi'),
      filing_prefix: String(m.filing_prefix ?? 'JCE/IQAC'), academic_year: String(m.academic_year ?? '2025-2026'),
      filing_digits: Number(m.filing_digits ?? 3), filing_start: Number(m.filing_start ?? 1),
      report_due_days: Number(m.report_due_days ?? 30),
      report_review_mode: (m.report_review_mode ?? 'hod_then_iqac') as Settings['report_review_mode'],
      report_required_kinds: (m.report_required_kinds ?? []) as Settings['report_required_kinds'],
    }
  } catch {
    return {
      institution_name: 'Jain College of Engineering, Belagavi',
      filing_prefix: 'JCE/IQAC', academic_year: '2025-2026',
      filing_digits: 3, filing_start: 1,
      report_due_days: 30,
      report_review_mode: 'hod_then_iqac',
      report_required_kinds: [],
    }
  }
}
