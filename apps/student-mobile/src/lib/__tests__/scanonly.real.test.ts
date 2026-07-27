// 스캔 경로만으로 텍스트 PDF를 인식했을 때 무엇이 남는가 — 브랜치 실험의 실측.
//
//   PURI_BENCH_PDF=~/Downloads/hi_math.pdf npx vitest run scanonly
//
// 앱(liveStore, SCAN_ONLY=true)과 같은 경로를 돈다: 페이지를 1700px로 렌더 →
// detectScan → scanRegions. 텍스트 경로 결과와 나란히 찍어 무엇을 잃고 얻는지 본다.
//
// Node에는 캔버스가 없어 @napi-rs/canvas로 pdf.js를 렌더한다. 앱의 renderPageBitmap과
// 같은 폭·같은 흰 배경이라 검출 입력은 사실상 같다.
// ★ 이 줄이 맨 위여야 한다 — pdf.js보다 먼저 전역을 세운다 (canvasGlobals.ts 주석 참고)
import './canvasGlobals'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectMarks } from '../liveDetect'
import { runPipeline } from '../psp'
import { pageInput, toAppRegions } from '../psp/adapter'
import { detectScan } from '../scan/detect'
import { scanRegions } from '../scan/regions'
import { APP_SCAN_WIDTH } from './scanRaster'
import type { Raster } from '../scan/components'
import type { PageInput } from '../psp/types'
import type { Point, Region, Stroke } from '../../types'

const expand = (p?: string) => p?.replace(/^~/, process.env.HOME ?? '~')
const PDF_PATH = expand(process.env.PURI_BENCH_PDF)
const suite = PDF_PATH && existsSync(PDF_PATH) ? describe : describe.skip

/** 선지 기호 자리에 친 동그라미 — livemark.real과 같은 모양 */
function circleOn(box: { x: number; y: number; w: number; h: number }, t: number): Stroke {
  const r = Math.min(box.h, box.w) * 0.6
  const cx = box.x + Math.min(box.h, box.w) / 2
  const cy = box.y + box.h / 2
  const points: Point[] = []
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2
    points.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, p: 0.5, t })
  }
  return { id: `s${t}`, regionId: null, attemptNo: 1, tool: 'pen', points }
}

