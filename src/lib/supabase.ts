import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configured = Boolean(url && key && !url.includes('YOUR-PROJECT'))

// Only the public (anon / publishable) key is ever used in the browser; authorization is enforced by RLS.
export const supabase = createClient(configured ? url! : 'http://localhost:54321', configured ? key! : 'not-configured', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
})
