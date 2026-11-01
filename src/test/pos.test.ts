import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PosDB } from '../db/db'
import {
  addCashMove,
  adjustStock,
  cancelSale,
  checkout,
  closeSession,
  getCashSummary,
  getOpenSession,
  openSession,
  updateProduct,
} from '../db/ops'
import { exportAll, importAll, validateBackup } from '../db/backup'
import { cartTotal, changeFor, denomTotal, expectedCash, judge, newId, parseYen } from '../lib/calc'
import { closingCsv, productSalesCsv, salesCsv } from '../lib/csv'
import { buildDashboard, buildStockRows } from '../lib/summary'
import type { Session } from '../lib/types'

let db: PosDB
let n = 0

beforeEach(async () => {
  db = new PosDB(`test-${++n}`)
  await db.open()
})
afterEach(async () => {
  await db.delete()
})

async function ready(stock = 10, float = 20000) {
  if (stock > 0) for (const id of ['P001', 'P002', 'P003', 'P004', 'P005']) await adjustStock(db, id, stock, '搬入')
  await openSession(db, float)
}

function sell(lines: { productId: string; qty: number }[], expectedTotal: number, received: number, id = newId()) {
  return checkout(db, { id, lines, expectedTotal, received })
}

async function openSessionRecord() {
  return (await getOpenSession(db)) as Session & { id: number }
}

describe('計算', () => {
  it('500円の商品2点で合計1,000円', () => {
    expect(cartTotal([{ unitPrice: 500, qty: 2 }])).toBe(1000)
  })
  it('1,200円の購入に2,000円を預かるとお釣り800円', () => {
    expect(changeFor(1200, 2000)).toBe(800)
  })
  it('預かり金不足ならお釣りは null', () => {
    expect(changeFor(1200, 1000)).toBeNull()
  })
  it('不正な金額入力は受け付けない', () => {
    expect(parseYen('-100')).toBeNull()
    expect(parseYen('10.5')).toBeNull()
    expect(parseYen('abc')).toBeNull()
    expect(parseYen('')).toBeNull()
    expect(parseYen('1,000')).toBe(1000)
  })
  it('金種別の合計', () => {
    expect(denomTotal({ '10000': 5, '5000': 1, '100': 4 })).toBe(55400)
  })
})

describe('会計', () => {
  it('会計すると売上が保存され在庫が減る', async () => {
    await ready()
    const sale = await sell([{ productId: 'P001', qty: 2 }], 1000, 1000)
    expect(sale.total).toBe(1000)
    expect(sale.change).toBe(0)
    expect((await db.products.get('P001'))!.stock).toBe(8)
  })

  it('1,200円の購入（500＋300＋400）に2,000円でお釣り800円', async () => {
    await ready()
    const sale = await sell(
      [
        { productId: 'P001', qty: 1 },
        { productId: 'P002', qty: 1 },
        { productId: 'P004', qty: 1 },
      ],
      1200,
      2000,
    )
    expect(sale.change).toBe(800)
  })

  it('預かり金不足では確定できず、何も保存されない', async () => {
    await ready()
    await expect(sell([{ productId: 'P001', qty: 2 }], 1000, 900)).rejects.toThrow('不足')
    expect(await db.sales.count()).toBe(0)
    expect((await db.products.get('P001'))!.stock).toBe(10)
  })

  it('同じ会計IDで二重に確定しても1件しか保存されない（連打・同時実行）', async () => {
    await ready()
    const id = newId()
    const results = await Promise.allSettled([
      sell([{ productId: 'P001', qty: 1 }], 500, 500, id),
      sell([{ productId: 'P001', qty: 1 }], 500, 500, id),
    ])
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    await sell([{ productId: 'P001', qty: 1 }], 500, 500, id)
    expect(await db.sales.count()).toBe(1)
    expect((await db.products.get('P001'))!.stock).toBe(9)
  })

  it('レジ開始前は会計できない', async () => {
    await adjustStock(db, 'P001', 10, '搬入')
    await expect(sell([{ productId: 'P001', qty: 1 }], 500, 500)).rejects.toThrow('レジが開始されていません')
  })

  it('数量0・マイナスは確定できない', async () => {
    await ready()
    await expect(sell([{ productId: 'P001', qty: 0 }], 0, 0)).rejects.toThrow('数量')
    await expect(sell([{ productId: 'P001', qty: -1 }], -500, 0)).rejects.toThrow('数量')
  })

  it('販売停止中の商品は売れない', async () => {
    await ready()
    await updateProduct(db, 'P002', { active: false })
    await expect(sell([{ productId: 'P002', qty: 1 }], 400, 400)).rejects.toThrow('販売停止')
  })
})

