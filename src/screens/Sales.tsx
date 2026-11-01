import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { cancelSale } from '../db/ops'
import { formatDateTime, yen } from '../lib/calc'
import { productSalesCsv, salesCsv } from '../lib/csv'
import { buildDashboard } from '../lib/summary'
import { PAYMENT_LABEL, type Sale } from '../lib/types'
import { Button, Field, inputCls, Modal, PageTitle, Stat, download, stamp, td, tdNum, th, thNum, useNotify, useRunner } from '../ui'

export default function Sales() {
  const sales = useLiveQuery(() => db.sales.orderBy('createdAt').reverse().toArray(), [])
  const products = useLiveQuery(() => db.products.orderBy('sortOrder').toArray(), [])
  const sessions = useLiveQuery(() => db.sessions.orderBy('openedAt').toArray(), [])
  const [filter, setFilter] = useState('all')
  const [target, setTarget] = useState<Sale | null>(null)

  if (!sales || !products || !sessions) return null

  const shown = filter === 'all' ? sales : sales.filter((s) => String(s.sessionId) === filter)
  const d = buildDashboard(shown, products)
  const suffix = filter === 'all' ? '全期間' : `レジ${filter}`

  return (
    <div className="mx-auto max-w-6xl">
      <PageTitle
        right={
          <>
            <Button className="px-4 py-2" onClick={() => download(`売上履歴_${suffix}_${stamp()}.csv`, salesCsv(shown), 'text/csv')}>
              売上履歴CSV
            </Button>
            <Button className="px-4 py-2" onClick={() => download(`商品別売上_${suffix}_${stamp()}.csv`, productSalesCsv(d), 'text/csv')}>
              商品別売上CSV
            </Button>
          </>
        }
      >
        売上・会計履歴
      </PageTitle>

      <div className="mb-4 flex items-center gap-3">
        <label htmlFor="session-filter" className="font-bold">
          集計範囲
        </label>
        <select id="session-filter" className={`${inputCls} max-w-md`} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">全期間</option>
          {sessions.map((s) => (
            <option key={s.id} value={String(s.id)}>
              レジ{s.id}（{formatDateTime(s.openedAt)} 開始{s.closedAt ? '・締め済み' : '・営業中'}）
            </option>
          ))}
        </select>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="累計売上金額" value={yen(d.totalSales)} strong />
        <Stat label="うち現金" value={yen(d.cashSales)} />
        <Stat label="うちPayPay" value={yen(d.paypaySales)} />
        <Stat label="会計件数" value={`${d.count}件`} />
        <Stat label="販売点数" value={`${d.qty}点`} />
        <Stat label="平均客単価" value={yen(d.average)} />
      </div>
      <p className="-mt-4 mb-6 text-sm text-gray-500">取消した会計は集計に含めていません。平均客単価は1円未満を四捨五入しています。</p>

      <h2 className="mb-2 text-xl font-bold">商品別</h2>
      <table className="mb-8 w-full border border-gray-200">
        <thead>
          <tr>
            <th className={th}>商品ID</th>
            <th className={th}>商品名</th>
            <th className={thNum}>販売数量</th>
            <th className={thNum}>売上金額</th>
          </tr>
        </thead>
        <tbody>
          {d.byProduct.map((p) => (
            <tr key={p.productId}>
              <td className={td}>{p.productId}</td>
              <td className={td}>{p.name}</td>
              <td className={tdNum}>{p.qty}</td>
              <td className={tdNum}>{yen(p.amount)}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className={td} colSpan={2}>
              合計
            </td>
            <td className={tdNum}>{d.qty}</td>
            <td className={tdNum}>{yen(d.totalSales)}</td>
          </tr>
        </tbody>
      </table>

      <h2 className="mb-2 text-xl font-bold">会計履歴（新しい順）</h2>
      {shown.length === 0 ? (
        <p className="text-gray-500">会計はまだありません。</p>
      ) : (
        <table className="w-full border border-gray-200">
          <thead>
            <tr>
              <th className={th}>No.</th>
              <th className={th}>日時</th>
              <th className={th}>明細</th>
              <th className={th}>支払</th>
              <th className={thNum}>合計</th>
              <th className={thNum}>預かり</th>
              <th className={thNum}>お釣り</th>
              <th className={th}>状態</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id} className={s.status === 'cancelled' ? 'bg-gray-100 text-gray-500' : ''}>
                <td className={tdNum}>{s.no}</td>
                <td className={`${td} whitespace-nowrap tabular-nums`}>{formatDateTime(s.createdAt)}</td>
                <td className={td}>
                  {s.items.map((i) => (
                    <div key={i.productId}>
                      {i.name} <span className="tabular-nums">{yen(i.unitPrice)}×{i.qty}</span>
                    </div>
                  ))}
                  {s.status === 'cancelled' && (
                    <div className="mt-1 text-sm text-red-700">
                      取消 {formatDateTime(s.cancelledAt!)}：{s.cancelReason}（返金 {yen(s.refundAmount ?? 0)}）
                    </div>
                  )}
                </td>
                <td className={`${td} whitespace-nowrap ${s.paymentMethod === 'paypay' ? 'font-bold text-red-700' : ''}`}>{PAYMENT_LABEL[s.paymentMethod]}</td>
                <td className={`${tdNum} ${s.status === 'cancelled' ? 'line-through' : 'font-bold'}`}>{yen(s.total)}</td>
                <td className={tdNum}>{s.paymentMethod === 'paypay' ? '—' : yen(s.received)}</td>
                <td className={tdNum}>{s.paymentMethod === 'paypay' ? '—' : yen(s.change)}</td>
                <td className={td}>{s.status === 'normal' ? '正常' : <span className="font-bold text-red-700">取消</span>}</td>
                <td className={td}>
                  {s.status === 'normal' && (
                    <Button variant="dangerOutline" className="px-3 py-1.5" onClick={() => setTarget(s)}>
                      取消
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {target && <CancelDialog sale={target} onClose={() => setTarget(null)} />}
    </div>
  )
}

function CancelDialog({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const { run, busy } = useRunner()
  const notify = useNotify()
  const submit = () =>
    run(async () => {
      await cancelSale(db, sale.id, reason)
      notify.info(`会計No.${sale.no}を取消しました`)
      onClose()
    })
  return (
    <Modal
      title={`会計No.${sale.no}を取消しますか？`}
      onClose={busy ? undefined : onClose}
      actions={
        <>
          <Button className="px-6 py-3 text-lg" disabled={busy} onClick={onClose}>
            やめる
          </Button>
          <Button variant="danger" className="px-6 py-3 text-lg" disabled={busy || !reason.trim()} onClick={submit}>
            取消して返金する
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <table className="w-full">
          <tbody>
            {sale.items.map((i) => (
              <tr key={i.productId}>
                <td className="py-1">{i.name}</td>
                <td className="py-1 text-right tabular-nums">
                  {yen(i.unitPrice)} × {i.qty}
                </td>
                <td className="py-1 text-right tabular-nums">{yen(i.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="rounded-md border-2 border-red-300 bg-red-50 p-3 text-lg">
          {sale.paymentMethod === 'paypay' ? (
            <>
              PayPayで支払われた会計です。<strong className="text-2xl tabular-nums">{yen(sale.total)}</strong> の返金は、
              <strong>PayPay for Business のアプリ・管理画面</strong>から行ってください。レジの現金からは返金しません。
            </>
          ) : (
            <>
              お客様に <strong className="text-2xl tabular-nums">{yen(sale.total)}</strong> を現金で返金してください。
            </>
          )}
          <div className="mt-1 text-base text-gray-700">売上集計から除外し、在庫を戻します。履歴は「取消」として残ります。</div>
        </div>
        <Field label="取消理由（必須）">
          <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：打ち間違い、返品" maxLength={100} />
        </Field>
      </div>
    </Modal>
  )
}
