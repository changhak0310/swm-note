// [PROBE] + [LAYOUT] — §4.1, §4.2
import { buildLines, median, medianLineHeight, type Line } from './lines'
import { PspError, type BBox, type PageInput, type SourceType, type Span } from './types'

// ---------- PROBE (§4.1) ----------

export const MAX_PAGES = 200
const TEXT_LAYER_SPANS_PER_PAGE = 20

export type ProbeResult = {
  sourceType: SourceType
  pageCount: number
  spansPerPage: number
}

export function probe(pages: PageInput[]): ProbeResult {
  if (pages.length === 0) throw new PspError('ERR_FILE_UNREADABLE')
  if (pages.length > MAX_PAGES) throw new PspError('ERR_PAGE_LIMIT')

  const total = pages.reduce((n, p) => n + p.spans.length, 0)
  const spansPerPage = total / pages.length
  const sourceType: SourceType =
    spansPerPage >= TEXT_LAYER_SPANS_PER_PAGE ? 'TEXT_LAYER' : 'SCANNED'

  // v0.1은 스캔본을 지원하지 않는다 (§1.4). v0.2에서 Surya/PaddleOCR 경로가 붙는다.
  if (sourceType === 'SCANNED') throw new PspError('ERR_UNSUPPORTED_SOURCE')

  return { sourceType, pageCount: pages.length, spansPerPage }
}

// ---------- LAYOUT (§4.2) ----------

export type Column = {
  index: 0 | 1
  bbox: BBox           // 컬럼 실측 경계
  spans: Span[]
  lines: Line[]
  lineHeight: number
}

export type PageLayout = {
  pageIndex: number
  width: number
  height: number
  contentBox: BBox     // 머리말·꼬리말·페이지 번호 제외
  columns: Column[]
  /** 컬럼 판정이 애매해 1단으로 넘긴 경우 → FLAG_COLUMN_AMBIGUOUS */
  columnAmbiguous: boolean
  images: BBox[]
  drawings: BBox[]
}

const OUTER_BAND = 0.15        // 머리말·꼬리말이 존재할 수 있는 상/하단 대역
const REPEAT_MIN_PAGES = 3     // §4.2 "3페이지 이상에서 반복"
// §4.2는 "폭 5% 이상"이라고 쓰지만 실측과 맞지 않는다 (준비도 #4는 미검증 항목이었다).
// 2027 6월 모평 문제지의 실제 단 사이 거터는 본문폭의 2.5%다. 5%를 그대로 쓰면
// 2단 페이지가 전부 1단으로 판정되고, 우측 단 앵커가 A-2에서 통째로 탈락한다.
// 폭 임계값을 실측에 맞춰 내리는 대신, 아래 INTERLEAVE_MIN으로 오검출을 막는다.
const GAP_MIN_W = 0.02
const GAP_AMBIGUOUS_W = 0.012
// 이만큼 넓은 골은 그 자체로 단 경계다 — 아래 세로 겹침 검사를 거치지 않는다.
// 겹침 검사는 임계값을 5%→2%로 내린 데 대한 보호장치이지, 넓은 거터까지 의심할 이유는 없다.
const GAP_CONFIDENT_W = 0.04
const GAP_BAND: [number, number] = [0.4, 0.6]   // §4.2 중앙 40~60%
// 빈 하나가 임계값(2%·1.2%)에 비해 크면 두 임계값 사이가 표현되지 않는다.
// 양 끝 floor/ceil이 각각 최대 한 빈씩 먹으므로 넉넉히 잡는다.
const HIST_BINS = 1000
const PAGE_NUMBER = /^\d{1,3}$/
/** §5.1 A-3과 같은 값 — 여기서는 "쪽번호가 아니다"의 판정선으로 쓴다 */
const EMPHASIS_RATIO = 1.05

// 골 하나만으로는 진짜 단 경계인지 알 수 없다. 페이지 세로를 잘라 각 띠에
// 경계 양쪽 모두 텍스트가 있는지 세고, 그 비율이 낮으면 2단이 아니라고 본다.
const VBANDS = 24
const INTERLEAVE_MIN = 0.35
const INTERLEAVE_AMBIGUOUS = 0.2

