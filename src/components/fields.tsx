import type { ReactNode } from 'react'

interface Base { id: string; label: string; error?: string; required?: boolean; full?: boolean; hint?: string }
const wrap = (b: Base, input: ReactNode) => (
  <div className={`field ${b.full ? 'full' : ''}`}>
    <label htmlFor={b.id}>{b.label}{b.required ? ' *' : ''}</label>{input}
    {b.hint && !b.error && <div className="hint">{b.hint}</div>}
    {b.error && <div className="err" id={b.id + '-err'} role="alert">{b.error}</div>}
  </div>
)
const aria = (b: Base) => ({ id: b.id, 'aria-invalid': b.error ? true : undefined, 'aria-describedby': b.error ? b.id + '-err' : undefined, className: b.error ? 'invalid' : '' })

export function Text(p: Base & { value: string; onChange: (v: string) => void; type?: string; readOnly?: boolean; min?: string; step?: string; maxLength?: number }) {
  return wrap(p, <input {...aria(p)} type={p.type ?? 'text'} value={p.value} readOnly={p.readOnly} min={p.min} step={p.step} maxLength={p.maxLength} onChange={(e) => p.onChange(e.target.value)} />)
}
export function Area(p: Base & { value: string; onChange: (v: string) => void; readOnly?: boolean }) {
  return wrap(p, <textarea {...aria(p)} value={p.value} readOnly={p.readOnly} onChange={(e) => p.onChange(e.target.value)} />)
}
export function Select(p: Base & { value: string; onChange: (v: string) => void; options: readonly string[] | { value: string; label: string }[]; disabled?: boolean }) {
  const opts = (p.options as (string | { value: string; label: string })[]).map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
  return wrap(p, <select {...aria(p)} value={p.value} disabled={p.disabled} onChange={(e) => p.onChange(e.target.value)}>
    <option value="">Select…</option>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>)
}
export function Check(p: Base & { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <div className="field full"><label className="check" htmlFor={p.id}>
      <input id={p.id} type="checkbox" checked={p.checked} aria-invalid={p.error ? true : undefined} onChange={(e) => p.onChange(e.target.checked)} /><span>{p.children}</span></label>
      {p.error && <div className="err" role="alert">{p.error}</div>}</div>
  )
}
export const ReadBlock = ({ label, value, full }: { label: string; value?: ReactNode; full?: boolean }) => (
  <div className={`field ${full ? 'full' : ''}`}><label>{label}</label>
    <div style={{ padding: '10px 11px', border: '1px solid var(--line)', borderRadius: 9, background: '#fbfcfe', fontSize: 12, whiteSpace: 'pre-wrap' }}>
      {value === undefined || value === null || value === '' ? '—' : value}</div></div>
)
