// 코퍼스 전체 채점 — "인식 95%"를 판정하는 단 하나의 명령.
//
//   PURI_CORPUS=~/puri-corpus npx vitest run corpus
//   PURI_CORPUS=~/puri-corpus PURI_CORPUS_WRITE=1 npx vitest run corpus   # baseline 갱신
//   PURI_CORPUS=~/puri-corpus PURI_TARGET=1 npx vitest run corpus         # 합격선 판정
//
// 디렉터리 규약 (PDF는 저작물이라 리포에 넣지 않는다 — 라벨 JSON과 해시만 커밋한다):
//
//   corpus/
//     train/    쎈수학1.pdf   쎈수학1.golden.json
//     holdout/  ...
//
// ★ holdout은 최종 판정 전까지 **열어 보지 않는다.** 한 번이라도 실패 케이스를 보고
//   상수를 만지면 그 순간 train이 되고, 일반화 성능을 재는 수단이 사라진다.
//   이 파일이 두 묶음을 따로 집계하는 이유가 그것이다.
//
// ★ 이 줄이 맨 위여야 한다 — pdf.js보다 먼저 전역을 세운다 (canvasGlobals.ts 주석 참고)
import './canvasGlobals'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { goldenToRegions, scoreAttribution, type AttributionScore } from '../metrics'
import { parseGolden, scoreAgainstGolden, type GoldenSet, type GoldenScore } from '../psp/golden'
import { detectScan } from '../scan/detect'
import { scanRegions } from '../scan/regions'
import { openPdf } from './pdfDoc'
import { APP_SCAN_WIDTH, pageRaster } from './scanRaster'
import type { Raster } from '../scan/components'
import type { Region } from '../../types'

/** 앱의 렌더 폭 (stores/documentStore.ts). 벡터는 더 크게 그려야 선지 링이 살아난다 */
const SCAN_WIDTH = APP_SCAN_WIDTH
const VECTOR_SCAN_WIDTH = 2800

/** 합격선 — 계획 문서 §2.3 · §2.4 */
const TARGET_M4 = 0.95          // 묶음 전체
const TARGET_M4_FLOOR = 0.9     // 어느 한 권도 이 아래로 떨어지지 않을 것
const TARGET_WRONG = 0.005      // 잘못 귀속(조용히 틀린다)
/** baseline 대비 이만큼 넘게 내려가면 회귀다 */
const REGRESSION_TOL = 0.005

const BASELINE_PATH = new URL('./corpus.baseline.json', import.meta.url).pathname

const CORPUS = process.env.PURI_CORPUS?.replace(/^~/, process.env.HOME ?? '~')
const suite = CORPUS && existsSync(CORPUS) ? describe : describe.skip

/**
 * 무엇을 예측으로 삼는가.
 *
 *   detect  검출 결과 — 합격선(§5.3) 판정은 언제나 이 모드로 한다
 *   oracle  라벨 그대로 — **판정 기하의 상한**을 잰다 (§11.1)
 *
 * ★ oracle이 100%가 아니면, 라벨을 아무리 잘 만들어도 그 차이만큼은 못 넘는다. 그때 고칠
 *   것은 검출이 아니라 판정 규칙(§4.4 detectChoice·ownerOf)이다. 라벨링에 며칠 쓰기 전에
 *   이 숫자를 먼저 봐야 한다 — 천장이 97%인 줄 모르고 99%를 좇으면 그 며칠이 낭비된다.
 */
const MODE = (process.env.PURI_MODE ?? 'detect') as 'detect' | 'oracle'

type Split = 'train' | 'holdout'

type BookResult = {
  split: Split
  name: string
  pages: number
  skipped: number[]
  hashOk: boolean | null
  score: GoldenScore
  m4: AttributionScore
  ms: number
}

/** 한 권의 지표 요약 — baseline에 저장하는 형태 */
type BookMetrics = {
  m0: number
  m1Recall: number
  m1Precision: number
  m2: number | null
  m3: number | null
  m4: number
  wrongRate: number
  choices: number
}

