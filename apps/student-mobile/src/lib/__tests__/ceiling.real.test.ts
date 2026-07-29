// 판정 기하의 상한 — **인쇄된 선지 문자를 정답으로 삼는다.**
//
//   PURI_CORPUS=~/puri-corpus npx vitest run ceiling
//
// §11.1의 오라클 상한은 손 라벨을 필요로 하지만, 라벨이 아직 0건이다. 그런데 벡터 PDF의
// 텍스트 레이어에는 **인쇄된 ①②③④⑤가 문자로 들어 있다.** 그건 출판사가 조판한 것이지
// 우리 검출기가 만든 것이 아니라, 마커 자리에 관한 한 그대로 정답이다.
//
// ★ 이것이 손 라벨을 대신하지는 않는다. 두 가지가 다르다.
//   ① 벡터 3권에만 쓸 수 있다 (스캔본에는 텍스트가 없다).
//   ② 선지 '띠'는 인쇄물에 없다 — 마커 자리에서 규칙으로 만든다. 그 규칙은 앱의 것을
//      그대로 빌려 오지만(§4.3.4), 사람이 그렸다면 조금 달랐을 것이다.
//
// 그래서 이 수치는 "마커를 하나도 놓치지 않았을 때 판정 기하가 얼마나 읽어내는가"의 상한이다.
// 99%에 못 미치면 **검출을 아무리 고쳐도, 라벨을 아무리 잘 만들어도 그 위로 못 간다.**
import './canvasGlobals'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { goldenToRegions, scoreAttribution } from '../metrics'
import { extractLines } from '../pdfText'
import { emptyGolden, type GoldenBox, type GoldenSet } from '../psp/golden'
import { computeHitboxes } from '../psp/regions'
import { openPdf } from './pdfDoc'
import type { BBox } from '../psp/types'
import type { Box, ChoiceLabel } from '../../types'

const CIRCLED = '①②③④⑤'

// 선지 띠 — 앱의 스캔 경로(§4.3.4 scan/regions.ts)와 같은 값
const LEAD = 0.35        // 마커 왼쪽 여유 (마커 폭 배수)
const ROW_PAD = 0.55     // 행 위아래 여유 (마커 높이 배수)
/** 줄의 마지막 선지가 물려받을 칸 폭이 없을 때 쓰는 폭 (마커 폭 배수) */
const TAIL_SLOT = 5

/**
 * 한 쪽의 원문자가 이보다 많으면 **정답표 격자**로 보고 통째로 뺀다.
 *
 * ★ 임의로 고른 값이 아니다. 실측 분포에 큰 틈이 있다 —
 *   hi_math p8:99 · p7:96 vs 나머지 전 쪽 ≤30, 수능 ≤20, 수학의 신 ≤20.
 *   그 두 쪽은 원문자 크기도 본문 마커의 0.65배(1.5 vs 2.3)이고 20 간격으로 촘촘히 박힌
 *   정답 격자다 — 선지가 아니다.
 *
 * 빼지 않으면 그 격자가 가짜 문항이 되어 상한이 98.77%로 내려간다(실측). 그건 판정 기하의
 * 결함이 아니라 **내가 만든 정답이 틀린 것**이라, 빼는 것이 옳다.
 */
const ANSWER_GRID_MARKERS = 40

const CORPUS = process.env.PURI_CORPUS?.replace(/^~/, process.env.HOME ?? '~')
const suite = CORPUS && existsSync(CORPUS) ? describe : describe.skip

type Marker = { label: number; box: Box }

