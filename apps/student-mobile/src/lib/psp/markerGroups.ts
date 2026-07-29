// 페이지 전역 선지 뭉치 — 앵커와 독립된 문항 증거 (규칙 문서 B-8)
//
// 텍스트 경로에서 문항은 오직 번호(앵커)에서 태어난다. `findMarkers`는 슬라이스 안에서만
// 돌고(`regions.ts` ← `pipeline.ts`), 슬라이스는 앵커에서 나오며, 앵커는 단 판정과 정렬
// 클러스터를 통과해야 한다. 그 사슬 중 하나만 끊겨도 문항이 **아예 존재하지 않는다** —
// 실측 hi_math p47(상단 장식이 거터를 메워 오른쪽 단 문항 3개 소실)이 그 경로였다.
//
// 그런데 텍스트 레이어에는 ①②③④⑤가 좌표와 함께 이미 들어 있다. 앵커도 단 판정도
// 거치지 않고. 이 파일은 그것을 페이지 전역에서 뭉치로 묶는다.
//
// ★ 뭉치 규칙은 스캔 경로의 `groupMarkers`를 **그대로 빌려 쓴다.** 그 함수의 입력은
//   좌표 넷짜리 `Comp`뿐이라 출처가 픽셀 링이든 span이든 상관없다. 두 경로가 같은
//   규칙으로 묶어야 교차 검증(규칙 문서 §8.2)에서 나온 차이가 신호가 된다 —
//   규칙까지 다르면 그 차이가 무엇 때문인지 알 수 없다.
//
// ★ 예전에 "텍스트의 원문자를 세어 문항 수를 재기"가 실패한 이유는 **개수 문턱 하나로
//   조절하려 했기** 때문이다(실측: 느슨하게 잡으면 hi_math 목차의 원문자까지 166개,
//   조이면 수능의 진짜 선지 33개 중 17개만). 여기서는 개수가 아니라 기하로 가른다:
//   행 시작 x 정렬(`alignedRows`) · 세로 간격 · 그리고 텍스트에만 있는 증거인
//   **인쇄된 서수가 읽는 순서와 일치하는가**. 목차의 원문자는 자리가 흩어져 있고
//   서수도 1..n을 이루지 않아 마지막 조건에서 걸린다.
import { groupMarkers } from '../scan/detect'
import type { Comp } from '../scan/components'
import type { Column as ScanColumn } from '../scan/detect'
import type { PageLayout } from './layout'
import { dominantFamily, findMarkers, type Marker } from './regions'
import { unionBBox, type BBox } from './types'

/** 뭉치로 인정할 최소 선지 수 — 스캔 경로의 `MIN_CHOICES`와 같은 값, 같은 이유.
 *  셋으로 두면 개념 정리 쪽의 "①… ②… ③…" 나열이 문항이 된다. */
const MIN_CHOICES = 4

/**
 * 마커가 **문서 본문**보다 이만큼은 커야 한다.
 *
 * 문제집 앞부분의 "이 책의 구성과 특징"에는 지면 미리보기 썸네일이 실린다. 그 안의
 * 선지는 진짜 선지를 축소한 것이라 서수 검산도, 행 시작 x 정렬도 전부 통과한다 —
 * 실측 hi_math p7·p8에서 없는 문항 14개가 그렇게 생겼다.
 *
 * ★ 기준이 **문서 전체** 본문 크기인 것이 핵심이다. 페이지 안 중앙값으로 재면 안 걸린다
 *   — 썸네일 쪽은 본문도 같이 작아서 비가 1.00으로 나온다(실제로 그렇게 재 보고 실패했다).
 *   A-3이 문서 전체 중앙값을 쓰는 것과 같은 이유다.
 *
 * 실측 여유가 넓다: 진짜 선지 **0.95~1.03**(n=180) vs 썸네일 **0.21~0.30**(n=18).
 * 0.5는 그 사이 빈 구간의 한가운데다.
 */
const MIN_BODY_RATIO = 0.5

export type MarkerGroup = {
  pageIndex: number
  /** 뭉치가 놓인 단. 단 판정이 1단이면 항상 0 */
  columnIndex: 0 | 1
  family: string
  /** 인쇄된 서수 순. ordinal은 **인쇄값**이고, 읽는 순서와 일치함이 검증된 것만 나온다 */
  markers: { ordinal: number; bbox: BBox }[]
  /** 뭉치 전체를 감싼 페이지 좌표 */
  bbox: BBox
}

/**
 * 한 페이지에서 선지 뭉치를 찾는다. 앵커·슬라이스·C-3 밴드를 전혀 거치지 않는다.
 *
 * 좌표 단위에 주의: PSP의 정규화 좌표는 x가 폭 기준, y가 높이 기준이라 **둘의 단위가
 * 다르다.** 그대로 `groupMarkers`에 넣으면 "세로 간격 > 마커 크기 × 5"가 페이지
 * 종횡비만큼(보통 1.4배) 왜곡된다. 그래서 pt로 되돌려 넣고 결과만 다시 정규화한다.
 *
 * @param bodyFontSize 문서 전체 본문 크기 (`anchor.ts`의 `bodyFontSize(layouts)`).
 *   기본값을 두지 않는 이유: 안 넘기면 썸네일 거르기(MIN_BODY_RATIO)가 조용히 꺼진다.
 */
