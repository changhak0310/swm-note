import { describe, expect, it } from 'vitest'
import { runPipeline } from '../psp/pipeline'
import { computeHitboxes } from '../psp/regions'
import { bucketOf, checkInvariants, confidenceOf, verify } from '../psp/verify'
import { layoutPages } from '../psp/layout'
import { intersectArea, type BBox, type PageInput, type Problem, type Span } from '../psp/types'

// ---------- 픽스처 ----------
// 좌표는 전부 정규화 [0,1], 좌상단 원점. 실제 문제집 조판을 최소한으로 흉내낸다.

const BODY_FS = 0.012
const ANCHOR_FS = 0.015
const LINE_H = 0.013

function span(text: string, x: number, y: number, w: number, opts: Partial<Span> = {}): Span {
  const h = opts.fontSize ?? BODY_FS
  return { text, bbox: [x, y, x + w, y + h], fontSize: h, bold: false, ...opts }
}

type ProblemSpec = {
  num: number
  /** 선지 개수. 0이면 주관식 */
  choices?: number
  /** 'row' 한 줄 / 'col' 세로 / 'mixed' 3+2 / 'irregular' 2+1+2 */
  layout?: 'row' | 'col' | 'mixed' | 'irregular'
  stem?: string
  /** 발문 안 <보기> 상자에 ①②③이 있는 문제 — C-3 검증용 */
  decoyMarkers?: boolean
}

const CIRCLED = '①②③④⑤'

/** 한 컬럼 분량의 span을 만든다. top부터 아래로 쌓고 사용한 높이를 돌려준다 */
function columnSpans(
  specs: ProblemSpec[],
  left: number,
  right: number,
  top: number,
  slotH: number,
): Span[] {
  const out: Span[] = []
  specs.forEach((s, i) => {
    const y = top + i * slotH
    // 번호 앵커 — 라인 선두(A-4), 컬럼 좌단 정렬(A-2), 본문보다 큼(A-3)
    out.push(span(`${s.num}.`, left, y, 0.02, { fontSize: ANCHOR_FS }))
    out.push(span(s.stem ?? '다음 값을 구하시오', left + 0.04, y, right - left - 0.06))

    // 발문 본문 — PROBE의 "페이지당 span ≥ 20"(§4.1)을 만족시키는 현실적인 분량
    for (let k = 0; k < 4; k++) {
      out.push(span('조건을 만족하는 실수 전체의 집합', left + 0.04, y + LINE_H * (k + 1.6), right - left - 0.08))
    }

    if (s.decoyMarkers) {
      // 발문 상단의 <보기> 상자 — 문제 상단 40%에 위치시켜 C-3에서 배제되어야 한다
      for (let k = 0; k < 3; k++) {
        out.push(span(CIRCLED[k], left + 0.04 + k * 0.08, y + slotH * 0.15, 0.015))
      }
    }

    const n = s.choices ?? 5
    if (n === 0) return
    const layout = s.layout ?? 'row'
    const choiceTop = y + slotH * 0.7          // 문제 하단 60% 안쪽
    const usable = right - left - 0.02

    if (layout === 'row') {
      for (let k = 0; k < n; k++) {
        const cx = left + 0.01 + (usable / n) * k
        out.push(span(`${CIRCLED[k]} ${k + 1}`, cx, choiceTop, usable / n - 0.01))
      }
    } else if (layout === 'col') {
      // 세로 5개가 슬롯 안에 들어가야 한다 — 넘치면 다음 문제 구역으로 새어 나간다
      const colTop = y + slotH * 0.45
      for (let k = 0; k < n; k++) {
        out.push(span(`${CIRCLED[k]} 보기 ${k + 1}`, left + 0.01, colTop + k * LINE_H * 1.2, 0.2))
      }
    } else {
      const shape = layout === 'irregular' ? [[0, 1], [2], [3, 4]] : [[0, 1, 2], [3, 4]]
      const rows = shape.map((r) => r.filter((k) => k < n))
      // 줄이 늘면 간격을 좁혀 슬롯 안에 들어오게 한다
      const gap = LINE_H * (rows.length > 2 ? 1.5 : 2.2)
      const top = y + slotH * (rows.length > 2 ? 0.55 : 0.7)
      rows.forEach((row, ri) => {
        row.forEach((k, ki) => {
          const cx = left + 0.01 + (usable / row.length) * ki
          out.push(span(`${CIRCLED[k]} ${k + 1}`, cx, top + ri * gap, usable / row.length - 0.01))
        })
      })
    }
  })
  return out
}

