// 3단 검증 실측 — 텍스트 / 위치 검증 / 픽셀을 각각·합쳐 재고 무엇이 늘었는지 본다.
//
//   PDF="~/Desktop/수학 문제집/문제/hi_math.pdf" npx vitest run threeStage
//
// PDF는 저작물이라 리포에 넣지 않는다. 경로가 없으면 조용히 건너뛴다.
import './canvasGlobals'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { extractLines } from '../pdfText'
import { runPipeline } from '../psp'
import { pageInput, toAppRegions } from '../psp/adapter'
import { detectScan } from '../scan/detect'
import { scanRegions } from '../scan/regions'
import { mergeRegions, verifyChoices, type PrintedMark } from '../verify/merge'
import type { Raster } from '../scan/components'
import type { PageInput } from '../psp/types'
import type { Region } from '../../types'

const req = createRequire(import.meta.url)
const expand = (p?: string) => p?.replace(/^~/, process.env.HOME ?? '~')
const PDF = expand(process.env.PDF)
const suite = PDF && existsSync(PDF) ? describe : describe.skip

/** 벡터 PDF를 픽셀로 볼 때의 렌더 폭 — 링 획이 1px 아래로 깎이지 않는 크기 */
const VECTOR_W = 2800
const CIRCLED = '①②③④⑤'

suite('3단 검증', () => {
  it('텍스트 · 위치검증 · 픽셀을 합치면 무엇이 늘어나는가', async () => {
    const ck = await import('@napi-rs/canvas')
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const base = req.resolve('pdfjs-dist/package.json').replace('package.json', '')
    // ★ CJK 폰트는 cMap이 있어야 읽힌다. 없으면 한글이 통째로 사라져 텍스트 경로가 무력해진다
    //   (실측 수학의 신: 한글 0자·원문자 0 → cMap 지정 후 237자·10개)
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(readFileSync(PDF!)),
      cMapUrl: base + 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: base + 'standard_fonts/',
    }).promise

    // ---------- 1단: 텍스트 ----------
    const inputs: PageInput[] = []
    for (let p = 1; p <= pdf.numPages; p++) inputs.push(await pageInput(pdf, p, true))
    let textRegions: Region[] = []
    try {
      textRegions = toAppRegions(runPipeline(inputs, { jobId: 't' }), 't')
    } catch {
      textRegions = []                 // 텍스트가 아예 없는 스캔본
    }

    // ---------- 3단: 픽셀 ----------
    const raster = async (pageNo: number): Promise<Raster | null> => {
      try {
        const page = await pdf.getPage(pageNo)
        const b = page.getViewport({ scale: 1 })
        const vp = page.getViewport({ scale: VECTOR_W / b.width })
        const canvas = ck.createCanvas(Math.floor(vp.width), Math.floor(vp.height))
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvasContext: ctx as never, viewport: vp, canvas: canvas as never })
          .promise
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
        return { width: img.width, height: img.height, rgba: img.data as unknown as Uint8ClampedArray }
      } catch {
        return null                    // 하네스(@napi-rs/canvas) 한계 — 앱은 브라우저 캔버스로 그린다
      }
    }

    const pages = (process.env.PAGES || '').split(',').filter(Boolean).map(Number)
    const range = pages.length ? pages : Array.from({ length: pdf.numPages }, (_, i) => i + 1)

    let onlyText = 0
    let onlyPixel = 0
    let both = 0
    let confirmed = 0
    let unconfirmed = 0
    let corrected = 0
    let skipped = 0
    let pixelChecked = 0
    let pixelConfirmed = 0
    const gained: string[] = []

    for (const p of range) {
      const r = await raster(p)
      if (!r) {
        skipped++
        continue
      }
      const pixelRegions = scanRegions(detectScan(r), r, 'p', p).regions.filter(
        (x) => x.choices.length >= 2,
      )
      const onPage = textRegions.filter((x) => x.page === p && x.answerType === 'choice')

      // ---------- 2단: 위치 검증 ----------
      // 텍스트가 성하면 토큰 위치가 곧 정답이다. OCR은 텍스트가 없을 때의 같은 역할
      const marks: PrintedMark[] = []
      for (const t of (await extractLines(await pdf.getPage(p))).flatMap((l) => l.tokens)) {
        for (const ch of t.str) {
          const i = CIRCLED.indexOf(ch)
          if (i >= 0) marks.push({ label: i + 1, box: t.box })
        }
      }

      const merged = mergeRegions(onPage, pixelRegions)
      for (const m of merged) {
        if (m.source === 'text') onlyText++
        else if (m.source === 'pixel') {
          onlyPixel++
          gained.push(`p${p} (${m.region.bounds.x.toFixed(0)},${m.region.bounds.y.toFixed(0)})`)
        } else both++

        if (marks.length) {
          const v = verifyChoices(m.region, marks)
          confirmed += v.report.confirmed
          unconfirmed += v.report.unconfirmed
          corrected += v.report.corrected
          // 픽셀만 찾은 문항이 진짜인지가 핵심이다 — 선지 자리에 인쇄된 기호가 있어야 한다
          if (m.source === 'pixel') {
            pixelChecked += v.report.confirmed + v.report.unconfirmed + v.report.corrected
            pixelConfirmed += v.report.confirmed + v.report.corrected
          }
        }
      }
    }

    const total = onlyText + both + onlyPixel
    console.log(
      `\n${PDF!.split('/').pop()} · ${range.length - skipped}쪽` +
        (skipped ? ` (렌더 실패 ${skipped} 제외)` : '') +
        `\n  1단 텍스트만 ${onlyText} · 3단 픽셀만 ${onlyPixel} · 둘 다 ${both}` +
        `\n  → 합계 객관식 ${total} (텍스트 단독 ${onlyText + both} 대비 +${onlyPixel})` +
        `\n  2단 위치검증: 확인 ${confirmed} · 교정 ${corrected} · 못 찾음 ${unconfirmed}` +
        (pixelChecked
          ? `\n  픽셀만 찾은 문항의 선지 ${pixelChecked}개 중 인쇄 자리 확인 ${pixelConfirmed}` +
            ` (${((pixelConfirmed / pixelChecked) * 100).toFixed(0)}%) — 낮으면 과검출이다`
          : ''),
    )
    if (gained.length) console.log('  픽셀이 되찾은 자리:\n    ' + gained.slice(0, 12).join('\n    '))

    expect(total).toBeGreaterThan(0)
  }, 1_800_000)
})
