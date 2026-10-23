import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { ToastProvider } from './hooks/useToast'
import { ReferenceProvider } from './hooks/useReference'
import { AppLayout } from './layouts/AppLayout'
import { Spinner } from './components/ui'
import { configured } from './lib/supabase'
import type { Role } from './types'
import { LoginPage, NoRolePage, SetupPage } from './pages/Login'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Proposals = lazy(() => import('./pages/Proposals'))
const ProposalForm = lazy(() => import('./pages/ProposalForm'))
const ProposalDetail = lazy(() => import('./pages/ProposalDetail'))
const Review = lazy(() => import('./pages/Review'))
const Reports = lazy(() => import('./pages/Reports'))
const ReportPage = lazy(() => import('./pages/ReportPage'))
const Filing = lazy(() => import('./pages/Filing'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Notifications = lazy(() => import('./pages/Notifications'))
const Admin = lazy(() => import('./pages/Admin'))
const Guide = lazy(() => import('./pages/Guide'))

function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { profile } = useAuth()
  if (!profile || !roles.includes(profile.role)) return <div className="card"><h3>Not available</h3><p>Your role does not have access to this page.</p></div>
  return <>{children}</>
}

function Shell() {
  const { loading, session, profile, noRole } = useAuth()
  if (!configured) return <SetupPage />
  if (loading) return <div className="login"><Spinner label="Signing you in…" /></div>
  if (!session) return <LoginPage />
  if (noRole || !profile) return <NoRolePage />
  const all: Role[] = ['faculty', 'hod', 'principal', 'iqac']
  return (
    <ReferenceProvider>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="proposals" element={<Proposals />} />
            <Route path="proposals/new" element={<Guard roles={['faculty', 'hod']}><ProposalForm /></Guard>} />
            <Route path="proposals/:id" element={<ProposalDetail />} />
            <Route path="proposals/:id/edit" element={<Guard roles={['faculty', 'hod']}><ProposalForm /></Guard>} />
            <Route path="review" element={<Guard roles={['hod', 'principal']}><Review /></Guard>} />
            <Route path="reports" element={<Guard roles={all}><Reports /></Guard>} />
            <Route path="reports/:proposalId" element={<Guard roles={all}><ReportPage /></Guard>} />
            <Route path="filing" element={<Guard roles={['principal', 'iqac']}><Filing /></Guard>} />
            <Route path="analytics" element={<Guard roles={['hod', 'principal', 'iqac']}><Analytics /></Guard>} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="admin" element={<Guard roles={['iqac']}><Admin /></Guard>} />
            <Route path="guide" element={<Guide />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </ReferenceProvider>
  )
}

export default function App() {
  return <BrowserRouter><ToastProvider><AuthProvider><Shell /></AuthProvider></ToastProvider></BrowserRouter>
}
