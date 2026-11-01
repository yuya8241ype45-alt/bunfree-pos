import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { adjustStock } from '../db/ops'
import { formatDateTime, parseYen } from '../lib/calc'
import { buildStockRows } from '../lib/summary'
import type { Product, StockLogType } from '../lib/types'
import { Button, Field, inputCls, Modal, PageTitle, td, tdNum, th, thNum, useNotify, useRunner } from '../ui'

const TYPE_LABEL: Record<StockLogType, string> = { sale: '販売', cancel: '取消', adjust: '在庫修正' }

export default function Inventory() {
  const products = useLiveQuery(() => db.products.orderBy('sortOrder').toArray(), [])
  const logs = useLiveQuery(() => db.stockLogs.orderBy('at').reverse().toArray(), [])
  const [target, setTarget] = useState<Product | null>(null)
  const [filter, setFilter] = useState('all')

  if (!products || !logs) return null
  const rows = buildStockRows(products, logs)
  const names = new Map(products.map((p) => [p.id, p.name]))
  const shownLogs = filter === 'all' ? logs : logs.filter((l) => l.productId === filter)

  return (
    <div className="mx-auto max-w-6xl">
      <PageTitle>在庫管理</PageTitle>
      <table className="mb-2 w-full border border-gray-200">
        <thead>
          <tr>
            <th className={th}>商品</th>
            <th className={thNum}>初期在庫（修正込み）</th>
            <th className={thNum}>販売数量</th>
            <th className={thNum}>現在庫</th>
            <th className={th}>状態</th>
            <th className={th}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ product: p, adjusted, sold, computed }) => (
            <tr key={p.id}>
              <td className={td}>
                <div className="font-bold">{p.name}</div>
                <div className="text-sm text-gray-500">{p.id}</div>
              </td>
              <td className={tdNum}>{adjusted}</td>
              <td className={tdNum}>{sold}</td>
              <td className={`${tdNum} text-2xl font-bold`}>{p.stock}</td>
              <td className={td}>
                {computed !== p.stock && <div className="font-bold text-red-700">履歴と不一致（計算上 {computed}）</div>}
                {!p.active ? '販売停止' : p.stock === 0 ? <span className="font-bold text-red-700">売り切れ</span> : '販売中'}
              </td>
              <td className={td}>
                <Button className="px-4 py-2" onClick={() => setTarget(p)}>
                  在庫を修正
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mb-8 text-sm text-gray-500">
        初期在庫（修正込み）＝在庫修正（搬入・棚卸など）の合計。販売数量は取消分を除いた数。現在庫＝初期在庫（修正込み）−販売数量。
      </p>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">在庫変更履歴（新しい順）</h2>
        <select className={`${inputCls} max-w-xs`} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="商品で絞り込み">
          <option value="all">すべての商品</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {shownLogs.length === 0 ? (
        <p className="text-gray-500">履歴はまだありません。</p>
      ) : (
        <table className="w-full border border-gray-200">
          <thead>
            <tr>
              <th className={th}>日時</th>
              <th className={th}>商品</th>
              <th className={th}>種別</th>
              <th className={thNum}>変更前</th>
              <th className={thNum}>増減</th>
              <th className={thNum}>変更後</th>
              <th className={th}>理由</th>
            </tr>
          </thead>
          <tbody>
            {shownLogs.map((l) => (
              <tr key={l.id}>
                <td className={`${td} whitespace-nowrap tabular-nums`}>{formatDateTime(l.at)}</td>
                <td className={td}>{names.get(l.productId) ?? l.productId}</td>
                <td className={td}>{TYPE_LABEL[l.type]}</td>
                <td className={tdNum}>{l.before}</td>
                <td className={tdNum}>{l.delta > 0 ? `+${l.delta}` : l.delta}</td>
                <td className={tdNum}>{l.after}</td>
                <td className={td}>{l.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {target && <AdjustDialog product={target} onClose={() => setTarget(null)} />}
    </div>
  )
}

function AdjustDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const [stockStr, setStockStr] = useState(String(product.stock))
  const [reason, setReason] = useState(product.stock === 0 ? '搬入（初期在庫）' : '')
  const { run, busy } = useRunner()
  const notify = useNotify()
  const newStock = parseYen(stockStr)
  const valid = newStock !== null && newStock !== product.stock && reason.trim() !== ''

  const submit = () =>
    run(async () => {
      await adjustStock(db, product.id, newStock!, reason)
      notify.info('在庫を修正しました')
      onClose()
    })

  return (
    <Modal
      title={`在庫を修正：${product.name}`}
      onClose={busy ? undefined : onClose}
      actions={
        <>
          <Button className="px-6 py-3 text-lg" disabled={busy} onClick={onClose}>
            やめる
          </Button>
          <Button variant="primary" className="px-6 py-3 text-lg" disabled={busy || !valid} onClick={submit}>
            修正する
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-lg">
          現在の在庫：<strong className="tabular-nums">{product.stock}</strong>
          {newStock !== null && newStock !== product.stock && (
            <>
              {' '}
              → <strong className="tabular-nums">{newStock}</strong>（{newStock > product.stock ? '+' : ''}
              {newStock - product.stock}）
            </>
          )}
        </p>
        <Field label="修正後の在庫数" hint={stockStr !== '' && newStock === null ? '0以上の整数で入力してください' : undefined}>
          <input className={inputCls} inputMode="numeric" value={stockStr} onChange={(e) => setStockStr(e.target.value)} />
        </Field>
        <Field label="理由（必須）">
          <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：搬入、棚卸で差異、破損" maxLength={100} />
        </Field>
      </div>
    </Modal>
  )
}