/** y0~y1을 본문 줄로 채운다 — 2단 판정은 두 단이 세로로 함께 채워져 있길 요구한다 */
function filler(left: number, right: number, y0: number, y1: number): Span[] {
  const out: Span[] = []
  for (let y = y0; y < y1; y += LINE_H * 1.4) {
    out.push(span('풀이 과정을 적는 본문 줄', left + 0.04, y, right - left - 0.08))
  }
  return out
}

function onePage(specs: ProblemSpec[], extra: Span[] = [], index = 0): PageInput {
  const top = 0.18
  const slotH = Math.min(0.16, (0.94 - top) / Math.max(1, specs.length))
  return {
    index,
    width: 595,
    height: 842,
    spans: [...columnSpans(specs, 0.08, 0.92, top, slotH), ...extra],
  }
}

/** 2단 조판 — 중앙 40~60%에 폭 5% 이상의 골이 생기도록 배치한다 */
function twoColumnPage(leftSpecs: ProblemSpec[], rightSpecs: ProblemSpec[], index = 0): PageInput {
  const top = 0.18
  const slotH = 0.16
  return {
    index,
    width: 595,
    height: 842,
    spans: [
      ...columnSpans(leftSpecs, 0.08, 0.45, top, slotH),
      ...columnSpans(rightSpecs, 0.55, 0.92, top, slotH),
    ],
  }
}

const run = (pages: PageInput[]) => runPipeline(pages, { jobId: 'J' })
const flagsOf = (p: Problem) => p.flags
const choicesOf = (p: Problem) => p.regions.filter((r) => r.kind === 'CHOICE_ITEM')

// ---------- 파이프라인 기본 ----------

describe('PSP 파이프라인', () => {
  it('1단 페이지의 문제를 번호 순으로 분할하고 선지 5개를 검출한다', () => {
    const r = run([onePage([{ num: 1 }, { num: 2 }, { num: 3 }])])

    expect(r.problems.map((p) => p.number)).toEqual(['1', '2', '3'])
    for (const p of r.problems) {
      expect(p.problemType).toBe('MULTIPLE_CHOICE')
      expect(choicesOf(p).map((c) => c.ordinal)).toEqual([1, 2, 3, 4, 5])
    }
  })

  it('선지가 없으면 주관식(SHORT_ANSWER)으로 판정한다', () => {
    const r = run([onePage([1, 2, 3, 4].map((num) => ({ num, choices: 0 })))])
    expect(r.problems.every((p) => p.problemType === 'SHORT_ANSWER')).toBe(true)
  })

  it("발문에 '설명하시오'가 있으면 DESCRIPTIVE", () => {
    const r = run([
      onePage([
        { num: 1, choices: 0, stem: '이유를 설명하시오' },
        { num: 2, choices: 0 },
        { num: 3, choices: 0 },
        { num: 4, choices: 0 },
      ]),
    ])
    expect(r.problems[0].problemType).toBe('DESCRIPTIVE')
    expect(r.problems[1].problemType).toBe('SHORT_ANSWER')
  })

  it('같은 입력을 두 번 넣으면 완전히 같은 결과가 나온다 (멱등 — §4)', () => {
    const pages = [onePage([{ num: 1 }, { num: 2 }])]
    expect(JSON.stringify(run(pages).problems)).toBe(JSON.stringify(run(pages).problems))
  })

  it('2단 조판을 인식하고 컬럼별로 문제를 나눈다', () => {
    const r = run([twoColumnPage([{ num: 1 }, { num: 2 }], [{ num: 3 }, { num: 4 }])])

    expect(r.layouts[0].columns).toHaveLength(2)
    expect(r.layouts[0].columnAmbiguous).toBe(false)
    expect(r.problems.map((p) => p.columnIndex)).toEqual([0, 0, 1, 1])
    expect(r.problems.map((p) => p.number)).toEqual(['1', '2', '3', '4'])
  })
})

// ---------- §4.2 LAYOUT ----------
// 아래는 전부 실제 수능 문제지에서 드러난 실패를 고정한 회귀 테스트다.

