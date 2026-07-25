import { describe, expect, it } from 'vitest'
import {
  expand,
  isClosedLoop,
  MAX_W,
  pointInPolygon,
  ratioInside,
  toNorm,
  toView,
} from '../geometry'
import { circlePoints, linePoints, pt } from './helpers'

describe('isClosedLoop', () => {
  it('동그라미는 닫힌 고리', () => {
    expect(isClosedLoop(circlePoints(50, 50, 20))).toBe(true)
  })

  it('직선·빗금은 열린 마크', () => {
    expect(isClosedLoop(linePoints(0, 0, 100, 100))).toBe(false)
  })

  it('점 두 개는 고리가 아니다', () => {
    expect(isClosedLoop([pt(0, 0), pt(1, 1)])).toBe(false)
  })
})

describe('ratioInside', () => {
  const box = { x: 0, y: 0, w: 100, h: 100 }

  it('절반 걸침', () => {
    const pts = [...linePoints(10, 50, 90, 50).slice(0, 5), ...linePoints(200, 200, 300, 300).slice(0, 5)]
    expect(ratioInside(pts, box)).toBeCloseTo(0.5)
  })

  it('빈 점열은 0', () => {
    expect(ratioInside([], box)).toBe(0)
  })
})

describe('pointInPolygon', () => {
  const square = [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100)]

  it('내부/외부 판정', () => {
    expect(pointInPolygon(50, 50, square)).toBe(true)
    expect(pointInPolygon(150, 50, square)).toBe(false)
  })
})

describe('expand', () => {
  it('사방으로 pad만큼 넓힌다', () => {
    expect(expand({ x: 10, y: 10, w: 20, h: 20 }, 5)).toEqual({ x: 5, y: 5, w: 30, h: 30 })
  })
})

describe('좌표 변환 (§5)', () => {
  const rect = { left: 20, top: 40, width: 380 }   // 화면 폭 380 = MAX_W의 절반

  it('화면 → 정규화', () => {
    expect(toNorm(20 + 190, 40 + 100, rect)).toEqual({ x: MAX_W / 2, y: 200 })
  })

  it('왕복 변환이 항등', () => {
    const n = toNorm(123, 456, rect, 1.5)
    const v = toView(n.x, n.y, rect, 1.5)
    expect(v.x).toBeCloseTo(123)
    expect(v.y).toBeCloseTo(456)
  })
})