/**
 * 페이지별 본문 영역·컬럼을 산출한다.
 * 머리말/꼬리말 판정은 페이지 간 비교가 필요해 문서 전체를 한 번에 받는다.
 */
export function layoutPages(pages: PageInput[]): PageLayout[] {
  const fontMedian = median(pages.flatMap((p) => p.spans.map((s) => s.fontSize)))
  const chrome = findRepeatedBands(pages)
  const band = contentBand(pages, chrome, fontMedian)

  return pages.map((page) => {
    const body = page.spans.filter((s) => !isChrome(s, chrome, fontMedian))
    if (body.length === 0) {
      return {
        pageIndex: page.index,
        width: page.width,
        height: page.height,
        contentBox: [0, 0, 1, 1] as BBox,
        columns: [],
        columnAmbiguous: false,
        images: page.images ?? [],
        drawings: page.drawings ?? [],
      }
    }

    // §4.2 본문 영역 = "페이지에서 머리말·꼬리말·페이지 번호를 제외한 영역".
    // 텍스트 합집합이 아니다 — 그림·수식이 벡터로 그려진 페이지는 텍스트가 상단에만
    // 몰려 있어서, 합집합으로 잡으면 본문 영역이 페이지 위쪽 일부로 쪼그라들고
    // 마지막 문제의 크롭이 잘린다. 머리말·꼬리말 사이 전체를 본문으로 본다.
    const textTop = Math.min(...body.map((s) => s.bbox[1]))
    const textBottom = Math.max(...body.map((s) => s.bbox[3]))
    const contentBox: BBox = [
      Math.min(...body.map((s) => s.bbox[0])),
      Math.min(band.top ?? textTop, textTop),
      Math.max(...body.map((s) => s.bbox[2])),
      Math.max(band.bottom ?? textBottom, textBottom),
    ]

    const split = findColumnSplit(body, contentBox, page.drawings ?? [])
    const columns = split.boundary === null
      ? [makeColumn(0, body, contentBox)]
      : splitColumns(body, contentBox, split.boundary)

    return {
      pageIndex: page.index,
      width: page.width,
      height: page.height,
      contentBox,
      columns,
      columnAmbiguous: split.ambiguous,
      images: page.images ?? [],
      drawings: page.drawings ?? [],
    }
  })
}

type Chrome = {
  /** 같은 y대역·같은 문구로 반복되는 라인 */
  lines: Set<string>
  /** 값이 페이지 번호를 따라가는 숫자 자리 = 쪽번호 */
  pageNumberSpots: Set<string>
}

/**
 * 페이지 장식(머리말·꼬리말·쪽번호) 수집 — §4.2.
 *
 * 라인은 상/하단 대역에서 3페이지 이상 같은 y·같은 문구로 반복되면 장식으로 본다.
 * 문구 비교 시 숫자는 '#'로 정규화한다 — "- 2 -" / "- 3 -" 같은 쪽번호 장식이
 * 페이지마다 달라 보여도 같은 꼬리말이기 때문이다.
 */
