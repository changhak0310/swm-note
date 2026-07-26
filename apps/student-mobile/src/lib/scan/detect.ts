// 스캔 페이지에서 "채점에 필요한 것"만 찾아낸다 — 선지 마커와 문제 번호 위치.
//
// 글자는 읽지 않는다(OCR 없음). 대신 조판이 남긴 기하 신호를 쓴다:
//   - 선지 마커 ①~⑤ = 정사각 링. 테두리만 잉크라 채움률이 낮고 속이 뚫려 있다.
//   - 문제 번호      = 컬럼 좌단에 정렬된 유채색 글자 덩어리. 문제집은 번호에 색을 준다.
//   - 그 외 잉크     = 본문 낱말. 컬럼 판정과 라인 구성에 쓰인다.
//
// 번호의 '값'은 못 읽는다. 라이브 노트가 필요로 하는 것은 번호의 자리(배지를 띄울 곳)이고
// 선지 번호는 순서로 정해지므로, 값 없이도 요구 1~4가 모두 성립한다.
import {
  components,
  holeArea,
  localTone,
  masks,
  median,
  paperTone,
  type Comp,
  type Raster,
  type Tone,
} from './components'

export type Column = { x0: number; x1: number }

export type ScanLayout = {
  /** 본문 글자 높이 추정 (px) — 잉크 덩어리 높이 중앙값 */
  unit: number
  /** 마커 크기 (px). 이 페이지의 자 — 간격·번호 크기를 전부 여기 상대적으로 잰다 */
  scale: number
  /** 단 경계 (px) */
  columns: Column[]
  /** 선지 마커. 문항별로 묶여 순서대로 ordinal 1..n을 받는다 */
  markers: (Comp & { ordinal: number; group: number })[]
  /** 문제 번호 블록 (단 좌단 정렬 통과) */
  headings: Comp[]
  /** 본문 낱말 덩어리 */
  words: Comp[]
}

// 마커 크기 — 페이지 폭 대비. 실측(쎈 수학1): 1653px 폭에서 27px = 1.6%
const MARKER_MIN_W = 0.008
const MARKER_MAX_W = 0.035
const MARKER_ASPECT = 0.18          // |w/h − 1| 허용
// ★ 이 두 값이 마커와 한글 고리(ㅇ·ㅁ·ㅂ)를 가른다. 실측 여유가 크다:
//   마커 fill 0.13~0.15 / hole 0.55~0.62,  나머지 fill ≥0.22 / hole ≤0.47
const MARKER_FILL_MAX = 0.20        // 링은 테두리만 잉크다
const MARKER_HOLE_MIN = 0.45        // bbox 면적 대비 갇힌 빈 공간
const MARKER_SIZE_TOL = 0.25        // 한 페이지 안에서 마커 크기는 균일하다

// 문항 경계 — 선지 행 사이가 이보다 벌어지면 다른 문항이다 (마커 크기 배수).
// 실측: 같은 문항의 행 간격 55px(2줄짜리 분수 선지 포함), 문항 사이 1000px 이상.
const GROUP_GAP = 5
const MAX_CHOICES = 5
// 선지 뭉치로 인정할 최소 개수. 개념 설명의 "①… ②… ③…" 나열을 문항으로 오인하지 않는다
// (실측 p60 개념정리 쪽). 문제집 객관식은 사실상 전부 5지선다다 — 실측 82문항 중
// 5개 완비 80, 나머지도 4개였다. 3지선다는 없다
const MIN_CHOICES = 4

// 문제 번호 — 색 덩어리를 낱말로 묶을 때의 가로 간격 (마커 크기 배수)
const HEAD_JOIN_GAP = 0.6
const HEAD_MIN_H = 0.5              // 마커 크기 배수
const HEAD_MAX_H = 1.8
const HEAD_MIN_ASPECT = 1.2         // 정사각 색 덩어리(정답 체크 ✓·아이콘) 배제
const HEAD_LEFT_TOL = 0.02          // 컬럼 좌단 정렬 허용 (페이지 폭 대비)
// 한 페이지의 문제 번호는 크기가 같다. 실측 여유가 좁다 — 번호 글자 25px,
// 묶음 안내 라벨 20px이라 0.2로 잡으면 둘이 한 무리가 된다
const HEAD_SIZE_TOL = 0.2
const BODY_GAP = 6                  // 번호 아래 발문이 있어야 하는 거리 (마커 크기 배수)
const SIDE_GAP = 2                  // 같은 줄 오른쪽 발문까지의 거리 (마커 크기 배수)

