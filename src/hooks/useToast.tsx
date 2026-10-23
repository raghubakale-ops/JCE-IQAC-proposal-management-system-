import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type Kind = 'success' | 'error' | 'info'
interface T { id: number; msg: string; kind: Kind }
const Ctx = createContext<{ toast: (msg: string, kind?: Kind) => void }>({ toast: () => {} })
export const useToast = () => useContext(Ctx).toast

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([])
  const toast = useCallback((msg: string, kind: Kind = 'info') => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x, { id, msg, kind }])
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'error' ? 7000 : 3500)
  }, [])
  const value = useMemo(() => ({ toast }), [toast])
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast" style={{ background: t.kind === 'error' ? '#b42318' : t.kind === 'success' ? '#157347' : '#172033' }}>{t.msg}</div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
