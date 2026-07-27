// 일회용 — D(검출) 추정. 손 라벨 없이 "인쇄된 선지 뭉치"를 분모로 쓴다.
//
// 텍스트 레이어에 ①②③④⑤가 서로 가까이 모여 있으면 그건 거의 확실히 한 문항의 선지다.
// 그 뭉치를 세고, 검출된 객관식 구역이 그 자리를 덮는지 본다. 덮지 못한 뭉치 = 놓친 문항.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, it } from 'vitest'
import { extractLines } from '../pdfText'
import { MAX_W } from '../geometry'
import { runPipeline } from '../psp'
import { pageInput, toAppRegions } from '../psp/adapter'
import type { Box } from '../../types'
import type { PageInput } from '../psp/types'

const req = createRequire(import.meta.url)
const CIRCLED = '①②③④⑤'

describe('D 추정', () => {
  it('인쇄된 선지 뭉치 vs 검출된 객관식', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const base = req.resolve('pdfjs-dist/package.json').replace('package.json', '')
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(readFileSync(process.env.PDF!)),
      cMapUrl: base + 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: base + 'standard_fonts/',
    }).promise

    const inputs: PageInput[] = []
    for (let p = 1; p <= pdf.numPages; p++) inputs.push(await pageInput(pdf, p, true))
    const res = runPipeline(inputs, { jobId: 'd' })
    const regions = toAppRegions(res, 'd')

    let printed = 0
    let covered = 0
    const missed: string[] = []

    for (let p = 1; p <= pdf.numPages; p++) {
      const tokens = (await extractLines(await pdf.getPage(p))).flatMap((l) => l.tokens)
      const at = (ch: string) =>
        tokens.filter((t) => t.str.includes(ch)).map((t) => ({ ...t.box }))
      const ones = at('①')

      for (const one of ones) {
        // ①에서 시작해 ②③④⑤가 오른쪽/아래 가까이 있는지 — 한 문항의 선지 뭉치인가
        const near = (b: Box) =>
          Math.abs(b.x - one.x) < MAX_W * 0.6 && b.y >= one.y - 5 && b.y - one.y < 160
        const found = CIRCLED.slice(1)
          .split('')
          .filter((ch) => at(ch).some(near)).length
        if (found < 3) continue // ②③④⑤ 중 셋 이상 — 보기 상자의 ①②는 여기서 빠진다
        printed++

        const hit = regions.some(
          (r) =>
            r.page === p &&
            r.answerType === 'choice' &&
            r.choices.some(
              (c) =>
                one.x + one.w / 2 >= c.box.x - 3 &&
                one.x + one.w / 2 <= c.box.x + c.box.w + 3 &&
                one.y + one.h / 2 >= c.box.y - 3 &&
                one.y + one.h / 2 <= c.box.y + c.box.h + 3,
            ),
        )
        if (hit) covered++
        else missed.push(`p${p} ①(${one.x.toFixed(0)},${one.y.toFixed(0)})`)
      }
    }

    const mc = regions.filter((r) => r.answerType === 'choice')
    console.log(
      `\n${process.env.PDF!.split('/').pop()} · ${pdf.numPages}쪽` +
        `\n  인쇄된 선지 뭉치 ${printed} · 그중 검출 ${covered}` +
        ` → D ≈ ${printed ? ((covered / printed) * 100).toFixed(1) : '-'}%` +
        `\n  검출된 객관식 ${mc.length} (뭉치보다 많으면 과검출 ${Math.max(0, mc.length - printed)})`,
    )
    if (missed.length) console.log('  놓친 자리:\n    ' + missed.slice(0, 15).join('\n    '))
  }, 1_800_000)
})
