import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useAsync } from '../hooks/useAsync'
import { queryProposals } from '../services/proposals'
import { Empty, ErrorBox, PageHead, Pager, Spinner } from '../components/ui'
import { ProposalTable } from '../components/ProposalTable'

export default function Review() {
  const { profile } = useAuth(); const hod = profile!.role === 'hod'; const [page, setPage] = useState(1)
  const res = useAsync(() => queryProposals({ statuses: hod ? ['hod_review'] : ['forwarded', 'principal_review'], page, pageSize: 15 }), [page, hod])
  return (
    <>
      <PageHead title={hod ? 'HOD review queue' : 'Principal review queue'} sub={hod ? 'Proposals from your department awaiting forward or return' : 'Proposals forwarded by HODs awaiting your decision'} />
      <div className="card">
        {res.loading ? <Spinner /> : res.error ? <ErrorBox message={res.error} onRetry={res.reload} />
          : !res.data?.rows.length ? <Empty>No proposals are waiting for you. 🎉</Empty>
          : <><ProposalTable rows={res.data.rows} /><Pager page={page} pageSize={15} total={res.data.total} onPage={setPage} /></>}
      </div>
    </>
  )
}
