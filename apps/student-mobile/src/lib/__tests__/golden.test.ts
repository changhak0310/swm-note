import { describe, expect, it } from 'vitest'
import {
  GOLDEN_FORMAT,
  emptyGolden,
  parseGolden,
  scoreAgainstGolden,
  type GoldenBox,
  type GoldenSet,
} from '../psp/golden'
import type { Box, ChoiceLabel, Region as AppRegion } from '../../types'

const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h })

function gold(page: number, number: string, b: Box, choices: Box[] = []): GoldenBox {
  return {
    id: `g${page}-${number}`,
    page,
    number,
    bbox: b,
    choices: choices.map((c, i) => ({ label: (i + 1) as ChoiceLabel, box: c })),
  }
}

function pred(page: number, numLabel: string, b: Box, choices: Box[] = []): AppRegion {
  return {
    id: `p${page}-${numLabel}`,
    docId: 'd',
    page,
    bounds: b,
    numLabel,
    choices: choices.map((c, i) => ({ label: (i + 1) as ChoiceLabel, box: c })),
    ansSynth: false,
    answerType: choices.length >= 2 ? 'choice' : 'integer',
  }
}

function set(boxes: GoldenBox[], reviewedPages: number[]): GoldenSet {
  return { ...emptyGolden('t.pdf', 10), boxes, reviewedPages }
}

