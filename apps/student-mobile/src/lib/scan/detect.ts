// 스캔 페이지에서 "채점에 필요한 것"만 찾아낸다 — 선지 마커와 문제 번호 위치.
//
// 글자는 읽지 않는다(OCR 없음). 대신 조판이 남긴 기하 신호를 쓴다:
//   - 선지 마커 ①~⑤ = 정사각 링. 테두리만 잉크라 채움률이 낮고 속이 뚫려 있다.
//   - 문제 번호      = 컬럼 좌단에 정렬된 유채색 글자 덩어리. 문제집은 번호에 색을 준다.
//   - 그 외 잉크     = 본문 낱말. 컬럼 판정과 라인 구성에 쓰인다.
//
// 번호의 '값'은 여기서 읽지 않는다. 검출에 필요한 것은 번호의 자리(배지를 띄울 곳)이고
// 선지 번호는 순서로 정해지므로, 값 없이도 요구 1~4가 모두 성립한다.
// 값이 필요한 쪽(라이브 노트 배지)은 이 결과의 번호 크롭만 scan/ocr.ts 숫자 OCR에 넘긴다.
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
// 번호 글자 높이 (마커 크기 배수). 하한이 0.5였을 때 쎈 p110·p150의 작은 표식
// (18px, 마커 27px의 0.67)이 번호로 새어 들어와 크기 주류를 뺏었다. 실측 두 책의
// 진짜 번호는 마커와 키가 비슷하다 — 쎈 25~26/27, 베이직쎈 28~31/29
const HEAD_MIN_H = 0.7
const HEAD_MAX_H = 1.8
const HEAD_LEFT_TOL = 0.02          // 컬럼 좌단 정렬 허용 (페이지 폭 대비)
// 한 페이지의 문제 번호는 크기가 같다. 실측 여유가 좁다 — 번호 글자 25px,
// 묶음 안내 라벨 20px이라 0.2로 잡으면 둘이 한 무리가 된다
const HEAD_SIZE_TOL = 0.2
// 번호 상자의 가로/세로 비 하한 — 글자가 하나로만 보일 때. 글자가 둘 이상 갈렸으면
// MULTI 쪽을 쓴다 (자세한 이유는 colorBlocks)
const HEAD_MIN_ASPECT = 1.2
const HEAD_MULTI_ASPECT = 0.9
const BODY_GAP = 6                  // 번호 아래 발문이 있어야 하는 거리 (마커 크기 배수)
const SIDE_GAP = 2                  // 같은 줄 오른쪽 발문까지의 거리 (마커 크기 배수)

// 종이색에서 이만큼 벗어난 배경 위에 있으면 문제 요소가 아니다 (개념 상자·머리띠).
// 실측: 종이 위 번호·마커는 종이색과 채도 차 0~2, 개념 상자 안은 8~16, 머리띠는 27~81.
// 글자가 "색을 띠었다"고 볼 최소 치우침 (inkBias). 실측 베이직쎈 p12에서
// 진짜 번호는 9.9~32.2, 검정 본문은 0~4.2로 갈린다
const TINT_BIAS = 8

const TINT_CHROMA = 6
const TINT_LUMA = 10

// 번호 글자 폭의 최대/최소 비.
//
// ★ 서체마다 '1'의 폭이 크게 다르다 — 쎈은 '1' 9px vs '0' 14px(1.6)이지만 베이직쎈의
//   굵은 번호는 '1' 9px vs '0' 23px으로 2.6까지 벌어진다. 2.0으로 잡았더니 이 책의
//   "01"이 통째로 탈락했다(사용자 스크린샷 p17 문항 01).
const GLYPH_W_RATIO = 3.0
// 낱글자의 가로/세로 비 상한. 폭 비율만 풀면 한글 배지·표제가 새어 든다(실측: 표지·
// 개념정리 쪽에 없는 문항이 생겼다). 숫자는 어떤 서체에서도 세로로 길다 —
// 실측 '0' 0.56(쎈)·0.79(베이직쎈), '1' 0.32~0.36. 한글 음절은 정사각(≈1.0)이라
// 이 한 줄이 둘을 가른다
const GLYPH_MAX_ASPECT = 0.92
// 낱글자의 가로/세로 비 하한. 숫자는 가장 좁은 '1'도 0.26~0.48인데, 한글·수식에서
// 떨어져 나온 세로획 조각은 0.15 아래다. 상자 모양 검사(HEAD_MIN_ASPECT)를 느슨하게
// 푼 대신 이 줄이 그런 조각 쌍을 막는다
const GLYPH_MIN_ASPECT = 0.22

