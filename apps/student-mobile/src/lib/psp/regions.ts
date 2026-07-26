// [REGION] — §4.5, §5.3 RULE-REGION + RULE-HITBOX
//
// L2가 이 명세의 핵심 차별점이다 (§1.2). 선택지 ①~⑤의 좌표가 확정되어야
// "학생이 어느 선택지에 동그라미를 쳤는가"를 서버·AI 없이 기하 판정으로 계산할 수 있다.
import type { Line } from './lines'
import type { Slice } from './slice'
import {
  bboxArea,
  bboxH,
  bboxW,
  intersectArea,
  toRelBBox,
  unionBBox,
  type BBox,
  type Flag,
  type ProblemType,
  type Region,
  type Span,
} from './types'

// ---------- 선지 마커 (§5.3-1) ----------

const FAMILIES: { name: string; chars: string }[] = [
  { name: 'circled-digit', chars: '①②③④⑤⑥⑦⑧⑨⑩' },   // U+2460~
  { name: 'circled-hangul', chars: '㉠㉡㉢㉣㉤㉥' },        // U+3260~
  { name: 'paren-digit', chars: '⑴⑵⑶⑷⑸⑹' },            // U+2474~
]
const ASCII_PAREN = /^\((\d)\)/

type Marker = { ordinal: number; family: string; bbox: BBox; line: Line }

function markerAt(text: string): { ordinal: number; family: string } | null {
  const t = text.trim()
  if (!t) return null
  for (const f of FAMILIES) {
    const i = f.chars.indexOf(t.charAt(0))
    if (i >= 0) return { ordinal: i + 1, family: f.name }
  }
  const m = ASCII_PAREN.exec(t)
  if (m) return { ordinal: Number(m[1]), family: 'ascii-paren' }
  return null
}

/**
 * 문제 내부 라인에서 선지 마커를 수집한다.
 * "(1)"이 "(", "1", ")" 세 조각으로 쪼개져 오는 경우가 있어 인접 span 결합도 시도한다.
 */
function findMarkers(lines: Line[]): Marker[] {
  const out: Marker[] = []
  for (const line of lines) {
    for (let i = 0; i < line.spans.length; i++) {
      const s = line.spans[i]
      let hit = markerAt(s.text)
      let bbox = s.bbox
      if (!hit && s.text.trim() === '(') {
        const joined = s.text + (line.spans[i + 1]?.text ?? '') + (line.spans[i + 2]?.text ?? '')
        hit = markerAt(joined)
        if (hit) bbox = unionBBox([s.bbox, line.spans[i + 1]!.bbox, line.spans[i + 2]!.bbox])
      }
      if (hit) out.push({ ...hit, bbox, line })
    }
  }
  return out
}

const CHOICE_BAND = 0.4        // C-3 문제 bbox 하단 60% → 상단 40% 배제
const ROW_TOL = 0.5            // 가로 배치 판정 — y 중앙값 차이 < 라인높이 × 0.5
const MARKER_LEAD = 0.02       // 마커 x0 − 컬럼폭의 2%
const ROW_PAD = 0.4            // 가로 배치 y 여유 — 라인높이 × 0.4
const HITBOX_MAX = 0.08        // RULE-HITBOX 최대 확장률 8%
const HITBOX_STEP = 0.01       // 1%씩 축소
const FIGURE_MIN_AREA = 0.03   // 문제 면적의 3%
const WORK_MIN_LINES = 2       // 라인높이 × 2 이상
const EPS = 1e-9

const DESCRIPTIVE = /설명하시오|서술|보이시오|증명/

export type RegionResult = {
  regions: Region[]
  problemType: ProblemType
  flags: Flag[]
  ocrText: string
  /** C-1~C-3 통과 전 원시 마커 수. V-6("객관식인데 선지 부족") 판정에 쓴다 */
  markersSeen: number
}

/**
 * 문제 bbox 내부를 구역으로 나눈다.
 * 처리 순서는 CHOICE_ITEM → FIGURE → STEM → WORK_AREA이고,
 * 위에서 확정된 영역은 아래 규칙에서 제외한다 (§5.3).
 */
