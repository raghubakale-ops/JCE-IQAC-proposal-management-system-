import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, configured } from '../lib/supabase'
import { DOMAIN } from '../lib/constants'
import { friendlyError } from '../lib/errors'
import type { Profile } from '../types'

interface AuthCtx {
  loading: boolean; session: Session | null; profile: Profile | null; noRole: boolean; authError: string | null
  signIn: () => Promise<void>; signOut: () => Promise<void>; reloadProfile: () => void
}
const Ctx = createContext<AuthCtx | null>(null)
export const useAuth = () => { const c = useContext(Ctx); if (!c) throw new Error('AuthProvider missing'); return c }

function oauthErrorFromUrl(): string | null {
  const raw = (window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '') || window.location.search.slice(1)
  const p = new URLSearchParams(raw)
  const d = p.get('error_description') ?? p.get('error')
  if (!d) return null
  window.history.replaceState({}, '', window.location.pathname)
  if (/database error saving new user|DOMAIN_NOT_ALLOWED|EMAIL_NOT_VERIFIED/i.test(d))
    return `Sign-in was refused. Only verified @${DOMAIN} Google accounts are allowed.`
  return `Sign-in failed: ${d.replace(/\+/g, ' ')}`
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(configured)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [noRole, setNoRole] = useState(false)
  const [authError, setAuthError] = useState<string | null>(() => oauthErrorFromUrl())
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!configured) return
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (!data.session) setLoading(false) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); if (!s) { setProfile(null); setNoRole(false); setLoading(false) } })
    return () => sub.subscription.unsubscribe()
  }, [])

  const uid = session?.user.id
  const email = session?.user.email?.toLowerCase()
  useEffect(() => {
    if (!uid) return
    let cancelled = false
    ;(async () => {
      if (!email?.endsWith('@' + DOMAIN)) {   // cosmetic: the database already refuses other domains
        await supabase.auth.signOut(); if (!cancelled) setAuthError(`Only @${DOMAIN} accounts may sign in.`); return
      }
      setLoading(true)
      const r = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
      if (cancelled) return
      if (r.error) { setAuthError(friendlyError(r.error)); setProfile(null); setNoRole(false) }
      else if (!r.data || !r.data.is_active) { setProfile(null); setNoRole(true) }
      else { setProfile(r.data as Profile); setNoRole(false) }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [uid, email, tick])

  const signIn = useCallback(async () => {
    setAuthError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin, queryParams: { hd: DOMAIN, prompt: 'select_account' } },
    })
    if (error) setAuthError(friendlyError(error))
  }, [])
  const signOut = useCallback(async () => { await supabase.auth.signOut(); setProfile(null); setNoRole(false) }, [])
  const reloadProfile = useCallback(() => setTick((t) => t + 1), [])

  const value = useMemo(() => ({ loading, session, profile, noRole, authError, signIn, signOut, reloadProfile }),
    [loading, session, profile, noRole, authError, signIn, signOut, reloadProfile])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
