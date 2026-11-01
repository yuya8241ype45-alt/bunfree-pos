import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { addProduct, moveProduct, updateProduct } from '../db/ops'
import { MAX_PRICE, parseYen, yen } from '../lib/calc'
import type { Product } from '../lib/types'
import { Button, Field, inputCls, Modal, PageTitle, td, tdNum, th, thNum, useNotify, useRunner } from '../ui'

export default function Products() {
  const products = useLiveQuery(() => db.products.orderBy('sortOrder').toArray(), [])
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const { run, busy } = useRunner()

  if (!products) return null

  return (
    <div className="mx-auto max-w-5xl">
      <PageTitle
        right={
          <Button variant="primary" className="px-4 py-2" onClick={() => setEditing('new')}>
            商品を追加
          </Button>
        }
      >
        商品設定
      </PageTitle>
      <table className="mb-2 w-full border border-gray-200">
        <thead>
          <tr>
            <th className={th}>表示順</th>
            <th className={th}>商品ID</th>
            <th className={th}>商品名</th>
            <th className={thNum}>販売単価</th>
            <th className={thNum}>在庫</th>
            <th className={th}>販売状態</th>
            <th className={th}></th>
          </tr>
        </thead>
        <tbody>
          {products.map((p, i) => (
            <tr key={p.id} className={p.active ? '' : 'bg-gray-100 text-gray-500'}>
              <td className={td}>
                <div className="flex gap-1">
                  <Button className="h-11 w-11" aria-label={`${p.name}を上へ`} disabled={busy || i === 0} onClick={() => run(() => moveProduct(db, p.id, -1))}>
                    ↑
                  </Button>
                  <Button
                    className="h-11 w-11"
                    aria-label={`${p.name}を下へ`}
                    disabled={busy || i === products.length - 1}
                    onClick={() => run(() => moveProduct(db, p.id, 1))}
                  >
                    ↓
                  </Button>
                </div>
              </td>
              <td className={td}>{p.id}</td>
              <td className={`${td} font-bold`}>{p.name}</td>
              <td className={`${tdNum} text-lg font-bold`}>{yen(p.price)}</td>
              <td className={tdNum}>{p.stock}</td>
              <td className={td}>{p.active ? '販売中' : '販売停止'}</td>
              <td className={td}>
                <Button className="px-4 py-2" onClick={() => setEditing(p)}>
                  編集
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-gray-500">
        価格を変更しても、すでに確定した会計の金額は変わりません（会計時の価格で保存しています）。在庫数は「在庫」画面で修正します。商品は削除できないため、扱わなくなった商品は販売停止にしてください。
      </p>

      {editing && <EditDialog product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function EditDialog({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const [name, setName] = useState(product?.name ?? '')
  const [priceStr, setPriceStr] = useState(product ? String(product.price) : '')
  const [active, setActive] = useState(product?.active ?? true)
  const [confirming, setConfirming] = useState(false)
  const { run, busy } = useRunner()
  const notify = useNotify()

  const price = parseYen(priceStr, MAX_PRICE)
  const valid = name.trim() !== '' && price !== null
  const priceChanged = product !== null && price !== null && price !== product.price
  const changed = product === null || name.trim() !== product.name || priceChanged || active !== product.active

  const save = () =>
    run(async () => {
      if (product) {
        await updateProduct(db, product.id, { name, price: price!, active })
        notify.info('商品を更新しました')
      } else {
        const p = await addProduct(db, name, price!)
        notify.info(`${p.id} を追加しました。在庫画面で在庫数を入力してください`)
      }
      onClose()
    })

  if (confirming && product) {
    return (
      <Modal
        title="価格を変更しますか？"
        onClose={busy ? undefined : () => setConfirming(false)}
        actions={
          <>
            <Button className="px-6 py-3 text-lg" disabled={busy} onClick={() => setConfirming(false)}>
              戻る
            </Button>
            <Button variant="primary" className="px-6 py-3 text-lg" disabled={busy} onClick={save}>
              変更する
            </Button>
          </>
        }
      >
        <p className="text-lg">
          「{product.name}」の販売単価を
          <br />
          <strong className="text-2xl tabular-nums">{yen(product.price)}</strong> → <strong className="text-2xl tabular-nums text-blue-800">{yen(price!)}</strong>
          <br />
          に変更します。
        </p>
        <p className="mt-3 text-gray-700">これから行う会計に適用されます。過去の会計の金額は変わりません。</p>
      </Modal>
    )
  }

  return (
    <Modal
      title={product ? `商品を編集：${product.id}` : '商品を追加'}
      onClose={busy ? undefined : onClose}
      actions={
        <>
          <Button className="px-6 py-3 text-lg" disabled={busy} onClick={onClose}>
            やめる
          </Button>
          <Button variant="primary" className="px-6 py-3 text-lg" disabled={busy || !valid || !changed} onClick={() => (priceChanged ? setConfirming(true) : save())}>
            {priceChanged ? '確認へ' : '保存する'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="商品名">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </Field>
        <Field label="販売単価（円）" hint={priceStr !== '' && price === null ? `0〜${MAX_PRICE.toLocaleString('ja-JP')}の整数で入力してください` : undefined}>
          <input className={inputCls} inputMode="numeric" value={priceStr} onChange={(e) => setPriceStr(e.target.value)} />
        </Field>
        {product && (
          <fieldset>
            <legend className="mb-1 text-sm font-bold text-gray-700">販売状態</legend>
            <div className="flex gap-2">
              <Button variant={active ? 'primary' : 'secondary'} className="flex-1 py-3 text-lg" onClick={() => setActive(true)} aria-pressed={active}>
                販売中
              </Button>
              <Button variant={!active ? 'primary' : 'secondary'} className="flex-1 py-3 text-lg" onClick={() => setActive(false)} aria-pressed={!active}>
                販売停止
              </Button>
            </div>
          </fieldset>
        )}
      </div>
    </Modal>
  )
}