suite('코퍼스 채점', () => {
  it('권별 M0~M4', async () => {
    const books = findBooks(CORPUS!)
    expect(books.length, `${CORPUS}에 <이름>.pdf + <이름>.golden.json 짝이 없다`).toBeGreaterThan(0)

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const { createCanvas } = await import('@napi-rs/canvas')

    const results: BookResult[] = []
    for (const book of books) {
      const t0 = Date.now()
      const bytes = readFileSync(book.pdfPath)
      const golden = parseGolden(readFileSync(book.goldenPath, 'utf8'))
      const hash = `sha256:${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}`
      const hashOk = golden.sourceHash ? golden.sourceHash === hash : null

      // 앱과 같은 옵션으로 연다 — CMap을 빼면 한글이 빠진 래스터를 재게 된다 (pdfDoc.ts)
      const pdf = await openPdf(pdfjs, new Uint8Array(bytes))
      // 앱과 같은 폭으로 그린다 — 폭이 달라지면 가는 링이 끊기고 안 끊기고가 갈린다
      const width = (await hasText(pdf)) ? VECTOR_SCAN_WIDTH : SCAN_WIDTH

      const pages = golden.reviewedPages.filter((p) => p >= 1 && p <= pdf.numPages)
      const regions: Region[] = []
      const skipped: number[] = []
      if (MODE === 'oracle') {
        // 검출을 통째로 건너뛰고 라벨을 예측으로 쓴다 — 렌더도 필요 없다
        regions.push(...goldenToRegions(golden, pages))
      } else {
        for (const p of pages) {
          const raster = await rasterOf(pdfjs, createCanvas, pdf, p, width)
          if (!raster) {
            skipped.push(p)
            continue
          }
          const layout = detectScan(raster)
          regions.push(...scanRegions(layout, raster, 'c', p).regions)
        }
      }

      // 렌더에 실패한 쪽은 채점에서 뺀다 — 하네스 한계를 알고리즘 점수로 셀 수 없다.
      // 대신 아래 표에 그대로 찍어 조용히 사라지지 않게 한다
      const scored: GoldenSet = skipped.length
        ? { ...golden, reviewedPages: pages.filter((p) => !skipped.includes(p)) }
        : { ...golden, reviewedPages: pages }

      results.push({
        split: book.split,
        name: book.name,
        pages: scored.reviewedPages.length,
        skipped,
        hashOk,
        score: scoreAgainstGolden(regions, scored),
        m4: scoreAttribution(regions, scored),
        ms: Date.now() - t0,
      })
    }

    report(results)

    // ---------- oracle: 판정 기하의 상한 ----------
    // baseline·합격선은 건드리지 않는다. 검출 수치와 섞이면 둘 다 뜻을 잃는다 (§11.7)
    if (MODE === 'oracle') {
      const total = sum(results.map((r) => r.m4.total))
      const correct = sum(results.map((r) => r.m4.correct))
      const wrong = sum(results.map((r) => r.m4.wrong))
      const ceiling = total ? correct / total : 0
      console.log(
        `\n판정 기하 상한 (라벨을 예측으로) — M4 ${(ceiling * 100).toFixed(2)}%` +
          ` · 잘못 귀속 ${((wrong / Math.max(1, total)) * 100).toFixed(2)}% · 선지 ${total}` +
          `\n  ${ceiling >= 0.99 ? '✅ 99% 라벨 우선 설계가 도달 가능하다' : '❌ 라벨을 완벽히 만들어도 여기가 천장이다 — 판정 규칙(§4.4)부터 고쳐야 한다'}`,
      )
      expect(total, 'oracle 모드인데 라벨된 선지가 없다').toBeGreaterThan(0)
      return
    }

    const current = Object.fromEntries(results.map((r) => [r.name, metricsOf(r)]))
    if (process.env.PURI_CORPUS_WRITE) {
      writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n')
      console.log(`\nbaseline 갱신: ${BASELINE_PATH}`)
    }

    // ---------- 회귀 ----------
    const regressions = compareBaseline(current)
    if (regressions.length) console.log('\n회귀:\n' + regressions.join('\n'))
    expect(regressions, '지표가 baseline보다 내려갔다').toEqual([])

    // ---------- 합격선 ----------
    // 아직 도달하지 못한 목표를 상시 빨간 테스트로 두면 회귀 신호가 묻힌다.
    // 판정은 PURI_TARGET=1일 때만 한다 (§8 계획의 마지막 지점)
    if (process.env.PURI_TARGET) {
      for (const split of ['train', 'holdout'] as Split[]) {
        const rs = results.filter((r) => r.split === split)
        if (!rs.length) continue
        const total = sum(rs.map((r) => r.m4.total))
        if (!total) continue
        expect(sum(rs.map((r) => r.m4.correct)) / total, `${split} M4`).toBeGreaterThanOrEqual(TARGET_M4)
        expect(sum(rs.map((r) => r.m4.wrong)) / total, `${split} 잘못 귀속`).toBeLessThanOrEqual(TARGET_WRONG)
        for (const r of rs) {
          expect(r.m4.accuracy, `${r.name} M4 하한`).toBeGreaterThanOrEqual(TARGET_M4_FLOOR)
        }
      }
    }
  }, 3_600_000)
})