// 종이색에서 이만큼 벗어난 배경 위에 있으면 문제 요소가 아니다 (개념 상자·머리띠).
// 실측: 종이 위 번호·마커는 종이색과 채도 차 0~2, 개념 상자 안은 8~16, 머리띠는 27~81.
const TINT_CHROMA = 6
const TINT_LUMA = 10

// 번호 글자 폭의 최대/최소 비. 숫자끼리는 1.6을 넘지 않고('1' 9px vs '0' 14px),
// 한글·괄호가 섞이면 3배까지 벌어진다
const GLYPH_W_RATIO = 2.0

/**
 * 번호만으로 문항을 세우려면 근거가 더 필요하다.
 *
 * 개념 정리 쪽의 단원 표제("01·1", "04·5")는 색이고 단 좌단에 정렬돼 있어 번호와
 * 구별되지 않는다. 다만 한 쪽에 두어 개뿐이다. 그래서 "번호처럼 생긴 것이 3개 이상"이거나
 * "흰 종이 위 선지 뭉치가 있다"를 문항 페이지의 증거로 삼는다.
 */
const HEAD_MIN_ALONE = 3

// 낱말 묶기
const WORD_JOIN_GAP = 0.45          // unit 배수
const WORD_MIN_PX = 6

export function detectScan(raster: Raster): ScanLayout {
  const { width: w, height: h } = raster
  const { ink, color } = masks(raster)
  const paper = paperTone(raster)
  const onPaper = (c: Comp) => {
    const t = localTone(raster, c)
    return Math.abs(t.chroma - paper.chroma) <= TINT_CHROMA && paper.luma - t.luma <= TINT_LUMA
  }

  const inkComps = components(ink, w, h, 4)
  const unit = estimateUnit(inkComps, h)

  // 종이 위에 있는 링만 선지 마커다. 개념 정리 상자 안의 "①… ②…" 나열이 여기서 걸린다
  const rings = findMarkers(inkComps, ink, w).filter(onPaper)
  // 마커 크기가 이 페이지의 자다. 마커가 없는 쪽(주관식·해설)에서는 글자 높이로 대신한다
  const scale = rings.length ? median(rings.map((r) => r.w)) : unit * 1.6

  const ringSet = new Set<Comp>(rings)
  const words = joinWords(
    inkComps.filter((c) => !ringSet.has(c) && c.px >= WORD_MIN_PX),
    unit,
  )

  const blocks = colorBlocks(components(color, w, h, 8), scale).filter(onPaper)
  const columns = findColumns(words, rings, blocks, scale, w)
  const markers = groupMarkers(rings, scale, columns)
  const headings = pickHeadings(blocks, columns, words, scale, markers.length > 0)

  return { unit, scale, columns, markers, headings, words }
}

/** 본문 글자 높이 — 잉크 덩어리 높이의 중앙값. 한글 한 글자가 대략 이 크기다 */
function estimateUnit(comps: Comp[], pageH: number): number {
  const hs = comps.filter((c) => c.h > pageH * 0.002 && c.h < pageH * 0.05).map((c) => c.h)
  return median(hs) || pageH * 0.012
}

// ---------- 선지 마커 ----------

function findMarkers(comps: Comp[], ink: Uint8Array, w: number): Comp[] {
  const cand = comps.filter((c) => {
    if (c.w < w * MARKER_MIN_W || c.w > w * MARKER_MAX_W) return false
    if (Math.abs(c.w / c.h - 1) > MARKER_ASPECT) return false
    if (c.px / (c.w * c.h) > MARKER_FILL_MAX) return false
    return holeArea(c, ink, w) >= c.w * c.h * MARKER_HOLE_MIN
  })
  if (cand.length < 2) return []

  // 같은 페이지의 마커는 같은 크기다. 크기 중앙값에서 벗어난 것은 한글 고리·도형이다
  const m = median(cand.map((c) => c.w))
  return cand.filter((c) => Math.abs(c.w - m) <= m * MARKER_SIZE_TOL)
}

/**
 * 마커를 문항별로 묶고 순서대로 번호를 준다.
 *
 * 링 안의 숫자를 읽지 않고도 ①~⑤를 알 수 있다 — 선지는 항상 순서대로 찍히기 때문이다.
 * 한 줄 5개 / 3+2 / 세로 1개씩이 모두 "읽는 순서"로 같게 처리된다.
 * 문항 경계는 세로 간격으로 가른다. 문항 사이에는 발문이 들어가 반드시 벌어진다.
 */
