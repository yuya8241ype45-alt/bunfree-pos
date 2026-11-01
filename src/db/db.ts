import Dexie, { type EntityTable } from 'dexie'
import type { CashMove, Meta, Product, Sale, Session, StockLog } from '../lib/types'

export const INITIAL_PRODUCTS: Omit<Product, 'updatedAt'>[] = [
  { id: 'P001', name: 'ブックカバー2種セット', price: 500, stock: 0, active: true, sortOrder: 1 },
  { id: 'P002', name: 'しおり A', price: 400, stock: 0, active: true, sortOrder: 2 },
  { id: 'P003', name: 'しおり B', price: 400, stock: 0, active: true, sortOrder: 3 },
  { id: 'P004', name: '紙クリップ2種セット', price: 300, stock: 0, active: true, sortOrder: 4 },
  { id: 'P005', name: 'ステッカー2種セット', price: 300, stock: 0, active: true, sortOrder: 5 },
]

export class PosDB extends Dexie {
  products!: EntityTable<Product, 'id'>
  sales!: EntityTable<Sale, 'id'>
  stockLogs!: EntityTable<StockLog, 'id'>
  cashMoves!: EntityTable<CashMove, 'id'>
  sessions!: EntityTable<Session, 'id'>
  meta!: EntityTable<Meta, 'key'>

  constructor(name = 'bunfree-pos') {
    super(name)
    this.version(1).stores({
      products: 'id, sortOrder',
      sales: 'id, &no, createdAt, sessionId, status, refundSessionId',
      stockLogs: '++id, productId, at, saleId',
      cashMoves: '++id, sessionId, at',
      sessions: '++id, openedAt',
      meta: 'key',
    })
    this.on('populate', (tx) => {
      const now = new Date().toISOString()
      return tx.table('products').bulkAdd(INITIAL_PRODUCTS.map((p) => ({ ...p, updatedAt: now })))
    })
  }
}

export const db = new PosDB()

export const ALL_TABLES = ['products', 'sales', 'stockLogs', 'cashMoves', 'sessions', 'meta'] as const