function findRepeatedBands(pages: PageInput[]): Chrome {
  const lineHits = new Map<string, Set<number>>()
  const spots = new Map<string, { page: number; value: number }[]>()

  for (const page of pages) {
    const outer = page.spans.filter((s) => inOuterBand(s.bbox))
    for (const line of buildLines(outer)) {
      const key = bandKey(line.bbox, line.text)
      if (!key) continue
      let seen = lineHits.get(key)
      if (!seen) lineHits.set(key, (seen = new Set()))
      seen.add(page.index)
    }
    for (const s of outer) {
      const t = s.text.trim()
      if (!PAGE_NUMBER.test(t)) continue
      const key = spotKey(s.bbox)
      const arr = spots.get(key) ?? []
      arr.push({ page: page.index, value: Number(t) })
      spots.set(key, arr)
    }
  }

  const lines = new Set<string>()
  const pageNumberSpots = new Set<string>()
  if (pages.length >= REPEAT_MIN_PAGES) {
    for (const [key, seen] of lineHits) {
      if (seen.size >= REPEAT_MIN_PAGES) lines.add(key)
    }
    for (const [key, obs] of spots) {
      // 쪽번호의 정의적 성질: 같은 자리에서 값이 페이지 번호를 그대로 따라간다.
      // 즉 (값 − 페이지 인덱스)가 모든 관측에서 같다. 실측 예: 010@p11, 014@p15,
      // 015@p16, 019@p20 → 오프셋 0으로 일정.
      //
      // 문항 번호는 이 조건을 통과하지 못한다. 같은 자리에 반복돼도("01"이 매 회차
      // 첫 문항 자리) 페이지 간격과 번호 간격이 어긋나기 때문이다.
      //
      // 한계: "한 페이지에 한 문항, 번호가 페이지와 나란히 증가"하는 문서라면
      // 문항 번호도 이 조건을 만족한다. 그런 조판은 문제집에서 드물어 감수한다.
      // 오프셋이 문서 전체에서 하나일 필요는 없다. 본책과 별책의 쪽번호 체계가
      // 다른 책이 흔하다(실측: 010~044 뒤에 166~168). 한 오프셋으로 3페이지 이상
      // 이어지는 무리가 있으면 그 자리를 쪽번호 자리로 확정하고, 그 자리의 숫자는
      // 오프셋과 무관하게 전부 지운다.
      if (obs.length < REPEAT_MIN_PAGES) continue
      const runs = new Map<number, number>()
      for (const o of obs) runs.set(o.value - o.page, (runs.get(o.value - o.page) ?? 0) + 1)
      if ([...runs.values()].some((n) => n >= REPEAT_MIN_PAGES)) pageNumberSpots.add(key)
    }
  }
  return { lines, pageNumberSpots }
}

/** 위치만으로 만든 키 — 쪽번호는 페이지마다 같은 자리에 찍힌다 */
function spotKey(b: BBox): string {
  return `${Math.round(((b[0] + b[2]) / 2) * 100)}:${Math.round(((b[1] + b[3]) / 2) * 200)}`
}

function inOuterBand(b: BBox): boolean {
  const cy = (b[1] + b[3]) / 2
  return cy < OUTER_BAND || cy > 1 - OUTER_BAND
}

function bandKey(bbox: BBox, text: string): string | null {
  const norm = text.replace(/\s+/g, '').replace(/\d+/g, '#')
  if (!norm) return null
  // y대역은 0.5% 단위로 양자화 — 조판 흔들림 흡수
  return `${Math.round(((bbox[1] + bbox[3]) / 2) * 200)}|${norm}`
}

/**
 * 머리말 아래 ~ 꼬리말 위 = 본문 세로 범위.
 * 페이지마다 재계산하면 머리말이 없는 페이지에서 튀므로 문서 전체 중앙값으로 고정한다.
 */
function contentBand(
  pages: PageInput[],
  chrome: Chrome,
  fontMedian: number,
): { top: number | null; bottom: number | null } {
  const tops: number[] = []
  const bottoms: number[] = []

  for (const page of pages) {
    const marks = page.spans.filter((s) => isChrome(s, chrome, fontMedian))
    const head = marks.filter((s) => (s.bbox[1] + s.bbox[3]) / 2 < OUTER_BAND)
    const foot = marks.filter((s) => (s.bbox[1] + s.bbox[3]) / 2 > 1 - OUTER_BAND)
    if (head.length) tops.push(Math.max(...head.map((s) => s.bbox[3])))
    if (foot.length) bottoms.push(Math.min(...foot.map((s) => s.bbox[1])))
  }

  return {
    top: tops.length ? median(tops) : null,
    bottom: bottoms.length ? median(bottoms) : null,
  }
}

function isChrome(span: Span, chrome: Chrome, fontMedian: number): boolean {
  if (!inOuterBand(span.bbox)) return false

  // §4.2는 페이지 번호 패턴(^\d{1,3}$)을 무조건 제거하라고 하지만 그대로 두면 안 된다.
  // 문제집은 각 단 첫 문항의 번호가 페이지 상단 15% 안에 들어와서, 패턴만 보고
  // 지우면 그 번호들이 통째로 사라진다 (실측: 한 페이지 6문항 중 2문항 유실).
  if (PAGE_NUMBER.test(span.text.trim())) {
    // 강조되지 않은 숫자 — A-3의 역. 앵커가 될 수 없으니 쪽번호로 본다
    if (!span.bold && span.fontSize < fontMedian * EMPHASIS_RATIO) return true
    // 크게 조판된 쪽번호도 있다. 그때는 "같은 자리, 바뀌는 값"으로 가른다
    return chrome.pageNumberSpots.has(spotKey(span.bbox))
  }

  const key = bandKey(span.bbox, span.text)
  return key !== null && chrome.lines.has(key)
}