/**
 * 번호만으로 문항을 세우려면 근거가 더 필요하다.
 *
 * 개념 정리 쪽의 절 표제("01·1", "04·5")는 색이고 단 좌단에 정렬돼 있어 번호와
 * 구별되지 않는다. 다만 한 쪽에 서넛뿐이다. 그래서 "번호처럼 생긴 것이 넷 이상"이거나
 * "흰 종이 위 선지 뭉치가 있다"를 문항 페이지의 증거로 삼는다.
 *
 * 셋이 아니라 넷인 이유: 쎈 p8의 개념 정리 쪽에 절 표제가 정확히 셋이다(01·1, 01·2,
 * 01·3). 두 책 전수에서 "번호 1~3개 + 선지 뭉치 없음"인 진짜 문항 쪽은 없었다 —
 * 주관식만 있는 쪽도 번호가 다섯 이상이고, 문항이 둘뿐인 쪽은 객관식이라 뭉치가 있다.
 */
const HEAD_MIN_ALONE = 4

// 낱말 묶기
const WORD_JOIN_GAP = 0.45          // unit 배수
const WORD_MIN_PX = 6

export function detectScan(raster: Raster): ScanLayout {
  const { width: w, height: h } = raster
  const { ink, inkLoose, color, colorSeed } = masks(raster)
  const paper = paperTone(raster)
  const onPaper = (c: Comp) => {
    const t = localTone(raster, c)
    return Math.abs(t.chroma - paper.chroma) <= TINT_CHROMA && paper.luma - t.luma <= TINT_LUMA
  }

  const inkComps = components(ink, w, h, 4)
  const unit = estimateUnit(inkComps, h)

  // 종이 위에 있는 링만 선지 마커다. 개념 정리 상자 안의 "①… ②…" 나열이 여기서 걸린다
  const rings = findMarkers(
    { comps: inkComps, ink },
    { comps: components(inkLoose, w, h, 4), ink: inkLoose },
    w,
  ).filter(onPaper)
  // 마커 크기가 이 페이지의 자다. 마커가 없는 쪽(주관식·해설)에서는 글자 높이로 대신한다
  const scale = rings.length ? median(rings.map((r) => r.w)) : unit * 1.6

  const ringSet = new Set<Comp>(rings)
  const words = joinWords(
    inkComps.filter((c) => !ringSet.has(c) && c.px >= WORD_MIN_PX),
    unit,
  )

  // 문제 번호 후보 = "색을 띤 글자". 색 마스크만으로 잡으면 안 된다 —
  //
  //   ★ 진하게 찍힌 색 글자는 획의 속이 거의 검정이라 채도가 0에 가깝다. 실측
  //     베이직쎈의 남색 번호는 색 마스크에서 획 가장자리만 남아 조각났고("16"의 '6'이
  //     22×21로 잘려 한글처럼 정사각이 됐다) 오른쪽 단 번호를 통째로 잃었다.
  //
  // 그래서 모양은 잉크 덩어리에서 가져오고, 색이라는 근거는 그 안의 씨앗 픽셀로 삼는다.
  // 검정 본문은 씨앗이 없어 떨어진다(실측 chroma 0~2). 잉크 문턱을 못 넘는 옅은 색
  // 글자만 색 마스크 쪽에서 보탠다.
  const sane = (c: Comp) => c.h <= scale * 3 && c.w <= scale * 15
  const hits = (a: Comp, b: Comp) =>
    a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0

  const inkTinted = inkComps.filter((c) => sane(c) && inkBias(raster, c, ink) >= TINT_BIAS)
  // 잉크 문턱을 못 넘는 옅은 색 글자는 색 마스크 쪽에서 보탠다. 잉크 덩어리와 겹치는
  // 것은 뺀다 — 같은 글자를 두 번 세면 글자 수·크기 판정이 통째로 어긋난다. 특히 색
  // 번짐이 이웃 숫자를 이어 붙인 덩어리가 함께 들어가면 "정사각 글자 하나"로 보여
  // 번호가 탈락한다 (실측 베이직쎈 p10 "04": 잉크 22×28+24×28 옆에 색 48×30이 겹쳤다)
  const extras = components(color, w, h, 8).filter(
    (c) => sane(c) && !inkTinted.some((t) => hits(c, t)) && inkBias(raster, c, color) >= TINT_BIAS,
  )
  // 글자 칸 나누기(열 투영)는 잉크와 색을 합쳐 본다 — 어느 한쪽만 보면 획이 끊긴다
  const glyphMask = new Uint8Array(ink.length)
  for (let i = 0; i < glyphMask.length; i++) glyphMask[i] = ink[i] | color[i]
  const blocks = colorBlocks([...inkTinted, ...extras], scale, glyphMask, w).filter(onPaper)
  // 단 판정에는 주류 크기 블록만 넣는다. 크기가 어긋난 색 잡동사니(쪽번호·장식)가
  // 정렬선 후보로 남으면 가짜 거터를 만든다 — 실측 쎈 p45: 쪽번호가 오른쪽 무리가 돼
  // 단 경계가 x1232로 밀리고, 마커 그룹이 두 단을 넘나들며 무너졌다
  const sized = dominantSize(blocks)
  const columns = findColumns(words, rings, sized, scale, w)
  const markers = groupMarkers(rings, scale, columns)
  const headings = pickHeadings(sized, columns, words, scale, markers.length > 0, blocks)

  return { unit, scale, columns, markers, headings, words }
}

