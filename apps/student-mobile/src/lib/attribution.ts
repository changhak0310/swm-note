// 스트로크 귀속 판정 (§7.1)
// - 스트로크를 절대 분할하지 않는다
// - 기준은 Region.bounds 전체이며 workBox가 아니다
// - 중심점 방식을 쓰지 않는다. 분수 막대·긴 대각선에서 중심이 엉뚱한 곳에 찍힌다
import type { Region, Stroke } from '../types'
import { expand, ratioInside } from './geometry'

// 이 비율 미만으로 걸치면 orphan이다.
//
// ★ 예전에는 STRONG(0.6)·WEAK(0.3) 두 단계가 있었으나 **두 분기가 같은 값을 반환**해서
//   STRONG은 아무 일도 하지 않았다. 강·약을 나눌 의도가 있었다면 구현되지 않은 것이고,
//   지금 동작은 임계 하나다. 되살리려면 "약한 귀속을 어떻게 다르게 다룰지"부터 정해야 한다.
const PAD = 8
const MIN_COVERAGE = 0.3

export function attribute(stroke: Stroke, regions: Region[]): string | null {
  if (regions.length === 0 || stroke.points.length === 0) return null

  const scored = regions.map((r) => ({
    id: r.id,
    coverage: ratioInside(stroke.points, expand(r.bounds, PAD)),
  }))

  const best = scored.reduce((a, b) => (b.coverage > a.coverage ? b : a))

  if (best.coverage >= MIN_COVERAGE) return best.id
  return null                      // orphan — 화면에는 남고 채점에서만 빠진다
}