suite('판정 기하 상한', () => {
  it('인쇄된 선지 문자를 정답으로 두고 M4를 잰다', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdfs = [join(CORPUS!, 'train'), join(CORPUS!, 'holdout'), CORPUS!]
      .filter(existsSync)
      .flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.pdf')).map((f) => join(d, f)))

    let anyVector = false
    const rows: string[] = []
    let allTotal = 0
    let allCorrect = 0
    let allWrong = 0

    for (const path of pdfs) {
      const pdf = await openPdf(pdfjs, new Uint8Array(readFileSync(path)))
      const { golden, skippedGrids } = await buildGolden(pdf, basename(path, '.pdf'))
      if (!golden.boxes.length) {
        rows.push(`  ${basename(path, '.pdf').padEnd(14)} — 인쇄된 선지 문자 없음 (스캔본)`)
        continue
      }
      anyVector = true

      // 예측 = 정답. 남는 실패는 판정 기하가 만든 것뿐이다
      const s = scoreAttribution(goldenToRegions(golden), golden)
      allTotal += s.total
      allCorrect += s.correct
      allWrong += s.wrong

      rows.push(
        `  ${basename(path, '.pdf').padEnd(14)} 문항 ${String(golden.boxes.length).padStart(4)}` +
          ` · 선지 ${String(s.total).padStart(5)}` +
          ` · M4 ${(s.accuracy * 100).toFixed(2).padStart(6)}%` +
          ` · 잘못 ${(s.wrongRate * 100).toFixed(2).padStart(5)}%` +
          ` · 미검출 ${((s.missed / Math.max(1, s.total)) * 100).toFixed(2).padStart(5)}%`,
      )
      for (const [kind, t] of Object.entries(s.byKind)) {
        if (t.total && t.correct < t.total) {
          rows.push(
            `      ${kind.padEnd(6)} ${t.correct}/${t.total}` +
              ` (잘못 ${t.wrong} · 미검출 ${t.missed})`,
          )
        }
      }
      for (const f of s.failures.slice(0, 6)) {
        rows.push(`      p${f.page} 선지${f.label} [${f.kind}] → ${f.got}`)
      }
      // 조용히 빼지 않는다 — 무엇을 재지 않았는지가 수치만큼 중요하다
      if (skippedGrids.length) {
        rows.push(`      (정답표로 보고 뺀 쪽: ${skippedGrids.join(' ')})`)
      }
    }

    const ceiling = allTotal ? allCorrect / allTotal : 0
    console.log(
      '\n판정 기하 상한 — 인쇄된 선지 문자를 정답으로 (벡터 PDF만)\n' +
        rows.join('\n') +
        `\n\n  합계  선지 ${allTotal} · M4 ${(ceiling * 100).toFixed(2)}%` +
        ` · 잘못 귀속 ${((allWrong / Math.max(1, allTotal)) * 100).toFixed(2)}%` +
        `\n  ${ceiling >= 0.99 ? '✅ 판정 기하는 99%를 감당한다 — 남은 격차는 검출과 라벨의 몫이다' : '❌ 여기가 천장이다. 검출을 고쳐도, 라벨을 만들어도 이 위로는 못 간다 — 판정 규칙(§4.4)부터 고쳐야 한다'}`,
    )

    expect(anyVector, '텍스트 레이어가 있는 PDF가 코퍼스에 없다').toBe(true)
    expect(allTotal).toBeGreaterThan(0)
  }, 1_800_000)
})

/**
 * 인쇄된 ①②③④⑤ 문자에서 골든셋을 만든다.
 *
 * 마커의 자리와 번호는 **인쇄물 그대로**다. 문항으로 묶는 규칙만 최소한으로 둔다 —
 * 읽는 순서로 훑다가 ①을 만나면 새 문항, 번호가 1씩 늘면 같은 문항. 4개 미만이면 버린다
 * (본문 속 "①의 경우" 같은 낱개 원문자를 문항으로 세우지 않기 위해서다).
 */
