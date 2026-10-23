import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useRef_ } from '../hooks/useReference'
import { ROLE_LABEL } from '../lib/constants'
import { initials } from '../utils/format'
import { unreadCount } from '../services/misc'
import type { Role } from '../types'

interface Item { to: string; label: string; roles: Role[]; end?: boolean }
const NAV: { title: string; items: Item[] }[] = [
  { title: 'Overview', items: [{ to: '/', label: 'Dashboard', roles: ['faculty', 'hod', 'principal', 'iqac'], end: true }] },
  { title: 'Proposals', items: [
    { to: '/proposals/new', label: 'New Proposal', roles: ['faculty', 'hod'] },
    { to: '/proposals', label: 'Proposals', roles: ['faculty', 'hod', 'principal', 'iqac'], end: true },
    { to: '/review', label: 'Review Queue', roles: ['hod', 'principal'] }] },
  { title: 'After the activity', items: [{ to: '/reports', label: 'Activity Reports', roles: ['faculty', 'hod', 'principal', 'iqac'] }] },
  { title: 'Institution', items: [
    { to: '/filing', label: 'Filing Register', roles: ['principal', 'iqac'] },
    { to: '/analytics', label: 'Analytics', roles: ['hod', 'principal', 'iqac'] },
    { to: '/admin', label: 'Administration', roles: ['iqac'] }] },
  { title: 'Help', items: [{ to: '/notifications', label: 'Notifications', roles: ['faculty', 'hod', 'principal', 'iqac'] },
    { to: '/guide', label: 'User Guide', roles: ['faculty', 'hod', 'principal', 'iqac'] }] },
]

export function AppLayout() {
  const { profile, signOut } = useAuth(); const { settings, deptCode } = useRef_()
  const [open, setOpen] = useState(false); const [unread, setUnread] = useState(0); const loc = useLocation()
  useEffect(() => { setOpen(false) }, [loc.pathname])
  useEffect(() => {
    let live = true
    const poll = () => unreadCount().then((n) => { if (live) setUnread(n) }).catch(() => {})
    poll(); const t = setInterval(poll, 60000); window.addEventListener('focus', poll)
    return () => { live = false; clearInterval(t); window.removeEventListener('focus', poll) }
  }, [loc.pathname])
  if (!profile) return null
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <div className="brand">
          <button className="btn no-print mobnav" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>☰</button>
          <div className="logo">JCE</div>
          <div><h1>{settings?.institution_name}</h1><p>IQAC Proposal Management System</p></div>
        </div>
        <div className="userbox">
          <span className="rolepill">{ROLE_LABEL[profile.role]}{profile.department_id ? ` · ${deptCode(profile.department_id)}` : ''}</span>
          <div className="avatar" aria-hidden="true">{initials(profile.full_name)}</div>
          <div style={{ fontSize: 12 }}><b>{profile.full_name}</b><div className="small" style={{ color: 'var(--muted)' }}>{profile.email}</div></div>
          <button className="btn small" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <div className="layout">
        <nav className={`sidebar no-print ${open ? 'open' : ''}`} aria-label="Main">
          {NAV.map((g) => {
            const items = g.items.filter((i) => i.roles.includes(profile.role)); if (!items.length) return null
            return <div key={g.title}><div className="navtitle">{g.title}</div>
              {items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `navbtn ${isActive ? 'active' : ''}`} style={{ textDecoration: 'none' }}>
                  {i.label}{i.to === '/notifications' && unread > 0 && <span className="count" aria-label={`${unread} unread`}>{unread}</span>}
                </NavLink>))}</div>
          })}
        </nav>
        <main className="main" id="main"><Outlet /></main>
      </div>
    </>
  )
}
