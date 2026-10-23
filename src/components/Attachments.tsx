import { useRef, useState } from 'react'
import type { Attachment, AttachmentKind } from '../types'
import { ACCEPT, KIND_LABEL } from '../lib/constants'
import { friendlyError } from '../lib/errors'
import { fmtBytes } from '../utils/format'
import { validateFile } from '../utils/validation'
import { openAttachment, removeAttachment, type Bucket } from '../services/attachments'
import { Select } from './fields'
import { useToast } from '../hooks/useToast'

export function AttachmentList({ items, bucket, canRemove, onChanged }: { items: Attachment[]; bucket: Bucket; canRemove?: boolean; onChanged?: () => void }) {
  const toast = useToast(); const [busy, setBusy] = useState<string | null>(null)
  if (!items.length) return <div className="hint">No files attached.</div>
  return (
    <div>
      {items.map((a) => (
        <div className="filechip" key={a.id}>
          <span><b>{a.file_name}</b> <span className="hint">· {KIND_LABEL[a.kind]} · {fmtBytes(a.size_bytes)}</span></span>
          <span className="actions">
            <button type="button" className="btn small" disabled={busy === a.id}
              onClick={async () => { setBusy(a.id); try { await openAttachment(bucket, a.storage_path) } catch (e) { toast(friendlyError(e), 'error') } setBusy(null) }}>Open</button>
            {canRemove && <button type="button" className="btn small bad" disabled={busy === a.id}
              onClick={async () => { if (!window.confirm(`Remove "${a.file_name}"?`)) return; setBusy(a.id)
                try { await removeAttachment(bucket, a); toast('File removed.', 'success'); onChanged?.() } catch (e) { toast(friendlyError(e), 'error') } setBusy(null) }}>Remove</button>}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Picks files, validates them client-side (the server re-validates), and hands them to `onPick`. */
export function FilePicker({ id, kinds, defaultKind, onPick, disabled, remaining }: {
  id: string; kinds?: AttachmentKind[]; defaultKind: AttachmentKind; onPick: (files: File[], kind: AttachmentKind) => void; disabled?: boolean; remaining: number
}) {
  const [kind, setKind] = useState<AttachmentKind>(defaultKind); const ref = useRef<HTMLInputElement>(null); const [err, setErr] = useState<string | null>(null)
  return (
    <div>
      {kinds && <Select id={id + '-kind'} label="File type" value={kind} onChange={(v) => setKind((v || defaultKind) as AttachmentKind)} options={kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />}
      <div className="field" style={{ marginTop: 8 }}>
        <label htmlFor={id}>Add files</label>
        <input id={id} ref={ref} type="file" multiple accept={ACCEPT} disabled={disabled || remaining <= 0}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]; if (ref.current) ref.current.value = ''
            if (files.length > remaining) { setErr(`You can add ${remaining} more file(s).`); return }
            const bad = files.map(validateFile).filter(Boolean); if (bad.length) { setErr(bad.join(' ')); return }
            setErr(null); onPick(files, kind)
          }} />
        <div className="hint">PDF, DOC/DOCX, XLS/XLSX, JPG, PNG · max 10 MB each · {remaining} more allowed</div>
        {err && <div className="err" role="alert">{err}</div>}
      </div>
    </div>
  )
}
