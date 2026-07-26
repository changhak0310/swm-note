// [SLICE] — §4.4, §5.2 RULE-SLICE. 앵커 사이를 잘라 문제 bbox 확정 (L1)
import type { Anchor } from './anchor'
import { columnOf } from './anchor'
import type { Column, PageLayout } from './layout'
import type { BBox } from './types'

const TOP_LEAD = 0.3          // §5.2 y0 = 앵커 y0 − 라인높이 × 0.3
const TAIL_BAND = 0.25        // §5.2 컬럼 하단 경계에서 25% 이내

export type Slice = {
  anchor: Anchor
  pageIndex: number
  columnIndex: 0 | 1
  bbox: BBox
  /** 컬럼·페이지를 넘어간 문제의 두 번째 조각 */
  continuation?: { pageIndex: number; columnIndex: 0 | 1; bbox: BBox }
  spansBoundary: boolean
  column: Column
  lineHeight: number
  /** FIGURE 탐지 원본 — 페이지의 임베디드 이미지 + 벡터 드로잉 bbox (§5.3-2) */
  figureSources: BBox[]
}

/**
 * 확정된 앵커 열(§5.2 정렬 순서)을 문제 bbox로 자른다.
 *
 * 컬럼/페이지 넘김은 자동으로 이어붙이되 FLAG_SPANS_BOUNDARY를 붙여 무조건 검수로 보낸다.
 * 이어붙이기는 실패 확률이 높고, 강사가 5초 만에 승인/수정하는 편이 싸다 (§5.2 주석).
 */
export function sliceProblems(anchors: Anchor[], layouts: PageLayout[]): Slice[] {
  const byPage = new Map(layouts.map((l) => [l.pageIndex, l]))
  const out: Slice[] = []

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]
    const layout = byPage.get(a.pageIndex)
    const column = layout && columnOf(layout, a.columnIndex)
    if (!layout || !column) continue

    const lh = column.lineHeight
    const next = anchors[i + 1]
    const sameColumn =
      next && next.pageIndex === a.pageIndex && next.columnIndex === a.columnIndex

    const y0 = a.bbox[1] - lh * TOP_LEAD
    // 컬럼 마지막 문제 → 컬럼 하단 경계 (= 본문 영역 하단, makeColumn 참조)
    const y1 = sameColumn ? next.bbox[1] - lh * TOP_LEAD : column.bbox[3]

    const bbox: BBox = [column.bbox[0], y0, column.bbox[2], y1]
    const slice: Slice = {
      anchor: a,
      pageIndex: a.pageIndex,
      columnIndex: a.columnIndex,
      bbox,
      spansBoundary: false,
      column,
      lineHeight: lh,
      figureSources: [...layout.images, ...layout.drawings],
    }

    // 넘김 판정 — 다음 앵커가 다른 컬럼/페이지에 있고, 이 앵커가 컬럼 하단 25% 이내
    if (next && !sameColumn) {
      const colH = column.bbox[3] - column.bbox[1]
      const nearBottom = a.bbox[1] >= column.bbox[3] - colH * TAIL_BAND
      if (nearBottom) {
        const cont = continuationBox(next, byPage, lh)
        if (cont) {
          slice.continuation = cont
          slice.spansBoundary = true
        }
      }
    }

    out.push(slice)
  }

  return out
}

/** 다음 앵커가 놓인 컬럼의 상단 ~ 다음 앵커 직전까지가 이어지는 조각이다 */
function continuationBox(
  next: Anchor,
  byPage: Map<number, PageLayout>,
  lineHeight: number,
): Slice['continuation'] | null {
  const layout = byPage.get(next.pageIndex)
  const col = layout && columnOf(layout, next.columnIndex)
  if (!col) return null

  const top = col.bbox[1]
  const bottom = next.bbox[1] - lineHeight * TOP_LEAD
  // 다음 문제가 컬럼 최상단에서 바로 시작하면 이어붙일 조각이 없다
  if (bottom - top < lineHeight) return null

  return {
    pageIndex: next.pageIndex,
    columnIndex: next.columnIndex,
    bbox: [col.bbox[0], top, col.bbox[2], bottom],
  }
}
