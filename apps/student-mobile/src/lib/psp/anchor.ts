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
  kept.sort(byDocOrder)

  // 기준선을 벗어났어도 번호 수열의 빈칸을 정확히 메우면 되살린다 (아래 참고)
  const keptSet = new Set(kept)
  const anchors = [...kept, ...fillNumberGaps(kept, eligible.filter((c) => !keptSet.has(c)))].sort(
    byDocOrder,
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

/** 되살릴 빈칸의 최대 폭 — 앞뒤 앵커의 번호 차이 */
const GAP_MAX = 5

const byDocOrder = (a: Anchor, b: Anchor) =>
  a.pageIndex - b.pageIndex || a.columnIndex - b.columnIndex || a.bbox[1] - b.bbox[1]

/**
 * 정렬 기준선에서 벗어나 폐기된 후보 중, 번호 수열의 빈칸을 정확히 메우는 것을 되살린다.
 *
 * 한 책 안에서도 단 좌단이 통째로 밀리는 쪽이 있다 — 실측 hi_math의 서술형 쪽(p35·p40)은
 * 왼쪽 단 번호가 다른 쪽보다 1.1%p 안쪽에 찍혀 클러스터에서 떨어졌고, 20·21번이 통째로
 * 사라졌다. 허용 오차를 그만큼 넓히면 이번엔 에세이 쪽(p4)의 장식 번호가 들어온다 —
 * 두 어긋남의 크기가 1.0%p·1.1%p로 사실상 같아서 오차로는 가를 수 없다.
 *
 * 가르는 것은 번호다. 되살린 20·21은 앞쪽(19)과 뒤쪽(22) 사이의 빈칸에 정확히 들어맞고,
 * 장식 번호는 그런 자리가 없다. 그래서 "문서 순서상 앞뒤 앵커 사이의 빠진 번호이고,
 * 그 이웃과 같은 쪽에 있을 것"만 받아들인다.
 */
function fillNumberGaps(accepted: Anchor[], discarded: Anchor[]): Anchor[] {
  if (accepted.length < 2 || discarded.length === 0) return []

  const out: Anchor[] = []
  const used = new Set<string>()
  for (const c of [...discarded].sort(byDocOrder)) {
    if (c.numberInt === null) continue

    let before: Anchor | null = null
    let after: Anchor | null = null
    for (const a of accepted) {
      if (byDocOrder(a, c) < 0) before = a
      else if (after === null) after = a
    }
    if (!before || !after || before.numberInt === null || after.numberInt === null) continue
    if (after.numberInt - before.numberInt > GAP_MAX) continue
    if (c.numberInt <= before.numberInt || c.numberInt >= after.numberInt) continue
    // 멀리 있는 쪽의 번호를 끌어오지 않는다 — 이웃과 같은 쪽에 있어야 한다
    if (c.pageIndex !== before.pageIndex && c.pageIndex !== after.pageIndex) continue

    // 빈칸은 문서 안에서 여러 번 나타난다(번호가 절마다 되풀이된다) — 키에 자리를 넣어
    // 구분한다. 번호만으로 묶으면 뒤에 오는 같은 빈칸이 통째로 건너뛰어진다
    const key = `${before.pageIndex}:${before.numberInt}-${after.pageIndex}:${after.numberInt}:${c.numberInt}`
    if (used.has(key)) continue
    used.add(key)
    out.push(c)
  }
  return out
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
