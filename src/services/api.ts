import { supabase } from '../lib/supabase'

export { supabase }
type Res<T> = { data: T | null; error: { message: string; code?: string } | null }

/** Throw on any error so callers can never report success for a failed request. */
export function unwrap<T>(r: Res<T>): T {
  if (r.error) throw r.error
  return r.data as T
}

/** Fetch every page of a query (used by exports / dashboards). */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<Res<T[]>>, page = 1000, cap = 50000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < cap; from += page) {
    const rows = unwrap(await build(from, from + page - 1)) ?? []
    out.push(...rows)
    if (rows.length < page) break
  }
  return out
}
