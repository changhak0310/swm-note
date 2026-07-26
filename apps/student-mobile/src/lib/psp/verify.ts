// [VERIFY] — §6 검증·신뢰도 + §3.2 불변 조건
//
// 전부 결정론적이다. LLM judge를 쓰지 않는다 (§6.1).
// LLM은 "몇 점"만 줄 뿐 "무엇이 틀렸는지"를 못 알려주므로 검수 UI에 연결할 수 없다.
import type { PageLayout } from './layout'
import {
  FLAG_WEIGHT,
  bboxArea,
  bboxH,
  bboxW,
  intersectArea,
  toPageBBox,
  type BBox,
  type Flag,
  type Problem,
} from './types'

const COVERAGE_MIN = 0.88      // V-2 크롭 합집합 ≥ 본문 영역의 88%
const ASPECT_RANGE: [number, number] = [0.1, 10]   // V-5
const MIN_HEIGHT_LINES = 2     // V-4 문제 높이 ≥ 라인높이 × 2
const EPS = 1e-9

export type ReviewBucket = 'AUTO_APPROVE' | 'REVIEW' | 'REVIEW_PRIORITY'

export type VerifyReport = {
  problems: Problem[]
  /** V-1 — 유실된 번호. 검수 UI가 "4번 근처를 확인하세요"로 지목하는 근거 */
  missingNumbers: number[]
  coverageByPage: Map<number, number>
  needsReview: boolean          // 30% 이상이 검수 대상 → Job NEEDS_REVIEW (§6.3)
  reviewRatio: number
}

/**
 * 문제 배열에 플래그·신뢰도를 채워 넣는다. 입력 배열을 변형하지 않는다(멱등).
 * layouts는 V-2 커버리지 계산에 필요한 본문 영역 정보다.
 */
export function verify(problems: Problem[], layouts: PageLayout[]): VerifyReport {
  const byPage = new Map(layouts.map((l) => [l.pageIndex, l]))
  const flags = new Map<string, Set<Flag>>()
  const add = (id: string, f: Flag) => {
    const s = flags.get(id) ?? new Set<Flag>()
    s.add(f)
    flags.set(id, s)
  }
  // REGION 단계에서 이미 붙은 플래그를 승계한다
  for (const p of problems) for (const f of p.flags) add(p.id, f)

  // ---------- V-1 번호 수열 연속성 ----------
  const missingNumbers: number[] = []
  let prev: number | null = null
  for (const p of problems) {
    const n = p.numberInt
    if (n === null) continue
    if (prev !== null && n > prev + 1) {
      for (let m = prev + 1; m < n; m++) missingNumbers.push(m)
      // 유실 직후 문제에 붙인다 — 검수 UI가 정확히 그 지점을 지목할 수 있게
      add(p.id, 'FLAG_NUMBER_GAP')
    }
    if (prev !== null && n <= prev) add(p.id, 'FLAG_NUMBER_DISORDER')
    prev = n
  }

  // ---------- V-2 커버리지 ----------
  const coverageByPage = new Map<number, number>()
  for (const layout of layouts) {
    const onPage = problems.filter((p) => p.pageIndex === layout.pageIndex)
    const content = bboxArea(layout.contentBox)
    if (content <= 0) continue
    const covered = onPage.reduce(
      (sum, p) => sum + intersectArea(p.bbox, layout.contentBox),
      0,
    )
    const ratio = covered / content
    coverageByPage.set(layout.pageIndex, ratio)
    if (onPage.length > 0 && ratio < COVERAGE_MIN) {
      // 페이지 단위 결함이므로 그 페이지의 문제 전체를 검수 대상으로 올린다
      for (const p of onPage) add(p.id, 'FLAG_LOW_COVERAGE')
    }
  }

  // ---------- V-3 bbox 겹침 (INV-2) ----------
  for (let i = 0; i < problems.length; i++) {
    for (let j = i + 1; j < problems.length; j++) {
      const a = problems[i]
      const b = problems[j]
      if (a.pageIndex !== b.pageIndex || a.columnIndex !== b.columnIndex) continue
      if (intersectArea(a.bbox, b.bbox) > EPS) {
        add(a.id, 'FLAG_BBOX_OVERLAP')
        add(b.id, 'FLAG_BBOX_OVERLAP')
      }
    }
  }

  for (const p of problems) {
    const layout = byPage.get(p.pageIndex)
    const lh = layout?.columns.find((c) => c.index === p.columnIndex)?.lineHeight ?? 0.012

    // ---------- V-4 최소 높이 ----------
    if (bboxH(p.bbox) < lh * MIN_HEIGHT_LINES) add(p.id, 'FLAG_TOO_SMALL')

    // ---------- V-5 종횡비 ----------
    // 정규화 좌표는 페이지 종횡비만큼 왜곡돼 있으므로 pt 환산 후 판정한다
    const wPt = bboxW(p.bbox) * (layout?.width ?? 1)
    const hPt = bboxH(p.bbox) * (layout?.height ?? 1)
    const aspect = hPt > 0 ? wPt / hPt : Infinity
    if (aspect < ASPECT_RANGE[0] || aspect > ASPECT_RANGE[1]) add(p.id, 'FLAG_ASPECT_ANOMALY')

    // ---------- V-6 객관식인데 선지 부족 ----------
    // 유형 판정이 CHOICE_ITEM 개수에 의존하므로(§5.3-5) 문자 그대로는 절대 발화하지 않는다.
    // 실제로 잡아야 할 것은 "선지 마커가 보였는데 C-1~C-3에서 확정에 실패한" 경우다.
    const items = p.regions.filter((r) => r.kind === 'CHOICE_ITEM')
    if (p.problemType === 'MULTIPLE_CHOICE' && items.length < 2) add(p.id, 'FLAG_CHOICES_MISSING')

    // ---------- V-7 hitbox 겹침 ----------
    const hitboxes = items.map((r) => r.hitbox ?? r.bbox)
    for (let i = 0; i < hitboxes.length; i++) {
      for (let j = i + 1; j < hitboxes.length; j++) {
        if (intersectArea(hitboxes[i], hitboxes[j]) > EPS) add(p.id, 'FLAG_HITBOX_COLLISION')
      }
    }

    // ---------- V-8 경계 넘김 ----------
    if (p.continuation) add(p.id, 'FLAG_SPANS_BOUNDARY')

    // 컬럼 판정 애매 — LAYOUT에서 내려온 페이지 단위 플래그
    if (layout?.columnAmbiguous) add(p.id, 'FLAG_COLUMN_AMBIGUOUS')
  }

  const scored = problems.map((p): Problem => {
    const f = [...(flags.get(p.id) ?? [])].sort()
    return { ...p, flags: f, confidence: confidenceOf(f) }
  })

  const reviewing = scored.filter((p) => bucketOf(p.confidence) !== 'AUTO_APPROVE').length
  const reviewRatio = scored.length ? reviewing / scored.length : 0

  return {
    problems: scored,
    missingNumbers,
    coverageByPage,
    needsReview: reviewRatio >= 0.3,
    reviewRatio,
  }
}

