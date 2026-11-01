import type { Product, Sale, StockLog } from './types'

export type ProductSales = { productId: string; name: string; qty: number; amount: number }

export type Dashboard = {
  totalSales: number
  /** 支払方法別の売上（取消を除く） */
  cashSales: number
  paypaySales: number
  count: number
  qty: number
  /** 平均客単価（1円未満は四捨五入）。会計0件なら 0 */
  average: number
  byProduct: ProductSales[]
}

/** 取消済みの会計は除外して集計する */
export function buildDashboard(sales: Sale[], products: Product[]): Dashboard {
  const valid = sales.filter((s) => s.status === 'normal')
  const map = new Map<string, ProductSales>()
  for (const p of products) map.set(p.id, { productId: p.id, name: p.name, qty: 0, amount: 0 })
  for (const s of valid) {
    for (const i of s.items) {
      const row = map.get(i.productId) ?? { productId: i.productId, name: i.name, qty: 0, amount: 0 }
      row.qty += i.qty
      row.amount += i.subtotal
      map.set(i.productId, row)
    }
  }
  const order = new Map(products.map((p) => [p.id, p.sortOrder]))
  const byProduct = [...map.values()].sort(
    (a, b) => (order.get(a.productId) ?? 1e9) - (order.get(b.productId) ?? 1e9) || a.productId.localeCompare(b.productId),
  )
  const totalSales = valid.reduce((s, x) => s + x.total, 0)
  const count = valid.length
  const paypaySales = valid.filter((s) => s.paymentMethod === 'paypay').reduce((s, x) => s + x.total, 0)
  return {
    totalSales,
    cashSales: totalSales - paypaySales,
    paypaySales,
    count,
    qty: valid.reduce((s, x) => s + x.totalQty, 0),
    average: count === 0 ? 0 : Math.round(totalSales / count),
    byProduct,
  }
}

export type StockRow = {
  product: Product
  /** 在庫修正（搬入・棚卸など）の合計 */
  adjusted: number
  /** 有効な販売数量（取消分を除く） */
  sold: number
  /** 履歴から計算した在庫。現在庫と一致しなければ不整合 */
  computed: number
}

export function buildStockRows(products: Product[], logs: StockLog[]): StockRow[] {
  return products.map((product) => {
    const mine = logs.filter((l) => l.productId === product.id)
    const adjusted = mine.filter((l) => l.type === 'adjust').reduce((s, l) => s + l.delta, 0)
    const sold = -mine.filter((l) => l.type !== 'adjust').reduce((s, l) => s + l.delta, 0)
    return { product, adjusted, sold, computed: adjusted - sold }
  })
}
