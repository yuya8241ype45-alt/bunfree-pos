import { isPositiveInt, isYen } from '../lib/calc'
import type { CashMove, Meta, Product, Sale, Session, StockLog } from '../lib/types'
import type { PosDB } from './db'
import { PosError } from './ops'

export const BACKUP_FORMAT = 'bunfree-pos-backup'
/** v2: 会計に支払方法（paymentMethod）を追加。v1 のファイルは全会計を現金として読み込む */
export const BACKUP_VERSION = 2
const SUPPORTED_VERSIONS = [1, 2]

export type BackupData = {
  products: Product[]
  sales: Sale[]
  stockLogs: StockLog[]
  cashMoves: CashMove[]
  sessions: Session[]
  meta: Meta[]
}

export type Backup = {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  data: BackupData
}

export async function exportAll(db: PosDB): Promise<Backup> {
  return db.transaction('r', [db.products, db.sales, db.stockLogs, db.cashMoves, db.sessions, db.meta], async () => ({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      products: await db.products.toArray(),
      sales: await db.sales.toArray(),
      stockLogs: await db.stockLogs.toArray(),
      cashMoves: await db.cashMoves.toArray(),
      sessions: await db.sessions.toArray(),
      meta: await db.meta.toArray(),
    },
  }))
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isDate = (v: unknown) => isStr(v) && !Number.isNaN(Date.parse(v))
const isInt = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v)

