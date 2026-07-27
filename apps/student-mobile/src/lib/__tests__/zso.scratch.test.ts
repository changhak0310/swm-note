import './canvasGlobals'
import { readFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { detectScan } from '../scan/detect'
import { scanRegions } from '../scan/regions'
const PDF = process.env.PURI_BENCH_PDF?.replace(/^~/, process.env.HOME ?? '~')
describe.runIf(!!PDF)('스캔 구역', () => {
  it('한 쪽', async () => {
    const { createCanvas } = await import('@napi-rs/canvas')
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(PDF!)) }).promise
    const W = Number(process.env.SCAN_W || 2800)
    const p = Number(process.env.PAGE || 17)
    const page = await pdf.getPage(p)
    const base = page.getViewport({ scale: 1 })
    const vp = page.getViewport({ scale: W / base.width })
    const canvas = createCanvas(Math.floor(vp.width), Math.floor(vp.height))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx as never, viewport: vp, canvas: canvas as never }).promise
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const r = { width: img.width, height: img.height, rgba: img.data as unknown as Uint8ClampedArray }
    const layout = detectScan(r)
    const { regions } = scanRegions(layout, r, 's', p)
    console.log(`p${p} @${W} 단=${JSON.stringify(layout.columns)}`)
    for (const rg of regions) {
      console.log(`  ${rg.id.split(':').pop()} bounds(${rg.bounds.x.toFixed(0)},${rg.bounds.y.toFixed(0)},${rg.bounds.w.toFixed(0)}x${rg.bounds.h.toFixed(0)}) 선지 ${rg.choices.map((c) => `${c.label}@(${c.box.x.toFixed(0)},${c.box.y.toFixed(0)},${c.box.w.toFixed(0)}x${c.box.h.toFixed(0)})`).join(' ')}`)
    }
  }, 900_000)
})