describe('컬럼 판정', () => {
  /** 거터 1.8% — PRD의 5%는 물론 히스토그램 임계값(2%)에도 못 미친다 */
  function narrowGutter(drawings?: BBox[]): PageInput {
    const top = 0.18
    return {
      index: 0,
      width: 595,
      height: 842,
      spans: [
        ...columnSpans([{ num: 1 }, { num: 2 }], 0.08, 0.49, top, 0.2),
        ...columnSpans([{ num: 3 }, { num: 4 }], 0.5063, 0.92, top, 0.2),
        // 각 단의 가로 끝을 정확히 맞춰 거터를 본문폭의 1.5%로 만든다
        span('단 끝까지 닿는 본문 줄', 0.08, 0.3, 0.4137),
        span('단 끝까지 닿는 본문 줄', 0.5063, 0.3, 0.4137),
      ],
      drawings,
    }
  }

  it('거터가 좁으면 폭만으로는 2단을 확정하지 못한다', () => {
    const l = layoutPages([narrowGutter()])[0]
    expect(l.columns).toHaveLength(1)
    expect(l.columnAmbiguous).toBe(true)
  })

  it('단 구분선이 그려져 있으면 거터 폭과 무관하게 2단이다', () => {
    // 실측: 수능 문제지는 x≈0.5에 세로 구분선을 긋는다. 히스토그램보다 확실한 신호다
    const l = layoutPages([narrowGutter([[0.4975, 0.15, 0.4985, 0.93]])])[0]
    expect(l.columns).toHaveLength(2)
    expect(l.columnAmbiguous).toBe(false)
  })

  it('구분선이 여러 번 중복 출력돼도 하나로 센다', () => {
    const dup: BBox[] = [
      [0.4975, 0.15, 0.4985, 0.93],
      [0.4975, 0.15, 0.4985, 0.93],
      [0.4975, 0.15, 0.4985, 0.93],
      [0, 0, 1, 1],           // 페이지 테두리 — 얇지 않아 후보가 아니다
    ]
    expect(layoutPages([narrowGutter(dup)])[0].columns).toHaveLength(2)
  })

  it('골이 애매한 폭일 때는 좌우가 세로로 나란한지까지 본다', () => {
    // 위아래로 갈린 블록은 중앙 골을 만들지만 2단 조판이 아니다.
    // 골 폭을 2~4% 구간(확정도 무시도 아닌 범위)에 두어 세로 겹침 검사를 태운다.
    const page: PageInput = {
      index: 0,
      width: 595,
      height: 842,
      spans: [
        ...columnSpans([{ num: 1 }, { num: 2 }], 0.08, 0.48, 0.18, 0.16),
        ...columnSpans([{ num: 3 }, { num: 4 }], 0.5115, 0.92, 0.62, 0.16),
        span('단 끝까지 닿는 본문 줄', 0.08, 0.3, 0.405),      // → 0.485
        span('단 끝까지 닿는 본문 줄', 0.5115, 0.74, 0.4085),   // → 0.92
      ],
    }
    expect(layoutPages([page])[0].columns).toHaveLength(1)
  })

  it('골이 충분히 넓으면 세로 겹침을 따지지 않고 2단으로 확정한다', () => {
    // 실측: 단 구분선이 없는 문제집에서 거터 6%가 세로 겹침 검사에 걸려
    // 2단 페이지가 통째로 1단으로 판정됐다
    const page: PageInput = {
      index: 0,
      width: 595,
      height: 842,
      spans: [
        ...columnSpans([{ num: 1 }, { num: 2 }], 0.08, 0.45, 0.18, 0.16),
        ...columnSpans([{ num: 3 }, { num: 4 }], 0.55, 0.92, 0.62, 0.16),
      ],
    }
    expect(layoutPages([page])[0].columns).toHaveLength(2)
  })

  it('본문 영역은 머리말~꼬리말 사이 전체다 — 텍스트 합집합이 아니다', () => {
    // 아래쪽이 그림·수식이라 텍스트가 없는 페이지. 본문 영역이 쪼그라들면
    // 마지막 문제의 크롭이 잘리고 선지가 C-3 밖으로 밀려난다.
    const page: PageInput = {
      index: 0,
      width: 595,
      height: 842,
      spans: [
        ...columnSpans([{ num: 1 }, { num: 2 }], 0.08, 0.92, 0.18, 0.12),
        span('12', 0.5, 0.95, 0.02),        // 쪽번호 → 꼬리말 경계
      ],
    }
    const l = layoutPages([page])[0]
    expect(l.contentBox[3]).toBeGreaterThan(0.9)

    // 여백이 넓어져도 마지막 문제의 선지가 살아 있어야 한다 (C-3)
    const r = run([page])
    const last = r.problems[r.problems.length - 1]
    expect(last.regions.filter((x) => x.kind === 'CHOICE_ITEM')).toHaveLength(5)
  })
})

