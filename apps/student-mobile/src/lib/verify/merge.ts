// 3단 검증 — 서로 다른 신호로 뽑은 구역을 합친다.
//
// 한 신호에 전부를 걸면 그 신호가 죽는 순간 문항을 통째로 잃는다. 실측으로 확인한
// 실패가 전부 그랬다: 꼬리말이 안 걸러져서, 단 구분선이 없어서, 링이 1px 끊겨서,
// CJK 폰트가 로드 안 돼서. 그래서 세 신호를 따로 뽑아 합친다.
//
//   1단 텍스트 — 조판 좌표를 그대로 읽는다. 쓸 수 있으면 가장 정확하다.
//   2단 위치 검증 — 선지 박스에 그 번호의 원문자가 실제로 있는지 확인한다.
//                  텍스트가 성하면 토큰 위치로, 아니면 크롭 OCR로.
//   3단 픽셀 — 렌더한 그림에서 ①~⑤ 링을 찾는다. 텍스트와 완전히 독립이다.
//
// 이 파일은 순수 함수다 — pdf.js도 DOM도 모른다.
import type { Box, Region } from '../../types'

/** 이 구역이 어느 신호에서 왔는가 — 진단·표시용 */
export type RegionSource = 'text' | 'pixel' | 'both'

export type MergedRegion = { region: Region; source: RegionSource }

/** 두 선지 박스가 같은 자리를 가리키는가 — 한쪽 중심이 다른 쪽 안에 들어오면 같다 */
function sameSpot(a: Box, b: Box): boolean {
  const cx = a.x + a.w / 2
  const cy = a.y + a.h / 2
  return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h
}

/**
 * 두 구역이 같은 문항인가.
 *
 * 경계(bounds)로 견주지 않는다 — 텍스트 경로는 문항 전체를, 픽셀 경로는 선지 뭉치
 * 언저리를 잡아서 경계 크기가 크게 다르다. 선지가 몇 개나 같은 자리를 가리키는지로 본다.
 */
function sameProblem(a: Region, b: Region): boolean {
  if (a.page !== b.page) return false
  let hit = 0
  for (const ca of a.choices) {
    if (b.choices.some((cb) => sameSpot(ca.box, cb.box) || sameSpot(cb.box, ca.box))) hit++
  }
  return hit >= 2
}

/**
 * 텍스트 경로 결과와 픽셀 경로 결과를 합친다.
 *
 * - 둘 다 찾은 문항: 선지를 더 많이 가진 쪽의 좌표를 쓴다. 같으면 텍스트 —
 *   조판 좌표가 픽셀 검출보다 정확하다.
 * - 텍스트만 찾은 문항: 그대로 둔다.
 * - 픽셀만 찾은 문항: 채택한다. 텍스트 경로가 놓친 것을 여기서 되찾는다 —
 *   단 판정이 무너졌거나 번호를 못 읽은 쪽이 여기 해당한다.
 *
 * 픽셀 쪽 문항이 이미 채택한 문항과 자리가 겹치면 버린다(같은 문항의 중복 검출).
 */
export function mergeRegions(text: Region[], pixel: Region[]): MergedRegion[] {
  const out: MergedRegion[] = []
  const usedPixel = new Set<Region>()

  for (const t of text) {
    const p = pixel.find((x) => !usedPixel.has(x) && sameProblem(t, x))
    if (!p) {
      out.push({ region: t, source: 'text' })
      continue
    }
    usedPixel.add(p)
    // 선지를 더 많이 확보한 쪽이 이긴다. 번호는 텍스트 쪽이 값까지 알고 있으므로 살린다
    const better = p.choices.length > t.choices.length ? { ...p, id: t.id, numLabel: t.numLabel ?? p.numLabel, numBox: t.numBox ?? p.numBox } : t
    out.push({ region: better, source: 'both' })
  }

  for (const p of pixel) {
    if (usedPixel.has(p)) continue
    if (out.some((o) => o.region.page === p.page && overlaps(o.region.bounds, p.bounds, 0.5))) continue
    out.push({ region: p, source: 'pixel' })
  }

  return out.sort(
    (a, b) => a.region.page - b.region.page || a.region.bounds.y - b.region.bounds.y,
  )
}

/** 두 상자가 작은 쪽 면적의 ratio 이상 겹치는가 */
function overlaps(a: Box, b: Box, ratio: number): boolean {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  if (w <= 0 || h <= 0) return false
  return w * h >= Math.min(a.w * a.h, b.w * b.h) * ratio
}

// ---------- 2단: 위치 검증 ----------

/** 인쇄된 선지 기호 하나 — 텍스트 토큰이든 OCR 결과든 이 모양으로 넘긴다 */
export type PrintedMark = { label: number; box: Box }

export type VerifyReport = {
  /** 박스 안에 그 번호의 기호가 있는 선지 수 */
  confirmed: number
  /** 기호를 못 찾은 선지 수 */
  unconfirmed: number
  /** 자리가 어긋나 기호 위치로 고친 선지 수 */
  corrected: number
}

/**
 * 선지 박스가 인쇄된 기호 자리에 붙었는지 확인하고, 어긋났으면 고친다.
 *
 * 되읽기 검사(박스에서 만든 획을 그 박스로 되읽기)는 자기일관이라 이걸 못 잡는다 —
 * 실측으로 꼬리말의 "(1) … (2) …"가 선지로 잡힌 적이 있는데 그때도 되읽기는 100%였다.
 * 인쇄물과 묶어 주는 것이 이 단계다.
 *
 * @param marks 그 페이지에 인쇄된 기호들 (텍스트 토큰 또는 OCR 결과)
 */
export function verifyChoices(region: Region, marks: PrintedMark[]): {
  region: Region
  report: VerifyReport
} {
  if (region.choices.length === 0) {
    return { region, report: { confirmed: 0, unconfirmed: 0, corrected: 0 } }
  }

  let confirmed = 0
  let unconfirmed = 0
  let corrected = 0

  const choices = region.choices.map((c) => {
    const inside = marks.find((m) => m.label === c.label && sameSpot(m.box, c.box))
    if (inside) {
      confirmed++
      return c
    }
    // 박스 밖이지만 문항 경계 안에 그 번호의 기호가 있으면 자리를 잘못 잡은 것이다
    const near = marks.find(
      (m) => m.label === c.label && sameSpot(m.box, region.bounds),
    )
    if (near) {
      corrected++
      // 기호를 감싸도록 박스를 옮긴다. 폭·높이는 원래 값을 유지해 이웃과의 관계를 지킨다
      return { ...c, box: { ...c.box, x: near.box.x, y: near.box.y + near.box.h / 2 - c.box.h / 2 } }
    }
    unconfirmed++
    return c
  })

  return { region: { ...region, choices }, report: { confirmed, unconfirmed, corrected } }
}
