import type { CashSummary, Denoms, Judgement } from './types'

export const DENOMINATIONS = [10000, 5000, 2000, 1000, 500, 100, 50, 10, 5, 1] as const

export const MAX_PRICE = 999_999
export const MAX_AMOUNT = 9_999_999

/** 0以上の安全な整数か */
export function isYen(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
}

/** 正の整数か（数量用） */
export function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0
}

/** 入力文字列を円の整数に変換する。数字以外・範囲外は null */
export function parseYen(input: string, max = MAX_AMOUNT): number | null {
  const s = input.trim().replace(/,/g, '')
  if (!/^\d{1,9}$/.test(s)) return null
  const n = Number(s)
  if (!isYen(n) || n > max) return null
  return n
}

export function lineSubtotal(unitPrice: number, qty: number): number {
  if (!isYen(unitPrice) || !isPositiveInt(qty)) throw new Error('単価または数量が不正です')
  return unitPrice * qty
}

export function cartTotal(lines: { unitPrice: number; qty: number }[]): number {
  return lines.reduce((sum, l) => sum + lineSubtotal(l.unitPrice, l.qty), 0)
}

/** お釣り。預かり金額が不足していれば null */
export function changeFor(total: number, received: number): number | null {
  if (!isYen(total) || !isYen(received)) return null
  return received >= total ? received - total : null
}

export function denomTotal(denoms: Denoms): number {
  return DENOMINATIONS.reduce((sum, d) => {
    const count = denoms[String(d)] ?? 0
    if (!isYen(count)) throw new Error(`${d}円の枚数が不正です`)
    return sum + d * count
  }, 0)
}

/**
 * 理論現金残高 = 釣銭準備金 + 現金売上 + 売上以外の入金 − 売上以外の出金 − 返金額
 * 現金売上は取消された会計も含む総額。取消分は返金額で差し引くので二重計上にならない。
 */
export function expectedCash(s: Omit<CashSummary, 'expected'>): number {
  return s.float + s.salesGross + s.cashIn - s.cashOut - s.refunds
}

export function judge(diff: number): Judgement {
  if (diff === 0) return '一致'
  return diff > 0 ? '現金過剰' : '現金不足'
}

const yenFormat = new Intl.NumberFormat('ja-JP')

export function yen(n: number): string {
  return `${yenFormat.format(n)}円`
}

export function signedYen(n: number): string {
  if (n === 0) return '0円'
  return `${n > 0 ? '+' : '−'}${yenFormat.format(Math.abs(n))}円`
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}