/** 본문 글자 높이 — 잉크 덩어리 높이의 중앙값. 한글 한 글자가 대략 이 크기다 */
function estimateUnit(comps: Comp[], pageH: number): number {
  const hs = comps.filter((c) => c.h > pageH * 0.002 && c.h < pageH * 0.05).map((c) => c.h)
  return median(hs) || pageH * 0.012
}

// ---------- 선지 마커 ----------

/**
 * 선지 링 찾기 — 두 잉크 마스크에서 각각 뽑아 합친다.
 *
 * 링은 가늘어서 렌더 축척이 조금만 달라져도 회색값이 본 문턱을 넘나든다. 앱 해상도
 * (1700px)에서 베이직쎈 p17의 ①·④가 C자로 끊겨 구멍이 사라졌고, 남은 3개는
 * 최소 개수(4)에 못 미쳐 그 문항의 선지가 통째로 없어졌다 — 사용자가 스크린샷으로
 * 신고한 "선지 박스가 이상하다"의 정체다. 느슨한 마스크(components.ts INK_LOOSE_*)를
 * 한 벌 더 훑어 그런 링을 건진다. 크기 판정은 합친 뒤 한 번만 한다.
 */
function findMarkers(
  strict: { comps: Comp[]; ink: Uint8Array },
  loose: { comps: Comp[]; ink: Uint8Array },
  w: number,
): Comp[] {
  const cand = ringsIn(strict.comps, strict.ink, w)
  for (const c of ringsIn(loose.comps, loose.ink, w)) {
    // 같은 링이 두 마스크에서 다 잡힌다 — 중심이 이미 잡힌 링 안에 들면 버린다
    const cx = (c.x0 + c.x1) / 2
    const cy = (c.y0 + c.y1) / 2
    if (cand.some((o) => cx >= o.x0 && cx <= o.x1 && cy >= o.y0 && cy <= o.y1)) continue
    cand.push(c)
  }
  if (cand.length < 2) return []

  // 같은 페이지의 마커는 같은 크기다. 크기 중앙값에서 벗어난 것은 한글 고리·도형이다
  const m = median(cand.map((c) => c.w))
  return cand.filter((c) => Math.abs(c.w - m) <= m * MARKER_SIZE_TOL)
}

