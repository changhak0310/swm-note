// 스캔 페이지 픽셀 → 연결요소. DOM 비의존 순수 함수.
//
// 스캔본에는 텍스트 레이어가 없다. 글자를 읽을 수는 없지만 "잉크 덩어리"의 모양과
// 위치는 읽을 수 있고, 자동채점에 필요한 것은 딱 그것뿐이다 — 선지 마커가 어디
// 있는가, 문제 번호가 어디서 시작하는가.

export type Raster = {
  width: number
  height: number
  /** RGBA. canvas ImageData.data 그대로 */
  rgba: Uint8ClampedArray
}

export type Comp = {
  x0: number
  y0: number
  x1: number
  y1: number
  w: number
  h: number
  /** 픽셀 수 */
  px: number
}

// 잉크 문턱의 허용 범위 — 좁게 가둔다.
//
// 실측(쎈 수학1): 본문 글자 ≤60, 옅은 배경 상자(개념 정리·유형 머리띠) ≥220, 종이 ~245.
// 그 사이라면 어디를 잘라도 결과가 같다. Otsu를 풀어 두면 배경 상자가 있는 쪽에서
// "종이 vs 옅은 색"으로 갈라 문턱이 200까지 올라가고, 그러면 상자가 통째로 잉크가 돼
// 거터가 메워진다(실측 p20·p30이 2단 → 1단으로 무너졌다).
const INK_MIN_T = 120
const INK_MAX_T = 160
// 마커 전용 느슨한 문턱. 선지 링은 가는 획이라 렌더 축척이 조금만 달라져도 회색값이
// 본 문턱을 넘나들며 끊긴다 — 실측: 앱 해상도(1700px)에서 베이직쎈 p17의 ①·④가
// C자로 끊겨 구멍이 사라졌고(3×3 닫기로도 못 메운다) 그 그룹이 통째로 버려졌다.
// +20에서 두 책의 마커 fill은 0.15~0.18로 상한(0.20) 아래에 머물고 한글 고리는
// 0.35로 오히려 더 벌어진다. 200까지 풀면 옅은 배경 상자(≥220)에 다가가 위험하다.
const INK_LOOSE_ADD = 20
const INK_LOOSE_MAX = 185
// 유채색 판정 — 검정 본문과 색 강조(문제 번호)를 가른다.
//
// 두 단계다: 씨앗(≥42)과 이음(≥16). 인쇄가 탁한 책은 색 번호의 픽셀 절반이
// 채도 16~42 사이라(실측 베이직쎈: "01" 글자 chroma 7~53 산포) 문턱 하나로 자르면
// 글자가 조각난다 — 조각나면 "숫자 2개 이상" 필터와 onPaper 판정까지 연쇄로 무너진다.
// 반대로 문턱만 낮추면 검정 본문 가장자리의 JPEG 색번짐이 넘어온다. 그래서 약한 색으로
// 덩어리를 잇되, 진한 씨앗을 품은 덩어리만 유채색으로 인정한다(detect.ts).
// 검정 본문 자체는 안전하다 — 실측 두 책 모두 chroma 0~2.
const CHROMA_SEED = 42
const CHROMA_JOIN = 16
const CHROMA_LUMA_MAX = 205

export type Masks = {
  ink: Uint8Array
  /** 마커(선지 링) 전용 — ink ⊂ inkLoose. 가는 링이 끊기지 않게 문턱을 조금 올렸다 */
  inkLoose: Uint8Array
  /** 약한 색 — 덩어리를 잇는 용도. 이 마스크의 연결요소는 seed 검증을 거쳐야 한다 */
  color: Uint8Array
  /** 진한 색 씨앗 — color ⊃ seed */
  colorSeed: Uint8Array
  threshold: number
}

/**
 * 잉크 마스크와 유채색 마스크.
 *
 * 잉크 문턱은 고정하지 않고 Otsu로 매 페이지 정한다. 스캐너 밝기도, 렌더러의
 * 축소 필터도 페이지마다 회색조를 바꾸는데, 문턱이 조금만 높아도 마커의 가는 링이
 * 끊겨 "구멍"이 사라진다 — 그러면 선지를 통째로 놓친다.
 *
 * color ⊂ ink 가 아니다 — 색 글자는 밝아서 잉크 문턱을 못 넘기도 한다.
 * 두 마스크를 따로 두고 각각 연결요소를 뽑는다.
 */
