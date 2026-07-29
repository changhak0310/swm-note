// 라이브 마킹 되읽기 — 실제 PDF에서 뽑은 선지 좌표에 동그라미·빗금을 쳐 보고
// detectMarks가 같은 번호를 돌려주는지 본다. 분할(hitbox)과 판정 사이의 계약이다.
//
//   PURI_BENCH_PDF=~/Downloads/문제집.pdf npx vitest run livemark
//
// PDF는 저작물이라 리포에 넣지 않는다. 경로가 없으면 조용히 건너뛴다.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectMarks } from '../liveDetect'
import { MAX_W } from '../geometry'
import { extractLines } from '../pdfText'
import { runPipeline } from '../psp'
import { pageInput, toAppRegions } from '../psp/adapter'
import { openPdf } from './pdfDoc'
import type { PageInput } from '../psp/types'
import type { Point, Region, Stroke } from '../../types'

const expand = (p?: string) => p?.replace(/^~/, process.env.HOME ?? '~')
const PDF_PATH = expand(process.env.PURI_BENCH_PDF)
const available = !!PDF_PATH && existsSync(PDF_PATH)
const suite = available ? describe : describe.skip

/** 선지 기호 자리(박스 왼쪽 정사각 영역)에 친 동그라미 — 사용자 마킹을 흉내낸다 */
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

/** 선지 위에 그은 빗금 */
function slashOn(box: { x: number; y: number; w: number; h: number }, t: number): Stroke {
  const points: Point[] = []
  const w = Math.min(box.w, box.h * 1.6)
  for (let i = 0; i <= 10; i++) {
    points.push({
      x: box.x + (w * i) / 10,
      y: box.y + box.h - (box.h * i) / 10,
      p: 0.5,
      t,
    })
  }
  return { id: `l${t}`, regionId: null, attemptNo: 1, tool: 'pen', points }
}