function groupMarkers(
  markers: Comp[],
  scale: number,
  columns: Column[],
): ScanLayout['markers'] {
  const out: ScanLayout['markers'] = []
  let group = 0

  for (const c0 of columns) {
    const col = markers
      .filter((c) => inColumn(c, c0))
      .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
    if (!col.length) continue

    let bucket: Comp[] = []
    let rowBottom = -Infinity        // 지금 담고 있는 행의 아래끝

    const flush = () => {
      if (bucket.length >= MIN_CHOICES) {
        group++
        bucket
          .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
          .forEach((c, i) => out.push({ ...c, ordinal: i + 1, group }))
      }
      bucket = []
      rowBottom = -Infinity
    }

    for (const c of col) {
      const sameRow = bucket.length > 0 && c.y0 < rowBottom
      const gapped = bucket.length > 0 && !sameRow && c.y0 - rowBottom > scale * GROUP_GAP
      if (gapped || bucket.length >= MAX_CHOICES) flush()
      bucket.push(c)
      rowBottom = Math.max(rowBottom, c.y1)
    }
    flush()
  }
  return out
}

// ---------- 문제 번호 ----------

/** 번호 후보 — 글자 크기를 함께 들고 다닌다 */
type Block = Comp & { glyphH: number }

/** 유채색 글자를 낱말 단위로 묶는다. 번호 후보 + 단 판정 재료 */
function colorBlocks(colorComps: Comp[], scale: number): Block[] {
  // ★ 잇기는 크기 제한 없이 한다. 물결·가운뎃점 같은 작은 글자를 빼고 이으면
  //   "[0001~0004]"가 "[0001~"과 "0004]"로 갈라지고, 그 반쪽이 번호와 크기가 같아진다.
  //   통째로 이어야 "번호보다 두 배 넓다"로 걸러낼 수 있다
  const glyphs = colorComps.filter(
    (c) => c.h >= scale * HEAD_MIN_H && c.h <= scale * HEAD_MAX_H && c.w <= scale * 2,
  )
  return (
    joinWords(colorComps, scale, HEAD_JOIN_GAP)
      // 번호는 여러 글자다. 정사각에 가까운 색 덩어리는 정답 체크 ✓·아이콘이다
      .filter((b) => b.w >= b.h * HEAD_MIN_ASPECT)
      .map((b) => {
        const inside = glyphs.filter(
          (g) => g.x0 >= b.x0 && g.x1 <= b.x1 && g.y0 >= b.y0 && g.y1 <= b.y1,
        )
        // ★ 크기 비교의 기준은 상자가 아니라 글자다. "[0001~0004]"를 반으로 자른
        //   "[0001~"은 상자 크기가 번호와 똑같지만(괄호가 키를 맞춘다) 속 숫자는
        //   한 급 작다 — 실측 라벨 20px vs 번호 25px
        // 스캔에서는 획이 쪼개져 실오라기 같은 조각이 생긴다. 잉크량이 성한 글자의
        // 1/4도 안 되면 글자로 세지 않는다 — 이걸 빼지 않으면 아래 폭 비교가 튄다
        // (실측 p107: 1px짜리 조각 하나에 비가 13:1까지 벌어져 번호를 통째로 잃었다)
        const solidPx = median(inside.map((g) => g.px)) * 0.25
        const solid = inside.filter((g) => g.px >= solidPx)
        return { ...b, glyphH: median(inside.map((g) => g.h)), solid }
      })
      // 번호는 폭이 고른 숫자만 늘어선다. 한글·괄호가 섞이면 번호가 아니다 —
      // "[교육청]기출", "서술형" 같은 배지가 여기서 걸린다
      .filter((b) => {
        if (b.solid.length < 2) return false
        const ws = b.solid.map((g) => g.w)
        return Math.max(...ws) <= Math.min(...ws) * GLYPH_W_RATIO
      })
      .map(({ solid: _s, ...b }) => b)
  )
}

/**
 * 색 블록 중 "각 단의 왼쪽 끝에서 시작하는 것"만 문제 번호로 본다.
 *
 * 문제집은 번호 말고도 색을 쓴다 — 유형 머리띠, 대표문제 배지, "11쪽 유형 02" 같은
 * 상호참조, 정답 체크. 그것들은 단 좌단에 정렬되지 않는다. 텍스트 경로의 A-2와 같은
 * 규칙이고, 실측에서 가장 강력한 판별자였다.
 */
