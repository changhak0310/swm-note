// M0~M4 — "인식 95%"가 무슨 뜻인지 코드로 못박는 자리.
//
// M0 페이지 유형 · M1 문항 검출 · M2 객관식 판정 · M3 선지 라벨 → psp/golden.ts
// M4 마킹 귀속                                                  → 이 파일
//
// ★ 되읽기(scan.real·livemark.real)와 결정적으로 다른 점이 하나 있다. 표시를 만드는
//   자리가 **우리가 그린 박스**가 아니라 **사람이 라벨한 인쇄 선지**다. 좌표계가 통째로
//   밀려도 100%가 나오던 자기일관 함정(규칙 문서 §5)이 여기서 사라진다 — 박스가
//   인쇄물에서 어긋나면 그만큼 그대로 점수가 깎인다.
//
// M4가 헤드라인인 이유: M1·M2·M3를 곱으로 품고, 사용자가 겪는 것과 같다. 문항 경계가
// 조금 어긋나도 마킹이 옳게 읽히면 제품은 멀쩡하고, 경계가 완벽해도 선지 라벨이 하나
// 밀리면 제품은 망가진다.
import type { Box, Point, Region, Stroke } from '../types'
import { detectMarks } from './liveDetect'
import { boxIou } from './psp/compare'
import type { GoldenBox, GoldenSet } from './psp/golden'

/**
 * 학생이 답을 표기하는 방식. 세 가지를 다 재고 따로 보고한다 — 판정 경로가 다르기 때문이다.
 *
 *   circle 기호에 친 동그라미 → 닫힌 고리 · 기호 판정점
 *   check  기호 위 체크 ✓     → 열린 마크 · 겹침 비율 (실제 사용자 표기의 주류다)
 *   wrap   선지 전체를 감쌈    → 닫힌 고리 · 박스 중심 판정점
 */
export type MarkKind = 'circle' | 'check' | 'wrap'

export const MARK_KINDS: MarkKind[] = ['circle', 'check', 'wrap']

/** 인쇄된 선지 자리에 학생이 낼 법한 획을 만든다. 예측 박스는 쓰지 않는다 — 그게 요점이다 */
export function markStroke(box: Box, kind: MarkKind, t = 1000): Stroke {
  const pts = kind === 'check' ? checkPoints(box, t) : loopPoints(box, kind, t)
  return { id: `m${kind}${t}`, regionId: null, attemptNo: 1, tool: 'pen', points: pts }
}

/** 선지 기호 자리 — 박스 왼쪽의 정사각 영역 중심 (grading.ts의 sym과 같은 규약) */
function symbolAt(box: Box): { cx: number; cy: number; unit: number } {
  const unit = Math.min(box.h, box.w)
  return { cx: box.x + unit / 2, cy: box.y + box.h / 2, unit }
}

function loopPoints(box: Box, kind: 'circle' | 'wrap', t: number): Point[] {
  const { cx, cy, unit } = symbolAt(box)
  // wrap은 선지 박스에 내접 — 이웃을 침범하지 않으면서 '중심 판정점' 경로를 탄다
  const c = kind === 'circle' ? { x: cx, y: cy } : { x: box.x + box.w / 2, y: box.y + box.h / 2 }
  const rx = kind === 'circle' ? unit * 0.6 : (box.w / 2) * 0.98
  const ry = kind === 'circle' ? unit * 0.6 : (box.h / 2) * 0.98
  const pts: Point[] = []
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2
    pts.push({ x: c.x + Math.cos(a) * rx, y: c.y + Math.sin(a) * ry, p: 0.5, t })
  }
  return pts
}

/** ✓ — 짧게 내려긋고 길게 올려긋는 두 획. 열린 마크라 겹침 비율 경로를 탄다 */
function checkPoints(box: Box, t: number): Point[] {
  const { cx, cy, unit } = symbolAt(box)
  const s = unit * 0.5
  const knots = [
    { x: cx - s * 0.6, y: cy - s * 0.1 },
    { x: cx - s * 0.15, y: cy + s * 0.5 },
    { x: cx + s * 0.7, y: cy - s * 0.7 },
  ]
  const pts: Point[] = []
  for (let k = 1; k < knots.length; k++) {
    const a = knots[k - 1]
    const b = knots[k]
    for (let i = k === 1 ? 0 : 1; i <= 8; i++) {
      pts.push({ x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8, p: 0.5, t })
    }
  }
  return pts
}

