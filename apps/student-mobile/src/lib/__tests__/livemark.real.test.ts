// 라이브 마킹 되읽기 — 실제 PDF에서 뽑은 선지 좌표에 동그라미·빗금을 쳐 보고
// detectMarks가 같은 번호를 돌려주는지 본다. 분할(hitbox)과 판정 사이의 계약이다.
//
//   PURI_BENCH_PDF=~/Downloads/문제집.pdf npx vitest run livemark
//
// PDF는 저작물이라 리포에 넣지 않는다. 경로가 없으면 조용히 건너뛴다.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectMarks } from '../liveDetect'
import { runPipeline } from '../psp'
import { pageInput, toAppRegions } from '../psp/adapter'
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
    const pdf = await pdfjs.getDocument({ data }).promise

    const inputs: PageInput[] = []
    for (let p = 1; p <= pdf.numPages; p++) inputs.push(await pageInput(pdf, p, false))
    const regions = toAppRegions(runPipeline(inputs, { jobId: 'b' }), 'b')

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
