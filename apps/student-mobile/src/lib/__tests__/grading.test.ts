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

// 3+2 세로 적층에 띠가 작은 조판 — 실측 수학의 신 p3을 그대로 옮겼다.
// 마커 h=2.94, 행 간격 4.7이라 띠 높이가 5.4밖에 안 된다.
//   ①②③  y 456.6~462.0
//   ④⑤    y 462.0~467.4
const TIGHT = region({
  id: 'T',
  bounds: { x: 400, y: 455, w: 70, h: 15 },
  choices: ([1, 2, 3, 4, 5] as ChoiceLabel[]).map((label) => ({
    label,
    box: {
      x: 402 + ((label - 1) % 3) * 21.9,
      y: label <= 3 ? 456.6 : 462.0,
      w: 21.9,
      h: 5.4,
    },
  })),
})

describe('detectChoice', () => {
  it('닫힌 고리 — 동그라미 안에 중심이 들어오는 선지', () => {
    const circle = stroke(circlePoints(75, 110, 15))   // ② 중심 (75, 110)
    expect(detectChoice(R, [circle])).toBe(2)
  })

  // ★ 옛 코드(CHOICE_PAD=4 고정 + 순회 순서 동점 처리)에서 실패한다.
  //   띠 높이 5.4에 사방 4를 더하면 상자가 13.4가 되어 윗줄이 아랫줄을 통째로 삼키고,
  //   겹침 비율이 둘 다 1.0이 되면 먼저 순회한 낮은 번호가 이겼다 — ④가 ①로 읽혔다.
  it('띠가 작은 3+2 배치 — 아랫줄 체크가 윗줄로 새지 않는다', () => {
    // ④ 기호 자리에 친 체크 (열린 마크 → 겹침 경로)
    const check4 = stroke([
      ...linePoints(404.5, 464.0, 405.9, 465.4),
      ...linePoints(405.9, 465.4, 408.6, 462.7),
    ])
    expect(detectChoice(TIGHT, [check4])).toBe(4)

    // ⑤도 같은 방식으로 ②에 새면 안 된다
    const check5 = stroke([
      ...linePoints(426.4, 464.0, 427.8, 465.4),
      ...linePoints(427.8, 465.4, 430.5, 462.7),
    ])
    expect(detectChoice(TIGHT, [check5])).toBe(5)
  })

  it('띠가 작아도 윗줄 표기는 그대로 윗줄로 읽힌다', () => {
    const check1 = stroke([
      ...linePoints(404.5, 458.6, 405.9, 460.0),
      ...linePoints(405.9, 460.0, 408.6, 457.3),
    ])
    expect(detectChoice(TIGHT, [check1])).toBe(1)
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