describe('価格変更', () => {
  it('500円→600円に変更でき、変更後の会計は600円、変更前の履歴は500円のまま', async () => {
    await ready()
    const before = await sell([{ productId: 'P001', qty: 1 }], 500, 500)
    await updateProduct(db, 'P001', { price: 600 })
    expect((await db.products.get('P001'))!.price).toBe(600)
    const after = await sell([{ productId: 'P001', qty: 1 }], 600, 1000)
    expect(after.items[0].unitPrice).toBe(600)
    expect(after.change).toBe(400)
    const old = await db.sales.get(before.id)
    expect(old!.items[0].unitPrice).toBe(500)
    expect(old!.total).toBe(500)
  })

  it('画面の合計とDBの価格が食い違うと確定しない', async () => {
    await ready()
    await updateProduct(db, 'P001', { price: 600 })
    await expect(sell([{ productId: 'P001', qty: 1 }], 500, 500)).rejects.toThrow('価格が変更')
  })

  it('不正な価格は保存できない', async () => {
    await expect(updateProduct(db, 'P001', { price: -1 })).rejects.toThrow()
    await expect(updateProduct(db, 'P001', { price: 1.5 })).rejects.toThrow()
  })
})

describe('在庫', () => {
  it('在庫10点から2点販売で8点、取消で10点に戻る', async () => {
    await ready()
    const sale = await sell([{ productId: 'P003', qty: 2 }], 800, 1000)
    expect((await db.products.get('P003'))!.stock).toBe(8)
    await cancelSale(db, sale.id, '打ち間違い')
    expect((await db.products.get('P003'))!.stock).toBe(10)
  })

  it('在庫0点の商品は販売できない', async () => {
    await ready(0)
    await expect(sell([{ productId: 'P001', qty: 1 }], 500, 500)).rejects.toThrow('在庫が不足')
  })

  it('在庫を超える数量は販売できない', async () => {
    await ready(1)
    await expect(sell([{ productId: 'P001', qty: 2 }], 1000, 1000)).rejects.toThrow('在庫が不足')
    expect((await db.products.get('P001'))!.stock).toBe(1)
  })

  it('在庫修正は変更前後・理由が記録され、履歴から計算した在庫と現在庫が一致する', async () => {
    await ready()
    await sell([{ productId: 'P001', qty: 3 }], 1500, 2000)
    await adjustStock(db, 'P001', 5, '棚卸で2点不足')
    const logs = await db.stockLogs.where('productId').equals('P001').toArray()
    const last = logs[logs.length - 1]
    expect(last).toMatchObject({ type: 'adjust', before: 7, after: 5, delta: -2, reason: '棚卸で2点不足' })
    const row = buildStockRows(await db.products.toArray(), await db.stockLogs.toArray()).find((r) => r.product.id === 'P001')!
    expect(row).toMatchObject({ adjusted: 8, sold: 3, computed: 5 })
    expect(row.product.stock).toBe(5)
  })
})

