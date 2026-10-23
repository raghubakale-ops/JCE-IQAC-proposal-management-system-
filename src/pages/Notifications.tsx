import { useNavigate } from 'react-router-dom'
import { useAsync } from '../hooks/useAsync'
import { useToast } from '../hooks/useToast'
import { listNotifications, markRead } from '../services/misc'
import { Empty, ErrorBox, PageHead, Spinner } from '../components/ui'
import { friendlyError } from '../lib/errors'
import { fmtDateTime } from '../utils/format'

export default function Notifications() {
  const res = useAsync(() => listNotifications(), []); const nav = useNavigate(); const toast = useToast()
  const open = async (id: string, read: boolean, proposal: string | null, report: string | null) => {
    try { if (!read) await markRead([id]) } catch (e) { toast(friendlyError(e), 'error') }
    if (report && proposal) nav(`/reports/${proposal}`); else if (proposal) nav(`/proposals/${proposal}`); else res.reload()
  }
  return (
    <>
      <PageHead title="Notifications" sub="Only you can see these">
        <button className="btn" disabled={!res.data?.some((n) => !n.is_read)} onClick={async () => { try { await markRead(); res.reload(); toast('All marked as read.', 'success') } catch (e) { toast(friendlyError(e), 'error') } }}>Mark all read</button></PageHead>
      <div className="card">{res.loading ? <Spinner /> : res.error ? <ErrorBox message={res.error} onRetry={res.reload} /> : !res.data?.length ? <Empty>You have no notifications.</Empty> :
        res.data.map((n) => (
          <button key={n.id} className="filechip" style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => open(n.id, n.is_read, n.proposal_id, n.report_id)}>
            <span className={n.is_read ? '' : 'unread'}>{!n.is_read && <span className="dotmark" aria-label="Unread" />}{n.title}<div className="hint">{n.message}</div></span>
            <span className="small" style={{ color: 'var(--muted)' }}>{fmtDateTime(n.created_at)}</span></button>))}</div>
    </>
  )
}
