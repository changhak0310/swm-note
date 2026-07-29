// 라벨 품질 도구의 계약.
//
// 이 도구들이 재는 것은 알고리즘이 아니라 **정답 데이터 자체**다. 그래서 여기서 틀리면
// 그 뒤의 모든 숫자가 조용히 틀린다 — 잘못된 자로 잰 값은 잘못됐다는 것조차 안 보인다.
import { describe, expect, it } from 'vitest'
import {
  agreement,
  injectTraps,
  scoreTraps,
  TRAP_KINDS,
  type Trap,
} from '../labelQuality'
import { emptyGolden, type GoldenBox, type GoldenSet } from '../psp/golden'
import type { Box, ChoiceLabel } from '../../types'

const ROW = 18
const choiceBox = (i: number, dy = 0): Box => ({ x: 10, y: 100 + i * ROW + dy, w: 120, h: 16 })
const choices = (n = 5, dy = 0) =>
  Array.from({ length: n }, (_, i) => ({ label: (i + 1) as ChoiceLabel, box: choiceBox(i, dy) }))

function gbox(page: number, number: string, dy = 0, n = 5): GoldenBox {
  return {
    id: `${page}-${number}`,
    page,
    number,
    bbox: { x: 0, y: 60 + dy, w: 300, h: 140 },
    kind: 'choice',
    choices: choices(n, dy),
  }
}

const set = (boxes: GoldenBox[], pages: number[]): GoldenSet => ({
  ...emptyGolden('t.pdf', 10),
  boxes,
  reviewedPages: pages,
})

// ============================================================ IAA

describe('라벨러 간 일치도', () => {
  it('같은 라벨이면 만점', () => {
    const a = set([gbox(1, '12'), gbox(2, '13')], [1, 2])
    const r = agreement(a, structuredClone(a))
    expect(r.pages).toBe(2)
    expect(r.problems.matched).toBe(2)
    expect(r.choices.samePlace).toBe(10)
    expect(r.m4).toBe(1)
    expect(r.disagreements).toEqual([])
  })

  it('한쪽만 라벨한 쪽은 분모에서 뺀다 — 진행도가 품질로 둔갑하면 안 된다', () => {
    const a = set([gbox(1, '12'), gbox(2, '13')], [1, 2])
    const b = set([gbox(1, '12')], [1])
    const r = agreement(a, b)
    expect(r.pages).toBe(1)
    expect(r.m4).toBe(1)                       // 2쪽은 아예 안 본다
    expect(r.disagreements).toEqual([])
  })

  it('선지 자리가 어긋나면 잡아내고 M4를 깎는다', () => {
    const a = set([gbox(1, '12')], [1])
    const b = set([{ ...gbox(1, '12'), choices: choices(5, ROW) }], [1])
    const r = agreement(a, b)
    expect(r.problems.matched).toBe(1)         // 문항은 짝이 맞는다 (bounds가 같다)
    expect(r.choices.samePlace).toBeLessThan(5)
    expect(r.m4).toBeLessThan(1)
    expect(r.disagreements.some((d) => d.kind === 'choice-place')).toBe(true)
  })

  it('번호·유형·선지 개수 불일치를 각각 집어낸다', () => {
    const a = set([gbox(1, '12')], [1])
    const b = set([{ ...gbox(1, '12', 0, 4), number: '13', kind: 'subjective' }], [1])
    const r = agreement(a, b)
    expect(r.numberMismatch).toBe(1)
    expect(r.kindMismatch).toBe(1)
    expect(r.disagreements.some((d) => d.kind === 'choice-count')).toBe(true)
  })

  it('한쪽에만 있는 문항을 양방향으로 보고한다', () => {
    const a = set([gbox(1, '12'), gbox(1, '13', 400)], [1])
    const b = set([gbox(1, '12'), gbox(1, '14', 800)], [1])
    const r = agreement(a, b)
    expect(r.disagreements.some((d) => d.kind === 'problem-only-a')).toBe(true)
    expect(r.disagreements.some((d) => d.kind === 'problem-only-b')).toBe(true)
  })
})