describe('取消', () => {
  it('取消は履歴を残し、売上集計から除外される', async () => {
    await ready()
    const a = await sell([{ productId: 'P001', qty: 2 }], 1000, 1000)
    await sell([{ productId: 'P002', qty: 1 }], 400, 500)
    await cancelSale(db, a.id, 'お客様都合')
    expect(await db.sales.count()).toBe(2)
    const d = buildDashboard(await db.sales.toArray(), await db.products.toArray())
    expect(d.totalSales).toBe(400)
    expect(d.count).toBe(1)
    expect(d.qty).toBe(1)
    expect(d.byProduct.find((p) => p.productId === 'P001')!.qty).toBe(0)
  })

  it('理由なし・二重取消はできない', async () => {
    await ready()
    const a = await sell([{ productId: 'P001', qty: 1 }], 500, 500)
    await expect(cancelSale(db, a.id, '  ')).rejects.toThrow('理由')
    await cancelSale(db, a.id, 'ミス')
    await expect(cancelSale(db, a.id, 'ミス')).rejects.toThrow('取消済み')
    expect((await db.products.get('P001'))!.stock).toBe(10)
  })
})

describe('レジ締め', () => {
  it('準備金20,000円＋売上35,400円 → 理論55,400円、差異0／−300／＋300', () => {
    const exp = expectedCash({ float: 20000, salesGross: 35400, refunds: 0, cashIn: 0, cashOut: 0 })
    expect(exp).toBe(55400)
    expect(55400 - exp).toBe(0)
    expect(judge(55400 - exp)).toBe('一致')
    expect(55100 - exp).toBe(-300)
    expect(judge(55100 - exp)).toBe('現金不足')
    expect(55700 - exp).toBe(300)
    expect(judge(55700 - exp)).toBe('現金過剰')
  })

  it('実データで35,400円を売り、金種入力で締めると差異が正しく出る', async () => {
    await ready(100)
    // 500×40 + 400×30 + 300×11 + 100 相当になるよう組む: 20000 + 12000 + 3300 = 35300、+ 不足分は別会計で調整
    await sell([{ productId: 'P001', qty: 40 }], 20000, 20000)
    await sell([{ productId: 'P002', qty: 30 }], 12000, 12000)
    await sell([{ productId: 'P004', qty: 10 }], 3000, 3000)
    await updateProduct(db, 'P005', { price: 400 })
    await sell([{ productId: 'P005', qty: 1 }], 400, 1000)
    const summary = await getCashSummary(db, await openSessionRecord())
    expect(summary.salesGross).toBe(35400)
    expect(summary.expected).toBe(55400)

    const closing = await closeSession(db, { '10000': 5, '5000': 1, '100': 1 })
    expect(closing.actual).toBe(55100)
    expect(closing.diff).toBe(-300)
    expect(closing.judgement).toBe('現金不足')
    expect(await getOpenSession(db)).toBeUndefined()
    expect((await db.sessions.toArray())[0].closing!.diff).toBe(-300)
  })

  it('取消（全額返金）と入出金を含めても二重計上しない', async () => {
    await ready()
    const a = await sell([{ productId: 'P001', qty: 2 }], 1000, 1000)
    await sell([{ productId: 'P002', qty: 1 }], 400, 1000)
    await cancelSale(db, a.id, '返品')
    await addCashMove(db, 'in', 5000, '両替用の追加')
    await addCashMove(db, 'out', 1200, '備品購入')
    const s = await getCashSummary(db, await openSessionRecord())
    // 20000 + (1000+400) + 5000 − 1200 − 1000 = 24200 （売上の純額400円ぶんだけ増えている）
    expect(s).toMatchObject({ salesGross: 1400, refunds: 1000, cashIn: 5000, cashOut: 1200, expected: 24200 })
  })

  it('前のセッションの会計を次のセッションで取消すと、返金は次のセッションの現金から引かれる', async () => {
    await ready()
    const a = await sell([{ productId: 'P001', qty: 1 }], 500, 500)
    const c1 = await closeSession(db, { '10000': 2, '500': 1 })
    expect(c1.expected).toBe(20500)
    expect(c1.diff).toBe(0)
    await openSession(db, 20500)
    await cancelSale(db, a.id, '翌日に返品')
    const s2 = await getCashSummary(db, await openSessionRecord())
    expect(s2).toMatchObject({ salesGross: 0, refunds: 500, expected: 20000 })
    // 締め済みの結果は変わらない
    expect((await db.sessions.get(1))!.closing!.expected).toBe(20500)
  })

  it('レジは同時に1つしか開始できない', async () => {
    await openSession(db, 20000)
    await expect(openSession(db, 20000)).rejects.toThrow('すでに')
  })
})

