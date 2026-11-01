// 使用マニュアル（当日の会計担当向け）を HTML で組み立て、Chrome で PDF にする。
// 先に shots.mjs で img/ と shots.json を作っておく。
// 使い方: node docs/manual/build.mjs <出力PDFのパス>
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DIR = import.meta.dirname
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const outPdf = path.resolve(process.argv[2] ?? path.join(DIR, 'manual.pdf'))
const shots = JSON.parse(fs.readFileSync(path.join(DIR, 'shots.json'), 'utf8'))

/** 注釈付きのスクリーンショット */
function fig(name, caption, { width = 100 } = {}) {
  const s = shots[name]
  if (!s) throw new Error('unknown shot ' + name)
  const marks = s.marks
    .map(
      (m) =>
        `<div class="mark${m.x < 2 ? ' edge-x' : ''}${m.y < 3 ? ' edge-y' : ''}" style="left:${Math.max(m.x, 0.2)}%;top:${Math.max(m.y, 0.2)}%;width:${m.w}%;height:${m.h}%"><span>${m.n}</span></div>`,
    )
    .join('')
  return `<figure style="width:${width}%"><div class="shot" style="aspect-ratio:${s.ratio}"><img src="img/${s.file}">${marks}</div>${
    caption ? `<figcaption>${caption}</figcaption>` : ''
  }</figure>`
}

const n = (k) => `<b class="num">${k}</b>`

