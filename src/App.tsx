import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db/db'
import { getOpenSession } from './db/ops'
import { NotifyProvider } from './ui'
import Checkout from './screens/Checkout'
import Sales from './screens/Sales'
import Inventory from './screens/Inventory'
import Products from './screens/Products'
import Register from './screens/Register'
import Backup from './screens/Backup'

const TABS = [
  { id: 'checkout', label: '会計' },
  { id: 'sales', label: '売上・履歴' },
  { id: 'inventory', label: '在庫' },
  { id: 'products', label: '商品設定' },
  { id: 'register', label: 'レジ開始・締め' },
  { id: 'backup', label: 'バックアップ' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function App() {
  const [tab, setTab] = useState<TabId>('checkout')
  const [online, setOnline] = useState(navigator.onLine)
  const openSession = useLiveQuery(() => getOpenSession(db).then((s) => s ?? null), [])

  useEffect(() => {
    // ストレージの永続化を要求（ブラウザによる自動削除を防ぐ）
    navigator.storage?.persist?.().catch(() => {})
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  return (
    <NotifyProvider>
      <div className="flex h-dvh flex-col bg-white text-gray-900">
        <nav className="flex shrink-0 items-stretch gap-1 overflow-x-auto border-b border-gray-300 bg-gray-50 px-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`shrink-0 touch-manipulation border-b-4 px-4 py-3 text-base font-bold whitespace-nowrap ${
                tab === t.id ? 'border-blue-700 text-blue-800' : 'border-transparent text-gray-600'
              }`}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              {t.label}
            </button>
          ))}
          <div className="ml-auto flex shrink-0 items-center gap-3 pl-3 text-sm whitespace-nowrap">
            <span className={openSession ? 'text-green-800' : 'text-red-700'}>{openSession ? '● レジ営業中' : '● レジ未開始'}</span>
            <span className="text-gray-500">{online ? 'オンライン' : 'オフライン'}</span>
          </div>
        </nav>
        <main className="min-h-0 flex-1">
          {tab === 'checkout' ? (
            <Checkout sessionOpen={!!openSession} sessionLoaded={openSession !== undefined} goRegister={() => setTab('register')} />
          ) : (
            <div className="h-full overflow-auto p-4 md:p-6">
              {tab === 'sales' && <Sales />}
              {tab === 'inventory' && <Inventory />}
              {tab === 'products' && <Products />}
              {tab === 'register' && <Register />}
              {tab === 'backup' && <Backup />}
            </div>
          )}
        </main>
      </div>
    </NotifyProvider>
  )
}