describe('保存・バックアップ', () => {
  it('DBを開き直しても会計履歴が残る（再読み込み相当）', async () => {
    await ready()
    await sell([{ productId: 'P001', qty: 1 }], 500, 500)
    const name = db.name
    db.close()
    const again = new PosDB(name)
    await again.open()
    expect(await again.sales.count()).toBe(1)
    again.close()
    await db.open()
  })

  it('JSONバックアップから復元できる', async () => {
    await ready()
    const a = await sell([{ productId: 'P001', qty: 2 }], 1000, 1000)
    await cancelSale(db, a.id, 'テスト')
    await sell([{ productId: 'P002', qty: 1 }], 400, 500)
    await closeSession(db, { '10000': 2, '100': 4 })
    const json = JSON.stringify(await exportAll(db))

    const other = new PosDB(`restore-${n}`)
    await other.open()
    await importAll(other, validateBackup(JSON.parse(json)))
    expect(await other.sales.count()).toBe(2)
    expect((await other.products.get('P001'))!.stock).toBe(10)
    expect((await other.sessions.toArray())[0].closing!.judgement).toBe('一致')
    // 復元後の会計Noは続きから振られる
    await openSession(other, 0)
    const next = await checkout(other, { id: newId(), lines: [{ productId: 'P003', qty: 1 }], expectedTotal: 400, received: 400 })
    expect(next.no).toBe(3)
    await other.delete()
  })

  it('壊れたバックアップは拒否する', async () => {
    await ready()
    await sell([{ productId: 'P001', qty: 2 }], 1000, 1000)
    const b = await exportAll(db)
    expect(() => validateBackup({ foo: 1 })).toThrow('バックアップファイルではありません')
    const broken = structuredClone(b)
    broken.data.sales[0].total = 999
    expect(() => validateBackup(broken)).toThrow('合計金額が明細と一致しない')
    const broken2 = structuredClone(b) as unknown as { data: { products: unknown[] } }
    broken2.data.products[0] = null
    expect(() => validateBackup(broken2)).toThrow('不正な要素')
  })

  it('CSV出力の内容が正しい', async () => {
    await ready()
    await updateProduct(db, 'P001', { name: 'ブックカバー, "限定"' })
    const a = await sell(
      [
        { productId: 'P001', qty: 2 },
        { productId: 'P002', qty: 1 },
      ],
      1400,
      2000,
    )
    await sell([{ productId: 'P004', qty: 1 }], 300, 300)
    await cancelSale(db, a.id, '打ち間違い')
    const sales = await db.sales.toArray()

    const csv = salesCsv(sales)
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.slice(1).trim().split('\r\n')
    expect(lines).toHaveLength(4)
    expect(lines[1]).toContain('"ブックカバー, ""限定"""')
    expect(lines[1]).toMatch(/,取消,P001,.*,500,2,1000,1400,2000,600,/)
    expect(lines[3]).toMatch(/,正常,P004,紙クリップ2種セット,300,1,300,300,300,0,,$/)

    const d = buildDashboard(sales, await db.products.toArray())
    const pcsv = productSalesCsv(d).slice(1).trim().split('\r\n')
    expect(pcsv[0]).toBe('商品ID,商品名,販売数量,売上金額')
    expect(pcsv[4]).toBe('P004,紙クリップ2種セット,1,300')
    expect(pcsv[6]).toBe(',合計,1,300')

    await closeSession(db, { '10000': 2, '100': 3 })
    const ccsv = closingCsv(await db.sessions.toArray()).slice(1).trim().split('\r\n')
    expect(ccsv).toHaveLength(2)
    expect(ccsv[1]).toContain(',20000,1700,1400,0,0,20300,20300,0,一致,2,0,0,0,0,3,0,0,0,0')
  })
})