const body = /* html */ `
<section class="page cover">
  <div class="cover-top">
    <p class="kicker">文学フリマ 物販ブース</p>
    <h1>文フリ レジ<br>使い方マニュアル</h1>
    <p class="lead">当日、会計を担当する方へ。<br>初めてでも、このとおりに操作すれば大丈夫です。</p>
  </div>
  <div class="flow">
    <div class="flow-step"><div class="flow-n">1</div><div><b>商品を選ぶ</b><br>商品の「＋」を押す</div></div>
    <div class="flow-arrow">→</div>
    <div class="flow-step"><div class="flow-n">2</div><div><b>金額を入れる</b><br>現金は預かった額<br>PayPayは支払った額</div></div>
    <div class="flow-arrow">→</div>
    <div class="flow-step"><div class="flow-n">3</div><div><b>確定する</b><br>「現金で確定」か<br>「PayPay」を押す</div></div>
  </div>
  <div class="toc">
    <h2>もくじ</h2>
    <ol>
      <li>はじめに（アプリの開き方）</li>
      <li>会計画面の見方</li>
      <li>現金で会計する</li>
      <li>PayPayで会計する</li>
      <li>間違えたとき</li>
      <li>ボタンが押せないとき・困ったとき</li>
    </ol>
  </div>
  <div class="note">
    <b>大事なこと</b>
    <ul>
      <li>インターネットにつながっていなくても使えます。</li>
      <li>会計は「確定」を押した時点で自動保存されます。保存ボタンはありません。</li>
      <li>確定した会計を間違えたときは、自分で消さずに責任者に声をかけてください（5章）。</li>
    </ul>
  </div>
</section>

<section class="page">
  <h2 class="ch"><span>1</span>はじめに（アプリの開き方）</h2>
  <ol class="steps">
    <li>iPadのホーム画面にある <b>「文フリレジ」</b>（青いレジの絵）のアイコンを押します。</li>
    <li><b>会計画面</b>が開きます。会計担当の方は、基本的にこの画面だけを使います。</li>
    <li>画面の右上に <b class="red">「● レジ未開始」</b> と出ているときは、まだ会計できません。責任者に声をかけてください。</li>
  </ol>
  ${fig('no-register', `${n(1)} 赤い帯「レジが開始されていません」が出ている間は会計できません　${n(2)} 右上の表示が「● レジ営業中」（緑）になれば会計できます`)}
  <div class="box">
    <h3>責任者の方へ：レジの開始</h3>
    <p>上のタブの「レジ開始・締め」を押し、${n(1)} にレジに入れた釣銭準備金（例：20000）を入れて ${n(2)}「レジを開始」を押します。</p>
    ${fig('register-start', '', { width: 82 })}
  </div>
</section>

<section class="page">
  <h2 class="ch"><span>2</span>会計画面の見方</h2>
  ${fig('overview')}
  <table class="legend">
    <tr><td>${n(1)}</td><th>商品</th><td>商品名・値段・残りの在庫数。「売り切れ」の商品は選べません。</td></tr>
    <tr><td>${n(2)}</td><th>−／＋ボタン</th><td>押すたびに数量が1つ増える・減ります。商品の名前のところを押しても1つ増えます。</td></tr>
    <tr><td>${n(3)}</td><th>選んだ商品</th><td>選んだ商品と金額の一覧。その下に点数と<b>合計</b>が出ます。</td></tr>
    <tr><td>${n(4)}</td><th>テンキー</th><td>預かった金額（PayPayは支払われた金額）を入れます。右の列は「ちょうど」「1,000」などの早押しボタンです。</td></tr>
    <tr><td>${n(5)}</td><th>確定ボタン</th><td>左から「リセット」（最初からやり直す）、「PayPay」、「現金で確定」。</td></tr>
    <tr><td>${n(6)}</td><th>レジの状態</th><td>「● レジ営業中」（緑）なら会計できます。</td></tr>
  </table>
</section>

<section class="page">
  <h2 class="ch"><span>3</span>現金で会計する</h2>
  <h3 class="step"><span>手順1</span>商品を選ぶ</h3>
  <p>お客様が買う商品の ${n(1)}「＋」を、買う数だけ押します。${n(2)} に選んだ商品、${n(3)} に点数と合計金額が出るので、お客様に合計金額を伝えます。</p>
  ${fig('cash-1-items', '例：ブックカバー2種セット1点＋しおりA 2点＝合計1,300円', { width: 70 })}
  <h3 class="step"><span>手順2</span>預かった金額を入れて確定する</h3>
  <p>お客様から受け取った金額を入れます。2,000円札なら ${n(1)}「2,000」を押すだけです（端数はテンキーで入力）。${n(2)} にお釣りが出るのを確認して、${n(3)}「<b>現金で確定</b>」を押します。</p>
  ${fig('cash-2-received', '「ちょうど」を押すと、合計と同じ金額が入ります', { width: 70 })}
</section>

<section class="page">
  <h2 class="ch"><span>3</span>現金で会計する（つづき）</h2>
  <h3 class="step"><span>手順3</span>お釣りを渡して、次のお客様へ</h3>
  <p>完了画面に ${n(1)} <b>お釣り</b>が大きく出ます。お釣りを渡したら ${n(2)}「<b>次のお客様へ</b>」を押します。会計画面に戻り、次の会計ができます。</p>
  ${fig('cash-3-done')}
  <div class="note">
    <b>ポイント</b>
    <ul>
      <li>お預かりした金額が合計より少ないと、「現金で確定」は押せません（6章）。</li>
      <li>「現金で確定」を2回押してしまっても、会計は1回分しか記録されません。</li>
      <li>在庫は自動で減ります。数えたり、メモしたりする必要はありません。</li>
    </ul>
  </div>
</section>

<section class="page">
  <h2 class="ch"><span>4</span>PayPayで会計する</h2>
  <p>PayPayは、<b>お客様がブースのQRコードを読み取り、お客様自身のスマホで金額を入力して支払う</b>方式です。</p>
  <ol class="steps">
    <li>現金と同じように、商品の「＋」で商品を選び、<b>合計金額をお客様に伝えます</b>。</li>
    <li>お客様にQRコードを読み取ってもらい、<b>合計金額を入力して支払って</b>もらいます。</li>
    <li>お客様のスマホの<b>支払い完了画面</b>を見せてもらい、支払った金額が合計と同じか確認します。</li>
    <li>その金額を ${n(1)} テンキーで入れます（同じ金額なら「ちょうど」でも可）。${n(2)} に金額が出ます。</li>
    <li>赤い ${n(3)}「<b>PayPay</b>」ボタンを押します。</li>
  </ol>
  ${fig('paypay-1-entered', '例：紙クリップ2種セット＋しおりB＝合計700円。700と入れると「PayPay」が押せるようになります', { width: 92 })}
</section>

<section class="page">
  <h2 class="ch"><span>4</span>PayPayで会計する（つづき）</h2>
  <p>完了画面に ${n(1)} PayPayで支払われた金額が出ます。${n(2)}「<b>次のお客様へ</b>」を押して終わりです。お釣りはありません。</p>
  ${fig('paypay-2-done')}
  <div class="note">
    <b>PayPayの注意</b>
    <ul>
      <li>「PayPay」ボタンは、入れた金額が<b>合計とぴったり同じとき</b>だけ押せます。</li>
      <li>お客様が違う金額で支払ってしまったときは、ボタンを押さずに責任者に声をかけてください。PayPay側で返金・支払い直しが必要です。</li>
      <li>PayPayのお金はレジの現金箱には入りません。現金を受け取ったり渡したりしないでください。</li>
    </ul>
  </div>
</section>

<section class="page">
  <h2 class="ch"><span>5</span>間違えたとき</h2>
  <h3>確定する前なら（その場で直せます）</h3>
  <ul class="plain">
    <li>商品の数を間違えた → 商品の「<b>−</b>」で減らす。</li>
    <li>金額の入力を間違えた → 金額欄の「<b>クリア</b>」、またはテンキーの「<b>⌫</b>」（1文字消す）。</li>
    <li>全部やり直したい → 「<b>リセット</b>」。商品も金額も空になります。</li>
  </ul>
  <h3>確定した後なら（会計の取消）</h3>
  <p class="warn">取消は売上と在庫に関わるので、<b>責任者が行う</b>か、責任者に確認してから行ってください。</p>
  <ol class="steps">
    <li>上のタブの「<b>売上・履歴</b>」を押し、${n(2)}「会計履歴」から取り消す会計を探して ${n(1)}「<b>取消</b>」を押します。</li>
  </ol>
  ${fig('cancel-1-list', '', { width: 84 })}
</section>

<section class="page">
  <h2 class="ch"><span>5</span>間違えたとき（つづき）</h2>
  <ol class="steps" start="2">
    <li>確認画面の ${n(1)} に、<b>返金する金額</b>が出ます。現金の会計なら、その金額をお客様に現金で返します。PayPayの会計なら、返金はPayPayの管理画面から行います（レジの現金からは返しません）。</li>
    <li>${n(2)} に取消の理由（例：打ち間違い、返品）を入れます。</li>
    <li>${n(3)}「<b>取消して返金する</b>」を押します。売上から外れ、在庫が元に戻ります。</li>
  </ol>
  ${fig('cancel-2-dialog')}
  <p class="small">取消した会計も履歴に「取消」として残ります（消えることはありません）。一部だけ返品するときは、会計全体を取消してから、残りの商品で会計し直します。</p>
</section>

<section class="page">
  <h2 class="ch"><span>6</span>ボタンが押せないとき・困ったとき</h2>
  ${fig('trouble-short', `例：合計500円に対して300円しか入っていない状態。${n(1)} に「不足」と出て、${n(2)} の確定ボタンは押せません。${n(3)} 売り切れの商品は「＋」が押せません`, { width: 66 })}
  <table class="faq">
    <tr><th>こんなとき</th><th>理由と対処</th></tr>
    <tr><td>「現金で確定」が押せない</td><td>預かった金額が<b>足りない</b>か、まだ入れていません。お釣り欄に「○円不足」と出ます。</td></tr>
    <tr><td>「PayPay」が押せない</td><td>入れた金額が<b>合計と違います</b>。お客様の支払い完了画面の金額を入れ直してください。</td></tr>
    <tr><td>商品の「＋」が押せない</td><td>その商品が<b>売り切れ</b>か、在庫の数まで選んでいます。</td></tr>
    <tr><td>赤い帯「レジが開始されていません」</td><td>会計できません。責任者に声をかけてください（1章）。</td></tr>
    <tr><td>「エラー」「保存できませんでした」と出た</td><td>その会計は<b>記録されていません</b>。「閉じる」を押して、もう一度確定してください。続くときは責任者へ。</td></tr>
    <tr><td>画面が固まった・アプリを閉じてしまった</td><td>ホーム画面のアイコンから開き直してください。確定済みの会計は消えません（確定前の入力はやり直し）。</td></tr>
  </table>
  <div class="note">
    <b>やらないでください</b>
    <ul>
      <li>Safariの「履歴とWebサイトデータを消去」（売上の記録が消えます）。</li>
      <li>「商品設定」「在庫」「バックアップ」画面の操作（責任者が行います）。</li>
    </ul>
  </div>
</section>
`

