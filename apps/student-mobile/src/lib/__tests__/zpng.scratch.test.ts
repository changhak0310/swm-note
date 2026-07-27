// 일회용 — 페이지를 PNG로 떨군다. 커밋하지 않는다.
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, it } from 'vitest'

const req = createRequire(import.meta.url)

describe('렌더', () => {
  it('png', async () => {
    const ck = await import('@napi-rs/canvas')
    const g = globalThis as Record<string, unknown>
    g.Path2D ??= ck.Path2D
    g.DOMMatrix ??= ck.DOMMatrix
    g.ImageData ??= ck.ImageData
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const base = req.resolve('pdfjs-dist/package.json').replace('package.json', '')
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(readFileSync(process.env.PDF!)),
      cMapUrl: base + 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: base + 'standard_fonts/',
    }).promise
    const tag = process.env.TAG || 'p'
    for (const p of (process.env.PAGES || '1').split(',').map(Number)) {
      const page = await pdf.getPage(p)
      const b = page.getViewport({ scale: 1 })
      const vp = page.getViewport({ scale: 1000 / b.width })
      const canvas = ck.createCanvas(Math.floor(vp.width), Math.floor(vp.height))
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx as never, viewport: vp, canvas: canvas as never })
        .promise
      writeFileSync(`${process.env.OUT}/${tag}${p}.png`, canvas.toBuffer('image/png'))
      console.log('wrote', tag + p)
    }
  }, 600_000)
})