/** §6.2 — confidence = 1.0 − Σ(플래그 가중치), 하한 0.0 */
export function confidenceOf(flags: Flag[]): number {
  const penalty = flags.reduce((s, f) => s + (FLAG_WEIGHT[f] ?? 0), 0)
  return Math.max(0, 1 - penalty)
}

/** §6.3 라우팅 */
export function bucketOf(confidence: number): ReviewBucket {
  if (confidence >= 0.85) return 'AUTO_APPROVE'
  if (confidence >= 0.5) return 'REVIEW'
  return 'REVIEW_PRIORITY'
}

// ---------- 불변 조건 (§3.2) ----------

export type Invariant = 'INV-1' | 'INV-2' | 'INV-3' | 'INV-4' | 'INV-5' | 'INV-6'

/**
 * DB 저장 전 반드시 검사한다. 위반 시 저장하지 않고 플래그를 붙여 검수로 보낸다 (§3.2).
 * requireCrop=false면 INV-6(cropUri 실재)을 건너뛴다 — 앱 내 인라인 실행 경로는
 * 크롭 파일을 만들지 않고 원본 페이지 위에 좌표를 그리기 때문이다.
 */
export function checkInvariants(
  problems: Problem[],
  opts: { requireCrop?: boolean; cropExists?: (uri: string) => boolean } = {},
): Map<string, Invariant[]> {
  const out = new Map<string, Invariant[]>()
  const push = (id: string, inv: Invariant) => {
    const arr = out.get(id) ?? []
    if (!arr.includes(inv)) arr.push(inv)
    out.set(id, arr)
  }

  for (const p of problems) {
    // INV-1
    if (!validBBox(p.bbox)) push(p.id, 'INV-1')
    for (const r of p.regions) {
      if (!validBBox(r.bbox)) push(p.id, 'INV-1')
      // INV-4 — Region은 상대 좌표이므로 [0,1] 안에 있으면 문제 bbox에 포함된다
      if (!within01(r.bbox)) push(p.id, 'INV-4')
    }

    // INV-3 — CHOICE_ITEM.ordinal 유일 + 1부터 연속
    const ords = p.regions
      .filter((r) => r.kind === 'CHOICE_ITEM')
      .map((r) => r.ordinal)
      .filter((o): o is number => o !== null)
      .sort((a, b) => a - b)
    if (new Set(ords).size !== ords.length) push(p.id, 'INV-3')
    if (ords.some((o, i) => o !== i + 1)) push(p.id, 'INV-3')

    // INV-5
    if (p.problemType === 'MULTIPLE_CHOICE' && ords.length < 2) push(p.id, 'INV-5')

    // INV-6
    if (opts.requireCrop && !(opts.cropExists?.(p.cropUri) ?? false)) push(p.id, 'INV-6')
  }

  // INV-2 — 동일 페이지·컬럼 내 겹침 면적 0
  for (let i = 0; i < problems.length; i++) {
    for (let j = i + 1; j < problems.length; j++) {
      const a = problems[i]
      const b = problems[j]
      if (a.pageIndex !== b.pageIndex || a.columnIndex !== b.columnIndex) continue
      if (intersectArea(a.bbox, b.bbox) > EPS) {
        push(a.id, 'INV-2')
        push(b.id, 'INV-2')
      }
    }
  }

  return out
}

function validBBox(b: BBox): boolean {
  return b[0] < b[2] && b[1] < b[3] && b.every((v) => Number.isFinite(v))
}

function within01(b: BBox): boolean {
  return b.every((v) => v >= -EPS && v <= 1 + EPS)
}

/** Region 상대 좌표를 페이지 좌표로 환산 — 오버레이·채점 진입점 */
export function regionPageBBox(problem: Problem, region: { bbox: BBox }): BBox {
  return toPageBBox(region.bbox, problem.bbox)
}
