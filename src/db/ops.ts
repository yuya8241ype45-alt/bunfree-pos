import {
  changeFor,
  denomTotal,
  expectedCash,
  isPositiveInt,
  isYen,
  judge,
  lineSubtotal,
  MAX_AMOUNT,
  MAX_PRICE,
} from '../lib/calc'
import type { CashSummary, Closing, Denoms, PaymentMethod, Product, Sale, SaleItem, Session } from '../lib/types'
import type { PosDB } from './db'

/** 利用者に見せるエラー。メッセージはそのまま画面に出す */
export class PosError extends Error {}

const now = () => new Date().toISOString()

function fail(message: string): never {
  throw new PosError(message)
}

export async function getOpenSession(db: PosDB): Promise<Session | undefined> {
  return db.sessions.filter((s) => !s.closedAt).first()
}

async function requireOpenSession(db: PosDB): Promise<Session & { id: number }> {
  const s = await getOpenSession(db)
  if (!s || s.id === undefined) fail('レジが開始されていません。レジ締め画面でレジを開始してください。')
  return s as Session & { id: number }
}

// ---------- 会計 ----------

export type CheckoutInput = {
  /** 二重会計防止用の会計ID。同じIDで2回呼んでも1件しか保存されない */
  id: string
  lines: { productId: string; qty: number }[]
  paymentMethod: PaymentMethod
  /** 現金：預かり金額 / PayPay：お客様が支払った金額（合計と一致しなければ確定しない） */
  received: number
  /** 画面に表示していた合計金額。DB上の価格と食い違えば確定しない */
  expectedTotal: number
}

/** 会計確定・在庫減算・在庫履歴の保存を単一トランザクションで行う */
export async function checkout(db: PosDB, input: CheckoutInput): Promise<Sale> {
  return db.transaction('rw', [db.products, db.sales, db.stockLogs, db.sessions, db.meta], async () => {
    const existing = await db.sales.get(input.id)
    if (existing) return existing

    const session = await requireOpenSession(db)
    if (input.lines.length === 0) fail('商品が選択されていません')
    if (!isYen(input.received) || input.received > MAX_AMOUNT) fail('預かり金額が不正です')

    const qtyById = new Map<string, number>()
    for (const l of input.lines) {
      if (!isPositiveInt(l.qty)) fail('数量が不正です')
      qtyById.set(l.productId, (qtyById.get(l.productId) ?? 0) + l.qty)
    }

    const at = now()
    const items: SaleItem[] = []
    const updates: { product: Product; qty: number }[] = []
    for (const [productId, qty] of qtyById) {
      const product = await db.products.get(productId)
      if (!product) fail(`商品 ${productId} が見つかりません`)
      if (!product.active) fail(`「${product.name}」は販売停止中です`)
      if (product.stock < qty) fail(`「${product.name}」の在庫が不足しています（在庫 ${product.stock}点）`)
      items.push({
        productId,
        name: product.name,
        unitPrice: product.price,
        qty,
        subtotal: lineSubtotal(product.price, qty),
      })
      updates.push({ product, qty })
    }

    const total = items.reduce((s, i) => s + i.subtotal, 0)
    if (total !== input.expectedTotal) fail('商品の価格が変更されています。会計内容を確認してください。')
    let change: number | null
    if (input.paymentMethod === 'paypay') {
      if (input.received !== total) {
        fail(`PayPayの支払い金額（${input.received.toLocaleString('ja-JP')}円）が合計（${total.toLocaleString('ja-JP')}円）と一致しません`)
      }
      change = 0
    } else if (input.paymentMethod === 'cash') {
      change = changeFor(total, input.received)
      if (change === null) fail('預かり金額が不足しています')
    } else {
      fail('支払方法が不正です')
    }

    const seq = ((await db.meta.get('saleSeq'))?.value as number | undefined) ?? 0
    const sale: Sale = {
      id: input.id,
      no: seq + 1,
      createdAt: at,
      sessionId: session.id,
      paymentMethod: input.paymentMethod,
      items,
      totalQty: items.reduce((s, i) => s + i.qty, 0),
      total,
      received: input.received,
      change,
      status: 'normal',
    }

    await db.meta.put({ key: 'saleSeq', value: sale.no })
    await db.sales.add(sale)
    for (const { product, qty } of updates) {
      const after = product.stock - qty
      await db.products.update(product.id, { stock: after })
      await db.stockLogs.add({
        productId: product.id,
        at,
        type: 'sale',
        delta: -qty,
        before: product.stock,
        after,
        reason: `会計No.${sale.no}`,
        saleId: sale.id,
      })
    }
    return sale
  })
}