suite('실제 PDF 선지 판정', () => {
  it('모든 객관식 문항의 모든 선지를 하나씩 쳐 본다', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const data = new Uint8Array(readFileSync(PDF_PATH!))
    const pdf = await openPdf(pdfjs, data)

    const inputs: PageInput[] = []
    // 앱(liveStore.runDocPass)과 같은 입력 — 도형 포함. 도형을 빼면 단 판정이 무너져
    // 선지 박스가 안 붙는 문항이 생긴다(실측 수능: 객관식 33→26)
    for (let p = 1; p <= pdf.numPages; p++) inputs.push(await pageInput(pdf, p, true))
    const result = runPipeline(inputs, { jobId: 'b' })
    const regions = toAppRegions(result, 'b')

    // ★ 글자는 페이지 안에 있어야 한다.
    //
    // 아래 되읽기 검사는 자기일관이라 좌표계가 통째로 밀려도 통과한다 — 실제로
    // CropBox 원점이 0이 아닌 PDF(hi_math 1쪽 원점 x=703pt)에서 글자가 페이지 밖에
    // 찍히는 동안에도 752/752였고, 화면에서만 다 깨져 보였다. 분할 결과가 아니라
    // 입력 좌표를 봐야 그게 드러난다 — 구역만 보면 문항 없는 쪽의 어긋남을 놓친다.
    const strays: string[] = []
    for (const inp of inputs) {
      for (const s of inp.spans) {
        const [x0, y0, x1, y1] = s.bbox
        if (x0 < -0.01 || y0 < -0.01 || x1 > 1.01 || y1 > 1.01) {
          strays.push(
            `p${inp.index + 1} "${s.text.slice(0, 8)}" [${x0.toFixed(2)},${y0.toFixed(2)},${x1.toFixed(2)},${y1.toFixed(2)}]`,
          )
        }
      }
    }
    if (strays.length) console.log(`\n페이지 밖 글자 ${strays.length}개:\n` + strays.slice(0, 5).join('\n'))
    expect(strays).toHaveLength(0)

    // 구역도 마찬가지 (같은 어긋남이 분할까지 밀고 갔는지)
    const outside = regions.filter((r) => {
      const h = (inputs[r.page - 1].height / inputs[r.page - 1].width) * MAX_W
      const b = r.bounds
      return b.x < -1 || b.y < -1 || b.x + b.w > MAX_W + 1 || b.y + b.h > h + 1
    })
    expect(outside).toHaveLength(0)

    // ★ 선지 박스는 인쇄된 ①~⑤ 자리에 붙어야 한다.
    //
    // 되읽기 검사만으로는 "박스가 엉뚱한 곳에 붙었다"를 못 잡는다 — 박스에서 만든
    // 획을 그 박스로 되읽으니 어디에 있든 통과한다. 실측으로 꼬리말의 "(1) … (2) …"가
    // 선지로 잡힌 적이 있는데(hi_math p18 21번) 그때도 되읽기는 100%였다.
    // 텍스트 레이어의 원문자 위치와 대조해야 그게 드러난다.
    const CIRCLED = ['①', '②', '③', '④', '⑤']
    const misplaced: string[] = []
    const pageGroups = new Map<number, Region[]>()
    for (const r of regions) {
      if (r.answerType !== 'choice') continue
      const arr = pageGroups.get(r.page)
      if (arr) arr.push(r)
      else pageGroups.set(r.page, [r])
    }
    for (const [page, list] of pageGroups) {
      const tokens = (await extractLines(await pdf.getPage(page))).flatMap((l) => l.tokens)
      for (const r of list) {
        for (const c of r.choices) {
          const want = CIRCLED[c.label - 1]
          const hit = tokens.some(
            (t) =>
              t.str.includes(want) &&
              t.box.x + t.box.w / 2 >= c.box.x - 2 &&
              t.box.x + t.box.w / 2 <= c.box.x + c.box.w + 2 &&
              t.box.y + t.box.h / 2 >= c.box.y - 2 &&
              t.box.y + t.box.h / 2 <= c.box.y + c.box.h + 2,
          )
          if (!hit) misplaced.push(`p${page} ${r.numLabel ?? '?'}번 ${want} 박스(${c.box.x.toFixed(0)},${c.box.y.toFixed(0)})에 글자 없음`)
        }
      }
    }
    if (misplaced.length) console.log(`\n인쇄 자리와 어긋난 선지 박스 ${misplaced.length}개:\n` + misplaced.slice(0, 8).join('\n'))
    expect(misplaced).toHaveLength(0)

    // 한국 문제집 객관식은 사실상 전부 5지선다다 — 선지가 모자라면 놓친 것이다
    const mc = regions.filter((r) => r.answerType === 'choice')
    const full = mc.filter((r) => r.choices.length === 5)
    console.log(`선지 5개 완비 ${full.length}/${mc.length}`)
    expect(full.length).toBe(mc.length)

    // ★ "①~⑤가 보이는데 선지 박스가 안 붙은" 문항이 없어야 한다.
    //
    // 사용자가 앱에서 겪는 증상이 정확히 이것이고(그 문항만 필기해도 답이 안 읽힌다),
    // 파이프라인은 V-6으로 스스로 그걸 알고 있다. 완비율만 보면 안 잡힌다 —
    // 선지가 0개면 주관식으로 분류돼 객관식 집계에서 통째로 빠지기 때문이다.
    // ★ 한 문항 안에서 선지 박스 높이가 고를 것.
    //
    // 마지막 선지만 문항 바닥까지 늘리던 때가 있었다 — 실측 hi_math p24 24번의 ⑤는
    // 163px로 다른 선지(21px)의 여덟 배였고 최대 301px까지 갔다. 그 아래는 학생이
    // 풀이를 쓰는 자리라, 거기 그은 획이 전부 ⑤ 선택으로 읽힌다.
    // 분수가 든 선지는 인쇄 줄 자체가 높으므로(실측 34 vs 21) 2배까지는 허용한다.
    const uneven: string[] = []
    for (const r of mc) {
      const hs = r.choices.map((c) => c.box.h)
      const ratio = Math.max(...hs) / Math.min(...hs)
      if (ratio > 2) uneven.push(`p${r.page} ${r.numLabel ?? '?'}번 높이비 ${ratio.toFixed(1)} [${hs.map((h) => h.toFixed(0)).join(' ')}]`)
    }
    if (uneven.length) console.log(`\n선지 높이가 들쭉날쭉한 문항 ${uneven.length}개:\n` + uneven.slice(0, 8).join('\n'))
    expect(uneven).toHaveLength(0)

    // ★ 번호 수열에 빈칸이 없을 것 — 문항을 통째로 놓치면 여기서 드러난다.
    //
    // 실측 hi_math: 페이지 맨 위 가운데의 작은 장식이 거터를 이어 붙여 p47이 1단으로
    // 판정됐고 오른쪽 단 문항 셋(04·05·06)이 사라졌다. 서술형 쪽(p35·p40)은 단 좌단이
    // 1.1%p 안쪽이라 정렬 클러스터에서 떨어져 20·21번이 사라졌다. 둘 다 "그 문항만
    // 구역이 안 잡힌다"로 나타난다.
    const gaps = result.report.missingNumbers ?? []
    if (gaps.length) console.log(`\n번호 수열 빈칸: ${gaps.slice(0, 20).join(', ')}`)
    expect(gaps).toHaveLength(0)

    const blind = result.problems.filter((p) => p.flags?.includes('FLAG_CHOICES_MISSING'))
    if (blind.length) {
      console.log(
        `\n마커는 봤는데 선지를 못 붙인 문항 ${blind.length}개:\n` +
          blind.slice(0, 10).map((p) => `  p${p.pageIndex + 1} ${p.number ?? "?"}번`).join('\n'),
      )
    }
    expect(blind).toHaveLength(0)

    const byPage = new Map<number, Region[]>()
    for (const r of regions) {
      const arr = byPage.get(r.page)
      if (arr) arr.push(r)
      else byPage.set(r.page, [r])
    }

    let tried = 0
    let ok = 0
    const misses: string[] = []
    for (const [page, list] of byPage) {
      for (const r of list) {
        if (r.answerType !== 'choice') continue
        for (const c of r.choices) {
          for (const [kind, make] of [['○', circleOn], ['/', slashOn]] as const) {
            tried++
            const marks = detectMarks(list, [make(c.box, 1000)])
            if (marks[r.id] === c.label) ok++
            else {
              misses.push(
                `p${page} ${r.numLabel}번 ${kind}${c.label} → ${
                  marks[r.id] ? `${marks[r.id]}` : Object.keys(marks).length ? '다른문항' : '미검출'
                }`,
              )
            }
          }
        }
      }
    }

    // 한 문항에 두 번 치면 나중 것이 이겨야 한다
    let switched = 0
    let switchTried = 0
    for (const list of byPage.values()) {
      for (const r of list) {
        if (r.answerType !== 'choice' || r.choices.length < 2) continue
        switchTried++
        const marks = detectMarks(list, [
          circleOn(r.choices[0].box, 1000),
          circleOn(r.choices[r.choices.length - 1].box, 2000),
        ])
        if (marks[r.id] === r.choices[r.choices.length - 1].label) switched++
      }
    }

    console.log(
      `\n${PDF_PATH} · ${pdf.numPages}p · 객관식 ${regions.filter((r) => r.answerType === 'choice').length}문항\n` +
        `마킹 되읽기 ${ok}/${tried} (${((ok / tried) * 100).toFixed(1)}%)\n` +
        `고쳐 치기 ${switched}/${switchTried}`,
    )
    if (misses.length) console.log('\n실패:\n' + misses.slice(0, 40).join('\n'))

    // hitbox 한가운데 친 마크를 못 읽으면 분할이든 판정이든 어느 한쪽이 깨진 것이다
    expect(ok).toBe(tried)
    expect(switched).toBe(switchTried)
  }, 300_000)
})