export function buildRegions(slice: Slice, problemId: string): RegionResult {
  const { bbox, column, lineHeight: lh } = slice
  const flags: Flag[] = []
  const colW = bboxW(column.bbox)
  const colRight = column.bbox[2]

  const lines = column.lines.filter((l) => lineOverlapsProblem(l, bbox))
  const ocrText = lines.map((l) => l.text).join('\n')

  // ---------- (1) CHOICE_ITEM — 최우선 ----------
  const choice = detectChoiceItems(lines, bbox, lh, colW, colRight)
  if (choice.mixedLayout) flags.push('FLAG_CHOICE_LAYOUT_MIXED')

  // INV-4 — 모든 Region bbox ⊆ 소속 Problem bbox.
  // 마커 좌측 2% 여유가 컬럼 좌단을 넘거나 세로 배치 마지막 선지가 문제 하단을
  // 넘어설 수 있어 여기서 한 번에 잘라낸다. 잘라도 맞물림(면적 0)은 깨지지 않는다.
  for (const item of choice.items) item.bbox = clampTo(item.bbox, bbox)

  const pageRegions: { kind: Region['kind']; bbox: BBox; ordinal: number | null; hitbox?: BBox }[] =
    []

  for (const item of choice.items) {
    pageRegions.push({ kind: 'CHOICE_ITEM', bbox: item.bbox, ordinal: item.ordinal })
  }
  if (choice.items.length >= 2) {
    pageRegions.push({
      kind: 'CHOICES',
      bbox: unionBBox(choice.items.map((c) => c.bbox)),
      ordinal: null,
    })
  }

  // RULE-HITBOX — 겹침 0은 타협 불가 조건이다 (§5.3 주석)
  const hitboxes = computeHitboxes(choice.items.map((c) => c.bbox))
  choice.items.forEach((_, i) => {
    const r = pageRegions.find((p) => p.kind === 'CHOICE_ITEM' && p.ordinal === choice.items[i].ordinal)
    if (r) r.hitbox = clampTo(hitboxes.boxes[i], bbox)
  })
  if (hitboxes.collided) flags.push('FLAG_HITBOX_COLLISION')

  // ---------- (2) FIGURE ----------
  const occupied: BBox[] = choice.items.map((c) => c.bbox)
  const figures = detectFigures(slice, bbox, lh, occupied)
  for (const f of figures) pageRegions.push({ kind: 'FIGURE', bbox: f, ordinal: null })
  occupied.push(...figures)

  // ---------- (3) STEM ----------
  const stem = detectStem(lines, bbox, slice.anchor.bbox[1], occupied)
  if (stem) {
    pageRegions.push({ kind: 'STEM', bbox: stem, ordinal: null })
    occupied.push(stem)
  }

  // ---------- (4) WORK_AREA — 실패해도 무시한다 (§5.3-4 주석) ----------
  for (const w of detectWorkAreas(bbox, occupied, lh)) {
    pageRegions.push({ kind: 'WORK_AREA', bbox: w, ordinal: null })
  }

  // ---------- (5) 유형 판정 ----------
  const stemText = stem ? textIn(lines, stem) : ocrText
  const problemType: ProblemType =
    choice.items.length >= 2
      ? 'MULTIPLE_CHOICE'
      : DESCRIPTIVE.test(stemText)
        ? 'DESCRIPTIVE'
        : 'SHORT_ANSWER'

  // Region.bbox는 문제 bbox 기준 상대 좌표다 (§3.1)
  const regions: Region[] = pageRegions.map((r, i) => ({
    id: `${problemId}:${r.kind}:${r.ordinal ?? i}`,
    kind: r.kind,
    bbox: toRelBBox(clampTo(r.bbox, bbox), bbox),
    hitbox: r.hitbox ? toRelBBox(clampTo(r.hitbox, bbox), bbox) : undefined,
    ordinal: r.ordinal,
    confidence: 1,
  }))

  return { regions, problemType, flags, ocrText, markersSeen: choice.markersSeen }
}