/** 会計取消（全額返金）。売上集計から除外し、在庫を戻す。履歴は削除しない */
export async function cancelSale(db: PosDB, saleId: string, reason: string): Promise<Sale> {
  const r = reason.trim()
  if (!r) fail('取消理由を入力してください')
  return db.transaction('rw', [db.products, db.sales, db.stockLogs, db.sessions], async () => {
    const session = await requireOpenSession(db)
    const sale = await db.sales.get(saleId)
    if (!sale) fail('会計が見つかりません')
    if (sale.status !== 'normal') fail('この会計はすでに取消済みです')

    const at = now()
    const cancelled: Sale = {
      ...sale,
      status: 'cancelled',
      cancelledAt: at,
      cancelReason: r,
      refundAmount: sale.total,
      refundSessionId: session.id,
    }
    await db.sales.put(cancelled)
    for (const item of sale.items) {
      const product = await db.products.get(item.productId)
      if (!product) fail(`商品 ${item.productId} が見つかりません`)
      const after = product.stock + item.qty
      await db.products.update(product.id, { stock: after })
      await db.stockLogs.add({
        productId: product.id,
        at,
        type: 'cancel',
        delta: item.qty,
        before: product.stock,
        after,
        reason: `会計No.${sale.no} 取消：${r}`,
        saleId: sale.id,
      })
    }
    return cancelled
  })
}

// ---------- 商品 ----------

function validateName(name: string): string {
  const n = name.trim()
  if (!n) fail('商品名を入力してください')
  if (n.length > 40) fail('商品名は40文字以内にしてください')
  return n
}

function validatePrice(price: number): number {
  if (!isYen(price) || price > MAX_PRICE) fail('価格は0円以上の整数で入力してください')
  return price
}

export async function updateProduct(
  db: PosDB,
  id: string,
  patch: { name?: string; price?: number; active?: boolean },
): Promise<void> {
  const changes: Partial<Product> = { updatedAt: now() }
  if (patch.name !== undefined) changes.name = validateName(patch.name)
  if (patch.price !== undefined) changes.price = validatePrice(patch.price)
  if (patch.active !== undefined) changes.active = patch.active
  const n = await db.products.update(id, changes)
  if (n === 0) fail('商品が見つかりません')
}

export async function addProduct(db: PosDB, name: string, price: number): Promise<Product> {
  const n = validateName(name)
  const p = validatePrice(price)
  return db.transaction('rw', db.products, async () => {
    const all = await db.products.toArray()
    const maxNum = all.reduce((m, x) => Math.max(m, Number(x.id.replace(/\D/g, '')) || 0), 0)
    const maxOrder = all.reduce((m, x) => Math.max(m, x.sortOrder), 0)
    const product: Product = {
      id: `P${String(maxNum + 1).padStart(3, '0')}`,
      name: n,
      price: p,
      stock: 0,
      active: true,
      sortOrder: maxOrder + 1,
      updatedAt: now(),
    }
    await db.products.add(product)
    return product
  })
}