function ringsIn(comps: Comp[], ink: Uint8Array, w: number): Comp[] {
  return comps.filter((c) => {
    if (c.w < w * MARKER_MIN_W || c.w > w * MARKER_MAX_W) return false
    if (Math.abs(c.w / c.h - 1) > MARKER_ASPECT) return false
    if (c.px / (c.w * c.h) > MARKER_FILL_MAX) return false
    const min = c.w * c.h * MARKER_HOLE_MIN
    // 1~2px 끊김은 닫아서 메운다 (실측 베이직쎈 p11 ②가 이 경로로만 잡힌다)
    return holeArea(c, ink, w) >= min || holeArea(c, ink, w, true) >= min
  })
}

/**
 * 마커를 문항별로 묶고 순서대로 번호를 준다.
 *
 * 링 안의 숫자를 읽지 않고도 ①~⑤를 알 수 있다 — 선지는 항상 순서대로 찍히기 때문이다.
 * 한 줄 5개 / 3+2 / 세로 1개씩이 모두 "읽는 순서"로 같게 처리된다.
 * 문항 경계는 세로 간격으로 가른다. 문항 사이에는 발문이 들어가 반드시 벌어진다.
 *
 * ★ 읽는 순서는 y0·x0 정렬이 아니다. 스캔에서는 같은 행의 마커도 y0가 1~2px씩
 *   달라, y0부터 견주면 한 행 안의 ①②가 ②①로 뒤집힌다 — OCR 대조 실측에서
 *   2+2+1 배치가 ②①④③⑤로 나왔다. 행을 먼저 묶고(겹침 판정 — regions.ts의
 *   choiceBoxes와 같은 규칙) 행 안에서만 x로 정렬해야 한다.
 *
 * ★ 텍스트 경로도 이 함수를 그대로 쓴다(`psp/markerGroups.ts`). 입력이 좌표 넷짜리
 *   `Comp`뿐이라 출처가 픽셀 링이든 인쇄된 ①②③ span이든 규칙이 같다 — 두 경로가
 *   뭉치를 다르게 묶으면 그 차이가 곧 버그다.
 */
