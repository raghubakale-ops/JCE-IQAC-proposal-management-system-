import { useAuth } from '../hooks/useAuth'
import { DOMAIN } from '../lib/constants'

const Brand = () => (
  <div className="loginbrand"><div className="logo">JCE</div>
    <h2 style={{ margin: '12px 0 4px' }}>Jain College of Engineering, Belagavi</h2>
    <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>IQAC Proposal Management System</p></div>
)

export function LoginPage() {
  const { signIn, authError } = useAuth()
  return (
    <div className="login"><div className="loginbox">
      <Brand />
      {authError && <div className="errorbox" role="alert" style={{ marginTop: 18 }}>{authError}</div>}
      <div className="loginbuttons">
        <button className="btn primary" style={{ padding: 13 }} onClick={signIn}>Sign in with your @{DOMAIN} Google account</button>
      </div>
      <p className="note" style={{ marginTop: 18 }}>Access is limited to verified institutional accounts. Your role and department are assigned by the IQAC office; signing in does not grant access by itself.</p>
    </div></div>
  )
}

export function NoRolePage() {
  const { signOut, session, reloadProfile } = useAuth()
  return (
    <div className="login"><div className="loginbox">
      <Brand />
      <div className="banner warn" role="alert" style={{ marginTop: 18 }}>
        <b>No role assigned.</b> You are signed in as {session?.user.email}, but the IQAC office has not assigned you a role (or your access is deactivated). Please contact the IQAC Coordinator and ask to be added to the staff directory, then try again.
      </div>
      <div className="loginbuttons"><button className="btn primary" onClick={reloadProfile}>Check again</button><button className="btn" onClick={signOut}>Sign out</button></div>
    </div></div>
  )
}

export function SetupPage() {
  return (
    <div className="login"><div className="loginbox">
      <Brand />
      <div className="banner warn" role="alert" style={{ marginTop: 18 }}>
        <b>Application not configured.</b> The Supabase connection settings are missing. Set <span className="mono">VITE_SUPABASE_URL</span> and <span className="mono">VITE_SUPABASE_ANON_KEY</span> in your hosting environment (or a local <span className="mono">.env</span> file) and rebuild. See the README.
      </div>
    </div></div>
  )
}
