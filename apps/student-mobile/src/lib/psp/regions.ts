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

export type Marker = { ordinal: number; family: string; bbox: BBox; line: Line }

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
export function findMarkers(lines: Line[]): Marker[] {
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
/** 본문에서 이만큼(라인 높이 배수) 떨어져 홀로 놓인 꼬리 줄은 이 문제의 것이 아니다 */
const STRAY_GAP = 3

/**
 * C-1 — 선지로 인정할 최소 개수. 스캔 경로의 `MIN_CHOICES`와 같은 값, 같은 이유다.
 *
 * 예전에는 2였는데, 그러면 **소문항 번호와 설명 단계 표시가 선지가 된다** — `⑴⑵`로 갈라
 * 묻는 서술형 문항과 "㈎∼㈑에 알맞은 것을 써넣어라" 꼴이 전부 객관식으로 잡혔다.
 * 실측 "수학의 신 문제.pdf": 어긋난 선지 박스가 전부 `① ②` 두 개짜리였고,
 * 선지 개수 분포는 **2개 12문항 · 3개 1 · 4개 1 · 5개 78**이었다. 앞의 13이 오검출이다.
 *
 * 진짜 2~3지선다를 잃을 위험은 실측상 없다 — hi_math 106문항, 수능 33문항이 **전부**
 * 5지선다이고, 규칙 문서 §4.3.3의 스캔 실측도 같은 말을 한다("3지선다는 없다").
 * 그래도 이것은 **전제**이지 사실이 아니다 (B-3). 3지선다를 쓰는 책이 코퍼스에 들어오면
 * 개수 하한이 아니라 정렬·간격 균일 증거로 갈라야 한다.
 */
const CHOICE_MIN = 4
/** 밴드를 건너뛰고 "맨 아래 뭉치"를 쓸 때 요구하는 최소 선지 수 — C-1과 같은 값이다 */
const RETRY_MIN = CHOICE_MIN

/**
 * 문제 끝에 딸려 온 장식 줄을 텍스트 범위에서 뺀다.
 *
 * 다음 문제의 배지("동영상 집중공략 1")가 앵커 바로 위에 놓이면 앞 문제 슬라이스의
 * 마지막 줄로 들어온다. 그러면 텍스트 범위가 그만큼 늘어나 C-3 밴드가 아래로 밀리고,
 * 진짜 선지가 상단 40%로 밀려 통째로 탈락한다 — 실측 hi_math p17 13번: 선지는
 * y 0.477~0.498인데 배지(0.645) 때문에 밴드가 0.493에서 시작해 ①②③을 잃었고,
 * 남은 ④⑤는 1부터 시작하지 않아(C-2) 문항 전체가 주관식이 됐다. p15 3·4번,
 * p16 10번, p18 20번도 같은 원인이었다.
 *
 * 무엇을 빼도 되는지는 마커가 가른다: 본문과 멀리 떨어져 있고 주 계열 마커가 없는
 * 꼬리 줄만 뺀다. 그래서 그림 아래에 떨어져 놓인 선지 줄은 절대 잘리지 않는다.
 */
function withoutTrailingStrays(lines: Line[], markers: Marker[], lh: number): Line[] {
  if (lines.length < 2) return lines
  const family = dominantFamily(markers)
  const markerLines = new Set(markers.filter((m) => m.family === family).map((m) => m.line))

  const sorted = [...lines].sort((a, b) => a.bbox[1] - b.bbox[1])
  let end = sorted.length
  while (end > 1) {
    const last = sorted[end - 1]
    if (markerLines.has(last)) break
    const prevBottom = Math.max(...sorted.slice(0, end - 1).map((l) => l.bbox[3]))
    if (last.bbox[1] - prevBottom <= lh * STRAY_GAP) break
    end--
  }
  return sorted.slice(0, end)
}

/**
 * 마커 무리에서 선지가 될 수 있는 것만 남긴다 — C-1(`CHOICE_MIN` 이상)·C-2(1부터 연속).
 * 계열이 섞이면 가장 많이 쓰인 계열만 본다. 같은 번호가 두 번 나오면 위쪽 것을 쓴다.
 */
function runFrom(markers: Marker[]): Marker[] {
  if (markers.length < CHOICE_MIN) return []
  const family = dominantFamily(markers)
  let picked = markers.filter((m) => m.family === family)

  picked.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0])
  const seen = new Set<number>()
  picked = picked.filter((m) => (seen.has(m.ordinal) ? false : (seen.add(m.ordinal), true)))

  picked.sort((a, b) => a.ordinal - b.ordinal)
  let n = 0
  while (n < picked.length && picked[n].ordinal === n + 1) n++
  return n >= CHOICE_MIN ? picked.slice(0, n) : []
}

