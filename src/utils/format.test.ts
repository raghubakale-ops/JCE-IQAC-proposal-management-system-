import { describe, expect, it } from 'vitest'
import { academicYearOf, academicYearRange, filingPreview } from './format'
import { csvCell, toCsv } from './csv'
import { friendlyError } from '../lib/errors'
import { emptyProposal, emptyReport, safeSearch, validateFile, validateProposal, validateReport } from './validation'

describe('academic year', () => {
  it('maps dates to academic years', () => {
    expect(academicYearOf('2026-06-01')).toBe('2026-27')
    expect(academicYearOf('2027-05-31')).toBe('2026-27')
    expect(academicYearOf('2027-06-01')).toBe('2027-28')
    expect(academicYearOf('2099-12-01')).toBe('2099-00')
  })
  it('gives the date range', () => { expect(academicYearRange('2026-27')).toEqual(['2026-06-01', '2027-05-31']) })
  it('previews filing numbers', () => { expect(filingPreview('JCE/IQAC', '2026-27', 3, 7)).toBe('JCE/IQAC/2026-27/007') })
})
describe('csv', () => {
  it('quotes and escapes', () => { expect(csvCell('a,"b"')).toBe('"a,""b"""') })
  it('neutralises formula injection', () => {
    for (const s of ['=1+1', '+cmd', '-2', '@SUM(A1)']) expect(csvCell(s).startsWith("'")).toBe(true)
    expect(csvCell('=HYPERLINK("x","y")')).toBe('"\'=HYPERLINK(""x"",""y"")"')
  })
  it('builds rows', () => {
    const out = toCsv([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], [{ a: 1, b: null }])
    expect(out).toBe('\uFEFFA,B\r\n1,')
  })
})
describe('validation', () => {
  it('draft only needs a title', () => {
    expect(validateProposal({ ...emptyProposal(), title: 'x' }, false)).toEqual({})
    expect(validateProposal(emptyProposal(), false).title).toBeTruthy()
  })
  it('submit requires fields and declaration', () => {
    const e = validateProposal({ ...emptyProposal(), title: 't' }, true)
    for (const k of ['category', 'venue', 'objectives', 'declaration', 'proposed_date']) expect(e).toHaveProperty(k)
  })
  it('rejects bad times and numbers', () => {
    const e = validateProposal({ ...emptyProposal(), title: 't', start_time: '10:00', end_time: '09:00', total_budget: '-1', expected_participants: '2.5' }, false)
    expect(e.end_time).toBeTruthy(); expect(e.total_budget).toBeTruthy(); expect(e.expected_participants).toBeTruthy()
  })
  it('files', () => {
    expect(validateFile({ name: 'a.pdf', size: 10 })).toBeNull()
    expect(validateFile({ name: 'a.exe', size: 10 })).toMatch(/only PDF/)
    expect(validateFile({ name: 'a.pdf', size: 11 * 1024 * 1024 })).toMatch(/10 MB/)
  })
  it('reports', () => {
    expect(Object.keys(validateReport(emptyReport(), true)).length).toBe(5)
    expect(validateReport(emptyReport(), false)).toEqual({})
  })
  it('sanitises search', () => { expect(safeSearch('a,b(c)%')).toBe('a b c') })
})
describe('friendlyError', () => {
  it('maps network errors from every browser', () => {
    for (const m of ['Failed to fetch', 'TypeError: fetch failed', 'Load failed', 'NetworkError when attempting to fetch resource.'])
      expect(friendlyError(new TypeError(m))).toMatch(/Nothing was saved/)
  })
  it('maps server prefixes', () => {
    expect(friendlyError({ message: 'VALIDATION: remarks are mandatory' })).toBe('remarks are mandatory')
    expect(friendlyError({ message: 'NO_ROLE: x' })).toMatch(/no active role/)
    expect(friendlyError({ message: 'x', code: '42501' })).toMatch(/permission/)
  })
})
