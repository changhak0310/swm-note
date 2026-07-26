// 텍스트 라인 구성 — 모든 stage가 공유하는 1차 가공
//
// PDF는 글자를 조각내서 준다("[3점]" → "[","3","점","]"). 앵커 패턴(A-1)도
// 선지 마커도 라인 단위 결합을 전제로 한다.
import type { BBox, Span } from './types'

export type Line = {
  spans: Span[]      // x0 오름차순
  text: string
  bbox: BBox
  /** 라인 높이 — SLICE·REGION의 모든 여백 계산 기준 */
  height: number
}

const yCenter = (b: BBox) => (b[1] + b[3]) / 2

/**
 * 세로 중심이 가까운 span끼리 한 줄로 묶는다.
 * 주의: 2단 조판 페이지에 전체 span을 그대로 넣으면 좌/우 단이 한 줄로 합쳐진다.
 * 반드시 컬럼별로 필터해서 호출한다.
 */
export function buildLines(spans: Span[]): Line[] {
  if (spans.length === 0) return []

  const sorted = [...spans].sort((a, b) => yCenter(a.bbox) - yCenter(b.bbox))
  const groups: Span[][] = []
  let current: Span[] = []

  for (const s of sorted) {
    const prev = current[current.length - 1]
    const sameLine =
      prev &&
      Math.abs(yCenter(s.bbox) - yCenter(prev.bbox)) <
        Math.max(s.bbox[3] - s.bbox[1], prev.bbox[3] - prev.bbox[1]) * 0.6
    if (sameLine) current.push(s)
    else {
      if (current.length) groups.push(current)
      current = [s]
    }
  }
  if (current.length) groups.push(current)

  return groups.map(toLine).sort((a, b) => a.bbox[1] - b.bbox[1])
}

function toLine(spans: Span[]): Line {
  spans.sort((a, b) => a.bbox[0] - b.bbox[0])
  const bbox: BBox = [
    Math.min(...spans.map((s) => s.bbox[0])),
    Math.min(...spans.map((s) => s.bbox[1])),
    Math.max(...spans.map((s) => s.bbox[2])),
    Math.max(...spans.map((s) => s.bbox[3])),
  ]
  return {
    spans,
    text: spans.map((s) => s.text).join(''),
    bbox,
    height: bbox[3] - bbox[1],
  }
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** 본문 라인 높이의 중앙값 — 여백·간격의 단위. 라인이 없으면 보수적 기본값 */
export function medianLineHeight(lines: Line[]): number {
  return median(lines.map((l) => l.height)) || 0.012
}