// ---------- M4 ----------

/**
 * 한 번의 표기가 맞은 방식.
 *
 * ★ wrong과 missed를 합치면 안 된다. 같은 5%라도 값이 다르다 —
 *   wrong은 조용히 오답 처리돼 신뢰를 깎고, missed는 눈에 보여 다시 칠 수 있다.
 *   합격선도 따로다 (계획 문서 §2.4: wrong ≤ 0.5%).
 */
export type MarkOutcome = 'correct' | 'wrong' | 'missed'

export type MarkFailure = {
  page: number
  /** 골든의 문제 번호 */
  number: string
  label: number
  kind: MarkKind
  outcome: 'wrong' | 'missed'
  /** 무엇으로 읽혔는가 — '다른문항 선지3' / '선지2' / '미검출' */
  got: string
}

export type KindTally = { total: number; correct: number; wrong: number; missed: number }

export type AttributionScore = {
  total: number
  correct: number
  /** 잘못 귀속 — 조용히 틀린다 */
  wrong: number
  /** 미검출 — 눈에 보인다 */
  missed: number
  /** M4 헤드라인 = correct / total */
  accuracy: number
  wrongRate: number
  byKind: Record<MarkKind, KindTally>
  failures: MarkFailure[]
}

/** 이만큼 겹치면 "그 선지를 가리킨 것"으로 본다 */
const CHOICE_PAIR_IOU = 0.3

/**
 * 골든 문항 ↔ 예측 구역 짝짓기 — **선지 박스 겹침으로 짝짓는다. bounds가 아니다.**
 *
 * ★ 예전에는 bounds IoU ≥ 0.7로 짝지었다. 그러면 문항 경계 라벨이 조금만 헐거워도 짝이
 *   깨져 그 문항의 선지가 전부 실패로 잡힌다. 그런데 bounds는 라벨에서 **가장 애매하고
 *   가장 비싼 항목**이다 — 그림을 어디까지 넣을지, 여백을 어디서 자를지가 사람마다 다르다.
 *   M4가 묻는 것은 "표기가 옳은 문항의 옳은 번호로 읽히는가"이지 경계가 아니고,
 *   경계 정확도는 M1(`scoreAgainstGolden`)이 따로 잰다.
 *
 *   실질적 효과: 라벨의 필수 최소 집합이 (문항 그룹, 선지 위치, 선지 번호)로 줄어든다.
 *   마커 위치는 애매함이 거의 없는 객관적 대상이라 라벨러 간 일치도(IAA)도 잘 나온다.
 */
function pairByChoices(golden: GoldenBox[], predicted: Region[]): Map<number, string> {
  const cand: { gi: number; pi: number; hits: number; sum: number }[] = []
  golden.forEach((gb, gi) => {
    if (!gb.choices.length) return
    predicted.forEach((pr, pi) => {
      let hits = 0
      let sum = 0
      for (const c of gb.choices) {
        let best = 0
        for (const pc of pr.choices) best = Math.max(best, boxIou(c.box, pc.box))
        sum += best
        if (best >= CHOICE_PAIR_IOU) hits++
      }
      if (hits > 0) cand.push({ gi, pi, hits, sum })
    })
  })
  // 겹친 선지 수 우선, 같으면 총 겹침량으로
  cand.sort((a, b) => b.hits - a.hits || b.sum - a.sum)

  const out = new Map<number, string>()
  const usedG = new Set<number>()
  const usedP = new Set<number>()
  for (const m of cand) {
    if (usedG.has(m.gi) || usedP.has(m.pi)) continue
    usedG.add(m.gi)
    usedP.add(m.pi)
    out.set(m.gi, predicted[m.pi].id)
  }
  return out
}

/**
 * 라벨을 예측으로 변환한다 — 오라클 상한 측정(§11.1)과 라벨러 간 일치도(IAA)가 쓴다.
 *
 * M0~M3는 정의상 만점이 되고 남는 것은 M4뿐이다: 박스가 인쇄물과 정확히 같을 때도 표기가
 * 잘못 읽히는 경우. 그게 판정 기하의 상한이고, 라벨 우선 설계가 도달할 수 있는 최대치다.
 */
