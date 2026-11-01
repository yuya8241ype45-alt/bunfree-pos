// アプリアイコン（PNG）を外部ライブラリなしで生成する。node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const BLUE = [29, 78, 216]
const WHITE = [255, 255, 255]

/** 0〜1の正規化座標で描く。レジ本体（画面＋キー3×3）を白で描画 */
function pixel(x, y) {
  const inRect = (x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1
  if (inRect(0.24, 0.2, 0.76, 0.38)) return inRect(0.28, 0.24, 0.72, 0.34) ? BLUE : WHITE
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const x0 = 0.24 + c * 0.185
      const y0 = 0.45 + r * 0.12
      if (inRect(x0, y0, x0 + 0.15, y0 + 0.09)) return WHITE
    }
  }
  if (inRect(0.2, 0.82, 0.8, 0.86)) return WHITE
  return BLUE
}

function crc32(buf) {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel((x + 0.5) / size, (y + 0.5) / size)
      const o = y * (size * 3 + 1) + 1 + x * 3
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

writeFileSync('public/icon-192.png', png(192))
writeFileSync('public/icon-512.png', png(512))
writeFileSync('public/apple-touch-icon.png', png(180))

const keys = [0, 1, 2]
  .flatMap((r) => [0, 1, 2].map((c) => `<rect x="${24 + c * 18.5}" y="${45 + r * 12}" width="15" height="9" fill="#fff"/>`))
  .join('')
writeFileSync(
  'public/icon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#1d4ed8"/><rect x="24" y="20" width="52" height="18" fill="#fff"/><rect x="28" y="24" width="44" height="10" fill="#1d4ed8"/>${keys}<rect x="20" y="82" width="60" height="4" fill="#fff"/></svg>\n`,
)
console.log('icons written')
