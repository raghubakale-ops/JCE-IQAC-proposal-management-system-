import { useEffect, useRef, useState, type ReactNode } from 'react'
import { REPORT_CLASS, REPORT_LABEL, STATUS_CLASS, STATUS_LABEL } from '../lib/constants'
import { friendlyError } from '../lib/errors'
import type { ProposalStatus, ReportStatus } from '../types'

export const Spinner = ({ label = 'Loading…' }: { label?: string }) => <div className="center" role="status"><span className="spinner" /><span>{label}</span></div>
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="errorbox" role="alert"><span>{message}</span>{onRetry && <button className="btn small" onClick={onRetry}>Retry</button>}</div>
}
export const Banner = ({ tone, children }: { tone: 'warn' | 'info' | 'good'; children: ReactNode }) => <div className={`banner ${tone}`} role="note">{children}</div>
export const StatusBadge = ({ s }: { s: ProposalStatus }) => <span className={`badge ${STATUS_CLASS[s]}`}>{STATUS_LABEL[s]}</span>
export const ReportBadge = ({ s }: { s: ReportStatus | null | undefined }) => <span className={`badge ${REPORT_CLASS[s ?? 'none']}`}>{REPORT_LABEL[s ?? 'none']}</span>
export const Kpi = ({ label, value, sub, onClick }: { label: string; value: ReactNode; sub?: string; onClick?: () => void }) => (
  <div className="card kpi" style={onClick ? { cursor: 'pointer' } : undefined} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
    onKeyDown={(e) => { if (onClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick() } }}>
    <div className="label">{label}</div><div className="value">{value}</div><div className="sub">{sub}</div>
  </div>
)
export const PageHead = ({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) => (
  <div className="pagehead"><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div><div className="actions no-print">{children}</div></div>
)

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  return (
    <div className="pager no-print">
      <span>{from}–{Math.min(total, page * pageSize)} of {total}</span>
      <span className="actions">
        <button className="btn small" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span style={{ alignSelf: 'center' }}>Page {page} of {pages}</span>
        <button className="btn small" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </span>
    </div>
  )
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab' && ref.current) {   // keep focus inside the dialog
        const f = ref.current.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])')
        if (!f.length) return
        const first = f[0], last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); prev?.focus() }
  }, [onClose])
  return (
    <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modalbox" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} style={wide ? undefined : { maxWidth: 560 }}>
        <div className="modalhead"><h3 style={{ margin: 0 }}>{title}</h3><button className="close" aria-label="Close" onClick={onClose}>×</button></div>
        <div className="modalbody">{children}</div>
      </div>
    </div>
  )
}

/** Confirmation dialog, optionally collecting mandatory remarks. Stays open and shows the error if the action fails. */
export function ConfirmDialog(p: {
  title: string; message?: ReactNode; confirmLabel: string; tone?: 'primary' | 'good' | 'bad' | 'warn'
  remarks?: 'none' | 'optional' | 'required'; onConfirm: (remarks: string) => Promise<void>; onClose: () => void
}) {
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const mode = p.remarks ?? 'none'
  const go = async () => {
    if (mode === 'required' && !text.trim()) { setErr('Remarks are mandatory for this action.'); return }
    setBusy(true); setErr(null)
    try { await p.onConfirm(text.trim()) } catch (e) { setErr(friendlyError(e)); setBusy(false) }
  }
  return (
    <Modal title={p.title} onClose={busy ? () => {} : p.onClose}>
      {p.message && <div style={{ fontSize: 13, marginBottom: 12 }}>{p.message}</div>}
      {mode !== 'none' && (
        <div className="field"><label htmlFor="remarks">Remarks{mode === 'required' ? ' *' : ' (optional)'}</label>
          <textarea id="remarks" value={text} onChange={(e) => setText(e.target.value)} className={err && !text.trim() && mode === 'required' ? 'invalid' : ''} /></div>
      )}
      {err && <div className="errorbox" role="alert" style={{ marginTop: 10 }}>{err}</div>}
      <div className="footeractions"><button className="btn" disabled={busy} onClick={p.onClose}>Cancel</button>
        <button className={`btn ${p.tone ?? 'primary'}`} disabled={busy} onClick={go}>{busy ? 'Working…' : p.confirmLabel}</button></div>
    </Modal>
  )
}
