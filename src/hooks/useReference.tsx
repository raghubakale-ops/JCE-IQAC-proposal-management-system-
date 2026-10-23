import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useAsync } from './useAsync'
import { loadDepartments, loadSettings } from '../services/reference'
import type { Department, Settings } from '../types'

interface Ref { departments: Department[]; settings: Settings | null; deptCode: (id?: string | null) => string; deptName: (id?: string | null) => string; refreshSettings: () => void }
const Ctx = createContext<Ref | null>(null)
export const useRef_ = () => { const c = useContext(Ctx); if (!c) throw new Error('ReferenceProvider missing'); return c }

export function ReferenceProvider({ children }: { children: ReactNode }) {
  const d = useAsync(loadDepartments, [])
  const s = useAsync(loadSettings, [])
  const value = useMemo<Ref>(() => {
    const departments = d.data ?? []
    const by = new Map(departments.map((x) => [x.id, x]))
    return { departments, settings: s.data, deptCode: (id) => (id ? by.get(id)?.code ?? '—' : '—'),
      deptName: (id) => (id ? by.get(id)?.name ?? '—' : '—'), refreshSettings: s.reload }
  }, [d.data, s.data, s.reload])
  if (d.loading || s.loading) return <div className="center"><span className="spinner" aria-label="Loading" /></div>
  if (d.error || s.error) return <div className="center"><div className="errorbox" role="alert">{d.error ?? s.error}</div></div>
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
