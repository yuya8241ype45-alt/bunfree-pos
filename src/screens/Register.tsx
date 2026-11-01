import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { addCashMove, closeSession, getCashSummary, getOpenSession, openSession } from '../db/ops'
import { DENOMINATIONS, denomTotal, formatDateTime, judge, parseYen, signedYen, yen } from '../lib/calc'
import { closingCsv } from '../lib/csv'
import type { CashSummary, Closing, Denoms, Session } from '../lib/types'
import { Button, Field, inputCls, Modal, PageTitle, download, stamp, td, tdNum, th, thNum, useNotify, useRunner } from '../ui'

type OpenSession = Session & { id: number }

export default function Register() {
  const session = useLiveQuery(() => getOpenSession(db).then((s) => (s as OpenSession | undefined) ?? null), [])
  const closed = useLiveQuery(() => db.sessions.orderBy('openedAt').reverse().filter((s) => !!s.closedAt).toArray(), [])

  if (session === undefined || !closed) return null

  return (
    <div className="mx-auto max-w-5xl">
      <PageTitle>レジ開始・締め</PageTitle>
      {session ? <OpenRegister session={session} /> : <StartRegister />}
      <History sessions={closed} />
    </div>
  )
}

function StartRegister() {
  const [floatStr, setFloatStr] = useState('')
  const { run, busy } = useRunner()
  const notify = useNotify()
  const float = parseYen(floatStr)
  return (
    <section className="mb-10 rounded-lg border border-gray-300 p-5">
      <h2 className="mb-3 text-xl font-bold">レジを開始する</h2>
      <p className="mb-4 text-gray-700">営業開始時に、レジに入れた釣銭準備金を入力してください。開始するまで会計はできません。</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Field label="釣銭準備金（円）">
            <input className={inputCls} inputMode="numeric" value={floatStr} onChange={(e) => setFloatStr(e.target.value)} placeholder="例：20000" />
          </Field>
        </div>
        <Button
          variant="primary"
          className="h-12 px-8 text-lg"
          disabled={busy || float === null}
          onClick={() =>
            run(async () => {
              await openSession(db, float!)
              notify.info('レジを開始しました')
            })
          }
        >
          レジを開始
        </Button>
      </div>
    </section>
  )
}

