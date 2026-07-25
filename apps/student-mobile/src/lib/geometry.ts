// 좌표·박스·고리 판정 유틸 — DOM 비의존 순수 함수
import type { Box, Point } from '../types'

// 정규화 좌표계 기준 폭 (§5). segment·스트로크·채점이 전부 이 계를 공유한다.
export const MAX_W = 760

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function pathLength(pts: Point[]): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i])
  return len
}

export function expand(box: Box, pad: number): Box {
  return { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 }
}

export function pointInBox(x: number, y: number, box: Box): boolean {
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h
}

/** 박스 내부에 들어오는 점의 비율 (0~1) */
export function ratioInside(pts: Point[], box: Box): number {
  if (pts.length === 0) return 0
  let inside = 0
  for (const p of pts) if (pointInBox(p.x, p.y, box)) inside++
  return inside / pts.length
}

/** 시작점과 끝점의 거리가 전체 경로 길이의 20% 미만이면 닫힌 고리로 본다 (§7.2) */
export function isClosedLoop(pts: Point[]): boolean {
  if (pts.length < 3) return false
  const len = pathLength(pts)
  if (len === 0) return false
  return dist(pts[0], pts[pts.length - 1]) < len * 0.2
}

/** ray casting. 스트로크 점열을 폴리곤으로 보고 내부 판정 */
export function pointInPolygon(x: number, y: number, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

export function boxCenter(box: Box): { x: number; y: number } {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 }
}

/** 점에서 스트로크(폴리라인)까지 최단 거리 — 스트로크 단위 지우개 히트테스트 */
export function distToStroke(x: number, y: number, pts: Point[]): number {
  if (pts.length === 0) return Infinity
  if (pts.length === 1) return Math.hypot(x - pts[0].x, y - pts[0].y)
  let min = Infinity
  for (let i = 1; i < pts.length; i++) {
    min = Math.min(min, distToSegment(x, y, pts[i - 1], pts[i]))
  }
  return min
}

function distToSegment(x: number, y: number, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lenSq))
  return Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t))
}

// ---------- 화면 ↔ 정규화 좌표 변환 (§5) ----------
// scale은 핀치 줌 배율. 확대·축소는 뷰 변환일 뿐 저장 좌표를 바꾸지 않는다.

export type ViewRect = { left: number; top: number; width: number }

export function toNorm(
  clientX: number,
  clientY: number,
  rect: ViewRect,
  scale = 1,
): { x: number; y: number } {
  const f = MAX_W / rect.width
  return {
    x: ((clientX - rect.left) / scale) * f,
    y: ((clientY - rect.top) / scale) * f,
  }
}

export function toView(
  x: number,
  y: number,
  rect: ViewRect,
  scale = 1,
): { x: number; y: number } {
  const f = rect.width / MAX_W
  return {
    x: x * f * scale + rect.left,
    y: y * f * scale + rect.top,
  }
}
