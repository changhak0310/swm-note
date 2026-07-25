// 스트로크 귀속 판정 (§7.1)
// - 스트로크를 절대 분할하지 않는다
// - 기준은 Region.bounds 전체이며 workBox가 아니다
// - 중심점 방식을 쓰지 않는다. 분수 막대·긴 대각선에서 중심이 엉뚱한 곳에 찍힌다
import type { Region, Stroke } from '../types'
import { expand, ratioInside } from './geometry'

const PAD = 8
const STRONG = 0.6
const WEAK = 0.3

export function attribute(stroke: Stroke, regions: Region[]): string | null {
  if (regions.length === 0 || stroke.points.length === 0) return null

  const scored = regions.map((r) => ({
    id: r.id,
    coverage: ratioInside(stroke.points, expand(r.bounds, PAD)),
  }))

  const best = scored.reduce((a, b) => (b.coverage > a.coverage ? b : a))

  if (best.coverage >= STRONG) return best.id
  if (best.coverage >= WEAK) return best.id
  return null                      // orphan — 화면에는 남고 채점에서만 빠진다
}