export function goldenToRegions(golden: GoldenSet, pages?: number[]): Region[] {
  const on = new Set(pages ?? golden.reviewedPages)
  return golden.boxes
    .filter((b) => on.has(b.page))
    .map((b) => ({
      id: b.id,
      docId: 'golden',
      page: b.page,
      bounds: b.bbox,
      numLabel: b.number,
      choices: b.choices,
      ansSynth: false,
      // kind를 적었으면 그것을 따르고, 없으면 선지 수로 본다 (v1 라벨 호환)
      answerType: (b.kind ? b.kind === 'choice' : b.choices.length >= 2)
        ? ('choice' as const)
        : ('integer' as const),
    }))
}

/**
 * M4 — 인쇄된 선지마다 표기를 만들어 시스템이 (그 문항, 그 번호)로 읽는지 본다.
 *
 * 분모는 **라벨된 전 선지**다. 검출된 문항이 아니라. 문항을 통째로 놓치면 그 선지가
 * 전부 missed로 잡힌다 — 지금의 되읽기 지표가 못 보던 실패가 여기서 드러난다.
 */
export function scoreAttribution(
  predicted: Region[],
  golden: GoldenSet,
  opts: { kinds?: MarkKind[]; maxFailures?: number } = {},
): AttributionScore {
  const kinds = opts.kinds ?? MARK_KINDS
  const maxFailures = opts.maxFailures ?? 200

  const reviewed = new Set(golden.reviewedPages)
  const tally: Record<MarkKind, KindTally> = {
    circle: { total: 0, correct: 0, wrong: 0, missed: 0 },
    check: { total: 0, correct: 0, wrong: 0, missed: 0 },
    wrap: { total: 0, correct: 0, wrong: 0, missed: 0 },
  }
  const failures: MarkFailure[] = []

  for (const page of [...reviewed].sort((a, b) => a - b)) {
    const g = golden.boxes.filter((b) => b.page === page)
    // 페이지 안에서만 판정한다 — 표기는 페이지를 넘지 않고, 남의 쪽 구역이 끼면
    // 귀속이 흐려진다 (앱도 페이지 단위로 판정한다)
    const p = predicted.filter((r) => r.page === page)
    if (!g.length) continue

    // 골든 문항 ↔ 예측 구역 짝짓기. 이 짝이 "옳은 문항"의 정의다
    const pairedId = pairByChoices(g, p)

    g.forEach((box, gi) => {
      if (!box.choices.length) return          // 선지를 라벨하지 않은 문항 — 분모에 넣지 않는다
      const expectId = pairedId.get(gi)
      for (const choice of box.choices) {
        for (const kind of kinds) {
          const marks = detectMarks(p, [markStroke(choice.box, kind)])
          const entries = Object.entries(marks)
          const t = tally[kind]
          t.total++

          if (!entries.length) {
            t.missed++
            if (failures.length < maxFailures) {
              failures.push({
                page,
                number: box.number,
                label: choice.label,
                kind,
                outcome: 'missed',
                got: '미검출',
              })
            }
            continue
          }

          const own = expectId ? marks[expectId] : undefined
          if (own === choice.label && entries.length === 1) {
            t.correct++
            continue
          }
          t.wrong++
          if (failures.length < maxFailures) {
            const [rid, label] = entries[0]
            failures.push({
              page,
              number: box.number,
              label: choice.label,
              kind,
              outcome: 'wrong',
              got: rid === expectId ? `선지${label}` : `다른문항 선지${label}`,
            })
          }
        }
      }
    })
  }

  const sum = (pick: (t: KindTally) => number) =>
    MARK_KINDS.reduce((n, k) => n + pick(tally[k]), 0)
  const total = sum((t) => t.total)
  const correct = sum((t) => t.correct)
  const wrong = sum((t) => t.wrong)

  return {
    total,
    correct,
    wrong,
    missed: sum((t) => t.missed),
    accuracy: total ? correct / total : 0,
    wrongRate: total ? wrong / total : 0,
    byKind: tally,
    failures,
  }
}