// ---------- CHOICE_ITEM ----------

type ChoiceItem = { ordinal: number; bbox: BBox }

function detectChoiceItems(
  lines: Line[],
  problem: BBox,
  lh: number,
  colW: number,
  colRight: number,
): { items: ChoiceItem[]; mixedLayout: boolean; markersSeen: number } {
  const all = findMarkers(lines)
  const markersSeen = all.length
  if (all.length === 0) return { items: [], mixedLayout: false, markersSeen }

  // C-3 — 하단 60% 이내. 발문 속 <보기> 상자의 ㉠㉡㉢을 배제하는 규칙이다.
  //
  // 기준은 문제 bbox가 아니라 문제의 실제 텍스트 범위다. 컬럼 마지막 문제는
  // bbox가 남은 여백까지 통째로 늘어나므로, bbox로 재면 선지가 상단 40%로 밀려
  // 통째로 탈락한다. 텍스트 범위로 재면 두 경우가 같아진다.
  const textTop = Math.min(...lines.map((l) => l.bbox[1]))
  const textBottom = Math.max(...lines.map((l) => l.bbox[3]))
  const extentTop = Number.isFinite(textTop) ? textTop : problem[1]
  const extentBottom = Number.isFinite(textBottom) ? textBottom : problem[3]
  const bandTop = extentTop + (extentBottom - extentTop) * CHOICE_BAND
  const inBand = all.filter((m) => (m.bbox[1] + m.bbox[3]) / 2 >= bandTop)
  if (inBand.length < 2) return { items: [], mixedLayout: false, markersSeen }

  // 가장 많이 쓰인 계열만 남긴다 — 계열 혼용은 선지가 아니다
  const byFamily = new Map<string, Marker[]>()
  for (const m of inBand) {
    const arr = byFamily.get(m.family) ?? []
    arr.push(m)
    byFamily.set(m.family, arr)
  }
  let markers: Marker[] = []
  for (const arr of byFamily.values()) if (arr.length > markers.length) markers = arr

  // 같은 ordinal 중복은 위쪽 것만 (도형 속 재등장 방어)
  markers.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0])
  const seen = new Set<number>()
  markers = markers.filter((m) => (seen.has(m.ordinal) ? false : (seen.add(m.ordinal), true)))

  // C-1 최소 2개 · C-2 1부터 연속
  markers.sort((a, b) => a.ordinal - b.ordinal)
  let n = 0
  while (n < markers.length && markers[n].ordinal === n + 1) n++
  markers = markers.slice(0, n)
  if (markers.length < 2) return { items: [], mixedLayout: false, markersSeen }

  // 행 그룹핑 — 한 줄 5개 / 2줄 3+2 / 한 줄에 하나씩이 모두 여기서 갈린다
  markers.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0])
  const rows: Marker[][] = []
  for (const m of markers) {
    const row = rows[rows.length - 1]
    const sameRow = row && Math.abs(midY(m.bbox) - midY(row[0].bbox)) < lh * ROW_TOL
    if (sameRow) row.push(m)
    else rows.push([m])
  }
  for (const r of rows) r.sort((a, b) => a.bbox[0] - b.bbox[0])

  const vertical = rows.every((r) => r.length === 1) && rows.length > 1
  const horizontal = rows.length === 1

  // 부록 A의 "가로/세로 혼재"는 배치를 확정할 수 없는 경우를 말한다.
  // 3+2처럼 마지막 줄만 짧은 격자는 혼재가 아니라 표준 배치다 — 실측 문제집에서
  // 99문항 중 64문항이 3+2였다. 이걸 전부 검수로 보내면 플래그가 의미를 잃는다.
  // 중간 줄에 홀로 놓인 마커가 있을 때만 진짜 불규칙으로 본다.
  const mixedLayout =
    !vertical && !horizontal && rows.slice(0, -1).some((r) => r.length === 1)

  const items: ChoiceItem[] = []
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri]
    // 행의 세로 범위 — 마커가 속한 텍스트 라인 전체를 쓴다 (선지 본문 포함)
    const lineTop = Math.min(...row.map((m) => m.line.bbox[1]))
    const lineBottom = Math.max(...row.map((m) => m.line.bbox[3]))

    let y0: number
    let y1: number
    if (vertical) {
      // §5.3 세로 배치 — y0 = 마커 k 라인 상단, y1 = 마커 k+1 라인 상단
      y0 = lineTop
      y1 = rows[ri + 1] ? rows[ri + 1][0].line.bbox[1] : problem[3]
    } else {
      // §5.3 가로 배치 — 라인 상하로 라인높이 × 0.4 여유
      y0 = lineTop - lh * ROW_PAD
      y1 = lineBottom + lh * ROW_PAD
      // 여유가 이웃 행을 침범하면 행 사이 중점까지로 자른다.
      // 이 클램프가 없으면 3+2 배치에서 hitbox가 아무리 축소해도 겹친다.
      const prev = rows[ri - 1]
      const next = rows[ri + 1]
      if (prev) y0 = Math.max(y0, (Math.max(...prev.map((m) => m.line.bbox[3])) + lineTop) / 2)
      if (next) y1 = Math.min(y1, (lineBottom + Math.min(...next.map((m) => m.line.bbox[1]))) / 2)
    }

    const lead = colW * MARKER_LEAD
    for (let k = 0; k < row.length; k++) {
      const x0 = row[k].bbox[0] - lead
      // 마지막 선지의 우측은 컬럼 우단까지 — "⑤ 9"의 답 텍스트를 포함해야 동그라미가 잡힌다.
      //
      // ★ PRD §5.3은 x1 = "마커 k+1의 x0"라고 쓰지만, x0는 2% 당겨 잡으므로
      //   그대로 두면 인접 선지가 정확히 2%만큼 항상 겹친다. 같은 절이 "겹침 0은
      //   타협 불가"라 못박고 AC-3도 겹침 0건을 요구하므로 x1도 같은 폭만큼 당긴다.
      //   결과적으로 선지 띠가 빈틈없이 맞물린다(맞닿음 = 면적 0).
      const x1 = vertical ? colRight : row[k + 1] ? row[k + 1].bbox[0] - lead : colRight
      items.push({ ordinal: row[k].ordinal, bbox: [x0, y0, x1, y1] })
    }
  }

  items.sort((a, b) => a.ordinal - b.ordinal)
  return { items, mixedLayout, markersSeen }
}