type ColumnSplit = { boundary: number | null; ambiguous: boolean }

/**
 * 본문 span의 x 히스토그램에서 빈 골을 찾는다.
 * 컬럼 판정이 틀리면 이후 전 단계가 무너지므로, 애매하면 1단으로 판정하고
 * FLAG_COLUMN_AMBIGUOUS를 붙여 검수로 보낸다 (§4.2 주석).
 */
export function findColumnSplit(
  spans: Span[],
  contentBox: BBox,
  drawings: BBox[] = [],
): ColumnSplit {
  const x0 = contentBox[0]
  const width = contentBox[2] - contentBox[0]
  if (width <= 0) return { boundary: null, ambiguous: false }

  // 조판된 단 구분선이 있으면 그것이 정답이다. 히스토그램보다 우선한다 —
  // 거터가 좁거나 텍스트가 성긴 페이지에서도 흔들리지 않는다.
  const rule = separatorRule(drawings, contentBox)
  if (rule !== null && bothSidesPopulated(spans, rule)) {
    return { boundary: rule, ambiguous: false }
  }

  const filled = new Array<boolean>(HIST_BINS).fill(false)
  for (const s of spans) {
    const a = Math.floor(((s.bbox[0] - x0) / width) * HIST_BINS)
    const b = Math.ceil(((s.bbox[2] - x0) / width) * HIST_BINS)
    for (let i = Math.max(0, a); i < Math.min(HIST_BINS, b); i++) filled[i] = true
  }

  // 빈 골 수집
  const gaps: { center: number; width: number }[] = []
  let run = 0
  for (let i = 0; i <= HIST_BINS; i++) {
    if (i < HIST_BINS && !filled[i]) run++
    else {
      if (run > 0) {
        const start = (i - run) / HIST_BINS
        const end = i / HIST_BINS
        gaps.push({ center: (start + end) / 2, width: end - start })
      }
      run = 0
    }
  }

  const central = gaps.filter((g) => g.center >= GAP_BAND[0] && g.center <= GAP_BAND[1])
  if (central.length === 0) return { boundary: null, ambiguous: false }

  central.sort((a, b) => b.width - a.width)
  const best = central[0]

  if (best.width < GAP_AMBIGUOUS_W) return { boundary: null, ambiguous: false }
  if (best.width < GAP_MIN_W) return { boundary: null, ambiguous: true }

  const boundary = x0 + best.center * width

  // 골이 넓어도 한쪽이 거의 비어 있으면 2단이 아니다 (마지막 페이지 등)
  if (!bothSidesPopulated(spans, boundary)) return { boundary: null, ambiguous: false }

  // 비슷한 폭의 골이 하나 더 있으면 어디가 진짜 경계인지 확정할 수 없다
  if (central.length > 1 && central[1].width >= best.width * 0.8) {
    return { boundary: null, ambiguous: true }
  }

  if (best.width < GAP_CONFIDENT_W) {
    const woven = interleaving(spans, boundary, contentBox)
    if (woven < INTERLEAVE_AMBIGUOUS) return { boundary: null, ambiguous: false }
    if (woven < INTERLEAVE_MIN) return { boundary: null, ambiguous: true }
  }

  return { boundary, ambiguous: false }
}

const RULE_MAX_W = 0.01     // 구분선은 본문폭의 1% 이하로 얇다
const RULE_MIN_H = 0.5      // 본문 높이의 절반 이상 뻗는다

/**
 * 중앙 대역을 세로로 가로지르는 얇고 긴 선 = 단 구분선.
 * 후보가 둘 이상이면(표 테두리 등) 어느 것이 단 경계인지 알 수 없으므로 포기한다.
 */
