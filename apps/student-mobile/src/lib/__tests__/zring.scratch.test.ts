import './canvasGlobals'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { components, holeArea, masks, median } from '../scan/components'
import { APP_SCAN_WIDTH } from './scanRaster'
const PDF = process.env.PURI_BENCH_PDF?.replace(/^~/, process.env.HOME ?? '~')
describe.runIf(!!PDF && existsSync(PDF!))('링 후보', () => {
  it('렌더된 텍스트 PDF의 원문자', async () => {
    const { createCanvas } = await import('@napi-rs/canvas')
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(PDF!)) }).promise
    const W = Number(process.env.WIDTH || APP_SCAN_WIDTH)
    for (const p of (process.env.PAGES || '15').split(',').map(Number)) {
      const page = await pdf.getPage(p)
      const base = page.getViewport({ scale: 1 })
      const vp = page.getViewport({ scale: W / base.width })
      const canvas = createCanvas(Math.floor(vp.width), Math.floor(vp.height))
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx as never, viewport: vp, canvas: canvas as never }).promise
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const r = { width: img.width, height: img.height, rgba: img.data as unknown as Uint8ClampedArray }
      const { ink, inkLoose, threshold } = masks(r)
      console.log(`\np${p} ${r.width}x${r.height} 잉크문턱 ${threshold}`)
      for (const [name, mask] of [['엄격', ink], ['느슨', inkLoose]] as const) {
        const comps = components(mask, r.width, r.height, 4)
        // 정사각에 가까운 덩어리를 크기순으로
        const sq = comps.filter((c) => Math.abs(c.w / c.h - 1) <= 0.25 && c.w >= 8 && c.w <= 80)
        const rows = sq.map((c) => ({
          c, fill: c.px / (c.w * c.h),
          hole: holeArea(c, mask, r.width) / (c.w * c.h),
          holeC: holeArea(c, mask, r.width, true) / (c.w * c.h),
        }))
        const rings = rows.filter((o) => o.fill <= 0.20 && Math.max(o.hole, o.holeC) >= 0.45)
        console.log(`  ${name}: 정사각 ${sq.length} · 폭중앙값 ${median(sq.map((c) => c.w))} · 링조건 통과 ${rings.length}`)
        // 링에 가장 가까운 것들 (구멍 큰 순)
        for (const o of rows.sort((a, b) => Math.max(b.hole, b.holeC) - Math.max(a.hole, a.holeC)).slice(0, 6)) {
          console.log(`     (${o.c.x0},${o.c.y0}) ${o.c.w}x${o.c.h} fill=${o.fill.toFixed(2)} hole=${o.hole.toFixed(2)} 닫기=${o.holeC.toFixed(2)}`)
        }
      }
    }
  }, 900_000)
})