// ============================================================ 함정

describe('함정 쪽', () => {
  const truth = set(
    Array.from({ length: 40 }, (_, i) => gbox(1 + (i % 4), String(i + 1), (i % 10) * 200)),
    [1, 2, 3, 4],
  )

  it('같은 seed는 같은 함정을 만든다 — 재현되지 않으면 감사가 아니다', () => {
    const a = injectTraps(truth, 7, 0.3)
    const b = injectTraps(truth, 7, 0.3)
    expect(a.traps).toEqual(b.traps)
    expect(injectTraps(truth, 8, 0.3).traps).not.toEqual(a.traps)
  })

  it('심은 만큼 초안이 실제로 달라진다', () => {
    const { draft, traps } = injectTraps(truth, 3, 0.5)
    expect(traps.length).toBeGreaterThan(0)
    expect(JSON.stringify(draft.boxes)).not.toBe(JSON.stringify(truth.boxes))
    // problem-drop이 있었다면 문항 수가 줄어든다
    const drops = traps.filter((t) => t.kind === 'problem-drop').length
    expect(draft.boxes.length).toBe(truth.boxes.length - drops)
  })

  it('초안을 그대로 승인하면 전부 놓친 것으로 잡힌다 — 이게 승인 편향이다', () => {
    const { draft, traps } = injectTraps(truth, 11, 0.5)
    const r = scoreTraps(draft, traps, truth)
    expect(r.total).toBe(traps.length)
    expect(r.caught).toBe(0)
    expect(r.missRate).toBe(1)
  })

  it('전부 제대로 고치면 전부 잡은 것으로 잡힌다', () => {
    const { traps } = injectTraps(truth, 11, 0.5)
    const r = scoreTraps(truth, traps, truth)
    expect(r.caught).toBe(traps.length)
    expect(r.missRate).toBe(0)
  })

  it('함정을 알아채고 엉뚱하게 고쳐도 잡은 것으로 세지 않는다', () => {
    const one = set([gbox(1, '12')], [1])
    const { draft, traps } = forceTrap(one, 'choice-drop')
    // 지워진 선지를 되살리긴 했는데 자리가 틀렸다
    const wrong: GoldenSet = {
      ...one,
      boxes: [{ ...one.boxes[0], choices: choices(5, ROW * 3) }],
    }
    expect(scoreTraps(wrong, traps, one).caught).toBe(0)
    expect(scoreTraps(draft, traps, one).caught).toBe(0)
  })

  it('문항을 지웠다 다시 그려 id가 달라져도 잡은 것으로 센다', () => {
    const one = set([gbox(1, '12')], [1])
    const { traps } = forceTrap(one, 'problem-drop')
    const redrawn: GoldenSet = {
      ...one,
      boxes: [{ ...one.boxes[0], id: 'freshly-drawn' }],
    }
    expect(scoreTraps(redrawn, traps, one).caught).toBe(1)
  })

  it('종류별로 집계한다 — 어떤 실수를 잘 놓치는지가 규약을 고칠 자리다', () => {
    const { draft, traps } = injectTraps(truth, 5, 1)
    const r = scoreTraps(draft, traps, truth)
    for (const k of TRAP_KINDS) expect(r.byKind[k].total).toBeGreaterThanOrEqual(0)
    expect(TRAP_KINDS.reduce((n, k) => n + r.byKind[k].total, 0)).toBe(traps.length)
  })
})

/** 특정 종류의 함정이 나올 때까지 seed를 돌린다 (테스트 편의) */
function forceTrap(truth: GoldenSet, kind: Trap['kind']) {
  for (let seed = 1; seed < 500; seed++) {
    const out = injectTraps(truth, seed, 1)
    if (out.traps.length === 1 && out.traps[0].kind === kind) return out
  }
  throw new Error(`${kind} 함정을 만들지 못했다`)
}
