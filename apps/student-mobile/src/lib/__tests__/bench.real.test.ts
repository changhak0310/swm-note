// 실제 문제집 PDF 벤치마크 — 기존 segmentPage vs PSP v0.1
//
// PDF는 저작물이라 리포지토리에 넣지 않는다. 환경변수로 경로를 준다:
//   PURI_BENCH_PDF=~/Downloads/suneung27mo06_2.pdf npx vitest run bench.real
// 경로가 없으면 조용히 건너뛴다 — CI에서 실패시키지 않는다.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractLines } from '../pdfText'
import { segmentPage } from '../segment'
import { runPipeline } from '../psp'
import { contentExtents, pageInput, toAppRegions } from '../psp/adapter'
import { diff, measure, type PageExtent } from '../psp/compare'
import { parseGolden, scoreAgainstGolden, type GoldenScore } from '../psp/golden'
import type { Region as AppRegion } from '../../types'

const expand = (p?: string) => p?.replace(/^~/, process.env.HOME ?? '~')
const PDF_PATH = expand(process.env.PURI_BENCH_PDF)
// 골든셋을 주면 "서로 얼마나 다른가" 대신 "얼마나 맞았는가"를 잰다
const GOLDEN_PATH = expand(process.env.PURI_GOLDEN)
const available = !!PDF_PATH && existsSync(PDF_PATH)

const suite = available ? describe : describe.skip