suite('스캔 경로만으로 텍스트 PDF', () => {
  it('텍스트 경로와 나란히 잰다', async () => {
    const { createCanvas } = await import('@napi-rs/canvas')
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(PDF_PATH!)) }).promise

    // ---------- 기준선: 텍스트 경로 ----------
    const inputs: PageInput[] = []
    for (let p = 1; p <= pdf.numPages; p++) inputs.push(await pageInput(pdf, p, true))
    const textRegions = toAppRegions(runPipeline(inputs, { jobId: 't' }), 't')
    const textMc = textRegions.filter((r) => r.answerType === 'choice')

    // ---------- 스캔 경로 ----------
    // 앱 renderPageBitmap과 같다: 폭 1700, 흰 배경
    const width = Number(process.env.SCAN_W || APP_SCAN_WIDTH)
    const raster = async (pageNo: number): Promise<Raster> => {
      const page = await pdf.getPage(pageNo)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: width / base.width })
      const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height))
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx as never, viewport, canvas: canvas as never }).promise
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
      return { width: img.width, height: img.height, rgba: img.data as unknown as Uint8ClampedArray }
    }

    const pages = (process.env.PAGES || '')
      .split(',')
      .filter(Boolean)
      .map(Number)
    const range = pages.length ? pages : Array.from({ length: pdf.numPages }, (_, i) => i + 1)

    let scanProblems = 0
    let scanMc = 0
    let scanFull = 0
    let synth = 0
    let tried = 0
    let ok = 0
    let detectMs = 0
    let skipped = 0
    const skippedPages = new Set<number>()
    const perPage: string[] = []
    const misses: string[] = []

    for (const p of range) {
      // @napi-rs/canvas가 못 그리는 path가 섞인 쪽이 있다 — 하네스 한계이지 앱 문제가 아니다
      // (앱은 브라우저 캔버스로 그린다). 그런 쪽은 세지 않고 넘긴다
      let r: Raster
      try {
        r = await raster(p)
      } catch {
        skipped++
        skippedPages.add(p)
        continue
      }
      const t0 = Date.now()
      const layout = detectScan(r)
      const { regions, synthesizedHeadings } = scanRegions(layout, r, 's', p)
      detectMs += Date.now() - t0
      const mc = regions.filter((x) => x.choices.length >= 2)
      scanProblems += regions.length
      scanMc += mc.length
      scanFull += mc.filter((x) => x.choices.length === 5).length
      synth += synthesizedHeadings

      for (const rg of mc) {
        for (const c of rg.choices) {
          tried++
          const got = detectMarks(regions, [circleOn(c.box, 1000)])
          if (got[rg.id] === c.label) ok++
          else {
            misses.push(
              `p${p} ${rg.id.split(':').pop()} 선지${c.label}` +
                ` (${c.box.x.toFixed(0)},${c.box.y.toFixed(0)},${c.box.w.toFixed(0)}x${c.box.h.toFixed(0)})` +
                ` → ${got[rg.id] ?? (Object.keys(got).length ? '다른문항' : '미검출')}`,
            )
          }
        }
      }

      const t = textRegions.filter((x) => x.page === p)
      const tm = t.filter((x) => x.answerType === 'choice').length
      if (!process.env.QUIET && (t.length || regions.length)) {
        perPage.push(
          `p${String(p).padStart(3)} 텍스트 문항${String(t.length).padStart(2)} 객관식${String(tm).padStart(2)}` +
            ` | 스캔 문항${String(regions.length).padStart(2)} 객관식${String(mc.length).padStart(2)}` +
            `${synthesizedHeadings ? ` 번호대체${synthesizedHeadings}` : ''}`,
        )
      }
    }

    if (perPage.length) console.log('\n' + perPage.join('\n'))
    // 텍스트 경로 기준선도 같은 쪽만 세야 비교가 된다
    const inRange = (r: Region) => range.includes(r.page) && !skippedPages.has(r.page)
    const tRegions = textRegions.filter(inRange)
    const tMc = tRegions.filter((r) => r.answerType === 'choice')
    console.log(
      `\n${PDF_PATH} · ${range.length}쪽 · 렌더 폭 ${width}` +
        `\n  텍스트 경로: 문항 ${tRegions.length} · 객관식 ${tMc.length}` +
        ` · 선지5완비 ${tMc.filter((r) => r.choices.length === 5).length}` +
        `\n  스캔 경로  : 문항 ${scanProblems} · 객관식 ${scanMc} · 선지5완비 ${scanFull}` +
        ` · 번호대체 ${synth}` +
        `\n  스캔 마킹 되읽기 ${ok}/${tried}` +
        ` · 검출 ${(detectMs / Math.max(1, range.length - skipped)).toFixed(0)}ms/쪽` +
        (skipped ? `\n  (렌더 실패로 건너뛴 쪽 ${skipped} — 하네스 한계, 앱은 브라우저 캔버스로 그린다)` : ''),
    )

    if (misses.length) console.log('\n되읽기 실패:\n' + misses.slice(0, 10).join('\n'))

    // 되읽기는 스캔 경로 안에서 자기일관이어야 한다 (분할과 판정 사이의 계약).
    // 스캔본에서는 100%지만(scan.real), 벡터 PDF에 스캔 경로를 대면 단 판정이 흔들려
    // 좌우 단 마커가 한 문항으로 묶이는 쪽이 남는다 — 이 브랜치의 미해결 항목이다.
    expect(tried).toBeGreaterThan(0)
    expect(ok / tried).toBeGreaterThanOrEqual(0.99)
  }, 1_800_000)
})
