import { DENOMINATIONS, formatDateTime } from './calc'
import type { Dashboard } from './summary'
import type { Sale, Session } from './types'

type Cell = string | number

function escape(cell: Cell): string {
  const s = String(cell)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Excelで文字化けしないよう BOM 付き、改行は CRLF */
export function toCsv(rows: Cell[][]): string {
  return '﻿' + rows.map((r) => r.map(escape).join(',')).join('\r\n') + '\r\n'
}

const statusLabel = (s: Sale) => (s.status === 'normal' ? '正常' : '取消')

/** 売上履歴（明細1行＝1レコード）。会計単位の金額は各明細行に繰り返して出す */
export function salesCsv(sales: Sale[]): string {
  const rows: Cell[][] = [
    ['会計No', '会計ID', '会計日時', 'ステータス', '商品ID', '商品名', '販売単価', '数量', '小計', '会計合計', '預かり金額', 'お釣り', '取消日時', '取消理由'],
  ]
  for (const s of [...sales].sort((a, b) => a.no - b.no)) {
    for (const i of s.items) {
      rows.push([
        s.no,
        s.id,
        formatDateTime(s.createdAt),
        statusLabel(s),
        i.productId,
        i.name,
        i.unitPrice,
        i.qty,
        i.subtotal,
        s.total,
        s.received,
        s.change,
        s.cancelledAt ? formatDateTime(s.cancelledAt) : '',
        s.cancelReason ?? '',
      ])
    }
  }
  return toCsv(rows)
}

export function productSalesCsv(d: Dashboard): string {
  const rows: Cell[][] = [['商品ID', '商品名', '販売数量', '売上金額']]
  for (const p of d.byProduct) rows.push([p.productId, p.name, p.qty, p.amount])
  rows.push(['', '合計', d.qty, d.totalSales])
  return toCsv(rows)
}

export function closingCsv(sessions: Session[]): string {
  const rows: Cell[][] = [
    [
      'セッションID',
      'レジ開始日時',
      '締め日時',
      '釣銭準備金',
      '現金売上（取消含む総額）',
      '返金額',
      '入金合計',
      '出金合計',
      '理論現金残高',
      '実際の現金残高',
      '現金差異',
      '判定',
      ...DENOMINATIONS.map((d) => `${d}円（枚）`),
    ],
  ]
  for (const s of sessions) {
    const c = s.closing
    if (!c) continue
    rows.push([
      s.id ?? '',
      formatDateTime(s.openedAt),
      formatDateTime(c.closedAt),
      c.float,
      c.salesGross,
      c.refunds,
      c.cashIn,
      c.cashOut,
      c.expected,
      c.actual,
      c.diff,
      c.judgement,
      ...DENOMINATIONS.map((d) => c.denoms[String(d)] ?? 0),
    ])
  }
  return toCsv(rows)
}