/** 表示順を1つ上（-1）または下（+1）に移動 */
export async function moveProduct(db: PosDB, id: string, dir: -1 | 1): Promise<void> {
  await db.transaction('rw', db.products, async () => {
    const list = await db.products.orderBy('sortOrder').toArray()
    const i = list.findIndex((p) => p.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    const [a, b] = [list[i], list[j]]
    await db.products.update(a.id, { sortOrder: b.sortOrder })
    await db.products.update(b.id, { sortOrder: a.sortOrder })
  })
}

// ---------- 在庫 ----------

export async function adjustStock(db: PosDB, productId: string, newStock: number, reason: string): Promise<void> {
  const r = reason.trim()
  if (!r) fail('修正理由を入力してください')
  if (!isYen(newStock) || newStock > MAX_AMOUNT) fail('在庫数は0以上の整数で入力してください')
  await db.transaction('rw', [db.products, db.stockLogs], async () => {
    const product = await db.products.get(productId)
    if (!product) fail('商品が見つかりません')
    if (product.stock === newStock) fail('在庫数が変わっていません')
    await db.products.update(productId, { stock: newStock })
    await db.stockLogs.add({
      productId,
      at: now(),
      type: 'adjust',
      delta: newStock - product.stock,
      before: product.stock,
      after: newStock,
      reason: r,
    })
  })
}

// ---------- レジ（開始・入出金・締め） ----------

export async function openSession(db: PosDB, float: number): Promise<number> {
  if (!isYen(float) || float > MAX_AMOUNT) fail('釣銭準備金は0円以上の整数で入力してください')
  return db.transaction('rw', db.sessions, async () => {
    if (await getOpenSession(db)) fail('すでにレジが開始されています')
    return (await db.sessions.add({ openedAt: now(), float })) as number
  })
}

export async function addCashMove(db: PosDB, type: 'in' | 'out', amount: number, reason: string): Promise<void> {
  const r = reason.trim()
  if (!r) fail('理由を入力してください')
  if (!isPositiveInt(amount) || amount > MAX_AMOUNT) fail('金額は1円以上の整数で入力してください')
  await db.transaction('rw', [db.sessions, db.cashMoves], async () => {
    const session = await requireOpenSession(db)
    await db.cashMoves.add({ sessionId: session.id, at: now(), type, amount, reason: r })
  })
}

export async function getCashSummary(db: PosDB, session: Session & { id: number }): Promise<CashSummary> {
  const [made, refunded, moves] = await Promise.all([
    db.sales.where('sessionId').equals(session.id).toArray(),
    db.sales.where('refundSessionId').equals(session.id).toArray(),
    db.cashMoves.where('sessionId').equals(session.id).toArray(),
  ])
  const isPayPay = (x: Sale) => x.paymentMethod === 'paypay'
  const sumTotal = (list: Sale[]) => list.reduce((s, x) => s + x.total, 0)
  const sumRefund = (list: Sale[]) => list.reduce((s, x) => s + (x.refundAmount ?? 0), 0)
  // レジの現金が動くのは現金会計だけ。PayPay の売上・返金は参考値として別に持つ
  const base = {
    float: session.float,
    salesGross: sumTotal(made.filter((x) => !isPayPay(x))),
    refunds: sumRefund(refunded.filter((x) => !isPayPay(x))),
    cashIn: moves.filter((m) => m.type === 'in').reduce((s, m) => s + m.amount, 0),
    cashOut: moves.filter((m) => m.type === 'out').reduce((s, m) => s + m.amount, 0),
  }
  return {
    ...base,
    expected: expectedCash(base),
    paypaySales: sumTotal(made.filter(isPayPay)),
    paypayRefunds: sumRefund(refunded.filter(isPayPay)),
  }
}

export async function closeSession(db: PosDB, denoms: Denoms): Promise<Closing> {
  return db.transaction('rw', [db.sessions, db.sales, db.cashMoves], async () => {
    const session = await requireOpenSession(db)
    const summary = await getCashSummary(db, session)
    const actual = denomTotal(denoms)
    const diff = actual - summary.expected
    const closing: Closing = {
      ...summary,
      closedAt: now(),
      denoms: { ...denoms },
      actual,
      diff,
      judgement: judge(diff),
    }
    await db.sessions.update(session.id, { closedAt: closing.closedAt, closing })
    return closing
  })
}
