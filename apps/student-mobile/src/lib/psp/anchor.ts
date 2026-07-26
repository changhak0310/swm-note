// [ANCHOR] — §4.3, §5.1 RULE-ANCHOR + §5.2 확정 절차
import { median, type Line } from './lines'
import type { Column, PageLayout } from './layout'
import { PspError, type BBox, type Span } from './types'

export type Anchor = {
  pageIndex: number
  columnIndex: 0 | 1
  /** 원본 표기 그대로. "1", "01" */
  numberText: string
  numberInt: number | null
  bbox: BBox
  line: Line
  /** 컬럼 좌측 경계로부터의 x0 오프셋 — 정렬 기준선 클러스터링 키 */
  offset: number
}

// A-1 패턴 (§5.1)
const PATTERNS: RegExp[] = [
  /^\s*(\d{1,3})\s*[.)]?\s*$/,
  /^\[(\d{1,3})\]$/,
  /^(?:문제|유형)\s*(\d{1,3})/,
]

const LEFT_ALIGN_TOL = 0.08     // A-2 컬럼폭의 8%
const EMPHASIS_RATIO = 1.05     // A-3 본문 중앙값 × 1.05
const CLUSTER_TOL = 0.015       // §5.2 컬럼폭의 1.5%

function matchNumber(text: string): string | null {
  for (const re of PATTERNS) {
    const m = re.exec(text)
    if (m) return m[1]
  }
  return null
}

/**
 * A-1~A-4를 모두 만족하는 span을 앵커 후보로 뽑는다.
 *
 * PDF가 "1." 을 "1" + "." 두 조각으로 주는 경우가 흔해, 라인 선두 span 단독과
 * 선두 2개 결합을 모두 시도한다. A-4(라인 선두)는 어느 쪽이든 유지된다.
 */
export function findCandidates(layout: PageLayout, bodyFontSize: number): Anchor[] {
  const out: Anchor[] = []

  for (const col of layout.columns) {
    const colW = col.bbox[2] - col.bbox[0]
    if (colW <= 0) continue
    const leftLimit = col.bbox[0] + colW * LEFT_ALIGN_TOL

    for (const line of col.lines) {
      const head = line.spans[0]
      if (!head) continue

      // A-2 — 가장 강력한 판별자. 본문 중간의 "3"은 여기서 대부분 탈락한다
      if (head.bbox[0] > leftLimit) continue

      // A-3
      if (!isEmphasized(head, bodyFontSize)) continue

      // A-1 (A-4는 head가 line.spans[0]인 것으로 이미 성립)
      const numberText =
        matchNumber(head.text.trim()) ??
        matchNumber((head.text + (line.spans[1]?.text ?? '')).trim())
      if (numberText === null) continue

      const numberInt = Number(numberText)
      out.push({
        pageIndex: layout.pageIndex,
        columnIndex: col.index,
        numberText,
        numberInt: Number.isFinite(numberInt) ? numberInt : null,
        bbox: head.bbox,
        line,
        offset: head.bbox[0] - col.bbox[0],
      })
    }
  }
  return out
}

function isEmphasized(span: Span, bodyFontSize: number): boolean {
  return span.bold || span.fontSize >= bodyFontSize * EMPHASIS_RATIO
}

/** 본문 폰트 크기 중앙값 — A-3의 기준. 문서 전체로 잡아야 페이지별 흔들림이 없다 */
export function bodyFontSize(layouts: PageLayout[]): number {
  const sizes: number[] = []
  for (const l of layouts) for (const c of l.columns) for (const s of c.spans) sizes.push(s.fontSize)
  return median(sizes)
}

export type AnchorResolution = {
  anchors: Anchor[]
  /** 정렬 기준선에서 벗어나 폐기된 후보 수 — 진단용 */
  discarded: number
  /** 번호 수열이 역행한 지점의 앵커 인덱스 → FLAG_NUMBER_DISORDER */
  disorderAt: Set<number>
}

