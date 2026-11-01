import { useEffect, useRef, useState } from 'react'
import { db } from '../db/db'
import { exportAll, importAll, validateBackup, type Backup as BackupFile } from '../db/backup'
import { PosError } from '../db/ops'
import { formatDateTime } from '../lib/calc'
import { closingCsv, productSalesCsv, salesCsv } from '../lib/csv'
import { buildDashboard } from '../lib/summary'
import { Button, Modal, PageTitle, download, stamp, useNotify, useRunner } from '../ui'

export default function Backup() {
  const { run, busy } = useRunner()
  const notify = useNotify()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ name: string; backup: BackupFile } | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted, () => setPersisted(null))
  }, [])

  const exportJson = () =>
    run(async () => {
      const b = await exportAll(db)
      download(`bunfree-pos_バックアップ_${stamp()}.json`, JSON.stringify(b, null, 2), 'application/json')
      notify.info('バックアップを書き出しました')
    })

  const exportCsv = (kind: 'sales' | 'products' | 'closing') =>
    run(async () => {
      const b = await exportAll(db)
      if (kind === 'sales') download(`売上履歴_${stamp()}.csv`, salesCsv(b.data.sales), 'text/csv')
      if (kind === 'products') {
        const products = [...b.data.products].sort((a, c) => a.sortOrder - c.sortOrder)
        download(`商品別売上_${stamp()}.csv`, productSalesCsv(buildDashboard(b.data.sales, products)), 'text/csv')
      }
      if (kind === 'closing') {
        const sessions = [...b.data.sessions].sort((a, c) => a.openedAt.localeCompare(c.openedAt))
        download(`レジ締め結果_${stamp()}.csv`, closingCsv(sessions), 'text/csv')
      }
    })

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    await run(async () => {
      let raw: unknown
      try {
        raw = JSON.parse(await file.text())
      } catch {
        throw new PosError('JSONファイルとして読み込めませんでした')
      }
      setPending({ name: file.name, backup: validateBackup(raw) })
    })
    if (fileRef.current) fileRef.current.value = ''
  }

  const restore = () =>
    run(async () => {
      await importAll(db, pending!.backup)
      setPending(null)
      notify.info('バックアップから復元しました')
    })

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageTitle>バックアップ・設定</PageTitle>

      <section className="rounded-lg border border-gray-300 p-5">
        <h2 className="mb-2 text-xl font-bold">全データのバックアップ（JSON）</h2>
        <p className="mb-4 text-gray-700">
          商品・会計履歴・在庫履歴・入出金・レジ締め結果をすべて1つのファイルに書き出します。イベント終了時とレジ締め後に必ず保存し、iPadの「ファイル」アプリやiCloud Driveに残してください。
        </p>
        <Button variant="primary" className="h-14 px-8 text-lg" disabled={busy} onClick={exportJson}>
          バックアップを書き出す
        </Button>
      </section>

      <section className="rounded-lg border border-gray-300 p-5">
        <h2 className="mb-2 text-xl font-bold">バックアップから復元</h2>
        <p className="mb-4 text-gray-700">選んだファイルの内容を検証してから、確認画面を表示します。復元すると、この端末の現在のデータはすべて置き換わります。</p>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
        <Button className="h-14 px-8 text-lg" disabled={busy} onClick={() => fileRef.current?.click()}>
          ファイルを選んで復元
        </Button>
      </section>

      <section className="rounded-lg border border-gray-300 p-5">
        <h2 className="mb-2 text-xl font-bold">CSV出力（全期間）</h2>
        <p className="mb-4 text-gray-700">Excel・Numbersで開けます。期間を絞った出力は「売上・履歴」画面から行えます。</p>
        <div className="flex flex-wrap gap-3">
          <Button className="h-12 px-5" disabled={busy} onClick={() => exportCsv('sales')}>
            売上履歴CSV
          </Button>
          <Button className="h-12 px-5" disabled={busy} onClick={() => exportCsv('products')}>
            商品別売上CSV
          </Button>
          <Button className="h-12 px-5" disabled={busy} onClick={() => exportCsv('closing')}>
            レジ締め結果CSV
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-gray-300 p-5">
        <h2 className="mb-2 text-xl font-bold">この端末の保存状態</h2>
        <ul className="list-disc space-y-1 pl-6 text-gray-700">
          <li>データはこの端末のブラウザ内（IndexedDB）にだけ保存され、外部には送信されません。</li>
          <li>
            データ保護（永続化）：
            {persisted === null ? '確認できません' : persisted ? '有効' : '未許可（ホーム画面に追加して使うと保護されやすくなります）'}
          </li>
          <li>iPadでは、Safariの「ホーム画面に追加」から起動して使ってください。Safariのタブのまま使うと、長期間使わない場合にデータが消えることがあります。</li>
          <li>Safariの「履歴とWebサイトデータを消去」を行うとデータが消えます。</li>
        </ul>
      </section>

      {pending && (
        <Modal
          title="この内容で復元しますか？"
          onClose={busy ? undefined : () => setPending(null)}
          actions={
            <>
              <Button className="px-6 py-3 text-lg" disabled={busy} onClick={() => setPending(null)}>
                やめる
              </Button>
              <Button variant="danger" className="px-6 py-3 text-lg" disabled={busy} onClick={restore}>
                現在のデータを置き換えて復元
              </Button>
            </>
          }
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-lg">
            <dt className="text-gray-600">ファイル</dt>
            <dd className="break-all">{pending.name}</dd>
            <dt className="text-gray-600">書き出し日時</dt>
            <dd>{formatDateTime(pending.backup.exportedAt)}</dd>
            <dt className="text-gray-600">商品</dt>
            <dd>{pending.backup.data.products.length}件</dd>
            <dt className="text-gray-600">会計</dt>
            <dd>{pending.backup.data.sales.length}件</dd>
            <dt className="text-gray-600">レジ</dt>
            <dd>{pending.backup.data.sessions.length}件</dd>
          </dl>
          <p className="mt-4 font-bold text-red-700">この端末の現在のデータはすべて消え、ファイルの内容に置き換わります。先に現在のデータをバックアップしておくことをおすすめします。</p>
        </Modal>
      )}
    </div>
  )
}