export function groupMarkers(
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
        const rows: Comp[][] = []
        for (const c of [...bucket].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
          const row = rows[rows.length - 1]
          if (row && c.y0 < Math.max(...row.map((r) => r.y1))) row.push(c)
          else rows.push([c])
        }
        if (alignedRows(rows, scale)) {
          group++
          let ordinal = 0
          for (const row of rows) {
            for (const c of row.sort((a, b) => a.x0 - b.x0)) {
              out.push({ ...c, ordinal: ++ordinal, group })
            }
          }
        }
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

/**
 * 선지 뭉치는 행마다 같은 자리에서 시작한다.
 *
 * 조판이 선지 줄을 왼쪽 맞춤으로 흘리기 때문이다. 반대로 본문 속에 흩어진 원문자는
 * 자리가 제각각이다 — 실측 쎈 p180(전부 주관식)의 증명 상자에서 원문자 한글 ㉮㉯㉰가
 * 넷 모여 없는 객관식 한 문항을 만들었다. 그것들의 행 시작 x는 247·399·440·768로 흩어진다.
 *
 * 마커를 하나 놓쳐 첫 행이 밀리는 경우가 있으므로(그게 이 검출기의 흔한 실패다)
 * 전부가 아니라 과반만 맞으면 통과시킨다.
 */
function alignedRows(rows: Comp[][], scale: number): boolean {
  if (rows.length < 2) return true
  const starts = rows.map((r) => Math.min(...r.map((c) => c.x0)))
  const tol = scale * 1.5
  return starts.some((s) => starts.filter((o) => Math.abs(o - s) <= tol).length * 2 >= starts.length)
}

// ---------- 문제 번호 ----------

/** 번호 후보 — 글자 크기를 함께 들고 다닌다 */
type Block = Comp & { glyphH: number }

/** 유채색 글자를 낱말 단위로 묶는다. 번호 후보 + 단 판정 재료 */
function colorBlocks(colorComps: Comp[], scale: number, mask: Uint8Array, w: number): Block[] {
  // ★ 잇기는 크기 제한 없이 한다. 물결·가운뎃점 같은 작은 글자를 빼고 이으면
  //   "[0001~0004]"가 "[0001~"과 "0004]"로 갈라지고, 그 반쪽이 번호와 크기가 같아진다.
  //   통째로 이어야 "번호보다 두 배 넓다"로 걸러낼 수 있다
  const glyphs = colorComps.filter(
    (c) => c.h >= scale * HEAD_MIN_H && c.h <= scale * HEAD_MAX_H && c.w <= scale * 2,
  )
  return (
    joinWords(colorComps, scale, HEAD_JOIN_GAP)
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
        // 글자 크기의 기준은 잉크가 가장 많은(가장 성한) 글자다. 중앙값을 쓰면 균열로
        // 쪼개진 반쪽들이 기준을 끌어내려 진짜 번호가 주류 크기에서 밀려난다
        // (실측 베이직쎈 p10: 온전한 숫자 h29 옆에 조각 h19 — 중앙값 19로 탈락)
        const best = solid.reduce((a, g) => (g.px > (a?.px ?? 0) ? g : a), solid[0])
        return { ...b, glyphH: best ? best.h : median(inside.map((g) => g.h)), solid }
      })
      // 번호는 폭이 고른 숫자만 늘어선다. 한글·괄호가 섞이면 번호가 아니다 —
      // "[교육청]기출", "서술형" 같은 배지가 여기서 걸린다.
      //
      // ★ 연결요소가 성할 때만 이 판정을 믿는다. 탁한 인쇄에서는 이웃 숫자가 다리로
      //   붙어 한 덩어리가 되는데("02"가 46px 통짜 — 실측 베이직쎈 p10) 그때는
      //   열 투영으로 대신 센다 — 다리 열은 획 열보다 얇아 골이 남는다.
      //   성한 글자가 둘 이상이면 투영으로 넘어가지 않는다: 한글 자모 조각(지·수)이
      //   투영에서는 폭 고른 칸으로 보여 배지 거름이 무너지기 때문이다.
      .filter((b) => {
        // 상자 모양 검사 — 글자가 몇인지에 따라 잣대가 다르다.
        //
        // ★ 글자가 둘 이상으로 갈린 덩어리는 이미 "여러 글자"라는 증거가 있으니 느슨하게
        //   본다. '1'이 좁은 서체에서는 두 자리 수도 거의 정사각이다 — 실측 베이직쎈
        //   p22 "15"는 37×31(비 1.19). 반대로 글자가 하나뿐인 덩어리에는 잣대를 세운다:
        //   작은 아이콘·배지가 여기서 걸린다(실측 쎈 p110의 21×18 표식들이 비 1.17로
        //   새어 들어와 크기 주류를 통째로 뺏었다)
        if (b.solid.length >= 2) {
          return b.w >= b.h * HEAD_MULTI_ASPECT && digitsLike(b.solid)
        }
        if (b.w < b.h * HEAD_MIN_ASPECT) return false
        // 연결요소가 뭉개졌으면(이웃 숫자가 붙음) 열 투영으로 다시 센다
        const segs = segmentGlyphs(b, mask, w)
        if (segs.length < 2 || !digitsLike(segs)) return false
        b.glyphH = median(segs.map((s) => s.h))
        // 칸도 글자 높이여야 한다 — comp 경로의 h≥0.5×scale과 같은 하한. 이게 없으면
        // 12px짜리 색 노이즈 조각 둘이 "번호"가 된다 (실측 베이직쎈 p12)
        return b.glyphH >= scale * HEAD_MIN_H && b.glyphH <= scale * HEAD_MAX_H
      })
      .map(({ solid: _s, ...b }) => b)
  )
}