/**
 * 맨 아래에서 위로 올라가며 번호가 1씩 줄어드는 뭉치 — "문항의 마지막 마커 무리".
 * 발문 속 <보기>는 그 위에 따로 있으므로 여기 섞이지 않는다.
 */
function bottomRun(markers: Marker[]): Marker[] {
  const family = dominantFamily(markers)
  const ms = markers
    .filter((m) => m.family === family)
    .sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0])

  const run: Marker[] = []
  let want = -1
  for (let i = ms.length - 1; i >= 0; i--) {
    if (want < 0) {
      if (ms[i].ordinal < 2) break          // 맨 끝이 ①이면 뭉치가 아니다
      want = ms[i].ordinal
    }
    if (ms[i].ordinal !== want) break
    run.unshift(ms[i])
    if (--want === 0) break
  }
  return run.length && run[0].ordinal === 1 ? run : []
}

export function dominantFamily(markers: Marker[]): string | null {
  const count = new Map<string, number>()
  for (const m of markers) count.set(m.family, (count.get(m.family) ?? 0) + 1)
  let best: string | null = null
  let bestN = 0
  for (const [f, n] of count) if (n > bestN) ((bestN = n), (best = f))
  return best
}
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
export function buildRegions(
  slice: Slice,
  problemId: string,
  /** 이 문서가 선지에 쓰는 계열 (`markerGroups.ts`의 `dominantChoiceFamily`).
   *  null이면 문항 안 다수결로 정한다 — 예전 동작 그대로. */
  choiceFamily: string | null = null,
): RegionResult {
  const { bbox, column, lineHeight: lh } = slice
  const flags: Flag[] = []
  const colW = bboxW(column.bbox)
  const colRight = column.bbox[2]

  const lines = column.lines.filter((l) => lineOverlapsProblem(l, bbox))
  const ocrText = lines.map((l) => l.text).join('\n')

  // ---------- (1) CHOICE_ITEM — 최우선 ----------
  const choice = detectChoiceItems(lines, bbox, lh, colW, colRight, choiceFamily)
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
  choiceFamily: string | null,
): { items: ChoiceItem[]; mixedLayout: boolean; markersSeen: number } {
  // 문서가 쓰는 계열이 정해졌으면 그것만 본다. 다른 계열은 이 책에서 선지가 아니므로
  // markersSeen에도 넣지 않는다 — 넣으면 소문항이 있는 문항마다 V-6이 헛되이 붙는다
  const all = choiceFamily
    ? findMarkers(lines).filter((m) => m.family === choiceFamily)
    : findMarkers(lines)
  const markersSeen = all.length
  if (all.length === 0) return { items: [], mixedLayout: false, markersSeen }

  // C-3 — 하단 60% 이내. 발문 속 <보기> 상자의 ㉠㉡㉢을 배제하는 규칙이다.
  //
  // 기준은 문제 bbox가 아니라 문제의 실제 텍스트 범위다. 컬럼 마지막 문제는
  // bbox가 남은 여백까지 통째로 늘어나므로, bbox로 재면 선지가 상단 40%로 밀려
  // 통째로 탈락한다. 텍스트 범위로 재면 두 경우가 같아진다.
  const body = withoutTrailingStrays(lines, all, lh)
  const textTop = Math.min(...body.map((l) => l.bbox[1]))
  const textBottom = Math.max(...body.map((l) => l.bbox[3]))
  const extentTop = Number.isFinite(textTop) ? textTop : problem[1]
  const extentBottom = Number.isFinite(textBottom) ? textBottom : problem[3]
  const bandTop = extentTop + (extentBottom - extentTop) * CHOICE_BAND
  let markers = runFrom(all.filter((m) => (m.bbox[1] + m.bbox[3]) / 2 >= bandTop))

  // 밴드가 진짜 선지를 자를 때가 있다.
  //
  // 발문이 두어 줄뿐이고 선지가 세로로 늘어선 문항은 선지가 문항 높이의 대부분을
  // 차지해서, 첫 선지가 상단 40%에 걸린다 — 실측 hi_math p15 3번: ①의 중심이
  // 0.707인데 밴드가 0.712에서 시작해 ①만 잘렸고, 남은 ②~⑤는 1부터 시작하지
  // 않아(C-2) 문항 전체가 주관식이 됐다. 밴드를 낮추면 이번엔 <보기> 상자가 새어
  // 들어오므로, 밴드가 실패했을 때만 "맨 아래 연속 뭉치"로 되짚는다. 5지선다는
  // 거의 다 채워져 오고 <보기> 낱개는 셋 이하라, 넷 이상을 요구하면 둘이 갈린다.
  if (markers.length < 2) {
    const tail = bottomRun(all)
    if (tail.length >= RETRY_MIN) markers = tail
  }
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

  const slot = choiceSlot(rows, colW)
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
      // ★ 마지막 선지만 문제 바닥까지 늘리면 안 된다. 문항 아래 빈 곳은 학생이 풀이를
      //   쓰는 자리인데, 거기 그은 획이 전부 ⑤ 선택으로 읽힌다 — 실측 hi_math p24 24번의
      //   ⑤는 163px로 다른 선지(21px)의 여덟 배였고, 전 문항 최대는 301px이었다.
      //   앞 행들과 같은 줄 간격만큼만 내린다. 그러면 다섯 선지의 높이가 고르게 된다.
      y1 = rows[ri + 1] ? rows[ri + 1][0].line.bbox[1] : Math.min(lineBottom + rowPitch(rows, lh), problem[3])
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
      // ★ 줄 끝 선지는 앞 선지들과 같은 칸 폭을 물려받는다.
      //
      //   컬럼 우단까지 늘리면 그 선지만 이웃의 두 배가 되고(실측 hi_math: ⑤ 199px vs
      //   ④ 91px) 오른쪽 빈 곳에 쓴 풀이가 ⑤ 선택으로 읽힌다. 그렇다고 글자 끝에
      //   딱 맞추면 이번엔 혼자 좁아진다(31px) — 앞 선지들의 폭에는 다음 선지까지의
      //   여백이 들어 있기 때문이다. 답 텍스트가 칸보다 길면 글자 끝을 따른다.
      const textRight = Math.max(...row.map((m) => m.line.bbox[2])) + lead
      const x1 = vertical
        ? colRight
        : row[k + 1]
          ? row[k + 1].bbox[0] - lead
          : Math.min(colRight, Math.max(x0 + slot, textRight))
      items.push({ ordinal: row[k].ordinal, bbox: [x0, y0, x1, y1] })
    }
  }

  items.sort((a, b) => a.ordinal - b.ordinal)
  return { items, mixedLayout, markersSeen }
}