function pickHeadings(
  blocks: Block[],
  columns: Column[],
  words: Comp[],
  scale: number,
  hasMarkers: boolean,
): Comp[] {
  // 1) 한 쪽의 문제 번호는 크기가 같다 — 같은 자릿수, 같은 서체.
  //    실측 p20: 진짜 번호는 59~63×25~26으로 붙어 있고, 나머지(머리띠·배지·표제)는
  //    14·19·34·39로 흩어진다. 최대 무리만 남기면 그 둘이 갈린다
  const sized = dominantSize(blocks)

  // 2) 번호 아래에는 반드시 내용이 온다. 이 조건이 색 꼬리말을 걷어낸다 —
  //    "(교사용)"은 번호와 크기도 좌단도 같아 다른 규칙으로는 안 걸린다
  //
  //    ★ 좌단 정렬은 거르는 데 쓰지 않는다. 한 단 안에 번호 열이 둘인 조판이 있다
  //      (기본 문제 쪽: 한 쪽에 짧은 주관식 37문항이 2×2 격자로 들어간다).
  //      정렬선 하나만 남기면 그런 쪽에서 절반을 잃는다 — 실측 p9에서 37개 중 20개.
  const kept: Comp[] = []
  for (const col of columns) {
    const colWords = words.filter((wd) => inColumn(wd, col))
    kept.push(
      ...sized
        .filter((b) => inColumn(b, col))
        .filter((b) =>
          colWords.some(
            (wd) =>
              // 아래에 발문이 온다 (보통의 문항)
              (wd.y0 > b.y1 && wd.y0 - b.y1 < scale * BODY_GAP) ||
              // 또는 같은 줄 오른쪽에 온다 — 기본 문제 쪽은 "0011 ⁿ√(−2)⁶"처럼 한 줄이다
              (wd.x0 > b.x1 && wd.x0 - b.x1 < scale * SIDE_GAP && overlapsY(wd, b, 0.4)),
          ),
        ),
    )
  }

  // 3) 문항 페이지라는 증거가 없으면 통째로 버린다
  if (kept.length < HEAD_MIN_ALONE && !hasMarkers) return []
  return kept.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
}

/** 글자 크기와 폭이 서로 닮은 것끼리 묶어 가장 큰 무리를 돌려준다 */
function dominantSize(blocks: Block[]): Block[] {
  if (blocks.length < 2) return blocks
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(a, b) * HEAD_SIZE_TOL
  let best: Block[] = []
  for (const a of blocks) {
    const group = blocks.filter((b) => near(a.w, b.w) && near(a.glyphH, b.glyphH))
    // 동수면 더 넓은 쪽 — 번호는 여러 자리라 표제·배지보다 길다
    if (group.length > best.length || (group.length === best.length && a.w > (best[0]?.w ?? 0))) {
      best = group
    }
  }
  return best
}

// ---------- 단 ----------

/**
 * 단 경계.
 *
 * 1순위는 번호 정렬선이다 — 색 블록이 크게 떨어진 두 x 무리를 이루면 2단이고,
 * 그 사이가 거터다. 잉크 히스토그램만 쓰면 두 단에 걸친 그림·표 한 장에 거터가 메워진다
 * (실측 p21). 색을 쓰지 않는 문제집을 위해 히스토그램 판정을 2순위로 남긴다.
 */
