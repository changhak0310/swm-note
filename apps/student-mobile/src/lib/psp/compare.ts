// 분할 알고리즘 비교 지표 — DOM 비의존 순수 함수
//
// 기존 segmentPage와 PSP는 산출 타입이 같은 앱 Region[]이므로
// 여기서 동일한 잣대로 잰다. 골든 라벨 없이도 계산되는 지표만 쓴다.
import type { Box, Region as AppRegion } from '../../types'

export type SegmentMetrics = {
  problems: number
  /** 객관식으로 판정된 문항 수 */
  multipleChoice: number
  /** 선지 5개를 모두 잡은 문항 수 — AC-2의 분자 */
  fullChoiceSets: number
  /** 객관식 중 5개 완비 비율 */
  choiceDetectRate: number
  /** AC-3 — 선지 판정 박스끼리 겹친 문항 수. 0이어야 한다 */
  hitboxCollisions: number
  /** INV-2 — 같은 페이지에서 문항 bbox가 겹친 쌍 수 */
  boundsOverlaps: number
  /** 문항 bbox 합집합 / 페이지 텍스트 영역. V-2의 잣대 */
  coverage: number
  /** 번호 수열에서 유실된 번호 */
  missingNumbers: number[]
  extractMs: number
  segmentMs: number
}

export type PageExtent = { page: number; box: Box }

const GRID = 256   // 합집합 면적은 래스터라이즈로 잰다 — 직사각형 union의 정확·단순한 방법

// 맞닿은 변은 겹침이 아니다(INV-2는 면적 0 기준). 좌표 변환을 거치면
// 정확히 맞물린 경계도 1e-11 수준의 잔차를 남기므로 그 아래는 0으로 본다.
const EPS = 1e-6

export function measure(
  regions: AppRegion[],
  extents: PageExtent[],
  timing: { extractMs: number; segmentMs: number },
): SegmentMetrics {
  const byPage = new Map<number, AppRegion[]>()
  for (const r of regions) {
    const arr = byPage.get(r.page) ?? []
    arr.push(r)
    byPage.set(r.page, arr)
  }

  let hitboxCollisions = 0
  let boundsOverlaps = 0
  let multipleChoice = 0
  let fullChoiceSets = 0

  for (const r of regions) {
    if (r.answerType === 'choice') {
      multipleChoice++
      if (r.choices.length >= 5) fullChoiceSets++
    }
    if (anyOverlap(r.choices.map((c) => c.box))) hitboxCollisions++
  }

  for (const list of byPage.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (overlapArea(list[i].bounds, list[j].bounds) > EPS) boundsOverlaps++
      }
    }
  }

  // 커버리지 — 페이지별 텍스트 영역 대비 문항 합집합
  let covered = 0
  let total = 0
  for (const { page, box } of extents) {
    const list = byPage.get(page) ?? []
    if (!list.length) continue
    covered += unionAreaWithin(list.map((r) => r.bounds), box)
    total += box.w * box.h
  }

  return {
    problems: regions.length,
    multipleChoice,
    fullChoiceSets,
    choiceDetectRate: multipleChoice ? fullChoiceSets / multipleChoice : 0,
    hitboxCollisions,
    boundsOverlaps,
    coverage: total > 0 ? covered / total : 0,
    missingNumbers: missingNumbers(regions),
    ...timing,
  }
}

function missingNumbers(regions: AppRegion[]): number[] {
  const nums = regions
    .map((r) => Number(r.numLabel))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
  const out: number[] = []
  for (let i = 1; i < nums.length; i++) {
    for (let m = nums[i - 1] + 1; m < nums[i]; m++) out.push(m)
  }
  return out
}

export function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

function anyOverlap(boxes: Box[]): boolean {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlapArea(boxes[i], boxes[j]) > EPS) return true
    }
  }
  return false
}

/** 직사각형 합집합 면적 (frame 안쪽만). 래스터라이즈 — 정확도보다 단순함을 택했다 */
function unionAreaWithin(boxes: Box[], frame: Box): number {
  if (!boxes.length || frame.w <= 0 || frame.h <= 0) return 0
  const cell = new Uint8Array(GRID * GRID)
  for (const b of boxes) {
    const x0 = Math.max(0, Math.floor(((b.x - frame.x) / frame.w) * GRID))
    const x1 = Math.min(GRID, Math.ceil(((b.x + b.w - frame.x) / frame.w) * GRID))
    const y0 = Math.max(0, Math.floor(((b.y - frame.y) / frame.h) * GRID))
    const y1 = Math.min(GRID, Math.ceil(((b.y + b.h - frame.y) / frame.h) * GRID))
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) cell[y * GRID + x] = 1
  }
  let on = 0
  for (let i = 0; i < cell.length; i++) on += cell[i]
  return (on / cell.length) * frame.w * frame.h
}

// ---------- 두 결과의 차이 ----------

export type Match = {
  page: number
  numLabel: string
  iou: number
  /** 한쪽에만 있으면 그 쪽 */
  onlyIn: 'old' | 'new' | null
}

export type Divergence = {
  matches: Match[]
  meanIou: number
  /** IoU 0.9 미만 — 경계가 눈에 띄게 다른 문항 */
  disagreeing: Match[]
  onlyOld: Match[]
  onlyNew: Match[]
}

/** 같은 페이지·같은 번호끼리 짝지어 IoU를 낸다 */
export function diff(oldRegions: AppRegion[], newRegions: AppRegion[]): Divergence {
  const key = (r: AppRegion) => `${r.page}:${r.numLabel}`
  const a = new Map(oldRegions.map((r) => [key(r), r]))
  const b = new Map(newRegions.map((r) => [key(r), r]))

  const matches: Match[] = []
  for (const [k, ra] of a) {
    const rb = b.get(k)
    const [page, numLabel] = splitKey(k)
    if (!rb) {
      matches.push({ page, numLabel, iou: 0, onlyIn: 'old' })
      continue
    }
    matches.push({ page, numLabel, iou: boxIou(ra.bounds, rb.bounds), onlyIn: null })
  }
  for (const [k] of b) {
    if (a.has(k)) continue
    const [page, numLabel] = splitKey(k)
    matches.push({ page, numLabel, iou: 0, onlyIn: 'new' })
  }

  matches.sort((x, y) => x.page - y.page || Number(x.numLabel) - Number(y.numLabel))
  const paired = matches.filter((m) => m.onlyIn === null)

  return {
    matches,
    meanIou: paired.length ? paired.reduce((s, m) => s + m.iou, 0) / paired.length : 0,
    disagreeing: paired.filter((m) => m.iou < 0.9),
    onlyOld: matches.filter((m) => m.onlyIn === 'old'),
    onlyNew: matches.filter((m) => m.onlyIn === 'new'),
  }
}

function splitKey(k: string): [number, string] {
  const i = k.indexOf(':')
  return [Number(k.slice(0, i)), k.slice(i + 1)]
}

export function boxIou(a: Box, b: Box): number {
  const inter = overlapArea(a, b)
  const union = a.w * a.h + b.w * b.h - inter
  return union > 0 ? inter / union : 0
}