// ---------- 코퍼스 읽기 ----------

type Book = { split: Split; name: string; pdfPath: string; goldenPath: string }

/** <dir>/{train,holdout}/ 아래의 pdf + golden.json 짝. 하위 폴더가 없으면 통째로 train */
function findBooks(root: string): Book[] {
  const out: Book[] = []
  const scan = (dir: string, split: Split) => {
    if (!existsSync(dir)) return
    for (const f of readdirSync(dir)) {
      if (!f.toLowerCase().endsWith('.pdf')) continue
      const pdfPath = join(dir, f)
      const goldenPath = pdfPath.replace(/\.pdf$/i, '.golden.json')
      // 라벨 없는 PDF는 채점할 수 없다 — 조용히 넘기지 않고 알린다
      if (!existsSync(goldenPath)) {
        console.log(`(라벨 없음, 건너뜀) ${pdfPath}`)
        continue
      }
      out.push({ split, name: basename(f, '.pdf'), pdfPath, goldenPath })
    }
  }
  scan(join(root, 'train'), 'train')
  scan(join(root, 'holdout'), 'holdout')
  if (!out.length) scan(root, 'train')
  return out
}

/**
 * 텍스트 레이어 유무 — `lib/pdf.ts`의 `hasTextLayer`와 같은 판정.
 *
 * 그 파일을 import 하지 않는 이유: 모듈 최상위에서 `new Worker(...)`를 만드는데
 * Node에는 Worker가 없어 불러오는 것만으로 죽는다. 세 줄이라 여기 옮겨 적는다.
 */
async function hasText(pdf: any): Promise<boolean> {
  const content = await (await pdf.getPage(1)).getTextContent()
  return content.items.some((i: any) => 'str' in i && i.str.trim() !== '')
}

/**
 * 페이지 래스터. 캔버스 렌더가 앱과 같은 경로라 우선이고, @napi-rs/canvas가 못 그리는
 * path가 섞인 쪽만 내장 이미지 리샘플로 되짚는다(스캔본은 그 경로로도 같은 픽셀이 나온다).
 */
async function rasterOf(
  pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs'),
  createCanvas: (w: number, h: number) => any,
  pdf: any,
  pageNo: number,
  width: number,
): Promise<Raster | null> {
  try {
    const page = await pdf.getPage(pageNo)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: width / base.width })
    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport, canvas }).promise
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    return { width: img.width, height: img.height, rgba: img.data as unknown as Uint8ClampedArray }
  } catch {
    return pageRaster(pdfjs, pdf, pageNo, width).catch(() => null)
  }
}

// ---------- 보고 ----------

function metricsOf(r: BookResult): BookMetrics {
  return {
    m0: round(r.score.pageTypeAccuracy),
    m1Recall: round(r.score.recall),
    m1Precision: round(r.score.precision),
    m2: r.score.choiceTypeAccuracy === null ? null : round(r.score.choiceTypeAccuracy),
    m3: r.score.choiceRecall === null ? null : round(r.score.choiceRecall),
    m4: round(r.m4.accuracy),
    wrongRate: round(r.m4.wrongRate),
    choices: r.m4.total,
  }
}

