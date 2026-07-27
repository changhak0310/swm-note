// 텍스트 추출의 좌표 변환 (pdfText.ts).
//
// 실제로 앱을 깨뜨린 적이 있다. CropBox 원점이 0이 아닌 PDF(~/Downloads/hi_math.pdf,
// 1쪽 원점 x=703pt)에서 문항 박스가 화면 밖으로 나갔다. 그런데 분할·판정 테스트는
// 전부 통과했다 — 페이지 안의 글자가 모두 같은 만큼 밀리면 상대 배치는 그대로라,
// "검출한 박스에 마킹해 보고 되읽는" 자기일관 검사로는 어긋남이 드러나지 않는다.
// 그래서 여기서는 절대 좌표를 못박는다.
import { describe, expect, it } from 'vitest'
import { MAX_W } from '../geometry'
import { extractLines } from '../pdfText'

type Item = { str: string; width: number; height: number; transform: number[] }

/**
 * pdf.js PageProxy 흉내. 회전 없는 페이지의 뷰포트 행렬은
 * [s, 0, 0, −s, −view[0]·s, view[3]·s] 다 (실측으로 확인).
 */
function fakePage(view: [number, number, number, number], items: Item[]) {
  return {
    getViewport: ({ scale }: { scale: number }) => ({
      width: (view[2] - view[0]) * scale,
      height: (view[3] - view[1]) * scale,
      transform: [scale, 0, 0, -scale, -view[0] * scale, view[3] * scale],
    }),
    getTextContent: async () => ({ items }),
  }
}

/** 밑선 (x, y)에 놓인 글자 하나 */
const glyph = (x: number, y: number, w = 20, h = 10): Item => ({
  str: 'A',
  width: w,
  height: h,
  transform: [h, 0, 0, h, x, y],
})

describe('extractLines 좌표', () => {
  it('원점이 0인 페이지', async () => {
    // view 400×800 → f = 760/400 = 1.9. 밑선 (150, 700) → 위에서 100pt
    const [line] = await extractLines(fakePage([0, 0, 400, 800], [glyph(150, 700)]))
    expect(line.tokens[0].box.x).toBeCloseTo(285, 3)        // 150 × 1.9
    expect(line.tokens[0].box.y).toBeCloseTo(171, 3)        // (800−700−10) × 1.9
    expect(line.tokens[0].box.w).toBeCloseTo(38, 3)
    expect(line.tokens[0].box.h).toBeCloseTo(19, 3)
  })

  it('CropBox 원점이 0이 아닌 페이지 — 원점만큼 빼야 한다', async () => {
    // 같은 크기(400×800)지만 상자가 (100, 50)에서 시작한다. 글자는 상자 안 같은 자리
    const [line] = await extractLines(fakePage([100, 50, 500, 850], [glyph(250, 750)]))
    expect(line.tokens[0].box.x).toBeCloseTo(285, 3)        // (250−100) × 1.9
    expect(line.tokens[0].box.y).toBeCloseTo(171, 3)        // (850−750−10) × 1.9
  })

  it('어떤 원점에서도 페이지 안에 들어온다', async () => {
    // hi_math 1쪽의 실제 상자 — 예전 코드는 여기서 x 887~1217을 냈다
    const view: [number, number, number, number] = [702.992, 34.0157, 1341.68, 886.724]
    const [line] = await extractLines(fakePage(view, [glyph(1000, 500), glyph(1300, 100)]))
    const H = ((view[3] - view[1]) / (view[2] - view[0])) * MAX_W
    for (const t of line.tokens.concat()) {
      expect(t.box.x).toBeGreaterThanOrEqual(0)
      expect(t.box.x + t.box.w).toBeLessThanOrEqual(MAX_W)
      expect(t.box.y).toBeGreaterThanOrEqual(0)
      expect(t.box.y + t.box.h).toBeLessThanOrEqual(H)
    }
  })
})
