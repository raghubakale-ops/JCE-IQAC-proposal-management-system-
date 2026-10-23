/** Turn Supabase / PostgREST / network errors into messages a coordinator can act on. */
const PREFIXES = ['VALIDATION', 'INVALID_STATE', 'INVALID_TRANSITION', 'FORBIDDEN', 'NO_ROLE', 'NOT_FOUND',
  'UPLOAD_MISSING', 'IMMUTABLE', 'DOMAIN_NOT_ALLOWED', 'EMAIL_NOT_VERIFIED']

export function friendlyError(e: unknown): string {
  const err = e as { message?: string; code?: string; name?: string } | null
  const msg = String(err?.message ?? e ?? 'Unknown error')
  if (/failed to fetch|fetch failed|networkerror|load failed|network request failed|econnrefused|enotfound/i.test(msg)) {
    return 'Network problem: the server could not be reached. Nothing was saved. Check your connection and try again.'
  }
  for (const p of PREFIXES) {
    if (msg.includes(p + ':')) {
      const text = msg.slice(msg.indexOf(p + ':') + p.length + 1).trim()
      if (p === 'NO_ROLE') return 'Your account has no active role assignment. Please contact the IQAC Coordinator.'
      if (p === 'INVALID_STATE' || p === 'INVALID_TRANSITION') return `This action is not allowed in the current state. ${text}`
      return text
    }
  }
  if (err?.code === '42501' || /permission denied|row-level security/i.test(msg)) return 'You do not have permission to do that.'
  if (err?.code === '23505') return 'That record already exists.'
  if (/jwt|not authenticated|invalid claim/i.test(msg)) return 'Your session has expired. Please sign in again.'
  return msg
}