suite('실제 PDF 벤치마크', () => {
  it('두 알고리즘을 같은 잣대로 비교한다', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const data = new Uint8Array(readFileSync(PDF_PATH!))
    const pdf = await pdfjs.getDocument({ data }).promise

    // ---------- 기존 ----------
    let t = performance.now()
    const lines = []
    for (let p = 1; p <= pdf.numPages; p++) lines.push(await extractLines(await pdf.getPage(p)))
    const oldExtract = performance.now() - t

    t = performance.now()
    const oldRegions: AppRegion[] = []
    for (let p = 1; p <= pdf.numPages; p++) oldRegions.push(...segmentPage('b', p, lines[p - 1]))
    const oldSegment = performance.now() - t

    // ---------- PSP ----------
    t = performance.now()
    const pages = []
    for (let p = 1; p <= pdf.numPages; p++) pages.push(await pageInput(pdf, p, true))
    const pspExtract = performance.now() - t

    t = performance.now()
    const result = runPipeline(pages, { jobId: 'b' })
    const pspSegment = performance.now() - t
    const pspRegions = toAppRegions(result, 'b')

    // 커버리지 분모는 PRD §4.2의 본문 영역 — 양쪽에 같은 잣대를 쓴다
    const extents: PageExtent[] = contentExtents(result)

    const a = measure(oldRegions, extents, { extractMs: oldExtract, segmentMs: oldSegment })
    const b = measure(pspRegions, extents, { extractMs: pspExtract, segmentMs: pspSegment })
    const d = diff(oldRegions, pspRegions)

    const rows = [
      ['지표', '기존', 'PSP v0.1'],
      ['검출 문항', a.problems, b.problems],
      ['객관식', a.multipleChoice, b.multipleChoice],
      [
        '선지 5개 완비 (AC-2)',
        `${(a.choiceDetectRate * 100).toFixed(1)}% (${a.fullChoiceSets}/${a.multipleChoice})`,
        `${(b.choiceDetectRate * 100).toFixed(1)}% (${b.fullChoiceSets}/${b.multipleChoice})`,
      ],
      ['선지 박스 겹침 (AC-3)', a.hitboxCollisions, b.hitboxCollisions],
      ['문항 bbox 겹침 (INV-2)', a.boundsOverlaps, b.boundsOverlaps],
      ['본문 커버리지 (V-2)', `${(a.coverage * 100).toFixed(1)}%`, `${(b.coverage * 100).toFixed(1)}%`],
      ['번호 유실 (V-1)', a.missingNumbers.join(',') || '없음', b.missingNumbers.join(',') || '없음'],
      ['텍스트 추출', `${a.extractMs.toFixed(0)}ms`, `${b.extractMs.toFixed(0)}ms`],
      ['분할 연산', `${a.segmentMs.toFixed(0)}ms`, `${b.segmentMs.toFixed(0)}ms`],
    ]

    const w = [26, 22, 22]
    const line = (r: (string | number)[]) =>
      r.map((c, i) => pad(String(c), w[i])).join('  ')
    console.log(`\n${PDF_PATH}  ·  ${pdf.numPages}페이지\n`)
    console.log(line(rows[0]))
    console.log('─'.repeat(w.reduce((s, n) => s + n + 2, 0)))
    for (const r of rows.slice(1)) console.log(line(r))

    console.log(`\n문항 경계 평균 IoU  ${d.meanIou.toFixed(3)}`)
    console.log(`경계 크게 다름      ${d.disagreeing.length}건`)
    console.log(`기존에만 / PSP에만  ${d.onlyOld.length} / ${d.onlyNew.length}`)

    const buckets = { auto: 0, review: 0, priority: 0 }
    for (const p of result.problems) {
      if (p.confidence >= 0.85) buckets.auto++
      else if (p.confidence >= 0.5) buckets.review++
      else buckets.priority++
    }
    console.log(
      `\nPSP 라우팅  자동승인 ${buckets.auto} / 검수 ${buckets.review} / 우선검수 ${buckets.priority}`,
    )
    const flagCount = new Map<string, number>()
    for (const p of result.problems) {
      for (const f of p.flags) flagCount.set(f, (flagCount.get(f) ?? 0) + 1)
    }
    console.log(
      '플래그      ' +
        ([...flagCount].sort((x, y) => y[1] - x[1]).map(([f, n]) => `${f}=${n}`).join(' ') || '없음'),
    )

    if (GOLDEN_PATH && existsSync(GOLDEN_PATH)) {
      const golden = parseGolden(readFileSync(GOLDEN_PATH, 'utf8'))
      const ga = scoreAgainstGolden(oldRegions, golden)
      const gb = scoreAgainstGolden(pspRegions, golden)
      console.log(
        `\n골든셋 ${golden.source} · 확인 ${ga.pages}페이지 · 정답 ${ga.golden}구역\n` +
          [
            ['지표', '기존', 'PSP v0.1'],
            ['경계 정확도 @IoU0.7 (AC-1)', pct(ga.recall), pct(gb.recall)],
            ['정밀도', pct(ga.precision), pct(gb.precision)],
            ['F1', pct(ga.f1), pct(gb.f1)],
            ['평균 IoU', ga.meanIou.toFixed(3), gb.meanIou.toFixed(3)],
            ['번호 정확도', pct(ga.numberAccuracy), pct(gb.numberAccuracy)],
            ['선지 전량 검출 (AC-2)', choicePct(ga), choicePct(gb)],
            ['놓침 / 오검출', `${ga.misses.length} / ${ga.falsePositives.length}`, `${gb.misses.length} / ${gb.falsePositives.length}`],
          ]
            .map((r) => r.map((c, i) => pad(String(c), w[i])).join('  '))
            .join('\n'),
      )
      if (gb.misses.length) {
        console.log(`\nPSP가 놓친 구역: ${gb.misses.map((m) => `p${m.page}·${m.number}`).join(' ')}`)
      }
    }

    // AC-3는 예외 없는 조건이다
    expect(b.hitboxCollisions).toBe(0)
    expect(b.boundsOverlaps).toBe(0)
  }, 120_000)
})

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const choicePct = (s: GoldenScore) => (s.choiceRecall === null ? '라벨 없음' : pct(s.choiceRecall))

function pad(s: string, n: number): string {
  // 한글은 폭 2로 세어 표 정렬을 맞춘다
  const w = [...s].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 0x2000 ? 2 : 1), 0)
  return s + ' '.repeat(Math.max(0, n - w))
}
