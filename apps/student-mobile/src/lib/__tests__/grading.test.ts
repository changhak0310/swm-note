import { describe, expect, it } from 'vitest'
import { buildRetryList, detectChoice, gradeRegion } from '../grading'
import { circlePoints, linePoints, region, stroke } from './helpers'
import type { Attempt, ChoiceLabel } from '../../types'

function att(regionId: string, no: number, result: Attempt['result']): Attempt {
  return { docId: 'd', regionId, no, detected: null, result, gradedAt: no }
}

// 한 줄 5선지: ① (0~50) ② (50~100) ③ (100~150) ④ (150~200) ⑤ (200~250), y 100~120
const CHOICES = ([1, 2, 3, 4, 5] as ChoiceLabel[]).map((label) => ({
  label,
  box: { x: (label - 1) * 50, y: 100, w: 50, h: 20 },
}))

const R = region({
  id: 'R',
  bounds: { x: 0, y: 0, w: 300, h: 300 },
  choices: CHOICES,
})

describe('detectChoice', () => {
  it('닫힌 고리 — 동그라미 안에 중심이 들어오는 선지', () => {
    const circle = stroke(circlePoints(75, 110, 15))   // ② 중심 (75, 110)
    expect(detectChoice(R, [circle])).toBe(2)
  })

  it('열린 마크 — 빗금은 겹치는 점 비율 최대 선지', () => {
    const slash = stroke(linePoints(105, 118, 145, 102))   // ③ 박스 안 대각선
    expect(detectChoice(R, [slash])).toBe(3)
  })

  it('두 선지 마크 — 마지막 스트로크 우선', () => {
    const first = stroke(circlePoints(75, 110, 15, 1000))         // ②, 먼저
    const second = stroke(linePoints(155, 118, 195, 102, 2000))   // ④, 나중
    expect(detectChoice(R, [first, second])).toBe(4)
  })

  it('마크 없음 — 풀이 필기만 있으면 null', () => {
    const work = stroke(linePoints(20, 200, 280, 280))   // 선지 밖 풀이 영역
    expect(detectChoice(R, [work])).toBeNull()
  })
})

describe('gradeRegion', () => {
  const entry = { regionId: 'R', value: '2', source: 'manual' as const }

  it('정답 없으면 nokey', () => {
    expect(gradeRegion(R, [], undefined, 1, 0).result).toBe('nokey')
  })

  it('마크 없으면 unattempted', () => {
    expect(gradeRegion(R, [], entry, 1, 0).result).toBe('unattempted')
  })

  it('판정 == 정답 → correct', () => {
    const a = gradeRegion(R, [stroke(circlePoints(75, 110, 15))], entry, 1, 0)
    expect(a.result).toBe('correct')
    expect(a.detected).toBe('2')
  })

  it('판정 != 정답 → incorrect', () => {
    const a = gradeRegion(R, [stroke(circlePoints(125, 110, 15))], entry, 1, 0)
    expect(a.result).toBe('incorrect')
    expect(a.detected).toBe('3')
  })

  it('주관식(choices 없음)은 1차에서 채점하지 않는다', () => {
    const sub = region({ id: 'S', bounds: { x: 0, y: 0, w: 100, h: 100 }, answerType: 'integer' })
    expect(gradeRegion(sub, [], entry, 1, 0).result).toBe('unattempted')
    expect(gradeRegion(sub, [], undefined, 1, 0).result).toBe('nokey')
  })
})

describe('buildRetryList — 오답 이력 누적·졸업', () => {
  it('이번 오답은 추가되고, 이전 목록의 문항은 정답이 돼도 유지된다', () => {
    const hist = {
      a: [att('a', 1, 'incorrect'), att('a', 2, 'correct')],   // 재풀이로 맞음 (연속 1)
      b: [att('b', 1, 'incorrect')],                            // 이번에 틀림
    }
    const now = [att('a', 2, 'correct'), att('b', 1, 'incorrect')]
    const prev = { docId: 'd', gradedAt: 0, regionIds: ['a'] }
    const list = buildRetryList('d', now, hist, prev, 1)
    expect(list.regionIds.sort()).toEqual(['a', 'b'])
  })

  it('3연속 달성 문항은 graduated로 옮겨 한 번 표시되고, 다음 채점부터 완전히 사라진다', () => {
    const hist = {
      a: [att('a', 1, 'incorrect'), att('a', 2, 'correct'), att('a', 3, 'correct'), att('a', 4, 'correct')],
    }
    // 4회차 채점: 3연속 달성 → regionIds에서 빠지고 graduated에 등장 (졸업 배지·토스트)
    const grad = buildRetryList('d', [att('a', 4, 'correct')], hist, { docId: 'd', gradedAt: 0, regionIds: ['a'] }, 1)
    expect(grad.regionIds).toEqual([])
    expect(grad.graduated).toEqual(['a'])
    // 같은 회차를 재채점해도 다시 나타나지 않는다
    const again = buildRetryList('d', [att('a', 4, 'correct')], hist, grad, 2)
    expect(again.regionIds).toEqual([])
    expect(again.graduated).toEqual([])
  })

  it('미응답 회차는 오답 이력을 지우지 못한다', () => {
    const hist = { a: [att('a', 1, 'incorrect'), att('a', 2, 'unattempted')] }
    const list = buildRetryList('d', [att('a', 2, 'unattempted')], hist, { docId: 'd', gradedAt: 0, regionIds: ['a'] }, 1)
    expect(list.regionIds).toEqual(['a'])
  })
})