describe('골든셋 채점', () => {
  it('완전히 일치하면 만점', () => {
    const g = set([gold(1, '1', box(0, 0, 100, 200)), gold(1, '2', box(0, 200, 100, 200))], [1])
    const s = scoreAgainstGolden(
      [pred(1, '1', box(0, 0, 100, 200)), pred(1, '2', box(0, 200, 100, 200))],
      g,
    )
    expect(s.recall).toBe(1)
    expect(s.precision).toBe(1)
    expect(s.f1).toBe(1)
    expect(s.meanIou).toBe(1)
    expect(s.numberAccuracy).toBe(1)
    expect(s.misses).toEqual([])
    expect(s.falsePositives).toEqual([])
  })

  it('IoU 0.7 미만이면 맞힌 것으로 세지 않는다', () => {
    const g = set([gold(1, '1', box(0, 0, 100, 200))], [1])
    // 절반만 겹침 → IoU 1/3
    const s = scoreAgainstGolden([pred(1, '1', box(0, 100, 100, 200))], g)
    expect(s.hit).toBe(0)
    expect(s.recall).toBe(0)
    expect(s.meanIou).toBeCloseTo(1 / 3, 3)
    expect(s.misses).toEqual([{ page: 1, number: '1' }])
    expect(s.falsePositives).toEqual([{ page: 1, number: '1' }])
  })

  it('놓친 것과 잘못 만든 것을 각각 집어낸다', () => {
    const g = set([gold(1, '1', box(0, 0, 100, 100)), gold(1, '2', box(0, 300, 100, 100))], [1])
    const s = scoreAgainstGolden(
      [pred(1, '1', box(0, 0, 100, 100)), pred(1, '9', box(0, 600, 100, 100))],
      g,
    )
    expect(s.recall).toBe(0.5)
    expect(s.precision).toBe(0.5)
    expect(s.misses).toEqual([{ page: 1, number: '2' }])
    expect(s.falsePositives).toEqual([{ page: 1, number: '9' }])
  })

  it('확인하지 않은 페이지는 통째로 채점에서 뺀다', () => {
    // 2쪽은 라벨링을 안 했으므로 거기서 뭘 내놓든 점수에 영향이 없어야 한다
    const g = set([gold(1, '1', box(0, 0, 100, 100))], [1])
    const s = scoreAgainstGolden(
      [pred(1, '1', box(0, 0, 100, 100)), pred(2, '5', box(0, 0, 100, 100))],
      g,
    )
    expect(s.pages).toBe(1)
    expect(s.predicted).toBe(1)
    expect(s.precision).toBe(1)
    expect(s.falsePositives).toEqual([])
  })

  it('"문항 없음"이 정답인 페이지에서 구역을 만들면 오검출로 잡힌다', () => {
    // 확인 완료 + 정답 구역 0개 = 표지·개념 설명 페이지
    const g = set([], [3])
    const s = scoreAgainstGolden([pred(3, '1', box(0, 0, 100, 100))], g)
    expect(s.golden).toBe(0)
    expect(s.predicted).toBe(1)
    expect(s.precision).toBe(0)
    expect(s.falsePositives).toEqual([{ page: 3, number: '1' }])
  })

  it('"문항 없음" 페이지를 비워 두면 감점이 없다', () => {
    const s = scoreAgainstGolden([], set([], [3]))
    expect(s.falsePositives).toEqual([])
    expect(s.misses).toEqual([])
  })

  it('번호가 틀려도 경계가 맞으면 검출은 인정하되 번호 정확도로 구분한다', () => {
    const g = set([gold(1, '7', box(0, 0, 100, 100))], [1])
    const s = scoreAgainstGolden([pred(1, '8', box(0, 0, 100, 100))], g)
    expect(s.recall).toBe(1)
    expect(s.numberAccuracy).toBe(0)
  })

  it('AC-2 — 라벨된 선지를 전부 맞혀야 인정한다', () => {
    const choices = [box(0, 80, 20, 15), box(20, 80, 20, 15), box(40, 80, 20, 15)]
    const g = set([gold(1, '1', box(0, 0, 100, 100), choices)], [1])

    const all = scoreAgainstGolden([pred(1, '1', box(0, 0, 100, 100), choices)], g)
    expect(all.choiceRecall).toBe(1)

    const partial = scoreAgainstGolden([pred(1, '1', box(0, 0, 100, 100), choices.slice(0, 2))], g)
    expect(partial.choiceRecall).toBe(0)
  })

  it('선지를 라벨링하지 않았으면 선지 점수는 null이다', () => {
    const g = set([gold(1, '1', box(0, 0, 100, 100))], [1])
    expect(scoreAgainstGolden([pred(1, '1', box(0, 0, 100, 100))], g).choiceRecall).toBeNull()
  })

  it('겹치는 후보가 여럿이면 IoU가 큰 쪽과 짝짓는다', () => {
    const g = set([gold(1, '1', box(0, 0, 100, 100))], [1])
    const s = scoreAgainstGolden(
      [pred(1, 'a', box(0, 0, 100, 40)), pred(1, 'b', box(0, 0, 100, 95))],
      g,
    )
    expect(s.hit).toBe(1)
    expect(s.falsePositives).toEqual([{ page: 1, number: 'a' }])
  })

  it('M0 — 비문항 쪽에 구역을 만들거나 문항 쪽을 비우면 깎인다', () => {
    // 1쪽은 문항 쪽, 3쪽은 비문항 쪽(표지·개념·해설)
    const g = set([gold(1, '1', box(0, 0, 100, 100))], [1, 3])
    expect(scoreAgainstGolden([pred(1, '1', box(0, 0, 100, 100))], g).pageTypeAccuracy).toBe(1)

    // 해설 쪽에서 없는 문항을 만들었다 — 오검출 비용이 가장 큰 실패다
    const spill = scoreAgainstGolden(
      [pred(1, '1', box(0, 0, 100, 100)), pred(3, '9', box(0, 0, 100, 100))],
      g,
    )
    expect(spill.pageTypeAccuracy).toBe(0.5)

    // 문항 쪽을 통째로 비웠다
    expect(scoreAgainstGolden([], g).pageTypeAccuracy).toBe(0.5)
  })

  it('M2 — 객관식/주관식 판정. kind를 적은 문항만 분모에 든다', () => {
    const choices = [box(0, 80, 20, 15), box(20, 80, 20, 15)]
    const mc: GoldenBox = { ...gold(1, '1', box(0, 0, 100, 100), choices), kind: 'choice' }
    const sa: GoldenBox = { ...gold(1, '2', box(0, 200, 100, 100)), kind: 'subjective' }

    const right = scoreAgainstGolden(
      [pred(1, '1', box(0, 0, 100, 100), choices), pred(1, '2', box(0, 200, 100, 100))],
      set([mc, sa], [1]),
    )
    expect(right.choiceTypeAccuracy).toBe(1)

    // 주관식을 객관식으로 봤다 (본문 원문자를 선지로 오인하는 실패)
    const wrong = scoreAgainstGolden(
      [pred(1, '1', box(0, 0, 100, 100), choices), pred(1, '2', box(0, 200, 100, 100), choices)],
      set([mc, sa], [1]),
    )
    expect(wrong.choiceTypeAccuracy).toBe(0.5)

    // kind가 없으면 잴 수 없다 — 0이 아니라 null이어야 한다
    const noKind = set([gold(1, '1', box(0, 0, 100, 100))], [1])
    expect(scoreAgainstGolden([pred(1, '1', box(0, 0, 100, 100))], noKind).choiceTypeAccuracy).toBeNull()
  })

  it('페이지별 내역을 낸다', () => {
    const g = set(
      [gold(1, '1', box(0, 0, 100, 100)), gold(2, '2', box(0, 0, 100, 100))],
      [1, 2],
    )
    const s = scoreAgainstGolden([pred(1, '1', box(0, 0, 100, 100))], g)
    expect(s.perPage).toEqual([
      { page: 1, golden: 1, predicted: 1, hit: 1, meanIou: 1 },
      { page: 2, golden: 1, predicted: 0, hit: 0, meanIou: 0 },
    ])
  })
})