function separatorRule(drawings: BBox[], contentBox: BBox): number | null {
  const w = contentBox[2] - contentBox[0]
  const h = contentBox[3] - contentBox[1]
  if (w <= 0 || h <= 0) return null

  const found = drawings
    .filter((d) => {
      if (d[2] - d[0] > w * RULE_MAX_W) return false
      if (d[3] - d[1] < h * RULE_MIN_H) return false
      const rel = ((d[0] + d[2]) / 2 - contentBox[0]) / w
      return rel >= GAP_BAND[0] && rel <= GAP_BAND[1]
    })
    .map((d) => (d[0] + d[2]) / 2)
    .sort((a, b) => a - b)

  if (found.length === 0) return null

  // 같은 선이 operator list에 여러 번 나온다(획·채움 중복). x로 묶어 한 개로 센다.
  const clusters: number[][] = []
  for (const cx of found) {
    const last = clusters[clusters.length - 1]
    if (last && cx - last[0] <= w * RULE_MAX_W) last.push(cx)
    else clusters.push([cx])
  }

  // 서로 다른 위치에 후보가 둘 이상이면 어느 쪽이 단 경계인지 확정할 수 없다
  return clusters.length === 1 ? median(clusters[0]) : null
}

/** 경계 양쪽 모두 무시 못 할 분량의 텍스트를 가졌는가 */
function bothSidesPopulated(spans: Span[], boundary: number): boolean {
  if (!spans.length) return false
  const left = spans.filter((s) => spanCenter(s) < boundary).length
  return Math.min(left, spans.length - left) / spans.length >= 0.1
}

/**
 * 경계 양쪽에 나란히 텍스트가 놓인 세로 띠의 비율.
 * 진짜 2단이면 페이지 대부분의 높이에서 좌·우가 함께 채워진다.
 * 들여쓰기나 가운데 정렬 수식이 만든 우연한 골은 이 값이 낮다.
 */
function interleaving(spans: Span[], boundary: number, contentBox: BBox): number {
  const top = contentBox[1]
  const h = contentBox[3] - contentBox[1]
  if (h <= 0) return 0

  const left = new Array<boolean>(VBANDS).fill(false)
  const right = new Array<boolean>(VBANDS).fill(false)
  for (const s of spans) {
    const b = Math.min(VBANDS - 1, Math.max(0, Math.floor((((s.bbox[1] + s.bbox[3]) / 2) - top) / h * VBANDS)))
    if (spanCenter(s) < boundary) left[b] = true
    else right[b] = true
  }

  let occupied = 0
  let both = 0
  for (let i = 0; i < VBANDS; i++) {
    if (!left[i] && !right[i]) continue
    occupied++
    if (left[i] && right[i]) both++
  }
  return occupied ? both / occupied : 0
}

const spanCenter = (s: Span) => (s.bbox[0] + s.bbox[2]) / 2

function splitColumns(spans: Span[], contentBox: BBox, boundary: number): Column[] {
  const left = spans.filter((s) => spanCenter(s) < boundary)
  const right = spans.filter((s) => spanCenter(s) >= boundary)
  const cols: Column[] = []
  // 컬럼 경계를 거터에서 잘라 서로 침범하지 않게 한다.
  // 실측 x만 쓰면 한쪽 단으로 배정된 넓은 요소가 반대쪽 단까지 뻗어 INV-2가 깨진다.
  if (left.length) cols.push(makeColumn(0, left, contentBox, [-Infinity, boundary]))
  if (right.length) cols.push(makeColumn(1, right, contentBox, [boundary, Infinity]))
  return cols
}

function makeColumn(
  index: 0 | 1,
  spans: Span[],
  contentBox: BBox,
  xLimit: [number, number] = [-Infinity, Infinity],
): Column {
  const lines = buildLines(spans)
  return {
    index,
    // x는 컬럼 실측(거터에서 클램프), y는 본문 영역 전체 — 컬럼 상·하단은 본문 경계와 같다
    bbox: [
      Math.max(Math.min(...spans.map((s) => s.bbox[0])), xLimit[0]),
      contentBox[1],
      Math.min(Math.max(...spans.map((s) => s.bbox[2])), xLimit[1]),
      contentBox[3],
    ],
    spans,
    lines,
    lineHeight: medianLineHeight(lines),
  }
}