async function buildGolden(
  pdf: { numPages: number; getPage(n: number): Promise<any> },
  source: string,
): Promise<{ golden: GoldenSet; skippedGrids: string[] }> {
  const boxes: GoldenBox[] = []
  const pages: number[] = []
  const skippedGrids: string[] = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const lines = await extractLines(await pdf.getPage(p))
    const markers: Marker[] = []
    for (const line of lines) {
      for (const t of line.tokens) {
        const s = t.str.trim()
        // 토큰 하나가 원문자 하나일 때만 — "①②" 같이 붙어 온 것은 자리를 나눌 수 없다
        if (s.length !== 1) continue
        const i = CIRCLED.indexOf(s)
        if (i >= 0) markers.push({ label: i + 1, box: t.box })
      }
    }
    if (markers.length < 4) continue
    if (markers.length > ANSWER_GRID_MARKERS) {
      skippedGrids.push(`p${p}(${markers.length})`)
      continue
    }

    // 읽는 순서 — 행을 먼저 묶고 행 안에서만 x로 정렬한다 (§4.3.3의 y 지터 함정과 같은 규약)
    const ordered = readingOrder(markers)

    let group: Marker[] = []
    const flush = () => {
      if (group.length >= 4 && group.every((m, i) => m.label === i + 1)) {
        const choices = bandsFor(group)
        if (choices.length) {
          boxes.push({
            id: `${source}-p${p}-${boxes.length}`,
            page: p,
            number: '',
            bbox: union(choices.map((c) => c.box)),
            kind: 'choice',
            choices,
          })
        }
      }
      group = []
    }
    for (const m of ordered) {
      if (m.label === 1) flush()
      else if (!group.length || m.label !== group[group.length - 1].label + 1) {
        flush()
        continue
      }
      group.push(m)
    }
    flush()

    if (boxes.some((b) => b.page === p)) pages.push(p)
  }

  return {
    golden: { ...emptyGolden(source, pdf.numPages), boxes, reviewedPages: pages },
    skippedGrids,
  }
}

/** 행을 먼저 묶고 행 안에서 x로 정렬 */
function readingOrder(markers: Marker[]): Marker[] {
  const rows: Marker[][] = []
  for (const m of [...markers].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
    const row = rows[rows.length - 1]
    if (row && m.box.y < Math.max(...row.map((r) => r.box.y + r.box.h))) row.push(m)
    else rows.push([m])
  }
  return rows.flatMap((r) => r.sort((a, b) => a.box.x - b.box.x))
}

/**
 * 마커 자리에서 선지 띠를 만든다 — 앱의 규칙(§4.3.4)을 그대로 빌린다.
 *
 * ★ 띠는 인쇄물에 없다. 여기가 이 측정에서 유일하게 '만들어 낸' 부분이고, 그래서 이 수치를
 *   손 라벨 오라클과 같은 것으로 부르지 않는다.
 */
function bandsFor(group: Marker[]): { label: ChoiceLabel; box: Box }[] {
  const rows: Marker[][] = []
  for (const m of group) {
    const row = rows[rows.length - 1]
    if (row && m.box.y < Math.max(...row.map((r) => r.box.y + r.box.h))) row.push(m)
    else rows.push([m])
  }

  const w = median(group.map((m) => m.box.w))
  const h = median(group.map((m) => m.box.h))
  const lead = w * LEAD
  // 줄의 마지막 선지가 물려받을 칸 폭 — 앞 선지들의 폭 중앙값 (§4.2.4 choiceSlot)
  const slots: number[] = []
  for (const row of rows) {
    for (let i = 0; i + 1 < row.length; i++) slots.push(row[i + 1].box.x - row[i].box.x)
  }
  const slot = slots.length ? median(slots) : w * TAIL_SLOT

  const raw: { label: ChoiceLabel; box: BBox }[] = []
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri]
    const top = Math.min(...row.map((m) => m.box.y))
    const bottom = Math.max(...row.map((m) => m.box.y + m.box.h))
    let y0 = top - h * ROW_PAD
    let y1 = bottom + h * ROW_PAD
    const prev = rows[ri - 1]
    const next = rows[ri + 1]
    if (prev) y0 = Math.max(y0, (Math.max(...prev.map((m) => m.box.y + m.box.h)) + top) / 2)
    if (next) y1 = Math.min(y1, (bottom + Math.min(...next.map((m) => m.box.y))) / 2)

    for (let i = 0; i < row.length; i++) {
      const x0 = row[i].box.x - lead
      const x1 = row[i + 1] ? row[i + 1].box.x - lead : row[i].box.x + slot - lead
      raw.push({ label: row[i].label as ChoiceLabel, box: [x0, y0, x1, y1] })
    }
  }

  // 겹침 0 보장 — 앱과 같은 규칙 (RULE-HITBOX)
  const { boxes } = computeHitboxes(raw.map((r) => r.box))
  return raw
    .map((r, i) => ({
      label: r.label,
      box: { x: boxes[i][0], y: boxes[i][1], w: boxes[i][2] - boxes[i][0], h: boxes[i][3] - boxes[i][1] },
    }))
    .sort((a, b) => a.label - b.label)
}

function union(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return {
    x,
    y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}
