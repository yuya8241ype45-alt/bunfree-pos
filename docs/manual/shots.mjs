// マニュアル用のスクリーンショットを撮り、注釈（番号の枠）の位置を shots.json に記録する。
// 事前に `npm run build && npm run preview` で http://localhost:4173 を起動しておく。
// 使い方: node docs/manual/shots.mjs
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const URL = process.env.APP_URL ?? 'http://localhost:4173/'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = path.join(import.meta.dirname, 'img')
fs.mkdirSync(OUT, { recursive: true })

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bunfree-manual-'))
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile })
const page = await browser.newPage()
await page.setViewport({ width: 1180, height: 820, deviceScaleFactor: 2 })
await page.goto(URL, { waitUntil: 'networkidle0' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const clickText = async (text, nth = 0) => {
  const ok = await page.evaluate(
    (t, i) => {
      const b = [...document.querySelectorAll('button')].filter((x) => x.textContent.trim() === t && !x.disabled)[i]
      if (b) b.click()
      return !!b
    },
    text,
    nth,
  )
  if (!ok) throw new Error('button not found/disabled: ' + text)
  await sleep(300)
}
const clickLabel = async (label) => {
  await page.click(`[aria-label="${label}"]`)
  await sleep(120)
}
const typeInto = async (selector, value) => {
  await page.click(selector, { clickCount: 3 })
  await page.type(selector, value)
  await sleep(100)
}
const key = async (k) => clickLabel(k)

/** 要素の位置（CSSピクセル）を取得。target は {sel} / {text} / {label} / {union:[...]} */
const rectOf = (target) =>
  page.evaluate((t) => {
    const find = (x) => {
      if (x.sel) return document.querySelector(x.sel)
      if (x.label) return document.querySelector(`[aria-label="${x.label}"]`)
      if (x.text) {
        const all = [...document.querySelectorAll(x.tag ?? 'button, h2, span, div, p, td, th, label')]
        return all.filter((e) => e.textContent.trim() === x.text).pop()
      }
      return null
    }
    const list = (t.union ?? [t]).map(find)
    if (list.some((e) => !e)) return null
    const rs = list.map((e) => e.getBoundingClientRect())
    const x = Math.min(...rs.map((r) => r.left))
    const y = Math.min(...rs.map((r) => r.top))
    return { x, y, w: Math.max(...rs.map((r) => r.right)) - x, h: Math.max(...rs.map((r) => r.bottom)) - y }
  }, target)

const shots = {}
async function shot(name, marks = [], clip) {
  await sleep(400)
  const file = `${name}.png`
  const box = clip ?? { x: 0, y: 0, width: 1180, height: 820 }
  await page.screenshot({ path: path.join(OUT, file), clip: box })
  const out = []
  for (const [n, target] of marks) {
    const r = await rectOf(target)
    if (!r) throw new Error(`mark ${n} not found in ${name}: ${JSON.stringify(target)}`)
    const pad = 4
    out.push({
      n,
      x: ((r.x - pad - box.x) / box.width) * 100,
      y: ((r.y - pad - box.y) / box.height) * 100,
      w: ((r.w + pad * 2) / box.width) * 100,
      h: ((r.h + pad * 2) / box.height) * 100,
    })
  }
  shots[name] = { file, ratio: box.width / box.height, marks: out }
}

// ---------- 準備：レジ未開始の会計画面 ----------
await shot('no-register', [[1, { sel: 'section[aria-label="会計"] > div' }], [2, { text: '● レジ未開始', tag: 'span' }]])

// 在庫を入れる（ステッカーは0のまま＝売り切れ表示）
await clickText('在庫')
const stocks = [30, 20, 20, 15]
for (let i = 0; i < stocks.length; i++) {
  await clickText('在庫を修正', i)
  await typeInto('[role=dialog] input[inputmode=numeric]', String(stocks[i]))
  await clickText('修正する')
  await sleep(300)
}
await clickText('レジ開始・締め')
await shot('register-start', [[1, { sel: 'input[placeholder="例：20000"]' }], [2, { text: 'レジを開始' }]], { x: 0, y: 0, width: 1180, height: 420 })
await typeInto('input[placeholder="例：20000"]', '20000')
await clickText('レジを開始')
await sleep(3000) // 「レジを開始しました」の通知が消えるのを待つ
await clickText('会計')

// ---------- 会計画面の見方 ----------
await shot('overview', [
  [1, { sel: 'section[aria-label="商品選択"]' }],
  [2, { union: [{ label: 'ブックカバー2種セットを1つ減らす' }, { label: 'ブックカバー2種セットを1つ増やす' }] }],
  [3, { sel: 'section[aria-label="会計"] > div.min-h-0' }],
  [4, { union: [{ text: '7' }, { text: '10,000' }] }],
  [5, { union: [{ text: 'リセット' }, { text: '現金で確定' }] }],
  [6, { text: '● レジ営業中', tag: 'span' }],
])

// ---------- 現金会計 ----------
await clickLabel('ブックカバー2種セットを1つ増やす')
await clickLabel('しおり Aを1つ増やす')
await clickLabel('しおり Aを1つ増やす')
await shot('cash-1-items', [
  [1, { label: 'しおり Aを1つ増やす' }],
  [2, { sel: 'section[aria-label="会計"] > div.min-h-0' }],
  [3, { union: [{ text: '点数 3点', tag: 'span' }, { text: '1,300円', tag: 'div' }] }],
])
await clickText('2,000')
await shot('cash-2-received', [
  [1, { text: '2,000' }],
  [2, { sel: 'section[aria-label="会計"] .grid.grid-cols-2' }],
  [3, { text: '現金で確定' }],
])
await clickText('現金で確定')
const DONE_CLIP = { x: 0, y: 250, width: 1180, height: 400 }
await shot(
  'cash-3-done',
  [
    [1, { sel: 'main .border-blue-700.bg-blue-50' }],
    [2, { text: '次のお客様へ' }],
  ],
  DONE_CLIP,
)
await clickText('次のお客様へ')

// ---------- PayPay会計 ----------
await clickLabel('紙クリップ2種セットを1つ増やす')
await clickLabel('しおり Bを1つ増やす')
await key('7')
await key('00')
await shot('paypay-1-entered', [
  [1, { union: [{ text: '7' }, { label: '1文字消す' }] }],
  [2, { sel: 'section[aria-label="会計"] .grid.grid-cols-2 > div:first-child' }],
  [3, { text: 'PayPay' }],
])
await clickText('PayPay')
await shot('paypay-2-done', [[1, { sel: 'main .border-red-600.bg-red-50' }], [2, { text: '次のお客様へ' }]], DONE_CLIP)
await clickText('次のお客様へ')

// ---------- 困ったとき ----------
await clickLabel('ブックカバー2種セットを1つ増やす')
await key('3')
await key('00')
await shot('trouble-short', [
  [1, { sel: 'section[aria-label="会計"] .grid.grid-cols-2 > div:nth-child(2)' }],
  [2, { union: [{ text: 'PayPay' }, { text: '現金で確定' }] }],
  [3, { union: [{ label: 'ステッカー2種セットを1つ減らす' }, { label: 'ステッカー2種セットを1つ増やす' }] }],
])
await clickText('リセット')

// ---------- 会計の取消 ----------
await clickText('売上・履歴')
await shot('cancel-1-list', [[1, { text: '取消' }]], { x: 0, y: 0, width: 1180, height: 820 })
await page.evaluate(() => document.querySelector('main > div').scrollTo(0, 99999))
await sleep(300)
await shot('cancel-1-list', [[1, { text: '取消' }], [2, { text: '会計履歴（新しい順）', tag: 'h2' }]])
// 現金の会計（No.1）を取消
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('tbody tr')].filter((r) => r.querySelector('td')?.textContent.trim() === '1')
  rows.at(-1).querySelector('button').click()
})
await sleep(300)
await typeInto('[role=dialog] input', '打ち間違い')
await shot('cancel-2-dialog', [
  [1, { sel: '[role=dialog] .border-red-300' }],
  [2, { sel: '[role=dialog] input' }],
  [3, { text: '取消して返金する' }],
])

fs.writeFileSync(path.join(import.meta.dirname, 'shots.json'), JSON.stringify(shots, null, 2))
await browser.close()
fs.rmSync(profile, { recursive: true, force: true })
console.log('shots:', Object.keys(shots).join(', '))
