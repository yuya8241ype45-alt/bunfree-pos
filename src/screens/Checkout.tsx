import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { checkout } from '../db/ops'
import { changeFor, newId, yen } from '../lib/calc'
import type { PaymentMethod, Sale } from '../lib/types'
import { Button, useRunner } from '../ui'

const SHORTCUTS = [1000, 2000, 5000, 10000]
const MAX_DIGITS = 7

type Props = { sessionOpen: boolean; sessionLoaded: boolean; goRegister: () => void }

export default function Checkout({ sessionOpen, sessionLoaded, goRegister }: Props) {
  const products = useLiveQuery(() => db.products.orderBy('sortOrder').toArray(), [])
  const [cart, setCart] = useState<Record<string, number>>({})
  const [receivedStr, setReceivedStr] = useState('')
  const [checkoutId, setCheckoutId] = useState(newId)
  const [done, setDone] = useState<Sale | null>(null)
  const { run, busy } = useRunner()

  const lines = useMemo(() => {
    if (!products) return []
    return products
      .filter((p) => (cart[p.id] ?? 0) > 0)
      .map((p) => ({ product: p, qty: cart[p.id], subtotal: p.price * cart[p.id] }))
  }, [products, cart])

  const total = lines.reduce((s, l) => s + l.subtotal, 0)
  const totalQty = lines.reduce((s, l) => s + l.qty, 0)
  const received = receivedStr === '' ? 0 : Number(receivedStr)
  const change = changeFor(total, received)
  const cartProblem = lines.find((l) => !l.product.active || l.qty > l.product.stock)
  const ready = sessionOpen && lines.length > 0 && receivedStr !== '' && !cartProblem && !busy
  const canCash = ready && change !== null
  // PayPay はお客様のスマホに表示された支払い金額を入力し、合計と一致したときだけ確定できる
  const canPayPay = ready && received === total
  const payPayMismatch = lines.length > 0 && receivedStr !== '' && received !== total

  const setQty = (id: string, qty: number) =>
    setCart((c) => {
      const next = { ...c }
      if (qty <= 0) delete next[id]
      else next[id] = qty
      return next
    })

  const press = (key: string) => {
    if (key === 'back') return setReceivedStr((s) => s.slice(0, -1))
    setReceivedStr((s) => {
      const next = (s === '0' ? '' : s) + key
      return next.length > MAX_DIGITS ? s : next.replace(/^0+(?=\d)/, '')
    })
  }

  const reset = () => {
    setCart({})
    setReceivedStr('')
  }

  const confirm = (paymentMethod: PaymentMethod) =>
    run(async () => {
      const sale = await checkout(db, {
        id: checkoutId,
        lines: lines.map((l) => ({ productId: l.product.id, qty: l.qty })),
        paymentMethod,
        received,
        expectedTotal: total,
      })
      setDone(sale)
    })

  const next = () => {
    reset()
    setCheckoutId(newId())
    setDone(null)
  }

  if (done) return <Completed sale={done} onNext={next} />

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_400px]">
      {/* 左：商品選択 */}
      <section className="overflow-auto p-4" aria-label="商品選択">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {products?.map((p) => {
            const qty = cart[p.id] ?? 0
            const soldOut = p.stock <= 0
            const unavailable = !p.active || soldOut
            return (
              <div
                key={p.id}
                className={`flex flex-col rounded-lg border-2 ${qty > 0 ? 'border-blue-600 bg-blue-50' : 'border-gray-300 bg-white'} ${
                  unavailable ? 'opacity-50' : ''
                }`}
              >
                <button
                  type="button"
                  className="touch-manipulation px-4 pt-3 pb-2 text-left disabled:pointer-events-none"
                  disabled={unavailable || qty >= p.stock}
                  onClick={() => setQty(p.id, qty + 1)}
                >
                  <div className="text-xl leading-snug font-bold">{p.name}</div>
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className="text-2xl font-bold tabular-nums">{yen(p.price)}</span>
                    <span className={`text-base ${soldOut ? 'font-bold text-red-700' : 'text-gray-600'}`}>
                      {!p.active ? '販売停止' : soldOut ? '売り切れ' : `在庫 ${p.stock}`}
                    </span>
                  </div>
                </button>
                <div className="flex items-center gap-2 px-3 pb-3">
                  <Button className="h-16 w-20 text-3xl" aria-label={`${p.name}を1つ減らす`} disabled={qty <= 0} onClick={() => setQty(p.id, qty - 1)}>
                    −
                  </Button>
                  <div className="flex-1 text-center text-3xl font-bold tabular-nums" aria-label="数量">
                    {qty}
                  </div>
                  <Button
                    variant="primary"
                    className="h-16 w-20 text-3xl"
                    aria-label={`${p.name}を1つ増やす`}
                    disabled={unavailable || qty >= p.stock}
                    onClick={() => setQty(p.id, qty + 1)}
                  >
                    ＋
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* 右：会計 */}
      <section className="flex min-h-0 flex-col border-l border-gray-300 bg-gray-50" aria-label="会計">
        {sessionLoaded && !sessionOpen && (
          <div className="flex items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-4 py-3">
            <span className="font-bold text-red-800">レジが開始されていません</span>
            <Button variant="primary" className="px-4 py-2" onClick={goRegister}>
              レジを開始
            </Button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto px-4 pt-3">
          {lines.length === 0 ? (
            <p className="py-6 text-center text-gray-500">商品を選んでください</p>
          ) : (
            <table className="w-full text-base">
              <tbody>
                {lines.map((l) => (
                  <tr key={l.product.id} className="border-b border-gray-200">
                    <td className="py-1.5 pr-2">
                      {l.product.name}
                      <div className="text-sm text-gray-600 tabular-nums">
                        {yen(l.product.price)} × {l.qty}
                      </div>
                    </td>
                    <td className="py-1.5 text-right font-bold tabular-nums whitespace-nowrap">{yen(l.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {cartProblem && (
            <p className="mt-2 font-bold text-red-700">「{cartProblem.product.name}」は在庫不足か販売停止です。数量を減らしてください。</p>
          )}
        </div>

        <div className="border-t border-gray-300 bg-white px-4 py-2">
          <div className="flex items-baseline justify-between">
            <span className="text-gray-700">点数 {totalQty}点</span>
            <span className="text-sm text-gray-600">合計</span>
          </div>
          <div className="text-right text-4xl font-bold tabular-nums">{yen(total)}</div>
        </div>

        <div className="space-y-2 border-t border-gray-300 px-4 py-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-gray-300 bg-white px-3 py-1">
              <div className="flex items-center justify-between text-sm text-gray-600">
                預かり／支払額
                <button type="button" className="touch-manipulation px-2 text-sm font-bold text-blue-700" onClick={() => setReceivedStr('')}>
                  クリア
                </button>
              </div>
              <div className="text-right text-2xl font-bold tabular-nums">{receivedStr === '' ? '—' : yen(received)}</div>
            </div>
            <div className={`rounded-md border px-3 py-1 ${receivedStr !== '' && change === null ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'}`}>
              <div className="text-sm text-gray-600">お釣り</div>
              <div className="text-right text-2xl font-bold tabular-nums">
                {receivedStr === '' ? '—' : change === null ? <span className="text-lg text-red-700">{yen(total - received)}不足</span> : yen(change)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '00', 'back'].map((k) => (
              <Button
                key={k}
                className="h-14 text-2xl"
                aria-label={k === 'back' ? '1文字消す' : k}
                onClick={() => press(k)}
              >
                {k === 'back' ? '⌫' : k}
              </Button>
            ))}
            <div className="col-start-4 row-span-4 row-start-1 grid grid-rows-5 gap-1.5">
              <Button className="text-base" disabled={total === 0} onClick={() => setReceivedStr(String(total))}>
                ちょうど
              </Button>
              {SHORTCUTS.map((v) => (
                <Button key={v} className="text-base tabular-nums" onClick={() => setReceivedStr(String(v))}>
                  {v.toLocaleString('ja-JP')}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-[1fr_1.4fr_1.8fr] gap-2 pb-1">
            <Button variant="dangerOutline" className="h-16 text-lg" disabled={busy || (lines.length === 0 && receivedStr === '')} onClick={reset}>
              リセット
            </Button>
            <Button variant="paypay" className="h-16 text-xl" disabled={!canPayPay} onClick={() => confirm('paypay')}>
              PayPay
            </Button>
            <Button variant="primary" className="h-16 text-xl" disabled={!canCash} onClick={() => confirm('cash')}>
              {busy ? '保存中…' : '現金で確定'}
            </Button>
          </div>
          {payPayMismatch && <p className="-mt-1 text-sm text-gray-600">PayPayは、合計と同じ金額を入力したときに押せます</p>}
        </div>
      </section>
    </div>
  )
}

function Completed({ sale, onNext }: { sale: Sale; onNext: () => void }) {
  if (sale.paymentMethod === 'paypay') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 bg-white p-6">
        <div className="text-xl font-bold text-green-800">PayPayの会計を記録しました（会計No.{sale.no}）</div>
        <div className="w-full max-w-md rounded-lg border-2 border-red-600 bg-red-50 p-6 text-center">
          <div className="text-lg font-bold text-red-800">PayPay支払い</div>
          <div className="text-6xl font-bold tabular-nums">{yen(sale.total)}</div>
        </div>
        <p className="text-gray-700">お客様のスマホの支払い完了画面を確認してください。</p>
        <Button variant="primary" className="h-20 w-full max-w-md text-2xl" onClick={onNext} autoFocus>
          次のお客様へ
        </Button>
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-white p-6">
      <div className="text-xl font-bold text-green-800">会計が完了しました（会計No.{sale.no}）</div>
      <div className="grid w-full max-w-3xl grid-cols-3 gap-4 text-center">
        <div className="rounded-lg border border-gray-300 p-4">
          <div className="text-lg text-gray-600">合計</div>
          <div className="text-4xl font-bold tabular-nums">{yen(sale.total)}</div>
        </div>
        <div className="rounded-lg border border-gray-300 p-4">
          <div className="text-lg text-gray-600">お預かり</div>
          <div className="text-4xl font-bold tabular-nums">{yen(sale.received)}</div>
        </div>
        <div className="rounded-lg border-2 border-blue-700 bg-blue-50 p-4">
          <div className="text-lg font-bold text-blue-900">お釣り</div>
          <div className="text-6xl font-bold tabular-nums text-blue-900">{yen(sale.change)}</div>
        </div>
      </div>
      <Button variant="primary" className="h-20 w-full max-w-md text-2xl" onClick={onNext} autoFocus>
        次のお客様へ
      </Button>
    </div>
  )
}
