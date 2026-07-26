import { describe, expect, it } from 'vitest'
import { detectMarks } from '../liveDetect'
import { circlePoints, linePoints, region, stroke } from './helpers'
import type { ChoiceLabel, Region } from '../../types'

/** 한 줄 5선지 문항. y는 top부터 쌓는다 */
function problem(id: string, top: number): Region {
  return region({
    id,
    bounds: { x: 0, y: top, w: 300, h: 140 },
    numBox: { x: 4, y: top + 4, w: 18, h: 14 },
    numLabel: id,
    choices: ([1, 2, 3, 4, 5] as ChoiceLabel[]).map((label) => ({
      label,
      box: { x: (label - 1) * 50, y: top + 100, w: 50, h: 20 },
    })),
  })
}

const P1 = problem('1', 0)
const P2 = problem('2', 140)

describe('detectMarks', () => {
  it('동그라미 친 선지를 문항별로 낸다', () => {
    const marks = detectMarks(
      [P1, P2],
      [
        stroke(circlePoints(75, 110, 15)),     // 1번 ②
        stroke(circlePoints(225, 250, 15)),    // 2번 ⑤ (y = 140 + 110)
      ],
    )
    expect(marks).toEqual({ '1': 2, '2': 5 })
  })

  it('구역이 아직 없으면 아무것도 내지 않는다 — 분석 전 첫 획', () => {
    expect(detectMarks([], [stroke(circlePoints(75, 110, 15))])).toEqual({})
  })

  it('저장된 regionId가 null이어도 판정한다 — 분석 전에 그은 획', () => {
    const s = stroke(circlePoints(75, 110, 15))
    expect(s.regionId).toBeNull()
    expect(detectMarks([P1], [s])).toEqual({ '1': 2 })
  })

  it('풀이 필기는 마크가 아니다', () => {
    const work = stroke(linePoints(20, 30, 280, 80))    // 선지 줄 위쪽 여백
    expect(detectMarks([P1], [work])).toEqual({})
  })

  it('형광펜은 답 마크로 세지 않는다', () => {
    const hi = { ...stroke(circlePoints(75, 110, 15)), tool: 'hi' as const }
    expect(detectMarks([P1], [hi])).toEqual({})
  })

  it('고쳐 그으면 마지막 마크가 이긴다', () => {
    const marks = detectMarks([P1], [
      stroke(circlePoints(75, 110, 15, 1000)),           // ②
      stroke(linePoints(155, 118, 195, 102, 2000)),      // ④
    ])
    expect(marks).toEqual({ '1': 4 })
  })

  it('문항 경계를 넘어간 동그라미도 선지를 가진 쪽으로 간다', () => {
    // 1번 ⑤에 크게 친 동그라미 — 아래로 2번 구역까지 걸친다.
    // bounds 귀속이 2번을 골라도 선지 판정이 성립하는 쪽은 1번뿐이다
    const big = stroke(circlePoints(225, 132, 34))
    expect(detectMarks([P1, P2], [big])).toEqual({ '1': 5 })
  })

  it('주관식 문항은 건너뛴다', () => {
    const short = region({
      id: 'S',
      bounds: { x: 0, y: 0, w: 300, h: 140 },
      answerType: 'integer',
    })
    expect(detectMarks([short], [stroke(circlePoints(75, 110, 15))])).toEqual({})
  })
})