describe('골든셋 직렬화', () => {
  it('내보낸 것을 그대로 다시 읽는다', () => {
    const g = set([gold(1, '1', box(1, 2, 3, 4))], [1, 2])
    const back = parseGolden(JSON.stringify(g))
    expect(back.boxes).toHaveLength(1)
    expect(back.boxes[0].bbox).toEqual({ x: 1, y: 2, w: 3, h: 4 })
    expect(back.reviewedPages).toEqual([1, 2])
  })

  it('형식 버전이 다르면 거부한다', () => {
    expect(() => parseGolden(JSON.stringify({ ...emptyGolden('t', 1), format: 99 }))).toThrow(
      /형식 버전/,
    )
  })

  it('v1 라벨을 그대로 읽는다 — 이미 만든 라벨을 버리지 않는다', () => {
    const v1 = { ...set([gold(1, '1', box(0, 0, 10, 10))], [1]), format: 1 }
    const back = parseGolden(JSON.stringify(v1))
    expect(back.format).toBe(GOLDEN_FORMAT)   // 형식이 올라가도 이 검사는 그대로 산다
    expect(back.boxes).toHaveLength(1)
    expect(back.boxes[0].kind).toBeUndefined()      // 유형 미지정 → M2 분모에서 빠진다
  })

  it('원본 해시를 보존한다 — 라벨과 PDF가 짝인지 확인하는 유일한 수단이다', () => {
    const g = { ...set([], [1]), sourceHash: 'sha256:abc' }
    expect(parseGolden(JSON.stringify(g)).sourceHash).toBe('sha256:abc')
  })

  it('망가진 상자는 버리고 나머지를 살린다', () => {
    const raw = {
      ...emptyGolden('t', 1),
      reviewedPages: [1],
      boxes: [
        gold(1, '1', box(0, 0, 10, 10)),
        { id: 'x', page: 1, number: '2', bbox: { x: 0, y: 0, w: 0, h: 5 }, choices: [] },
      ],
    }
    expect(parseGolden(JSON.stringify(raw)).boxes).toHaveLength(1)
  })
})