/**
 * 이 글자들이 숫자만 늘어선 것으로 보이는가.
 *
 * 두 가지를 본다. 낱글자가 세로로 길 것(한글 음절은 정사각이다) — 이게 "[교육청]기출",
 * "서술형" 같은 색 배지와 단원 표제를 거른다. 그리고 폭이 서로 크게 다르지 않을 것.
 */
function digitsLike(glyphs: { w: number; h: number }[]): boolean {
  if (glyphs.some((g) => g.w > g.h * GLYPH_MAX_ASPECT || g.w < g.h * GLYPH_MIN_ASPECT)) return false
  const ws = glyphs.map((g) => g.w)
  return Math.max(...ws) <= Math.min(...ws) * GLYPH_W_RATIO
}

/** 블록 안의 글자 칸 — 열 투영의 골로 나눈다. 붙은 숫자용 대체 계수기 */
function segmentGlyphs(
  b: Comp,
  mask: Uint8Array,
  w: number,
): { w: number; h: number }[] {
  const cols = new Uint32Array(b.w)
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) if (mask[y * w + x]) cols[x - b.x0]++
  }
  const filled = [...cols].filter((v) => v > 0)
  if (filled.length === 0) return []
  // 붙은 숫자 사이 다리는 획보다 얇다 — 실측(베이직쎈 p10 "04") 다리 열 2px vs
  // 획 안쪽 열 5~12px, 중앙값 8.5. 0.2로 두면 컷이 1.7이라 2px 다리를 못 가른다
  const cut = Math.max(1, median(filled) * 0.35)

  const out: { w: number; h: number }[] = []
  let start = -1
  const flush = (end: number) => {
    if (start < 0) return
    const width = end - start
    if (width >= Math.max(2, b.h * 0.15)) {
      // 칸 높이 — 그 열 범위에 실제로 찍힌 행의 폭
      let y0 = b.y1
      let y1 = b.y0
      for (let y = b.y0; y <= b.y1; y++) {
        for (let x = b.x0 + start; x < b.x0 + end; x++) {
          if (mask[y * w + x]) {
            if (y < y0) y0 = y
            if (y > y1) y1 = y
            break
          }
        }
      }
      out.push({ w: width, h: y1 - y0 + 1 })
    }
    start = -1
  }
  for (let x = 0; x < b.w; x++) {
    if (cols[x] >= cut) {
      if (start < 0) start = x
    } else flush(x)
  }
  flush(b.w)
  return out
}

/**
 * 색 블록 중 "각 단의 왼쪽 끝에서 시작하는 것"만 문제 번호로 본다.
 *
 * 문제집은 번호 말고도 색을 쓴다 — 유형 머리띠, 대표문제 배지, "11쪽 유형 02" 같은
 * 상호참조, 정답 체크. 그것들은 단 좌단에 정렬되지 않는다. 텍스트 경로의 A-2와 같은
 * 규칙이고, 실측에서 가장 강력한 판별자였다.
 */