/**
 * 가로 배치에서 선지 한 칸의 폭 — 이웃한 마커 사이 간격의 중앙값.
 * 줄 끝 선지는 오른쪽에 다음 마커가 없어 잣대가 없으므로 이 값을 물려받는다.
 */
function choiceSlot(rows: Marker[][], colW: number): number {
  const gaps: number[] = []
  for (const row of rows) {
    for (let k = 0; k + 1 < row.length; k++) gaps.push(row[k + 1].bbox[0] - row[k].bbox[0])
  }
  if (gaps.length === 0) return colW
  gaps.sort((a, b) => a - b)
  return gaps[gaps.length >> 1]
}

/**
 * 세로 배치에서 한 선지 줄이 차지하는 아래 여백 — 앞 행들의 줄 간격 중앙값.
 * 마지막 선지도 이만큼만 내려 앞 선지들과 높이를 맞춘다.
 */
function rowPitch(rows: Marker[][], lh: number): number {
  const gaps: number[] = []
  for (let i = 0; i + 1 < rows.length; i++) {
    gaps.push(rows[i + 1][0].line.bbox[1] - rows[i][0].line.bbox[3])
  }
  if (gaps.length === 0) return lh * ROW_PAD
  gaps.sort((a, b) => a - b)
  return Math.max(0, gaps[gaps.length >> 1])
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
