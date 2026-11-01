// 金額・数量はすべて整数（円・個）。日時は ISO 8601 文字列（UTC）。

export type Product = {
  id: string
  name: string
  price: number
  stock: number
  active: boolean
  sortOrder: number
  updatedAt: string
}

/** 会計確定時点の商品情報のスナップショット。価格変更の影響を受けない。 */
export type SaleItem = {
  productId: string
  name: string
  unitPrice: number
  qty: number
  subtotal: number
}

export type SaleStatus = 'normal' | 'cancelled'

/** cash: 現金（レジの現金が動く） / paypay: PayPay（お客様がQRを読んで支払う。レジの現金は動かない） */
export type PaymentMethod = 'cash' | 'paypay'

export const PAYMENT_LABEL: Record<PaymentMethod, string> = { cash: '現金', paypay: 'PayPay' }

export type Sale = {
  id: string
  no: number
  createdAt: string
  /** 会計を行ったレジセッション */
  sessionId: number
  paymentMethod: PaymentMethod
  items: SaleItem[]
  totalQty: number
  total: number
  /** 現金：預かり金額 / PayPay：お客様が支払った金額（合計と同額） */
  received: number
  /** PayPay は常に 0 */
  change: number
  status: SaleStatus
  cancelledAt?: string
  cancelReason?: string
  /** 取消は全額返金。返金額は total と同額 */
  refundAmount?: number
  /** 返金した（取消を行った）レジセッション。会計時のセッションと異なることがある */
  refundSessionId?: number
}

export type StockLogType = 'sale' | 'cancel' | 'adjust'

export type StockLog = {
  id?: number
  productId: string
  at: string
  type: StockLogType
  delta: number
  before: number
  after: number
  reason: string
  saleId?: string
}

export type CashMove = {
  id?: number
  sessionId: number
  at: string
  type: 'in' | 'out'
  amount: number
  reason: string
}

/** 金種（円）→ 枚数 */
export type Denoms = Record<string, number>

export type Judgement = '一致' | '現金過剰' | '現金不足'

export type CashSummary = {
  float: number
  /** 当セッションで受け取った売上の総額（後で取消された会計も含む） */
  salesGross: number
  /** 当セッションで行った返金の合計 */
  refunds: number
  cashIn: number
  cashOut: number
  expected: number
  /** 参考：当セッションの PayPay 売上（取消含む総額）と PayPay 返金。現金残高には含めない */
  paypaySales?: number
  paypayRefunds?: number
}

export type Closing = CashSummary & {
  closedAt: string
  denoms: Denoms
  actual: number
  diff: number
  judgement: Judgement
}

export type Session = {
  id?: number
  openedAt: string
  float: number
  closedAt?: string
  closing?: Closing
}

export type Meta = {
  key: string
  value: unknown
}
