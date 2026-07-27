// 3단 검증의 합치기·위치검증 규칙 (lib/verify/merge.ts).
//
// 실측에서 나온 상황을 못박는다: 텍스트 경로가 놓친 문항을 픽셀이 되찾고(hi_math +15,
// 수학의 신 +51), 같은 문항을 둘 다 찾으면 선지를 더 확보한 쪽을 쓴다.
import { describe, expect, it } from 'vitest'
import { mergeRegions, verifyChoices, type PrintedMark } from '../verify/merge'
import type { Box, ChoiceLabel, Region } from '../../types'

const box = (x: number, y: number, w = 40, h = 20): Box => ({ x, y, w, h })

function region(id: string, page: number, y: number, labels: number[], bx = 60): Region {
  return {
    id,
    docId: 'd',
    page,
    bounds: box(bx, y, 300, 120),
    choices: labels.map((label, i) => ({
      label: label as ChoiceLabel,
      box: box(bx + i * 45, y + 60),
    })),
    ansSynth: false,
    answerType: labels.length >= 2 ? 'choice' : 'integer',
  }
}

describe('mergeRegions', () => {
  it('같은 문항을 둘 다 찾으면 하나로 합친다', () => {
    const merged = mergeRegions([region('t1', 1, 100, [1, 2, 3, 4, 5])], [region('p1', 1, 100, [1, 2, 3, 4, 5])])
    expect(merged).toHaveLength(1)
    expect(merged[0].source).toBe('both')
    expect(merged[0].region.id).toBe('t1')            // 텍스트 쪽 id를 유지한다
  })

  it('선지를 더 확보한 쪽의 좌표를 쓴다', () => {
    const merged = mergeRegions([region('t1', 1, 100, [1, 2])], [region('p1', 1, 100, [1, 2, 3, 4, 5])])
    expect(merged[0].source).toBe('both')
    expect(merged[0].region.choices).toHaveLength(5)
    expect(merged[0].region.id).toBe('t1')
  })

  it('픽셀만 찾은 문항을 되찾는다 — 텍스트 경로가 놓친 자리', () => {
    const merged = mergeRegions([region('t1', 1, 100, [1, 2, 3, 4, 5])], [region('p9', 1, 500, [1, 2, 3, 4, 5])])
    expect(merged.map((m) => m.source)).toEqual(['text', 'pixel'])
  })

  it('텍스트만 찾은 문항은 그대로 둔다', () => {
    const merged = mergeRegions([region('t1', 1, 100, [1, 2, 3, 4, 5])], [])
    expect(merged).toHaveLength(1)
    expect(merged[0].source).toBe('text')
  })

  it('다른 쪽의 문항은 절대 합치지 않는다', () => {
    const merged = mergeRegions([region('t1', 1, 100, [1, 2, 3, 4, 5])], [region('p1', 2, 100, [1, 2, 3, 4, 5])])
    expect(merged.map((m) => m.source)).toEqual(['text', 'pixel'])
  })

  it('이미 채택한 문항과 자리가 겹치는 픽셀 구역은 버린다 — 같은 문항의 중복 검출', () => {
    const t = region('t1', 1, 100, [1, 2, 3, 4, 5])
    const p = region('p1', 1, 100, [1])              // 같은 자리, 선지 하나만 잡힌 조각
    expect(mergeRegions([t], [p]).map((m) => m.source)).toEqual(['text'])
  })

  it('자리가 다르면서 선지가 하나만 겹치면 합치지 않는다', () => {
    // 세로 배치에서 이웃 문항의 마지막 선지와 다음 문항의 첫 선지가 가까울 수 있다
    const t = region('t1', 1, 100, [1, 2, 3, 4, 5])
    const p = region('p1', 1, 400, [1])
    expect(mergeRegions([t], [p]).map((m) => m.source)).toEqual(['text', 'pixel'])
  })
})

describe('verifyChoices', () => {
  const marks = (spots: [number, number, number][]): PrintedMark[] =>
    spots.map(([label, x, y]) => ({ label, box: box(x, y, 12, 12) }))

  it('박스 안에 그 번호의 기호가 있으면 확인으로 센다', () => {
    const r = region('t1', 1, 100, [1, 2])
    const { report } = verifyChoices(r, marks([[1, 65, 165], [2, 110, 165]]))
    expect(report).toEqual({ confirmed: 2, unconfirmed: 0, corrected: 0 })
  })

  it('박스가 어긋났고 문항 안에 기호가 있으면 그 자리로 고친다', () => {
    const r = region('t1', 1, 100, [1])
    const { region: fixed, report } = verifyChoices(r, marks([[1, 200, 140]]))
    expect(report.corrected).toBe(1)
    expect(fixed.choices[0].box.x).toBe(200)
    expect(fixed.choices[0].box.w).toBe(r.choices[0].box.w)   // 폭은 유지한다
  })

  it('기호가 아예 없으면 고치지 않고 못 찾음으로 센다', () => {
    const r = region('t1', 1, 100, [1])
    const { region: same, report } = verifyChoices(r, marks([[3, 65, 165]]))
    expect(report).toEqual({ confirmed: 0, unconfirmed: 1, corrected: 0 })
    expect(same.choices[0].box).toEqual(r.choices[0].box)
  })

  it('선지가 없는 문항은 손대지 않는다', () => {
    const r = region('t1', 1, 100, [])
    expect(verifyChoices(r, marks([[1, 65, 165]])).report.confirmed).toBe(0)
  })
})