/**
 * §5.2 확정 절차.
 *
 * 1) 후보 x0를 1D 클러스터링해 가장 큰 클러스터를 정렬 기준선으로 채택
 * 2) 기준선을 벗어난 후보 폐기
 * 3) (pageIndex, columnIndex, y0) 순 정렬
 * 4) 정수 수열이 단조 증가하지 않으면 해당 지점에 FLAG_NUMBER_DISORDER
 *
 * 기준선은 (단 × 페이지 홀짝)마다 따로 잡는다.
 *
 * - 단별: 2단 조판에는 정렬선이 단마다 하나씩 있다.
 * - 홀짝별: 제본된 문제집은 좌우 펼침면의 안쪽 여백이 달라 홀수·짝수 페이지의
 *   번호 x좌표가 통째로 어긋난다(실측 2.6%p). 전체를 한 무리로 묶고 가장 큰
 *   클러스터만 남기면 한쪽 면의 앵커가 전부 폐기돼 문항 절반이 사라진다.
 *
 * 무리 안에서는 컬럼 좌측 경계로부터의 오프셋이 아니라 절대 x0로 묶는다.
 * 컬럼 경계는 그 단의 최좌단 요소를 따라가므로 넓은 그림 하나에 페이지마다 흔들리고,
 * 그러면 같은 자리에 찍힌 번호가 페이지마다 다른 오프셋을 갖게 된다.
 */
export function resolveAnchors(candidates: Anchor[], columnWidth: number): AnchorResolution {
  if (candidates.length === 0) throw new PspError('ERR_NO_ANCHOR')

  const tol = columnWidth * CLUSTER_TOL
  const eligible = byNumberFormat(candidates)
  const groups = new Map<string, Anchor[]>()
  for (const c of eligible) {
    const key = `${c.columnIndex}:${c.pageIndex % 2}`
    const arr = groups.get(key) ?? []
    arr.push(c)
    groups.set(key, arr)
  }

  const kept: Anchor[] = []
  for (const group of groups.values()) kept.push(...largestCluster(group, tol))

  const anchors = kept.sort(
    (a, b) => a.pageIndex - b.pageIndex || a.columnIndex - b.columnIndex || a.bbox[1] - b.bbox[1],
  )

  // V-1 이전 단계 — 순서 자체가 역행하는 지점
  const disorderAt = new Set<number>()
  let prev: number | null = null
  for (let i = 0; i < anchors.length; i++) {
    const n = anchors[i].numberInt
    if (n === null) continue
    if (prev !== null && n <= prev) disorderAt.add(i)
    prev = n
  }

  return { anchors, discarded: candidates.length - anchors.length, disorderAt }
}

const PADDED = /^0\d/
const PADDING_MIN_RATIO = 0.15

/**
 * 번호 표기 형식도 조판 규칙이다 — 정렬 기준선과 같은 성격의 판별자다.
 *
 * 0채움("01", "02")을 쓰는 문제집에서 한 자리 번호는 문항이 아니라 절·단원 표제다.
 * 실측: 핵심개념정리 페이지의 "1 .다항식의 연산", "2 .다항식의 연산(2)"가 문항 번호와
 * 같은 x에 찍혀 정렬 기준선만으로는 걸러지지 않았다.
 *
 * 0채움을 쓰지 않는 문서(1~30번을 그대로 쓰는 수능형)에는 아무 제약도 걸지 않는다.
 */
function byNumberFormat(candidates: Anchor[]): Anchor[] {
  const padded = candidates.filter((c) => PADDED.test(c.numberText)).length
  const usesPadding = padded >= Math.max(3, candidates.length * PADDING_MIN_RATIO)
  return usesPadding ? candidates.filter((c) => c.numberText.length >= 2) : candidates
}

/** x0를 1D 클러스터링해 가장 큰 무리를 돌려준다 — 그것이 그 단의 정렬 기준선이다 */
function largestCluster(group: Anchor[], tol: number): Anchor[] {
  const sorted = [...group].sort((a, b) => a.bbox[0] - b.bbox[0])
  const clusters: Anchor[][] = []
  for (const c of sorted) {
    const last = clusters[clusters.length - 1]
    if (last && c.bbox[0] - last[0].bbox[0] <= tol) last.push(c)
    else clusters.push([c])
  }
  let best = clusters[0]
  for (const cl of clusters) if (cl.length > best.length) best = cl
  return best
}

/** 컬럼폭 중앙값 — 클러스터링 허용 오차의 기준 */
export function medianColumnWidth(layouts: PageLayout[]): number {
  const widths: number[] = []
  for (const l of layouts) for (const c of l.columns) widths.push(c.bbox[2] - c.bbox[0])
  return median(widths) || 1
}

export function columnOf(layout: PageLayout, index: 0 | 1): Column | undefined {
  return layout.columns.find((c) => c.index === index)
}