const midY = (b: BBox) => (b[1] + b[3]) / 2

/**
 * RULE-HITBOX — 학생은 선택지에 텍스트보다 크게 동그라미를 친다.
 * 8%에서 시작해 인접 hitbox와의 겹침이 사라질 때까지 1%씩 축소한다 (최소 0%).
 * 겹침을 허용하면 자동채점이 두 선택지를 동시에 히트시킨다.
 */
export function computeHitboxes(boxes: BBox[]): { boxes: BBox[]; rate: number; collided: boolean } {
  for (let rate = HITBOX_MAX; rate > -EPS; rate -= HITBOX_STEP) {
    const r = Math.max(0, rate)
    const expanded = boxes.map((b): BBox => {
      const w = bboxW(b)
      const h = bboxH(b)
      return [b[0] - w * r, b[1] - h * r, b[2] + w * r, b[3] + h * r]
    })
    if (!hasOverlap(expanded)) return { boxes: expanded, rate: r, collided: false }
  }
  // 0%까지 줄여도 겹치면 표시용 bbox 자체가 겹친 것이다 → V-7
  return { boxes, rate: 0, collided: hasOverlap(boxes) }
}

function hasOverlap(boxes: BBox[]): boolean {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (intersectArea(boxes[i], boxes[j]) > EPS) return true
    }
  }
  return false
}

// ---------- FIGURE ----------