function findColumns(
  words: Comp[],
  markers: Comp[],
  blocks: Comp[],
  scale: number,
  pageW: number,
): Column[] {
  const all = [...words, ...markers]
  if (!all.length) return [{ x0: 0, x1: pageW }]
  const left = Math.min(...all.map((c) => c.x0))
  const right = Math.max(...all.map((c) => c.x1)) + 1
  const one = [{ x0: left, x1: right }]
  const mid = (left + right) / 2
  // 거터 최소 폭. 실측(쎈 수학1, 1700px 폭)에서 40px인 쪽도 23px인 쪽도 있었다.
  // 낮게 잡아도 안전하다 — "페이지 높이 전체에 걸쳐 비어 있는 x"라는 조건이 이미 세다.
  // 낱말 사이 여백은 줄마다 자리가 달라 세로로 이어지지 않는다
  const minGutter = scale * 0.5

  // 1) 번호 정렬선 — 가운데 좌우로 하나씩 있고 사이가 충분히 벌어졌는가
  const lefts = blocks.filter((b) => b.x0 < mid).map((b) => b.x0)
  const rights = blocks.filter((b) => b.x0 >= mid).map((b) => b.x0)
  if (lefts.length >= 2 && rights.length >= 2) {
    const rightStart = Math.min(...rights)
    // 오른쪽 단 번호 앞의 여백이 거터다. 왼쪽 단 본문이 거기까지 침범하지 않아야 한다
    const leftEnd = Math.max(
      ...all.filter((c) => c.x1 < rightStart).map((c) => c.x1),
      left,
    )
    if (rightStart - leftEnd >= minGutter) {
      const cut = (leftEnd + rightStart) / 2
      return [
        { x0: left, x1: cut },
        { x0: cut, x1: right },
      ]
    }
  }

  // 2) 잉크 히스토그램의 빈 골
  const hist = new Uint32Array(pageW)
  for (const c of all) for (let x = c.x0; x <= c.x1 && x < pageW; x++) hist[x]++
  const from = Math.floor(pageW * 0.3)
  const to = Math.ceil(pageW * 0.7)
  let best = { start: -1, len: 0 }
  let run = -1
  for (let x = from; x <= to; x++) {
    if (hist[x] === 0) {
      if (run < 0) run = x
      if (x - run + 1 > best.len) best = { start: run, len: x - run + 1 }
    } else run = -1
  }
  if (best.len < minGutter) return one
  const cut = best.start + best.len / 2
  // 양쪽에 실제로 내용이 있어야 단이다. 왼쪽에만 차 있는 쪽(짧은 1단 페이지)의
  // 오른쪽 여백을 거터로 오인하면 문항 bounds가 반쪽이 된다
  const leftN = all.filter((c) => (c.x0 + c.x1) / 2 < cut).length
  if (Math.min(leftN, all.length - leftN) < all.length * 0.15) return one
  return [
    { x0: left, x1: cut },
    { x0: cut, x1: right },
  ]
}

function inColumn(c: Comp, col: Column): boolean {
  const cx = (c.x0 + c.x1) / 2
  return cx >= col.x0 && cx < col.x1
}

// ---------- 낱말 ----------

/**
 * 같은 줄에서 가로로 가까운 덩어리를 하나로 합친다.
 *
 * ★ x0 순으로만 정렬한다. y0을 먼저 보면 한 픽셀 아래로 앉은 글자가 오른쪽 글자보다
 *   뒤로 밀려, 이미 자란 블록의 왼쪽에 도착한다 — 그러면 합쳐지지 못하고 혼자 남는다.
 *   실측: "0112"의 첫 자리가 떨어져 나가 번호가 44px(3자리)로 잡히고, 그 바람에
 *   좌단 정렬선까지 어긋나 같은 단의 다른 번호가 통째로 탈락했다.
 */
function joinWords(comps: Comp[], unit: number, gapUnits = WORD_JOIN_GAP): Comp[] {
  const sorted = [...comps].sort((a, b) => a.x0 - b.x0)
  const out: Comp[] = []
  for (const c of sorted) {
    const hit = out.find((o) => overlapsY(o, c, 0.4) && gapX(o, c) <= unit * gapUnits)
    if (hit) {
      hit.x0 = Math.min(hit.x0, c.x0)
      hit.x1 = Math.max(hit.x1, c.x1)
      hit.y0 = Math.min(hit.y0, c.y0)
      hit.y1 = Math.max(hit.y1, c.y1)
      hit.w = hit.x1 - hit.x0 + 1
      hit.h = hit.y1 - hit.y0 + 1
      hit.px += c.px
    } else {
      out.push({ ...c })
    }
  }
  return out
}

function overlapsY(a: Comp, b: Comp, ratio: number): boolean {
  const top = Math.max(a.y0, b.y0)
  const bottom = Math.min(a.y1, b.y1)
  return bottom - top >= Math.min(a.h, b.h) * ratio
}

/** 두 상자 사이의 가로 간격 (겹치면 0) */
function gapX(a: Comp, b: Comp): number {
  return Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1))
}

function insideAny(c: Comp, boxes: Comp[]): boolean {
  const cx = (c.x0 + c.x1) / 2
  const cy = (c.y0 + c.y1) / 2
  return boxes.some((b) => cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1)
}
