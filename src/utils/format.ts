import { AY_START_MONTH } from '../lib/constants'

export const fmtDateTime = (v?: string | null) => {
  if (!v) return '—'
  const d = new Date(v)
  return isNaN(d.getTime()) ? String(v) : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}
export const fmtDate = (v?: string | null) => {
  if (!v) return '—'
  const d = new Date(v.length === 10 ? v + 'T00:00:00' : v)
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-IN', { dateStyle: 'medium' })
}
export const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : '')
export const inr = (n?: number | string | null) => (n === null || n === undefined || n === '' ? '—' : '₹ ' + Number(n).toLocaleString('en-IN'))
export const fmtBytes = (n: number) => (n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB')
export const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || 'JCE'

/** Academic year label ("2026-27") a date falls in, for a year starting in `startMonth` (1-12). */
export function academicYearOf(date: string | Date, startMonth = AY_START_MONTH): string {
  const d = typeof date === 'string' ? new Date(date.length === 10 ? date + 'T00:00:00' : date) : date
  const y = d.getMonth() + 1 >= startMonth ? d.getFullYear() : d.getFullYear() - 1
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`
}
/** [from, to] ISO dates covering an academic year label. */
export function academicYearRange(label: string, startMonth = AY_START_MONTH): [string, string] {
  const y = Number(label.slice(0, 4))
  const from = `${y}-${String(startMonth).padStart(2, '0')}-01`
  const end = new Date(Date.UTC(y + 1, startMonth - 1, 0))
  return [from, end.toISOString().slice(0, 10)]
}
export function academicYearOptions(now = new Date(), back = 4): string[] {
  const cur = Number(academicYearOf(now).slice(0, 4))
  return Array.from({ length: back + 1 }, (_, i) => { const y = cur + 1 - i; return `${y}-${String((y + 1) % 100).padStart(2, '0')}` })
}
export const filingPreview = (prefix: string, year: string, digits: number, seq = 1) =>
  `${prefix}/${year}/${String(seq).padStart(digits, '0')}`