// ---------- §5.1 RULE-ANCHOR ----------

describe('RULE-ANCHOR', () => {
  it('본문 중간의 숫자는 A-2(좌측 정렬)에서 탈락한다', () => {
    const noise = [
      span('3', 0.5, 0.3, 0.01, { fontSize: ANCHOR_FS }),
      span('7', 0.6, 0.5, 0.01, { fontSize: ANCHOR_FS }),
    ]
    const r = run([onePage([{ num: 1 }, { num: 2 }], noise)])
    expect(r.problems.map((p) => p.number)).toEqual(['1', '2'])
  })

  it('정렬 기준선은 단마다 따로다 — 한쪽 단이 통째로 폐기되면 안 된다', () => {
    // 우단에 앵커보다 왼쪽에서 시작하는 넓은 요소를 둔다. 컬럼 좌측 경계가 그만큼
    // 당겨지므로, 경계로부터의 오프셋으로 묶으면 이 페이지의 우단 앵커만 다른
    // 클러스터로 밀려나 폐기된다. 절대 x0로 묶으면 두 페이지가 같은 무리가 된다.
    const wide = span('보기 상자를 감싸는 넓은 줄', 0.54, 0.5, 0.35)
    const rule: BBox[] = [[0.4975, 0.15, 0.4985, 0.93]]
    const two = (index: number, extra: Span[]): PageInput => ({
      index,
      width: 595,
      height: 842,
      spans: [
        ...columnSpans([{ num: 1 + index * 4 }, { num: 2 + index * 4 }], 0.08, 0.49, 0.18, 0.2),
        ...columnSpans([{ num: 3 + index * 4 }, { num: 4 + index * 4 }], 0.56, 0.92, 0.18, 0.2),
        ...extra,
      ],
      drawings: rule,
    })

    const r = run([two(0, [wide]), two(1, [])])
    expect(r.problems.map((p) => p.number)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    expect(r.discardedAnchors).toBe(0)
  })

  it('정렬 기준선을 벗어난 후보는 폐기된다 (§5.2)', () => {
    // 컬럼 좌단 근처지만 들여쓰기가 다른 가짜 번호. 다른 문제의 라인과 겹치지 않는 y에 둔다
    const stray = [span('9.', 0.095, 0.318, 0.02, { fontSize: ANCHOR_FS })]
    const r = run([onePage([{ num: 1 }, { num: 2 }, { num: 3 }], stray)])
    expect(r.problems.map((p) => p.number)).not.toContain('9')
    expect(r.discardedAnchors).toBeGreaterThan(0)
  })
})

// ---------- 제본된 문제집의 조판 (실측 회귀) ----------

describe('문제집 조판', () => {
  /** 홀·짝 페이지의 안쪽 여백이 다른 제본 — 실측 2.6%p 어긋난다 */
  function spread(index: number, nums: number[]): PageInput {
    const shift = index % 2 === 0 ? 0 : 0.026
    return {
      index,
      width: 595,
      height: 842,
      spans: [
        ...columnSpans(
          nums.map((num) => ({ num })),
          0.08 + shift,
          0.9 + shift,
          0.18,
          0.2,
        ),
      ],
    }
  }

  it('좌우 펼침면의 여백 차이 때문에 한쪽 면이 통째로 폐기되면 안 된다', () => {
    const r = run([spread(0, [1, 2]), spread(1, [3, 4]), spread(2, [5, 6]), spread(3, [7, 8])])
    expect(r.problems.map((p) => p.number)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    expect(r.discardedAnchors).toBe(0)
  })

  it('각 단 첫 문항 번호가 상단 대역에 있어도 쪽번호로 지우지 않는다', () => {
    // §4.2의 쪽번호 패턴을 그대로 적용하면 페이지 상단 15% 안의 문항 번호가 사라진다
    const page = (index: number): PageInput => ({
      index,
      width: 595,
      height: 842,
      spans: [
        // 상단 대역(y<0.15)에서 시작하는 문항 — 번호는 본문보다 크게 조판된다
        ...columnSpans([{ num: 1 + index * 2 }, { num: 2 + index * 2 }], 0.08, 0.9, 0.1, 0.3),
      ],
    })
    const r = run([page(0), page(1), page(2)])
    expect(r.problems.map((p) => p.number)).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('값이 페이지를 따라 증가하는 숫자 자리는 쪽번호로 지운다', () => {
    // 크게 조판된 쪽번호는 A-3을 통과해 앵커로 잡힌다. 값이 페이지와 나란히
    // 움직이는지로 가른다 — 문항 번호는 그렇지 않다.
    const page = (index: number): PageInput => ({
      index,
      width: 595,
      height: 842,
      spans: [
        ...columnSpans([{ num: 1 }, { num: 2 }], 0.08, 0.9, 0.2, 0.3),
        // 하단 좌측 쪽번호. 본문보다 크고 굵다
        span(`${10 + index}`, 0.08, 0.93, 0.03, { fontSize: ANCHOR_FS, bold: true }),
      ],
    })
    const r = run([page(0), page(1), page(2), page(3)])
    expect(r.problems.map((p) => p.number)).toEqual(['1', '2', '1', '2', '1', '2', '1', '2'])
  })

  it('0채움 문서에서 한 자리 번호는 문항이 아니라 절 표제다', () => {
    // 핵심개념정리의 "1 .다항식의 연산"이 문항 번호와 같은 x에 찍히는 실측 사례
    const problems = (index: number, nums: string[]): PageInput => ({
      index,
      width: 595,
      height: 842,
      spans: nums.flatMap((n, i) => [
        span(`${n}.`, 0.08, 0.2 + i * 0.2, 0.03, { fontSize: ANCHOR_FS }),
        span('다음 값을 구하시오', 0.13, 0.2 + i * 0.2, 0.6),
        ...Array.from({ length: 5 }, (_, k) =>
          span('조건을 만족하는 실수 전체의 집합', 0.13, 0.22 + i * 0.2 + k * 0.015, 0.6),
        ),
      ]),
    })
    const concept: PageInput = {
      index: 3,
      width: 595,
      height: 842,
      spans: [
        span('1.', 0.08, 0.2, 0.03, { fontSize: ANCHOR_FS }),
        span('다항식의 연산', 0.13, 0.2, 0.4),
        ...Array.from({ length: 20 }, (_, k) =>
          span('개념을 설명하는 본문 문장입니다', 0.13, 0.24 + k * 0.02, 0.6),
        ),
      ],
    }

    const r = run([
      problems(0, ['01', '02', '03']),
      problems(1, ['04', '05', '06']),
      problems(2, ['07', '08', '09']),
      concept,
    ])
    expect(r.problems.map((p) => p.number)).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09'])
    expect(r.problemPages).toEqual([0, 1, 2])
  })

  it('0채움을 쓰지 않는 문서에는 표기 형식 제약을 걸지 않는다', () => {
    const r = run([onePage([{ num: 1 }, { num: 2 }, { num: 9 }, { num: 10 }, { num: 11 }])])
    expect(r.problems.map((p) => p.number)).toEqual(['1', '2', '9', '10', '11'])
  })
})

// ---------- §5.3 RULE-REGION / RULE-HITBOX ----------

describe('RULE-HITBOX — AC-3 겹침 0건은 예외 없는 조건', () => {
  const layouts: ProblemSpec['layout'][] = ['row', 'col', 'mixed']

  for (const layout of layouts) {
    it(`${layout} 배치에서 hitbox가 서로 겹치지 않는다`, () => {
      const r = run([onePage([{ num: 1, layout }, { num: 2, layout }])])

      for (const p of r.problems) {
        const boxes = choicesOf(p).map((c) => c.hitbox ?? c.bbox)
        expect(boxes.length).toBe(5)
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            expect(intersectArea(boxes[i], boxes[j])).toBe(0)
          }
        }
        expect(p.flags).not.toContain('FLAG_HITBOX_COLLISION')
      }
    })
  }

  it('겹치지 않으면 8% 그대로, 겹치면 1%씩 줄인다', () => {
    const wide: BBox[] = [[0, 0, 0.1, 0.1], [0.5, 0, 0.6, 0.1]]
    expect(computeHitboxes(wide).rate).toBeCloseTo(0.08, 5)

    const tight: BBox[] = [[0, 0, 0.1, 0.1], [0.1, 0, 0.2, 0.1]]
    const got = computeHitboxes(tight)
    expect(got.rate).toBe(0)
    expect(got.collided).toBe(false)      // 맞닿음(면적 0)은 겹침이 아니다
  })

  it('0%까지 줄여도 겹치면 collided를 보고한다', () => {
    const overlapping: BBox[] = [[0, 0, 0.2, 0.1], [0.1, 0, 0.3, 0.1]]
    expect(computeHitboxes(overlapping).collided).toBe(true)
  })

  it('3+2는 표준 배치다 — 혼재로 보고 검수에 보내지 않는다', () => {
    // 실측 문제집은 99문항 중 64문항이 3+2였다. 이걸 전부 검수로 보내면 플래그가 죽는다
    const r = run([onePage([{ num: 1, layout: 'mixed' }, { num: 2, layout: 'mixed' }])])
    expect(flagsOf(r.problems[0])).not.toContain('FLAG_CHOICE_LAYOUT_MIXED')
  })

  it('중간 줄에 홀로 놓인 선지가 있으면 배치를 확정할 수 없다 (부록 A)', () => {
    const r = run([onePage([{ num: 1, layout: 'irregular' }, { num: 2, layout: 'irregular' }])])
    expect(flagsOf(r.problems[0])).toContain('FLAG_CHOICE_LAYOUT_MIXED')
  })

  it('C-3 — 발문 <보기>의 ①②③을 선지로 오인하지 않는다', () => {
    const r = run([
      onePage([{ num: 1, decoyMarkers: true }, { num: 2, decoyMarkers: true }]),
    ])
    for (const p of r.problems) {
      const items = choicesOf(p)
      expect(items.map((c) => c.ordinal)).toEqual([1, 2, 3, 4, 5])
      // 진짜 선지는 문제 하단에 있다 — 보기 상자(상단 40%)를 집었으면 y가 위로 올라간다
      const first = items[0]
      expect(first.bbox[1]).toBeGreaterThan(0.4)
    }
  })

  it('Region bbox는 문제 bbox 기준 상대 좌표다 (§3.1)', () => {
    const r = run([onePage([{ num: 1 }, { num: 2 }])])
    for (const p of r.problems) {
      for (const region of p.regions) {
        expect(region.bbox[0]).toBeGreaterThanOrEqual(-1e-9)
        expect(region.bbox[3]).toBeLessThanOrEqual(1 + 1e-9)
      }
    }
  })
})

// ---------- §6.1 검증 규칙 V-1 ~ V-8 ----------

describe('V-1 번호 수열 연속성', () => {
  it('AC-6 — 번호를 하나 빼면 유실 직후 문제에 FLAG_NUMBER_GAP이 붙는다', () => {
    const r = run([onePage([{ num: 1 }, { num: 2 }, { num: 3 }, { num: 5 }])])

    expect(r.report.missingNumbers).toEqual([4])
    const gapped = r.problems.filter((p) => p.flags.includes('FLAG_NUMBER_GAP'))
    expect(gapped.map((p) => p.number)).toEqual(['5'])
  })

  it('연속이면 플래그가 없다', () => {
    const r = run([onePage([{ num: 1 }, { num: 2 }, { num: 3 }])])
    expect(r.report.missingNumbers).toEqual([])
    expect(r.problems.every((p) => !p.flags.includes('FLAG_NUMBER_GAP'))).toBe(true)
  })
})

describe('V-2 커버리지', () => {
  it('본문 상단이 크게 비면 FLAG_LOW_COVERAGE', () => {
    // 문제는 페이지 아래쪽에만, 본문 영역은 위쪽 제목까지 포함
    const title = [
      span('제 1 회 모의고사', 0.1, 0.06, 0.4, { fontSize: 0.02 }),
      span('수학 영역', 0.1, 0.1, 0.3, { fontSize: 0.018 }),
    ]
    const page: PageInput = {
      index: 0,
      width: 595,
      height: 842,
      spans: [...title, ...columnSpans([{ num: 1 }, { num: 2 }], 0.08, 0.92, 0.62, 0.16)],
    }
    const r = run([page])
    expect(r.report.coverageByPage.get(0)!).toBeLessThan(0.88)
    expect(r.problems.every((p) => p.flags.includes('FLAG_LOW_COVERAGE'))).toBe(true)
  })

  it('정상 페이지는 커버리지 88% 이상', () => {
    const r = run([onePage([{ num: 1 }, { num: 2 }, { num: 3 }])])
    expect(r.report.coverageByPage.get(0)!).toBeGreaterThanOrEqual(0.88)
  })
})

describe('V-3 ~ V-5 — 기하 검사', () => {
  const layout = layoutPages([onePage([{ num: 1 }, { num: 2 }])])

  function problem(id: string, bbox: BBox, over: Partial<Problem> = {}): Problem {
    return {
      id, jobId: 'J', pageIndex: 0, columnIndex: 0, number: id, numberInt: Number(id) || null,
      bbox, numberBBox: bbox, cropUri: `J/000_${id}.png`, ocrText: null,
      problemType: 'SHORT_ANSWER', regions: [], confidence: 1, flags: [], reviewedAt: null,
      ...over,
    }
  }

  it('V-3 — 같은 페이지·컬럼에서 bbox가 겹치면 FLAG_BBOX_OVERLAP', () => {
    const out = verify(
      [problem('1', [0.1, 0.1, 0.9, 0.5]), problem('2', [0.1, 0.4, 0.9, 0.8])],
      layout,
    )
    expect(out.problems.every((p) => p.flags.includes('FLAG_BBOX_OVERLAP'))).toBe(true)
  })

  it('V-3 — 맞닿기만 하면 겹침이 아니다 (INV-2는 면적 0 기준)', () => {
    const out = verify(
      [problem('1', [0.1, 0.1, 0.9, 0.5]), problem('2', [0.1, 0.5, 0.9, 0.8])],
      layout,
    )
    expect(out.problems.every((p) => !p.flags.includes('FLAG_BBOX_OVERLAP'))).toBe(true)
  })

  it('V-4 — 라인높이 2배 미만이면 FLAG_TOO_SMALL', () => {
    const out = verify([problem('1', [0.1, 0.1, 0.9, 0.105])], layout)
    expect(out.problems[0].flags).toContain('FLAG_TOO_SMALL')
  })

  it('V-5 — 종횡비가 0.1~10을 벗어나면 FLAG_ASPECT_ANOMALY', () => {
    // 595×842 페이지에서 폭 전체 × 높이 0.4% → 종횡비 ≈ 176
    const out = verify([problem('1', [0, 0.1, 1, 0.104])], layout)
    expect(out.problems[0].flags).toContain('FLAG_ASPECT_ANOMALY')
  })
})

describe('V-6 선지 누락', () => {
  it('선지 마커가 보이는데 확정에 실패하면 FLAG_CHOICES_MISSING', () => {
    // ①③만 있어 C-2(1부터 연속)에서 확정 실패
    const broken = [
      span('①', 0.12, 0.30, 0.02),
      span('③', 0.35, 0.30, 0.02),
    ]
    const page: PageInput = {
      index: 0,
      width: 595,
      height: 842,
      spans: [
        ...columnSpans([1, 2, 3, 4].map((num) => ({ num, choices: 0 })), 0.08, 0.92, 0.2, 0.18),
        ...broken,
      ],
    }
    const r = run([page])
    expect(r.problems[0].flags).toContain('FLAG_CHOICES_MISSING')
  })
})

describe('V-8 경계 넘김', () => {
  it('컬럼 하단 25% 안에서 시작한 문제가 다음 컬럼으로 이어지면 FLAG_SPANS_BOUNDARY', () => {
    // 좌단 마지막 문제(2번)를 컬럼 아래쪽에 두고, 그 본문이 우단 상단으로 이어진 뒤
    // 3번 앵커가 우단 중간에서 시작하는 실제 조판을 흉내낸다.
    const page: PageInput = {
      index: 0,
      width: 595,
      height: 842,
      spans: [
        ...columnSpans([{ num: 1 }], 0.08, 0.45, 0.2, 0.16),
        ...filler(0.08, 0.45, 0.37, 0.76),        // 1번 풀이 본문 — 좌단을 채운다
        ...columnSpans([{ num: 2 }], 0.08, 0.45, 0.8, 0.14),
        ...filler(0.55, 0.92, 0.2, 0.52),         // 2번에서 넘어온 본문 — 우단 상단
        ...columnSpans([{ num: 3 }], 0.55, 0.92, 0.56, 0.16),
      ],
    }
    const r = run([page])
    expect(r.layouts[0].columns).toHaveLength(2)
    const p2 = r.problems.find((p) => p.number === '2')!
    expect(p2.continuation).toBeDefined()
    expect(p2.flags).toContain('FLAG_SPANS_BOUNDARY')
  })
})

// ---------- §6.2 · §6.3 신뢰도와 라우팅 ----------

describe('신뢰도 산식과 라우팅', () => {
  it('confidence = 1 − Σ가중치, 하한 0', () => {
    expect(confidenceOf([])).toBe(1)
    expect(confidenceOf(['FLAG_NUMBER_GAP'])).toBeCloseTo(0.6, 5)
    expect(confidenceOf(['FLAG_NUMBER_GAP', 'FLAG_CHOICES_MISSING'])).toBeCloseTo(0.25, 5)
    expect(
      confidenceOf(['FLAG_NUMBER_GAP', 'FLAG_CHOICES_MISSING', 'FLAG_HITBOX_COLLISION', 'FLAG_SPANS_BOUNDARY']),
    ).toBe(0)
  })

  it('0.85 이상 자동 승인 / 0.50~0.85 검수 / 0.50 미만 우선 검수', () => {
    expect(bucketOf(1)).toBe('AUTO_APPROVE')
    expect(bucketOf(0.85)).toBe('AUTO_APPROVE')
    expect(bucketOf(0.84)).toBe('REVIEW')
    expect(bucketOf(0.5)).toBe('REVIEW')
    expect(bucketOf(0.49)).toBe('REVIEW_PRIORITY')
  })

  it('깨끗한 페이지는 전부 자동 승인 구간', () => {
    const r = run([onePage([{ num: 1 }, { num: 2 }, { num: 3 }])])
    expect(r.problems.every((p) => p.confidence >= 0.85)).toBe(true)
    expect(r.report.needsReview).toBe(false)
  })

  it('30% 이상이 검수 대상이면 Job이 NEEDS_REVIEW로 간다', () => {
    // 3문제 중 1개가 번호 유실 → 33% ≥ 30%
    const r = run([onePage([{ num: 1 }, { num: 2 }, { num: 9 }])])
    expect(r.report.reviewRatio).toBeCloseTo(1 / 3, 5)
    expect(r.report.needsReview).toBe(true)
  })

  it('30% 미만이면 Job은 NEEDS_REVIEW로 가지 않는다', () => {
    const r = run([onePage([{ num: 1 }, { num: 2 }, { num: 3 }, { num: 9 }])])
    expect(r.report.reviewRatio).toBeCloseTo(0.25, 5)
    expect(r.report.needsReview).toBe(false)
  })
})

// ---------- §3.2 불변 조건 ----------

describe('INV-1 ~ INV-6', () => {
  it('정상 산출물은 위반이 없다', () => {
    const r = run([onePage([{ num: 1 }, { num: 2 }, { num: 3 }])])
    expect([...checkInvariants(r.problems)]).toEqual([])
  })

  it('INV-3 — CHOICE_ITEM ordinal이 1부터 연속이 아니면 위반', () => {
    const r = run([onePage([{ num: 1 }, { num: 2 }])])
    const broken = r.problems.map((p) => ({
      ...p,
      regions: p.regions.filter((x) => x.kind !== 'CHOICE_ITEM' || x.ordinal !== 3),
    }))
    const violations = checkInvariants(broken)
    expect([...violations.values()].flat()).toContain('INV-3')
  })

  it('INV-5 — 객관식인데 선지 2개 미만이면 위반', () => {
    const r = run([onePage([{ num: 1 }, { num: 2 }])])
    const broken = r.problems.map((p) => ({
      ...p,
      regions: p.regions.filter((x) => x.kind !== 'CHOICE_ITEM'),
    }))
    expect([...checkInvariants(broken).values()].flat()).toContain('INV-5')
  })

  it('INV-6 — 크롭 파일이 없으면 위반 (requireCrop일 때만)', () => {
    const r = run([onePage([{ num: 1 }, { num: 2 }])])
    expect([...checkInvariants(r.problems, { requireCrop: true, cropExists: () => false }).values()].flat())
      .toContain('INV-6')
    expect([...checkInvariants(r.problems, { requireCrop: false })]).toEqual([])
  })
})

// ---------- §7 에러 ----------

describe('에러 처리', () => {
  it('텍스트가 거의 없으면 ERR_UNSUPPORTED_SOURCE (스캔본은 v0.2)', () => {
    const bare: PageInput = { index: 0, width: 595, height: 842, spans: [span('x', 0.1, 0.1, 0.05)] }
    expect(() => run([bare])).toThrowError(/텍스트가 포함된 PDF/)
  })

  it('앵커가 하나도 없으면 ERR_NO_ANCHOR — 실패가 아니라 수동 모드 제안이다', () => {
    const prose: PageInput = {
      index: 0,
      width: 595,
      height: 842,
      spans: Array.from({ length: 40 }, (_, i) =>
        span('번호가 없는 본문 문장입니다', 0.1 + (i % 3) * 0.25, 0.2 + Math.floor(i / 3) * 0.02, 0.2),
      ),
    }
    expect(() => run([prose])).toThrowError(/문제 번호를 찾지 못했습니다/)
  })
})