function report(results: BookResult[]) {
  const pct = (v: number | null) => (v === null ? '   – ' : `${(v * 100).toFixed(1)}%`)
  const lines: string[] = [
    '',
    `모드: ${MODE}${MODE === 'oracle' ? ' (검출 건너뜀 — 라벨이 곧 예측)' : ''}`,
    '권                         쪽    M0     M1재현 M1정밀 M2     M3     M4     잘못  표본',
    '─'.repeat(94),
  ]
  for (const split of ['train', 'holdout'] as const) {
    const rs = results.filter((r) => r.split === split)
    if (!rs.length) continue
    lines.push(`[${split}]`)
    for (const r of rs) {
      const m = metricsOf(r)
      lines.push(
        `  ${r.name.slice(0, 22).padEnd(22)} ${String(r.pages).padStart(3)}  ` +
          [m.m0, m.m1Recall, m.m1Precision, m.m2, m.m3, m.m4].map((v) => pct(v).padStart(6)).join(' ') +
          ` ${pct(m.wrongRate).padStart(6)} ${String(m.choices).padStart(5)}` +
          (r.hashOk === false ? '  ⚠ 해시 불일치' : '') +
          (r.skipped.length ? `  (렌더 실패 ${r.skipped.length}쪽)` : ''),
      )
    }
    const total = sum(rs.map((r) => r.m4.total))
    if (total) {
      const acc = sum(rs.map((r) => r.m4.correct)) / total
      const wrong = sum(rs.map((r) => r.m4.wrong)) / total
      const floor = Math.min(...rs.map((r) => r.m4.accuracy))
      lines.push(
        `  ${'─ 합계'.padEnd(22)} ${String(sum(rs.map((r) => r.pages))).padStart(3)}` +
          `  M4 ${pct(acc)} · 최저 권 ${pct(floor)} · 잘못 귀속 ${pct(wrong)} · 선지 ${total}` +
          `   ${acc >= TARGET_M4 && floor >= TARGET_M4_FLOOR && wrong <= TARGET_WRONG ? '✅ 합격' : '❌ 미달'}`,
      )
    }
  }
  console.log(lines.join('\n'))

  // 실패 표본 — 무엇을 고쳐야 하는지는 숫자가 아니라 이 목록이 말한다
  for (const r of results) {
    const f = r.m4.failures
    if (!f.length) continue
    const wrong = f.filter((x) => x.outcome === 'wrong')
    console.log(
      `\n${r.name} 실패 ${f.length}건 (잘못 귀속 ${wrong.length})\n` +
        [...wrong, ...f.filter((x) => x.outcome === 'missed')]
          .slice(0, 12)
          .map((x) => `  p${x.page} ${x.number}번 선지${x.label} [${x.kind}] → ${x.got}`)
          .join('\n'),
    )
    if (r.score.misses.length) {
      console.log(
        `  놓친 문항 ${r.score.misses.length}: ` +
          r.score.misses.slice(0, 10).map((m) => `p${m.page}:${m.number}`).join(' '),
      )
    }
    if (r.score.falsePositives.length) {
      console.log(
        `  없는 문항 ${r.score.falsePositives.length}: ` +
          r.score.falsePositives.slice(0, 10).map((m) => `p${m.page}:${m.number}`).join(' '),
      )
    }
  }
}

/** baseline 대비 내려간 지표. 없거나 새 권이면 비교하지 않는다 */
function compareBaseline(current: Record<string, BookMetrics>): string[] {
  if (!existsSync(BASELINE_PATH)) {
    console.log('\n(baseline 없음 — PURI_CORPUS_WRITE=1로 만든다)')
    return []
  }
  const base = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Record<string, BookMetrics>
  const out: string[] = []
  for (const [name, cur] of Object.entries(current)) {
    const b = base[name]
    if (!b) continue
    for (const key of ['m0', 'm1Recall', 'm1Precision', 'm2', 'm3', 'm4'] as const) {
      const was = b[key]
      const now = cur[key]
      if (was === null || now === null || was === undefined) continue
      if (now < was - REGRESSION_TOL) {
        out.push(`  ${name} ${key}: ${(was * 100).toFixed(1)}% → ${(now * 100).toFixed(1)}%`)
      }
    }
    // 잘못 귀속은 올라가면 회귀다
    if (b.wrongRate !== undefined && cur.wrongRate > b.wrongRate + REGRESSION_TOL) {
      out.push(
        `  ${name} 잘못 귀속: ${(b.wrongRate * 100).toFixed(1)}% → ${(cur.wrongRate * 100).toFixed(1)}%`,
      )
    }
  }
  return out
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const round = (v: number) => Math.round(v * 1e4) / 1e4