/** JSON の構造と値を検証する。問題があれば内容を列挙して PosError を投げる */
export function validateBackup(raw: unknown): Backup {
  const errors: string[] = []
  const check = (ok: boolean, msg: string) => {
    if (!ok && errors.length < 20) errors.push(msg)
  }

  if (!isObj(raw) || raw.format !== BACKUP_FORMAT) throw new PosError('このアプリのバックアップファイルではありません')
  if (!SUPPORTED_VERSIONS.includes(raw.version as number)) {
    throw new PosError(`対応していないバックアップのバージョンです（${String(raw.version)}）`)
  }
  const d = raw.data
  if (!isObj(d)) throw new PosError('バックアップの data がありません')
  for (const k of ['products', 'sales', 'stockLogs', 'cashMoves', 'sessions', 'meta']) {
    const list = d[k]
    if (!Array.isArray(list)) throw new PosError(`バックアップの ${k} がありません`)
    if (!list.every(isObj)) throw new PosError(`バックアップの ${k} に不正な要素があります`)
  }
  const data = d as unknown as BackupData

  const productIds = new Set<string>()
  data.products.forEach((p, i) => {
    const at = `商品${i + 1}`
    check(isObj(p) && isStr(p.id) && p.id.length > 0, `${at}: id が不正`)
    check(isStr(p.name) && p.name.length > 0, `${at}: 商品名が不正`)
    check(isYen(p.price), `${at}: 価格が不正`)
    check(isYen(p.stock), `${at}: 在庫が不正`)
    check(typeof p.active === 'boolean', `${at}: 販売状態が不正`)
    check(isInt(p.sortOrder), `${at}: 表示順が不正`)
    check(!productIds.has(p.id), `${at}: id が重複`)
    productIds.add(p.id)
  })

  const saleIds = new Set<string>()
  const saleNos = new Set<number>()
  data.sales.forEach((s, i) => {
    const at = `会計${i + 1}`
    check(isObj(s) && isStr(s.id) && !saleIds.has(s.id), `${at}: id が不正または重複`)
    check(isPositiveInt(s.no) && !saleNos.has(s.no), `${at}: 会計No が不正または重複`)
    saleIds.add(s.id)
    saleNos.add(s.no)
    check(isDate(s.createdAt), `${at}: 会計日時が不正`)
    check(isInt(s.sessionId), `${at}: セッションが不正`)
    check(s.status === 'normal' || s.status === 'cancelled', `${at}: ステータスが不正`)
    check(Array.isArray(s.items) && s.items.length > 0, `${at}: 明細がない`)
    if (!Array.isArray(s.items)) return
    let total = 0
    let qty = 0
    for (const it of s.items) {
      const ok = isObj(it) && isStr(it.productId) && isStr(it.name) && isYen(it.unitPrice) && isPositiveInt(it.qty) && it.subtotal === it.unitPrice * it.qty
      check(ok, `${at}: 明細の金額・数量が不正`)
      total += it.subtotal
      qty += it.qty
    }
    check(s.total === total, `${at}: 合計金額が明細と一致しない`)
    check(s.totalQty === qty, `${at}: 購入点数が明細と一致しない`)
    if (s.paymentMethod === undefined) s.paymentMethod = 'cash'
    check(s.paymentMethod === 'cash' || s.paymentMethod === 'paypay', `${at}: 支払方法が不正`)
    check(isYen(s.received) && s.change === s.received - s.total && s.change >= 0, `${at}: 預かり金額・お釣りが不正`)
    if (s.paymentMethod === 'paypay') check(s.received === s.total, `${at}: PayPayの支払い金額が合計と一致しない`)
    if (s.status === 'cancelled') {
      check(s.refundAmount === s.total && isInt(s.refundSessionId) && isDate(s.cancelledAt), `${at}: 取消情報が不正`)
    }
  })

  data.stockLogs.forEach((l, i) => {
    const at = `在庫履歴${i + 1}`
    check(isObj(l) && isStr(l.productId) && isDate(l.at), `${at}: 内容が不正`)
    check(['sale', 'cancel', 'adjust'].includes(l.type), `${at}: 種別が不正`)
    check(isInt(l.delta) && isYen(l.before) && isYen(l.after) && l.after - l.before === l.delta, `${at}: 数量が不正`)
  })

  data.cashMoves.forEach((m, i) => {
    const at = `入出金${i + 1}`
    check(isObj(m) && isInt(m.sessionId) && isDate(m.at), `${at}: 内容が不正`)
    check((m.type === 'in' || m.type === 'out') && isPositiveInt(m.amount), `${at}: 種別・金額が不正`)
  })

  let openCount = 0
  data.sessions.forEach((s, i) => {
    const at = `レジ${i + 1}`
    check(isObj(s) && isInt(s.id) && isDate(s.openedAt) && isYen(s.float), `${at}: 内容が不正`)
    if (!s.closedAt) openCount++
    else check(isObj(s.closing) && isInt(s.closing.actual) && isInt(s.closing.expected), `${at}: 締め結果が不正`)
  })
  check(openCount <= 1, '開始中のレジが2つ以上あります')

  data.meta.forEach((m, i) => check(isObj(m) && isStr(m.key), `設定${i + 1}: 内容が不正`))

  if (errors.length > 0) throw new PosError(`バックアップの内容に問題があります。\n${errors.join('\n')}`)
  return raw as unknown as Backup
}

/** 既存データをすべて置き換える。途中で失敗した場合は元のデータのまま */
export async function importAll(db: PosDB, backup: Backup): Promise<void> {
  const d = backup.data
  await db.transaction('rw', [db.products, db.sales, db.stockLogs, db.cashMoves, db.sessions, db.meta], async () => {
    await Promise.all([
      db.products.clear(),
      db.sales.clear(),
      db.stockLogs.clear(),
      db.cashMoves.clear(),
      db.sessions.clear(),
      db.meta.clear(),
    ])
    await db.products.bulkAdd(d.products)
    await db.sales.bulkAdd(d.sales)
    await db.stockLogs.bulkAdd(d.stockLogs)
    await db.cashMoves.bulkAdd(d.cashMoves)
    await db.sessions.bulkAdd(d.sessions)
    await db.meta.bulkAdd(d.meta)
    const maxNo = d.sales.reduce((m, s) => Math.max(m, s.no), 0)
    const seq = (d.meta.find((m) => m.key === 'saleSeq')?.value as number | undefined) ?? 0
    if (seq < maxNo) await db.meta.put({ key: 'saleSeq', value: maxNo })
  })
}