export function masks(r: Raster): Masks {
  const n = r.width * r.height
  const d = r.rgba
  const luma = new Uint8Array(n)
  const hist = new Uint32Array(256)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const v = (d[o] * 0.299 + d[o + 1] * 0.587 + d[o + 2] * 0.114) | 0
    luma[i] = v
    hist[v]++
  }

  const threshold = Math.min(INK_MAX_T, Math.max(INK_MIN_T, otsu(hist, n)))

  const loose = Math.min(INK_LOOSE_MAX, threshold + INK_LOOSE_ADD)
  const ink = new Uint8Array(n)
  const inkLoose = new Uint8Array(n)
  const color = new Uint8Array(n)
  const colorSeed = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (luma[i] < threshold) ink[i] = 1
    if (luma[i] < loose) inkLoose[i] = 1
    const o = i * 4
    const chroma =
      Math.max(d[o], d[o + 1], d[o + 2]) - Math.min(d[o], d[o + 1], d[o + 2])
    if (luma[i] < CHROMA_LUMA_MAX) {
      if (chroma >= CHROMA_JOIN) color[i] = 1
      if (chroma >= CHROMA_SEED) colorSeed[i] = 1
    }
  }
  return { ink, inkLoose, color, colorSeed, threshold }
}

/** 클래스 간 분산이 최대가 되는 문턱 (Otsu 1979) */
function otsu(hist: Uint32Array, total: number): number {
  let sum = 0
  for (let v = 0; v < 256; v++) sum += v * hist[v]

  let sumB = 0
  let wB = 0
  let best = 0
  let bestVar = -1
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > bestVar) {
      bestVar = between
      best = t
    }
  }
  return best
}

/** 8-이웃 연결요소. 반복 스택(재귀 아님) — 한 덩어리가 수십만 픽셀일 수 있다 */
export function components(mask: Uint8Array, w: number, h: number, minPx = 1): Comp[] {
  const n = w * h
  const seen = new Uint8Array(n)
  const stack = new Int32Array(n)
  const out: Comp[] = []

  for (let start = 0; start < n; start++) {
    if (!mask[start] || seen[start]) continue
    let sp = 0
    stack[sp++] = start
    seen[start] = 1
    let px = 0
    let x0 = w
    let y0 = h
    let x1 = -1
    let y1 = -1

    while (sp > 0) {
      const p = stack[--sp]
      const x = p % w
      const y = (p / w) | 0
      px++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= w) continue
          const q = ny * w + nx
          if (mask[q] && !seen[q]) {
            seen[q] = 1
            stack[sp++] = q
          }
        }
      }
    }
    if (px >= minPx) out.push({ x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, px })
  }
  return out
}

/**
 * 덩어리 안에 갇힌 빈 픽셀 수.
 *
 * 선지 마커 ①~⑤는 "테두리 원 + 그 안의 숫자"인데, 인쇄물에서 둘은 붙어 있지 않다.
 * 그래서 마커는 채움률이 낮고(0.1 언저리) 내부에 큰 구멍이 있는 덩어리로 나타난다.
 * 한글 ㅇ·ㅁ·ㅂ의 고리도 구멍이 있지만 훨씬 작고 채움률이 높다.
 *
 * close=true면 3×3 닫기(팽창→침식)를 하고 잰다. 저해상도 스캔은 링이 1~2px 끊겨
 * 구멍 판정이 새는데(실측 베이직쎈 p11 ②: 크기·채움은 완벽한데 hole=0), 닫기가
 * 그 틈만 메운다 — 링 두께는 침식이 되돌리므로 구멍 넓이는 거의 변하지 않는다.
 */