function pickHeadings(
  sized: Block[],
  columns: Column[],
  words: Comp[],
  scale: number,
  hasMarkers: boolean,
  blocks: Block[] = sized,
): Comp[] {

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
              // 또는 같은 줄 오른쪽에 온다 — 기본 문제 쪽은 "0011 ⁿ√(−2)⁶"처럼 한 줄이다.
              // 겹침 기준이 낮은 이유: 번호 옆이 발문이 아니라 그림일 때가 있다. 그림은
              // 번호보다 한참 아래까지 내려오면서 시작은 번호 중간쯤이라 겹치는 몫이 작다
              // (실측 베이직쎈 p45 "04": 옆 도형과 세로로 8px만 겹쳐 0.4에서 탈락했다)
              (wd.x0 > b.x1 && wd.x0 - b.x1 < scale * SIDE_GAP && overlapsY(wd, b, 0.25)),
          ),
        ),
    )
  }

  // 3) 번호는 줄의 처음이다. 번호와 크기·발문 조건이 같은 색 배지가 번호 "뒤에" 붙는
  //    조판이 있다 — 실측 p110 "0725 [교육청]기출". 같은 행의 다른 후보 바로 오른쪽에
  //    붙어 있으면 번호가 아니라 꼬리 배지다. 격자 조판(p9)의 옆 열 번호는 앞 문항의
  //    발문을 사이에 두고 멀리 있어 안 걸린다
  const lead = kept.filter(
    (b) =>
      !kept.some(
        (o) => o !== b && overlapsY(o, b, 0.5) && b.x0 > o.x1 && b.x0 - o.x1 <= scale * 2,
      ),
  )

  // 4) 번호는 열을 이룬다 — 같은 들여쓰기(단 좌단 기준)로 반복된다. 크기·발문 검사를
  //    다 통과하고도 남는 한글 표제("지수")·배지("교육청")는 자기 자리가 하나뿐이라
  //    여기서 걸린다. 약한 색 마스크가 자모를 붙여 놓으면 음절이 "폭 고른 글자 2개"로
  //    보여 형태 필터로는 못 가른다(실측 쎈 p8·p110).
  //
  //    ★ 좌단 '정렬선 하나'가 아니라 '짝'이다 — 한 단에 번호 열이 둘인 격자 조판(p9)도
  //      각 열 안에서 짝을 이루고, 단이 달라도 들여쓰기는 같아 좌우 단끼리도 짝이 된다.
  const offsetOf = (b: Comp) => {
    const col = columns.find((c) => inColumn(b, c))
    return b.x0 - (col?.x0 ?? 0)
  }
  const paired = lead.filter((b) =>
    lead.some((o) => o !== b && Math.abs(offsetOf(o) - offsetOf(b)) <= scale),
  )

  // 5) 문항 페이지라는 증거가 없으면 통째로 버린다
  if (paired.length < HEAD_MIN_ALONE && !hasMarkers) return []
  return paired.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
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
  // ★ 기준 하나를 중심으로 모으면 사슬로 번진다 — 61을 기준으로 잡으면 64도 50도
  //   허용 안에 들어와 한 무리가 된다. 실측 쎈 p9: 4자리 번호(64×26) 무리에 단원
  //   표제 "01"(50×23)이 그렇게 딸려 들어가 없는 문항을 만들었다. 무리를 정한 뒤
  //   그 무리의 중앙값으로 다시 거르면 끊긴다
  if (best.length >= 2) {
    const mw = median(best.map((b) => b.w))
    const mh = median(best.map((b) => b.glyphH))
    best = best.filter((b) => near(b.w, mw) && near(b.glyphH, mh))
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

/**
 * 획이 색을 띤 정도 — 잉크 픽셀 평균의 채널 치우침.
 *
 * 픽셀 하나하나의 채도를 세면 안 된다. 스캔의 JPEG 색번짐이 검정 글자 가장자리에
 * 짙은 색 픽셀을 흩뿌려서, 진한 남색 번호(획 속이 거의 검정이라 채도가 낮다)보다
 * 검정 본문이 더 "색스럽게" 나온다 — 실측 베이직쎈 p12: 남색 '7' 씨앗 11/232,
 * 검정 본문 글자 27/147. 평균을 쓰면 흩뿌린 몇 점은 묻히고 획 전체의 색만 남는다.
 */
function inkBias(raster: Raster, c: Comp, ink: Uint8Array): number {
  const d = raster.rgba
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let y = c.y0; y <= c.y1; y++) {
    for (let x = c.x0; x <= c.x1; x++) {
      const i = y * raster.width + x
      if (!ink[i]) continue
      const o = i * 4
      r += d[o]
      g += d[o + 1]
      b += d[o + 2]
      n++
    }
  }
  if (!n) return 0
  return Math.max(r, g, b) / n - Math.min(r, g, b) / n
}

/** bbox 안의 진한 색 씨앗 픽셀 수 (덩어리 소속까지는 따지지 않는다 — 근사로 충분) */
function seedPx(c: Comp, seed: Uint8Array, w: number): number {
  let n = 0
  for (let y = c.y0; y <= c.y1; y++) {
    for (let x = c.x0; x <= c.x1; x++) if (seed[y * w + x]) n++
  }
  return n
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
