import type { Point, Region, Stroke } from '../../types'

export function pt(x: number, y: number, t = 0): Point {
  return { x, y, p: 0.5, t }
}

/** 중심 (cx, cy), 반지름 r의 닫힌 원형 스트로크 점열 */
export function circlePoints(cx: number, cy: number, r: number, t = 0): Point[] {
  const pts: Point[] = []
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2
    pts.push(pt(cx + Math.cos(a) * r, cy + Math.sin(a) * r, t))
  }
  return pts
}

/** (x1,y1) → (x2,y2) 직선 스트로크 점열 */
export function linePoints(x1: number, y1: number, x2: number, y2: number, t = 0): Point[] {
  const pts: Point[] = []
  for (let i = 0; i <= 10; i++) {
    pts.push(pt(x1 + ((x2 - x1) * i) / 10, y1 + ((y2 - y1) * i) / 10, t))
  }
  return pts
}

export function stroke(points: Point[], attemptNo = 1): Stroke {
  return { id: 's', regionId: null, attemptNo, points }
}

export function region(partial: Partial<Region> & Pick<Region, 'id' | 'bounds'>): Region {
  return {
    docId: 'd',
    page: 1,
    choices: [],
    ansSynth: false,
    answerType: 'choice',
    ...partial,
  }
}