export function holeArea(c: Comp, mask: Uint8Array, w: number, close = false): number {
  // 지역 격자에 2px 여백 — 팽창해도 경계에 닿지 않고, 플러드가 항상 바깥에서 시작한다
  const M = 2
  const bw = c.w + M * 2
  const bh = c.h + M * 2
  let grid = new Uint8Array(bw * bh)
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      grid[(y + M) * bw + (x + M)] = mask[(c.y0 + y) * w + (c.x0 + x)]
    }
  }

  if (close) {
    const dilated = new Uint8Array(bw * bh)
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        if (!grid[y * bw + x]) continue
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = y + dy
            const nx = x + dx
            if (ny >= 0 && ny < bh && nx >= 0 && nx < bw) dilated[ny * bw + nx] = 1
          }
        }
      }
    }
    const closed = new Uint8Array(bw * bh)
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        let keep = 1
        for (let dy = -1; dy <= 1 && keep; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = y + dy
            const nx = x + dx
            if (ny < 0 || ny >= bh || nx < 0 || nx >= bw || !dilated[ny * bw + nx]) {
              keep = 0
              break
            }
          }
        }
        closed[y * bw + x] = keep
      }
    }
    grid = closed
  }

  const vis = new Uint8Array(bw * bh)
  const stack: number[] = [0]
  vis[0] = 1
  while (stack.length) {
    const i = stack.pop()!
    const x = i % bw
    const y = (i / bw) | 0
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || nx >= bw || ny < 0 || ny >= bh) continue
      const j = ny * bw + nx
      if (!vis[j] && !grid[j]) {
        vis[j] = 1
        stack.push(j)
      }
    }
  }

  let hole = 0
  for (let i = 0; i < bw * bh; i++) if (!vis[i] && !grid[i]) hole++
  return hole
}

// ---------- 배경색 ----------
//
// 문제집은 "여기는 문제가 아니다"를 배경색으로 말한다 — 개념 정리 상자, 유형 머리띠,
// 단원 표제는 옅게 깔린 색 위에 있고, 문제 번호와 선지는 흰 종이 위에 있다.
// 그래서 덩어리 주변 배경이 종이색인지 보는 것만으로 그 둘이 갈린다.
//
// 절대 흰색과 비교하지 않는다. 스캔은 종이가 누렇게 뜨기도 해서, 기준은 언제나
// 그 페이지의 종이색이어야 한다.

export type Tone = { luma: number; chroma: number }

/** 페이지의 종이색 — 밝은 픽셀의 최빈값 */
export function paperTone(r: Raster): Tone {
  const lumaHist = new Uint32Array(256)
  const chromaHist = new Uint32Array(256)
  const d = r.rgba
  const n = r.width * r.height
  // 4픽셀마다 훑어도 최빈값은 흔들리지 않는다
  for (let i = 0; i < n; i += 4) {
    const o = i * 4
    const R = d[o]
    const G = d[o + 1]
    const B = d[o + 2]
    const luma = (R * 0.299 + G * 0.587 + B * 0.114) | 0
    if (luma < 170) continue                   // 글자·도판은 종이가 아니다
    lumaHist[luma]++
    chromaHist[Math.max(R, G, B) - Math.min(R, G, B)]++
  }
  return { luma: mode(lumaHist, 255), chroma: mode(chromaHist, 0) }
}

/** 덩어리를 둘러싼 띠의 배경색 (중앙값) — 글자 획에 오염되지 않게 중앙값을 쓴다 */
export function localTone(r: Raster, c: Comp): Tone {
  const pad = Math.max(4, Math.round(c.h * 0.5))
  const lumaHist = new Uint32Array(256)
  const chromaHist = new Uint32Array(256)
  let count = 0
  const d = r.rgba
  for (let y = c.y0 - pad; y <= c.y1 + pad; y++) {
    if (y < 0 || y >= r.height) continue
    for (let x = c.x0 - pad; x <= c.x1 + pad; x++) {
      if (x < 0 || x >= r.width) continue
      if (x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1) continue
      const o = (y * r.width + x) * 4
      const R = d[o]
      const G = d[o + 1]
      const B = d[o + 2]
      lumaHist[(R * 0.299 + G * 0.587 + B * 0.114) | 0]++
      chromaHist[Math.max(R, G, B) - Math.min(R, G, B)]++
      count++
    }
  }
  if (count === 0) return { luma: 255, chroma: 0 }
  return { luma: medianOf(lumaHist, count), chroma: medianOf(chromaHist, count) }
}

function mode(hist: Uint32Array, fallback: number): number {
  let best = fallback
  let bestN = 0
  for (let v = 0; v < 256; v++) {
    if (hist[v] > bestN) {
      bestN = hist[v]
      best = v
    }
  }
  return best
}

function medianOf(hist: Uint32Array, count: number): number {
  let seen = 0
  for (let v = 0; v < 256; v++) {
    seen += hist[v]
    if (seen * 2 >= count) return v
  }
  return 255
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[s.length >> 1]
}
