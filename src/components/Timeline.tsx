import { fmtDateTime } from '../utils/format'

export interface Step { title: string; at?: string | null; state?: 'done' | 'current' | 'todo'; note?: string }
export function Timeline({ steps }: { steps: Step[] }) {
  return (
    <div className="timeline" role="list">
      {steps.map((s) => (
        <div role="listitem" key={s.title} className={`step ${s.state === 'done' || (s.state === undefined && s.at) ? 'done' : s.state === 'current' ? 'current' : ''}`}>
          <div className="dot" /><div className="t">{s.title}</div>
          <div className="s">{s.at ? fmtDateTime(s.at) : s.note ?? 'Pending'}</div>
        </div>
      ))}
    </div>
  )
}