const css = /* css */ `
@page { size: A4; margin: 12mm 13mm 14mm; }
* { box-sizing: border-box; }
html { font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif; color: #111827; font-size: 10.5pt; line-height: 1.65; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; }
.page { break-after: page; }
.page:last-child { break-after: auto; }
h1 { font-size: 32pt; line-height: 1.25; margin: 0 0 6mm; }
h2.ch { display: flex; align-items: center; gap: 3mm; font-size: 17pt; margin: 0 0 4mm; padding-bottom: 2mm; border-bottom: 2px solid #1d4ed8; }
h2.ch span { display: inline-flex; width: 10mm; height: 10mm; align-items: center; justify-content: center; background: #1d4ed8; color: #fff; border-radius: 2mm; font-size: 14pt; }
h3 { font-size: 12.5pt; margin: 5mm 0 2mm; }
h3.step { display: flex; align-items: center; gap: 2.5mm; }
h3.step span { background: #e0e7ff; color: #1e3a8a; padding: 0.5mm 2.5mm; border-radius: 1.5mm; font-size: 10.5pt; }
p { margin: 0 0 3mm; }
.red { color: #b91c1c; }
.small { font-size: 9.5pt; color: #374151; }
figure { margin: 2mm auto 4mm; }
.shot { position: relative; border: 1px solid #9ca3af; }
.shot img { display: block; width: 100%; height: 100%; }
.mark { position: absolute; border: 2.5px solid #dc2626; border-radius: 4px; }
.mark.edge-x span { left: 2px; }
.mark.edge-y span { top: 2px; }
.mark span { position: absolute; left: -11px; top: -11px; width: 22px; height: 22px; border-radius: 50%; background: #dc2626; color: #fff; font-weight: 700; font-size: 12px; display: flex; align-items: center; justify-content: center; }
figcaption { font-size: 9.5pt; color: #374151; margin-top: 1.5mm; }
.num { display: inline-flex; width: 16px; height: 16px; border-radius: 50%; background: #dc2626; color: #fff; font-size: 9.5pt; align-items: center; justify-content: center; vertical-align: 1px; margin: 0 1px; }
ol.steps { padding-left: 6mm; margin: 0 0 3mm; }
ol.steps li { margin-bottom: 1.5mm; }
ul.plain { padding-left: 5mm; margin: 0 0 3mm; }
table { border-collapse: collapse; width: 100%; }
table.legend td, table.legend th, table.faq td, table.faq th { border: 1px solid #d1d5db; padding: 1.6mm 2.5mm; vertical-align: top; text-align: left; }
table.legend th { white-space: nowrap; background: #f3f4f6; width: 26mm; }
table.legend td:first-child { width: 9mm; text-align: center; }
table.faq th { background: #f3f4f6; }
table.faq td:first-child { width: 52mm; font-weight: 700; }
.note { border: 1.5px solid #1d4ed8; background: #eff6ff; border-radius: 2mm; padding: 3mm 4mm; margin-top: 4mm; }
.note ul { margin: 1mm 0 0; padding-left: 5mm; }
.warn { border-left: 4px solid #dc2626; background: #fef2f2; padding: 2mm 3mm; }
.box { border: 1px solid #d1d5db; border-radius: 2mm; padding: 3mm 4mm 1mm; margin-top: 4mm; background: #f9fafb; }
.box h3 { margin-top: 0; }
.cover-top { margin-top: 18mm; }
.kicker { color: #1d4ed8; font-weight: 700; font-size: 12pt; margin-bottom: 2mm; }
.lead { font-size: 13pt; }
.flow { display: flex; align-items: stretch; gap: 3mm; margin: 12mm 0 10mm; }
.flow-step { flex: 1; border: 2px solid #1d4ed8; border-radius: 3mm; padding: 4mm; display: flex; gap: 3mm; font-size: 10.5pt; }
.flow-n { flex: none; width: 11mm; height: 11mm; border-radius: 50%; background: #1d4ed8; color: #fff; font-weight: 700; font-size: 15pt; display: flex; align-items: center; justify-content: center; }
.flow-arrow { display: flex; align-items: center; font-size: 18pt; color: #1d4ed8; }
.toc h2 { font-size: 13pt; margin: 0 0 2mm; }
.toc ol { margin: 0; padding-left: 6mm; font-size: 11.5pt; }
`

const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>文フリ レジ 使い方マニュアル</title><style>${css}</style></head><body>${body}</body></html>`
const htmlPath = path.join(DIR, 'manual.html')
fs.writeFileSync(htmlPath, html)

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage()
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' })
await page.pdf({
  path: outPdf,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate:
    '<div style="width:100%;font-size:8pt;color:#6b7280;text-align:center;font-family:Hiragino Sans,sans-serif">文フリ レジ 使い方マニュアル ― <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
})
await browser.close()
console.log('PDF:', outPdf)