function detectFigures(slice: Slice, problem: BBox, lh: number, exclude: BBox[]): BBox[] {
  const inside = slice.figureSources.filter(
    (b) => bboxArea(b) > 0 && intersectArea(b, problem) > bboxArea(b) * 0.5,
  )
  if (inside.length === 0) return []

  const merged = mergeNearby(inside, lh)
  const minArea = bboxArea(problem) * FIGURE_MIN_AREA
  return merged
    .map((b): BBox => [
      Math.max(b[0], problem[0]),
      Math.max(b[1], problem[1]),
      Math.min(b[2], problem[2]),
      Math.min(b[3], problem[3]),
    ])
    .filter((b) => bboxArea(b) >= minArea)
    .filter((b) => exclude.every((e) => intersectArea(b, e) < bboxArea(b) * 0.5))
}

/** 서로 간격이 라인높이 이하인 드로잉은 하나로 병합 (§5.3-2) */
export function mergeNearby(boxes: BBox[], gap: number): BBox[] {
  const out = boxes.map((b) => [...b] as BBox)
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        if (near(out[i], out[j], gap)) {
          out[i] = unionBBox([out[i], out[j]])
          out.splice(j, 1)
          changed = true
          break outer
        }
      }
    }
  }
  return out
}

function near(a: BBox, b: BBox, gap: number): boolean {
  const dx = Math.max(0, Math.max(a[0], b[0]) - Math.min(a[2], b[2]))
  const dy = Math.max(0, Math.max(a[1], b[1]) - Math.min(a[3], b[3]))
  return dx <= gap && dy <= gap
}

// ---------- STEM ----------

/** 앵커 y0부터 시작해 CHOICE_ITEM·FIGURE에 닿기 직전까지의 연속 텍스트 블록 */
function detectStem(lines: Line[], problem: BBox, anchorY: number, exclude: BBox[]): BBox | null {
  const body = lines
    .filter((l) => l.bbox[3] > anchorY - EPS)
    .sort((a, b) => a.bbox[1] - b.bbox[1])

  const taken: BBox[] = []
  for (const l of body) {
    if (exclude.some((e) => intersectArea(l.bbox, e) > EPS)) break
    taken.push(l.bbox)
  }
  if (taken.length === 0) return null

  const u = unionBBox(taken)
  return [problem[0], Math.max(u[1], problem[1]), problem[2], Math.min(u[3], problem[3])]
}

function textIn(lines: Line[], box: BBox): string {
  return lines
    .filter((l) => intersectArea(l.bbox, box) > bboxArea(l.bbox) * 0.5)
    .map((l) => l.text)
    .join('\n')
}

// ---------- WORK_AREA ----------

/** 위 모두를 제외한 나머지 중 높이가 라인높이 × 2 이상인 빈 가로 띠 */
function detectWorkAreas(problem: BBox, occupied: BBox[], lh: number): BBox[] {
  const bands = occupied
    .map((b): [number, number] => [b[1], b[3]])
    .sort((a, b) => a[0] - b[0])

  const out: BBox[] = []
  let cursor = problem[1]
  for (const [top, bottom] of bands) {
    if (top - cursor >= lh * WORK_MIN_LINES) out.push([problem[0], cursor, problem[2], top])
    cursor = Math.max(cursor, bottom)
  }
  if (problem[3] - cursor >= lh * WORK_MIN_LINES) {
    out.push([problem[0], cursor, problem[2], problem[3]])
  }
  return out
}

// ---------- 보조 ----------

/** 문제 bbox 안으로 자른다 (INV-4) */
function clampTo(b: BBox, problem: BBox): BBox {
  return [
    Math.min(Math.max(b[0], problem[0]), problem[2]),
    Math.min(Math.max(b[1], problem[1]), problem[3]),
    Math.max(Math.min(b[2], problem[2]), problem[0]),
    Math.max(Math.min(b[3], problem[3]), problem[1]),
  ]
}

function lineOverlapsProblem(line: Line, problem: BBox): boolean {
  const cy = midY(line.bbox)
  return cy >= problem[1] && cy <= problem[3]
}

export function spansIn(spans: Span[], box: BBox): Span[] {
  return spans.filter((s) => intersectArea(s.bbox, box) > bboxArea(s.bbox) * 0.5)
}