function OpenRegister({ session }: { session: OpenSession }) {
  const summary = useLiveQuery(() => getCashSummary(db, session), [session.id])
  const moves = useLiveQuery(() => db.cashMoves.where('sessionId').equals(session.id).reverse().sortBy('at'), [session.id])
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState(false)

  if (!summary || !moves) return null

  const parsed: Denoms = {}
  let countError = false
  for (const d of DENOMINATIONS) {
    const s = counts[String(d)] ?? ''
    if (s === '') continue
    const n = parseYen(s)
    if (n === null) countError = true
    else parsed[String(d)] = n
  }
  const actual = countError ? null : denomTotal(parsed)
  const diff = actual === null ? null : actual - summary.expected

  const bump = (d: number, delta: number) =>
    setCounts((c) => {
      const cur = parseYen(c[String(d)] ?? '') ?? 0
      return { ...c, [String(d)]: String(Math.max(0, cur + delta)) }
    })

  return (
    <>
      <section className="mb-8">
        <p className="mb-3 text-gray-700">
          レジ{session.id}：{formatDateTime(session.openedAt)} 開始
        </p>
        <SummaryTable summary={summary} />
      </section>

      <CashMoves moves={moves} />

      <section className="mb-10">
        <h2 className="mb-2 text-xl font-bold">レジ締め（金種別の枚数）</h2>
        <table className="w-full border border-gray-200">
          <thead>
            <tr>
              <th className={th}>金種</th>
              <th className={th}>枚数</th>
              <th className={thNum}>金額</th>
            </tr>
          </thead>
          <tbody>
            {DENOMINATIONS.map((d) => {
              const v = counts[String(d)] ?? ''
              const n = parseYen(v)
              return (
                <tr key={d}>
                  <td className={`${td} text-lg font-bold whitespace-nowrap`}>
                    {d.toLocaleString('ja-JP')}円{d >= 1000 ? '札' : '玉'}
                  </td>
                  <td className={td}>
                    <div className="flex items-center gap-2">
                      <Button className="h-12 w-14 text-2xl" aria-label={`${d}円を1枚減らす`} onClick={() => bump(d, -1)}>
                        −
                      </Button>
                      <input
                        className={`w-28 rounded-md border bg-white px-3 py-2 text-center text-xl tabular-nums focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200 ${
                          v !== '' && n === null ? 'border-red-500' : 'border-gray-300'
                        }`}
                        inputMode="numeric"
                        value={v}
                        placeholder="0"
                        aria-label={`${d}円の枚数`}
                        onChange={(e) => setCounts((c) => ({ ...c, [String(d)]: e.target.value }))}
                      />
                      <Button className="h-12 w-14 text-2xl" aria-label={`${d}円を1枚増やす`} onClick={() => bump(d, 1)}>
                        ＋
                      </Button>
                    </div>
                  </td>
                  <td className={`${tdNum} text-lg`}>{n === null ? (v === '' ? '0円' : '—') : yen(n * d)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Box label="理論現金残高" value={yen(summary.expected)} />
          <Box label="実際の現金残高" value={actual === null ? '入力エラー' : yen(actual)} />
          <Box
            label={diff === null ? '現金差異' : `現金差異：${judge(diff)}`}
            value={diff === null ? '—' : signedYen(diff)}
            tone={diff === null ? undefined : diff === 0 ? 'ok' : 'ng'}
          />
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="primary" className="h-14 px-10 text-xl" disabled={actual === null} onClick={() => setConfirming(true)}>
            レジ締めを確定
          </Button>
        </div>
      </section>

      {confirming && actual !== null && (
        <CloseDialog
          denoms={parsed}
          expected={summary.expected}
          actual={actual}
          onClose={() => setConfirming(false)}
          onDone={() => {
            setConfirming(false)
            setCounts({})
          }}
        />
      )}
    </>
  )
}

function Box({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'ng' }) {
  const cls = tone === 'ok' ? 'border-green-600 bg-green-50 text-green-900' : tone === 'ng' ? 'border-red-600 bg-red-50 text-red-900' : 'border-gray-300 bg-white'
  return (
    <div className={`rounded-md border-2 px-4 py-3 ${cls}`}>
      <div className="text-sm">{label}</div>
      <div className="text-3xl font-bold tabular-nums">{value}</div>
    </div>
  )
}

function SummaryTable({ summary, closing }: { summary: CashSummary; closing?: Closing }) {
  const rows: [string, string][] = [
    ['開始時釣銭準備金', yen(summary.float)],
    ['現金売上（受け取った総額）', yen(summary.salesGross)],
    ['返金額（会計取消）', signedYen(-summary.refunds)],
    ['売上合計（純額）', yen(summary.salesGross - summary.refunds)],
    ['売上以外の入金', yen(summary.cashIn)],
    ['売上以外の出金', signedYen(-summary.cashOut)],
    ['入出金合計', signedYen(summary.cashIn - summary.cashOut)],
    ['理論現金残高', yen(summary.expected)],
  ]
  if (closing) {
    rows.push(['実際の現金残高', yen(closing.actual)], ['現金差異', signedYen(closing.diff)], ['差異判定', closing.judgement], ['締め日時', formatDateTime(closing.closedAt)])
  }
  return (
    <table className="w-full border border-gray-200">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className={k === '理論現金残高' || k === '現金差異' ? 'font-bold' : ''}>
            <th className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-left font-normal">{k}</th>
            <td className={`${tdNum} text-lg`}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function CashMoves({ moves }: { moves: { id?: number; at: string; type: 'in' | 'out'; amount: number; reason: string }[] }) {
  const [type, setType] = useState<'in' | 'out'>('in')
  const [amountStr, setAmountStr] = useState('')
  const [reason, setReason] = useState('')
  const { run, busy } = useRunner()
  const notify = useNotify()
  const amount = parseYen(amountStr)
  const valid = amount !== null && amount > 0 && reason.trim() !== ''

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-xl font-bold">売上以外の入金・出金</h2>
      <p className="mb-3 text-gray-700">釣銭の追加や、レジの現金からの備品購入など。会計の返金は「売上・履歴」画面の取消で行うので、ここには入れません。</p>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="flex gap-1">
          <Button variant={type === 'in' ? 'primary' : 'secondary'} className="h-12 px-5 text-lg" aria-pressed={type === 'in'} onClick={() => setType('in')}>
            入金
          </Button>
          <Button variant={type === 'out' ? 'primary' : 'secondary'} className="h-12 px-5 text-lg" aria-pressed={type === 'out'} onClick={() => setType('out')}>
            出金
          </Button>
        </div>
        <div className="w-40">
          <Field label="金額（円）">
            <input className={inputCls} inputMode="numeric" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} />
          </Field>
        </div>
        <div className="min-w-48 flex-1">
          <Field label="理由（必須）">
            <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：両替用の追加" maxLength={100} />
          </Field>
        </div>
        <Button
          variant="primary"
          className="h-12 px-6 text-lg"
          disabled={busy || !valid}
          onClick={() =>
            run(async () => {
              await addCashMove(db, type, amount!, reason)
              notify.info(`${type === 'in' ? '入金' : '出金'} ${yen(amount!)} を記録しました`)
              setAmountStr('')
              setReason('')
            })
          }
        >
          記録する
        </Button>
      </div>
      {moves.length > 0 && (
        <table className="w-full border border-gray-200">
          <thead>
            <tr>
              <th className={th}>日時</th>
              <th className={th}>種別</th>
              <th className={thNum}>金額</th>
              <th className={th}>理由</th>
            </tr>
          </thead>
          <tbody>
            {moves.map((m) => (
              <tr key={m.id}>
                <td className={`${td} tabular-nums`}>{formatDateTime(m.at)}</td>
                <td className={td}>{m.type === 'in' ? '入金' : '出金'}</td>
                <td className={tdNum}>{m.type === 'in' ? yen(m.amount) : `−${yen(m.amount)}`}</td>
                <td className={td}>{m.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function CloseDialog({
  denoms,
  expected,
  actual,
  onClose,
  onDone,
}: {
  denoms: Denoms
  expected: number
  actual: number
  onClose: () => void
  onDone: () => void
}) {
  const { run, busy } = useRunner()
  const notify = useNotify()
  const diff = actual - expected
  return (
    <Modal
      title="レジ締めを確定しますか？"
      onClose={busy ? undefined : onClose}
      actions={
        <>
          <Button className="px-6 py-3 text-lg" disabled={busy} onClick={onClose}>
            戻る
          </Button>
          <Button
            variant="primary"
            className="px-6 py-3 text-lg"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const c = await closeSession(db, denoms)
                notify.info(`レジ締めを保存しました（${c.judgement}）`)
                onDone()
              })
            }
          >
            確定する
          </Button>
        </>
      }
    >
      <table className="w-full text-lg">
        <tbody>
          <tr>
            <th className="py-1 text-left font-normal">理論現金残高</th>
            <td className="py-1 text-right tabular-nums">{yen(expected)}</td>
          </tr>
          <tr>
            <th className="py-1 text-left font-normal">実際の現金残高</th>
            <td className="py-1 text-right tabular-nums">{yen(actual)}</td>
          </tr>
          <tr className="font-bold">
            <th className="py-1 text-left">現金差異</th>
            <td className="py-1 text-right tabular-nums">
              {signedYen(diff)}（{judge(diff)}）
            </td>
          </tr>
        </tbody>
      </table>
      <p className="mt-3 text-gray-700">確定するとこのレジは締め済みになり、会計できなくなります。続けて販売する場合は、もう一度レジを開始してください。</p>
    </Modal>
  )
}

function History({ sessions }: { sessions: Session[] }) {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">レジ締め履歴</h2>
        <Button className="px-4 py-2" disabled={sessions.length === 0} onClick={() => download(`レジ締め結果_${stamp()}.csv`, closingCsv([...sessions].reverse()), 'text/csv')}>
          レジ締め結果CSV
        </Button>
      </div>
      {sessions.length === 0 ? (
        <p className="text-gray-500">締め済みのレジはまだありません。</p>
      ) : (
        <table className="w-full border border-gray-200">
          <thead>
            <tr>
              <th className={th}>レジ</th>
              <th className={th}>締め日時</th>
              <th className={thNum}>理論</th>
              <th className={thNum}>実際</th>
              <th className={thNum}>差異</th>
              <th className={th}>判定</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const c = s.closing!
              return (
                <tr key={s.id}>
                  <td className={td}>レジ{s.id}</td>
                  <td className={`${td} tabular-nums`}>{formatDateTime(c.closedAt)}</td>
                  <td className={tdNum}>{yen(c.expected)}</td>
                  <td className={tdNum}>{yen(c.actual)}</td>
                  <td className={`${tdNum} font-bold`}>{signedYen(c.diff)}</td>
                  <td className={`${td} font-bold ${c.diff === 0 ? 'text-green-800' : 'text-red-700'}`}>{c.judgement}</td>
                  <td className={td}>
                    <Button className="px-3 py-1.5" onClick={() => setOpen(s.id!)}>
                      詳細
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {open !== null && <ClosingDetail session={sessions.find((s) => s.id === open)!} onClose={() => setOpen(null)} />}
    </section>
  )
}

function ClosingDetail({ session, onClose }: { session: Session; onClose: () => void }) {
  const c = session.closing!
  return (
    <Modal
      title={`レジ${session.id} の締め結果`}
      onClose={onClose}
      wide
      actions={
        <Button variant="primary" className="px-6 py-3 text-lg" onClick={onClose}>
          閉じる
        </Button>
      }
    >
      <p className="mb-3 text-gray-700">開始：{formatDateTime(session.openedAt)}</p>
      <SummaryTable summary={c} closing={c} />
      <h3 className="mt-4 mb-2 font-bold">金種別枚数</h3>
      <table className="w-full border border-gray-200">
        <tbody>
          {DENOMINATIONS.map((d) => {
            const n = c.denoms[String(d)] ?? 0
            return (
              <tr key={d}>
                <th className="border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-left font-normal">{d.toLocaleString('ja-JP')}円</th>
                <td className={tdNum}>{n}枚</td>
                <td className={tdNum}>{yen(n * d)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Modal>
  )
}
