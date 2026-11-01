import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { PosError } from './db/ops'

export const btn = {
  base: 'inline-flex items-center justify-center rounded-md border font-bold select-none touch-manipulation disabled:opacity-35 disabled:pointer-events-none active:translate-y-px',
  primary: 'border-blue-700 bg-blue-700 text-white active:bg-blue-800',
  secondary: 'border-gray-300 bg-white text-gray-900 active:bg-gray-100',
  danger: 'border-red-700 bg-red-700 text-white active:bg-red-800',
  dangerOutline: 'border-red-300 bg-white text-red-700 active:bg-red-50',
}

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof Omit<typeof btn, 'base'> }) {
  return <button type="button" className={`${btn.base} ${btn[variant]} ${className}`} {...props} />
}

export const inputCls =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-lg focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200'

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-bold text-gray-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-sm text-gray-500">{hint}</span>}
    </label>
  )
}

export function Modal({
  title,
  children,
  actions,
  onClose,
  wide,
}: {
  title: string
  children: ReactNode
  actions: ReactNode
  onClose?: () => void
  wide?: boolean
}) {
  useEffect(() => {
    if (!onClose) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`flex max-h-full w-full flex-col rounded-lg bg-white ${wide ? 'max-w-3xl' : 'max-w-lg'}`}>
        <h2 className="border-b border-gray-200 px-5 py-4 text-xl font-bold">{title}</h2>
        <div className="overflow-auto px-5 py-4">{children}</div>
        <div className="flex justify-end gap-3 border-t border-gray-200 px-5 py-4">{actions}</div>
      </div>
    </div>
  )
}

// ---------- 通知 ----------

type Notice = { kind: 'error' | 'info'; message: string }
const NotifyContext = createContext<{ error: (e: unknown) => void; info: (m: string) => void }>({
  error: () => {},
  info: () => {},
})

export function errorMessage(e: unknown): string {
  if (e instanceof PosError) return e.message
  const name = e instanceof Error ? e.name : ''
  const msg = e instanceof Error ? e.message : String(e)
  if (name === 'QuotaExceededError' || /quota/i.test(msg)) {
    return 'データを保存できませんでした（端末の保存容量が不足しています）。処理は確定していません。'
  }
  return `データを保存できませんでした。処理は確定していません。\n（${name ? name + ': ' : ''}${msg}）`
}

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null)
  const timer = useRef<number>(undefined)
  const api = useRef({
    error: (e: unknown) => {
      console.error(e)
      setNotice({ kind: 'error', message: errorMessage(e) })
    },
    info: (message: string) => {
      setNotice({ kind: 'info', message })
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setNotice((n) => (n?.kind === 'info' ? null : n)), 2500)
    },
  }).current
  return (
    <NotifyContext.Provider value={api}>
      {children}
      {notice?.kind === 'error' && (
        <Modal
          title="エラー"
          onClose={() => setNotice(null)}
          actions={
            <Button variant="primary" className="px-8 py-3 text-lg" onClick={() => setNotice(null)}>
              閉じる
            </Button>
          }
        >
          <p className="whitespace-pre-wrap text-lg text-red-800">{notice.message}</p>
        </Modal>
      )}
      {notice?.kind === 'info' && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-gray-900 px-6 py-3 text-lg text-white" role="status">
          {notice.message}
        </div>
      )}
    </NotifyContext.Provider>
  )
}

export const useNotify = () => useContext(NotifyContext)

/** 非同期処理を1つずつ実行する（実行中の再実行は無視）。失敗時はエラーを表示して false を返す */
export function useRunner() {
  const notify = useNotify()
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    try {
      await fn()
      return true
    } catch (e) {
      notify.error(e)
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  return { run, busy }
}

export function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

export function PageTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">{children}</h1>
      {right && <div className="flex flex-wrap gap-2">{right}</div>}
    </div>
  )
}

export function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white px-4 py-3">
      <div className="text-sm text-gray-600">{label}</div>
      <div className={`tabular-nums font-bold ${strong ? 'text-3xl' : 'text-2xl'}`}>{value}</div>
    </div>
  )
}

export const th = 'border-b border-gray-300 bg-gray-50 px-3 py-2 text-left text-sm font-bold text-gray-700 whitespace-nowrap'
export const td = 'border-b border-gray-200 px-3 py-2 align-top'
export const tdNum = `${td} text-right tabular-nums whitespace-nowrap`
export const thNum = `${th} text-right`
