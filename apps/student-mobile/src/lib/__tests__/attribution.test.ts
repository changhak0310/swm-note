import { describe, expect, it } from 'vitest'
import { attribute } from '../attribution'
import { linePoints, pt, region, stroke } from './helpers'

const A = region({ id: 'A', bounds: { x: 0, y: 0, w: 300, h: 200 } })
const B = region({ id: 'B', bounds: { x: 0, y: 220, w: 300, h: 200 } })

describe('attribute', () => {
  it('완전 포함 — 전부 안에 있으면 그 구역', () => {
    const s = stroke(linePoints(50, 50, 200, 150))
    expect(attribute(s, [A, B])).toBe('A')
  })

  it('경계 걸침 — 60% 이상 걸치면 강한 귀속', () => {
    // 10점 중 7점이 A 내부(pad 포함), 3점이 밖
    const s = stroke([
      ...linePoints(50, 100, 200, 180).slice(0, 7),
      pt(150, 500), pt(160, 510), pt(170, 520),
    ])
    expect(attribute(s, [A, B])).toBe('A')
  })

  it('약한 겹침(30% 이상)도 최선 구역으로 귀속', () => {
    // 10점 중 4점만 A 내부(40%), 나머지는 어느 구역에도 없음
    const s = stroke([
      pt(10, 10), pt(20, 20), pt(30, 30), pt(40, 40),
      ...linePoints(400, 500, 500, 600).slice(0, 6),   // 6점, 구역 밖
    ])
    expect(attribute(s, [A, B])).toBe('A')
  })

  it('orphan — 어떤 구역에도 30% 미만이면 null', () => {
    const s = stroke(linePoints(500, 600, 700, 700))
    expect(attribute(s, [A, B])).toBeNull()
  })

  it('여러 Region 경합 — 겹침 비율이 큰 쪽', () => {
    // 세로선이 A(0~200)와 B(220~420)를 가로지름 — B 쪽 점이 더 많다
    const s = stroke(linePoints(150, 150, 150, 400))
    expect(attribute(s, [A, B])).toBe('B')
  })

  it('구역이 없으면 null', () => {
    expect(attribute(stroke(linePoints(0, 0, 10, 10)), [])).toBeNull()
  })
})