export function findMarkerGroups(layout: PageLayout, bodyFontSize: number): MarkerGroup[] {
  const all: Marker[] = layout.columns.flatMap((c) => findMarkers(c.lines))
  if (all.length < MIN_CHOICES) return []

  // 계열은 페이지 단위 다수결로 하나만 쓴다 — 텍스트 경로가 문항 안에서 하는 일과 같다.
  // 발문 속 <보기>의 ㉠㉡과 선지 ①②가 섞인 페이지에서 한쪽만 남긴다.
  const family = dominantFamily(all)
  const markers = all.filter((m) => m.family === family)
  if (markers.length < MIN_CHOICES || !family) return []

  const W = layout.width
  const H = layout.height
  const toComp = (b: BBox): Comp => {
    const x0 = b[0] * W
    const y0 = b[1] * H
    const x1 = b[2] * W
    const y1 = b[3] * H
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, px: 0 }
  }

  // 좌표로 원본을 되찾는다 — groupMarkers는 Comp를 펼쳐 돌려주므로 x0·y0이 보존된다
  const byKey = new Map<string, Marker>()
  const comps: Comp[] = []
  for (const m of markers) {
    const c = toComp(m.bbox)
    byKey.set(`${c.x0},${c.y0}`, m)
    comps.push(c)
  }

  const scale = medianOf(comps.map((c) => c.w))
  if (scale <= 0) return []

  const columns: ScanColumn[] = layout.columns.length
    ? layout.columns.map((c) => ({ x0: c.bbox[0] * W, x1: c.bbox[2] * W }))
    : [{ x0: 0, x1: W }]

  const grouped = groupMarkers(comps, scale, columns)

  const byGroup = new Map<number, typeof grouped>()
  for (const g of grouped) {
    const arr = byGroup.get(g.group)
    if (arr) arr.push(g)
    else byGroup.set(g.group, [g])
  }

  const out: MarkerGroup[] = []
  for (const items of byGroup.values()) {
    // groupMarkers가 준 ordinal은 **읽는 순서**다. 인쇄된 서수와 맞는지 여기서 검산한다.
    //
    // 스캔 경로는 링 안 숫자를 읽지 않아 이 검산을 못 한다. 텍스트 레이어가 공짜로 주는
    // 증거이고, 목차·본문에 흩어진 원문자를 거르는 가장 강한 조건이다.
    const ordered = [...items].sort((a, b) => a.ordinal - b.ordinal)
    const printed = ordered.map((g) => byKey.get(`${g.x0},${g.y0}`))
    if (printed.some((m) => !m)) continue
    if (printed.some((m, i) => m!.ordinal !== i + 1)) continue

    const bboxes = printed.map((m) => m!.bbox)

    // 지면 미리보기 썸네일 거르기 — 위 두 조건을 통과해도 여기서 걸린다
    if (bodyFontSize > 0) {
      const h = medianOf(bboxes.map((b) => b[3] - b[1]))
      if (h < bodyFontSize * MIN_BODY_RATIO) continue
    }

    const col = layout.columns.find(
      (c) => bboxes[0][0] >= c.bbox[0] && bboxes[0][0] < c.bbox[2],
    )
    out.push({
      pageIndex: layout.pageIndex,
      columnIndex: col?.index ?? 0,
      family,
      markers: printed.map((m) => ({ ordinal: m!.ordinal, bbox: m!.bbox })),
      bbox: unionBBox(bboxes),
    })
  }

  return out.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0])
}

/**
 * 이 문서가 선지에 쓰는 계열 하나를 확정한다 — 계획 문서 B-2의 "책 단위 다수결".
 *
 * 인정 계열 넷(①②③ · ㉠㉡㉢ · ⑴⑵⑶ · `(1)(2)`)은 **책마다 쓰임이 다르다.**
 * 실측 "수학의 신 문제.pdf"에서는
 *   ①②③ = 선지 · **⑴⑵⑶ = 소문항** · **㉠㉡㉢ = 그림 라벨**
 * 이라, 문항 단위로만 보면 소문항 `⑴⑵⑶⑷`(정확히 4개)와 그림 라벨 `㉠~㉤`(5개)가
 * C-1~C-3을 전부 통과해 선지가 된다 — 실측 p46 4-1 · p80 6-3이 그것이다.
 *
 * ★ **낱개 마커 수로 세면 안 된다.** 실측 낱개 분포는 수학의 신 503:207:10,
 *   hi_math 838:53:52:23으로 잡음이 섞인다. **뭉치로 세면** 80:2 · 116:1 · 33:0으로
 *   갈린다 — 뭉치는 이미 개수·서수·정렬·크기를 통과한 것이라 소문항과 라벨이 걸러진다.
 *
 * 과반을 넘는 계열이 없으면 `null`을 돌려 **기존 동작(문항 단위 다수결)을 그대로 둔다.**
 * 뭉치가 적은 문서에서 억지로 하나를 고르면 잃기만 한다.
 */
export function dominantChoiceFamily(
  layouts: PageLayout[],
  bodyFontSize: number,
): string | null {
  const count = new Map<string, number>()
  let total = 0
  for (const l of layouts) {
    for (const g of findMarkerGroups(l, bodyFontSize)) {
      count.set(g.family, (count.get(g.family) ?? 0) + 1)
      total++
    }
  }
  if (!total) return null

  let best: string | null = null
  let bestN = 0
  for (const [f, n] of count) if (n > bestN) ((bestN = n), (best = f))
  return bestN * 2 > total ? best : null
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
