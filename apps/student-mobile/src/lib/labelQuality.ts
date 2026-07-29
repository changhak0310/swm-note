// 라벨 품질 — 골든셋 자체를 감사한다.
//
// 99%를 목표로 두는 순간 **라벨 오류율이 목표보다 한 자릿수 작아야 하고, 그건 신념이 아니라
// 측정돼야 한다.** 라벨이 3% 틀리면 그 3%가 새 천장이 되는데 아무도 그걸 볼 수 없다.
//
// 두 가지를 잰다.
//   ① IAA  — 두 사람이 같은 쪽을 독립으로 라벨했을 때 얼마나 일치하는가 (§2단계·3단계)
//   ② 함정 — 초안에 일부러 심은 오류를 라벨러가 잡아내는가 (§4단계)
//
// ★ 둘은 다른 것을 잡는다. IAA는 **규약의 모호함**(선지 박스 오른쪽 끝을 어디로 볼 것인가)을,
//   함정은 **부주의**(초안을 안 보고 Enter를 누르는 것)를 잡는다. 라벨러가 성실해도 규약이
//   흐리면 IAA가 낮고, 규약이 완벽해도 대충 넘기면 함정에 걸린다.
import { goldenToRegions, scoreAttribution, type AttributionScore } from './metrics'
import { boxIou } from './psp/compare'
import type { GoldenBox, GoldenChoice, GoldenSet } from './psp/golden'

/** 같은 선지를 가리킨 것으로 볼 겹침 */
const CHOICE_SAME_IOU = 0.5
/** 같은 문항을 가리킨 것으로 볼 겹침 (bounds) */
const PROBLEM_SAME_IOU = 0.5

// ============================================================ ① IAA

export type Disagreement = {
  page: number
  kind: 'problem-only-a' | 'problem-only-b' | 'choice-count' | 'choice-place' | 'label' | 'number' | 'kind'
  detail: string
}

export type Agreement = {
  /** 양쪽 다 확인 완료로 표시한 쪽 수 — 분모다 */
  pages: number
  problems: { a: number; b: number; matched: number }
  choices: { total: number; samePlace: number; meanIou: number }
  numberMismatch: number
  kindMismatch: number
  /**
   * **M4 기준 일치율.** a를 예측으로, b를 정답으로 두고 채점한 것.
   * "라벨 간 M4 일치 ≥ 99.5%"라는 합격선이 바로 이 값이다 — 이보다 낮으면 99% 목표는
   * 애초에 측정할 수 없다(두 정답이 그만큼 다르니 어느 쪽에 맞춰야 할지 모른다).
   */
  m4: number
  m4Detail: AttributionScore
  disagreements: Disagreement[]
}

/**
 * 두 라벨러의 골든셋을 견준다.
 *
 * 대칭이 아니다 — `m4`는 a를 예측, b를 정답으로 본다. 사람 둘의 우열을 가리는 값이 아니라
 * **"이 규약으로 라벨하면 얼마나 재현되는가"** 를 재는 값이라 방향은 중요하지 않다.
 */
export function agreement(a: GoldenSet, b: GoldenSet, maxList = 100): Agreement {
  // 양쪽 다 본 쪽만 견준다. 한쪽만 라벨한 쪽을 불일치로 세면 진행도가 품질로 둔갑한다
  const pages = a.reviewedPages.filter((p) => b.reviewedPages.includes(p)).sort((x, y) => x - y)
  const onlyBoth: GoldenSet = { ...a, reviewedPages: pages }
  const bBoth: GoldenSet = { ...b, reviewedPages: pages }

  const disagreements: Disagreement[] = []
  const push = (d: Disagreement) => {
    if (disagreements.length < maxList) disagreements.push(d)
  }

  let matched = 0
  let aCount = 0
  let bCount = 0
  let choiceTotal = 0
  let samePlace = 0
  let iouSum = 0
  let numberMismatch = 0
  let kindMismatch = 0

  for (const page of pages) {
    const ga = a.boxes.filter((x) => x.page === page)
    const gb = b.boxes.filter((x) => x.page === page)
    aCount += ga.length
    bCount += gb.length

    const pairs = pairProblems(ga, gb)
    matched += pairs.size

    const usedB = new Set(pairs.values())
    ga.forEach((box, i) => {
      const bi = pairs.get(i)
      if (bi === undefined) {
        push({ page, kind: 'problem-only-a', detail: `${box.number || '?'}번이 A에만 있다` })
        return
      }
      const other = gb[bi]
      if (box.number !== other.number) {
        numberMismatch++
        push({ page, kind: 'number', detail: `A "${box.number}" ↔ B "${other.number}"` })
      }
      if (box.kind && other.kind && box.kind !== other.kind) {
        kindMismatch++
        push({ page, kind: 'kind', detail: `${box.number}번 A ${box.kind} ↔ B ${other.kind}` })
      }
      if (box.choices.length !== other.choices.length) {
        push({
          page,
          kind: 'choice-count',
          detail: `${box.number}번 선지 A ${box.choices.length}개 ↔ B ${other.choices.length}개`,
        })
      }
      for (const ca of box.choices) {
        choiceTotal++
        const cb = other.choices.find((c) => c.label === ca.label)
        if (!cb) {
          push({ page, kind: 'label', detail: `${box.number}번 선지${ca.label}이 B에 없다` })
          continue
        }
        const iou = boxIou(ca.box, cb.box)
        iouSum += iou
        if (iou >= CHOICE_SAME_IOU) samePlace++
        else {
          push({
            page,
            kind: 'choice-place',
            detail: `${box.number}번 선지${ca.label} 겹침 ${iou.toFixed(2)}`,
          })
        }
      }
    })
    gb.forEach((box, i) => {
      if (!usedB.has(i)) {
        push({ page, kind: 'problem-only-b', detail: `${box.number || '?'}번이 B에만 있다` })
      }
    })
  }

  // M4 일치 — a의 라벨을 검출 결과인 셈 치고 b로 채점한다
  const m4Detail = scoreAttribution(goldenToRegions(onlyBoth, pages), bBoth)

  return {
    pages: pages.length,
    problems: { a: aCount, b: bCount, matched },
    choices: { total: choiceTotal, samePlace, meanIou: choiceTotal ? iouSum / choiceTotal : 0 },
    numberMismatch,
    kindMismatch,
    m4: m4Detail.accuracy,
    m4Detail,
    disagreements,
  }
}

/** 문항 짝짓기 — bounds 겹침이 큰 쌍부터 (라벨끼리는 경계 규약이 같아야 하므로 bounds로 본다) */
function pairProblems(a: GoldenBox[], b: GoldenBox[]): Map<number, number> {
  const cand: { ai: number; bi: number; iou: number }[] = []
  a.forEach((x, ai) =>
    b.forEach((y, bi) => {
      const iou = boxIou(x.bbox, y.bbox)
      if (iou >= PROBLEM_SAME_IOU) cand.push({ ai, bi, iou })
    }),
  )
  cand.sort((m, n) => n.iou - m.iou)
  const out = new Map<number, number>()
  const usedA = new Set<number>()
  const usedB = new Set<number>()
  for (const m of cand) {
    if (usedA.has(m.ai) || usedB.has(m.bi)) continue
    usedA.add(m.ai)
    usedB.add(m.bi)
    out.set(m.ai, m.bi)
  }
  return out
}

// ============================================================ ② 함정 쪽

/**
 * 심는 오류의 종류. 전부 **초안을 안 보고 넘기면 놓치는** 것들이고, 실제 검출 실패와 같은
 * 모양이다 — 라벨러가 "이건 함정이네" 하고 알아채면 감시가 아니라 시험이 된다.
 */
export type TrapKind =
  /** 선지 하나를 한 행만큼 밀어 둔다 — 실제 검출 실패의 최빈형 */
  | 'choice-shift'
  /** 선지 하나를 지운다 (5개 → 4개) */
  | 'choice-drop'
  /** 이웃한 두 선지의 번호를 맞바꾼다 — 순서 뒤집힘 */
  | 'label-swap'
  /** 문항 하나를 통째로 지운다 */
  | 'problem-drop'
  /** 객관식 ↔ 주관식을 뒤집는다 */
  | 'kind-flip'

export const TRAP_KINDS: TrapKind[] = [
  'choice-shift',
  'choice-drop',
  'label-swap',
  'problem-drop',
  'kind-flip',
]

export type Trap = {
  page: number
  /** 손댄 문항. problem-drop이면 지워진 문항의 원래 id */
  boxId: string
  kind: TrapKind
  detail: string
}

export type TrapResult = {
  total: number
  caught: number
  missed: Trap[]
  /** 못 잡은 비율 — 그 라벨러·세션의 부주의율 */
  missRate: number
  byKind: Record<TrapKind, { total: number; caught: number }>
}

/**
 * 검증된 골든셋을 흐트러뜨려 라벨러에게 보여줄 초안을 만든다.
 *
 * ★ 입력은 **이미 검증된** 라벨이어야 한다(1단계 시드셋). 검출 결과를 흐트러뜨리면
 *   원래 값이 옳다는 보장이 없어 "잡았다/놓쳤다"를 판정할 수 없다.
 *
 * @param seed 같은 seed는 같은 함정을 만든다 — 재현 가능해야 감사가 된다
 * @param rate 함정을 심을 문항 비율 (0~1)
 */
export function injectTraps(
  truth: GoldenSet,
  seed: number,
  rate = 0.05,
): { draft: GoldenSet; traps: Trap[] } {
  const rnd = lcg(seed)
  const traps: Trap[] = []
  const boxes: GoldenBox[] = []

  for (const box of truth.boxes) {
    // 선지가 없는 문항에는 선지 함정을 못 심는다 — 그런 문항은 problem-drop만 후보다
    const usable = box.choices.length >= 2 ? TRAP_KINDS : (['problem-drop', 'kind-flip'] as TrapKind[])
    if (rnd() >= rate) {
      boxes.push(box)
      continue
    }
    const kind = usable[Math.floor(rnd() * usable.length)]
    const applied = applyTrap(box, kind, rnd)
    if (!applied.trap) {
      boxes.push(box)
      continue
    }
    traps.push({ page: box.page, boxId: box.id, kind, detail: applied.trap })
    if (applied.box) boxes.push(applied.box)
  }

  return { draft: { ...truth, boxes, updatedAt: '' }, traps }
}

function applyTrap(
  box: GoldenBox,
  kind: TrapKind,
  rnd: () => number,
): { box: GoldenBox | null; trap: string | null } {
  const choices = box.choices
  switch (kind) {
    case 'problem-drop':
      return { box: null, trap: `${box.number}번 문항을 통째로 뺐다` }

    case 'kind-flip': {
      const flipped = box.kind === 'choice' ? 'subjective' : 'choice'
      return { box: { ...box, kind: flipped }, trap: `${box.number}번 유형을 ${flipped}로 뒤집었다` }
    }

    case 'choice-drop': {
      const i = Math.floor(rnd() * choices.length)
      return {
        box: { ...box, choices: choices.filter((_, k) => k !== i) },
        trap: `${box.number}번 선지${choices[i].label}을 뺐다`,
      }
    }

    case 'label-swap': {
      const i = Math.floor(rnd() * (choices.length - 1))
      const next = [...choices]
      const la = next[i].label
      const lb = next[i + 1].label
      next[i] = { ...next[i], label: lb }
      next[i + 1] = { ...next[i + 1], label: la }
      return { box: { ...box, choices: next.sort(byLabel) }, trap: `${box.number}번 선지 ${la}↔${lb}` }
    }

    case 'choice-shift': {
      const i = Math.floor(rnd() * choices.length)
      // 한 행만큼 — 같은 문항 안 선지 간격의 중앙값. 세로 배치가 아니면 폭의 절반을 쓴다
      const dy = rowPitch(choices) || choices[i].box.h * 1.2
      const target = choices[i]
      return {
        box: {
          ...box,
          choices: choices.map((c, k) =>
            k === i ? { ...c, box: { ...c.box, y: c.box.y + dy } } : c,
          ),
        },
        trap: `${box.number}번 선지${target.label}을 ${dy.toFixed(0)}만큼 내렸다`,
      }
    }
  }
}

const byLabel = (a: GoldenChoice, b: GoldenChoice) => a.label - b.label

/** 세로로 늘어선 선지의 줄 간격 중앙값 (가로 배치면 0) */
function rowPitch(choices: GoldenChoice[]): number {
  const ys = choices.map((c) => c.box.y).sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] > 1) gaps.push(ys[i] - ys[i - 1])
  if (!gaps.length) return 0
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]
}

/**
 * 라벨러가 함정을 잡았는가 — 제출본을 원본(truth)과 견준다.
 *
 * "잡았다"는 그 자리가 다시 truth와 같아졌다는 뜻이다. 라벨러가 함정을 알아채고 **다르게**
 * 고쳤다면 잡지 못한 것으로 센다 — 정답과 다른 라벨은 어차피 라벨 오류다.
 */
export function scoreTraps(submitted: GoldenSet, traps: Trap[], truth: GoldenSet): TrapResult {
  const byKind = Object.fromEntries(
    TRAP_KINDS.map((k) => [k, { total: 0, caught: 0 }]),
  ) as TrapResult['byKind']
  const missed: Trap[] = []
  let caught = 0

  for (const trap of traps) {
    byKind[trap.kind].total++
    const want = truth.boxes.find((b) => b.id === trap.boxId)
    const got = findCounterpart(submitted, want, trap)
    if (want && got && sameBox(want, got)) {
      caught++
      byKind[trap.kind].caught++
    } else {
      missed.push(trap)
    }
  }

  return {
    total: traps.length,
    caught,
    missed,
    missRate: traps.length ? (traps.length - caught) / traps.length : 0,
    byKind,
  }
}

/**
 * 제출본에서 이 함정에 해당하는 문항을 찾는다.
 *
 * id로 먼저 찾고, 없으면 같은 쪽에서 bounds가 가장 겹치는 것을 쓴다 — 라벨러가 문항을
 * 지웠다 다시 그리면 id가 달라지기 때문이다(problem-drop을 잡은 경우가 정확히 그렇다).
 */
function findCounterpart(
  submitted: GoldenSet,
  want: GoldenBox | undefined,
  trap: Trap,
): GoldenBox | undefined {
  const byId = submitted.boxes.find((b) => b.id === trap.boxId)
  if (byId) return byId
  if (!want) return undefined
  let best: { box: GoldenBox; iou: number } | null = null
  for (const b of submitted.boxes) {
    if (b.page !== want.page) continue
    const iou = boxIou(b.bbox, want.bbox)
    if (iou >= PROBLEM_SAME_IOU && (!best || iou > best.iou)) best = { box: b, iou }
  }
  return best?.box
}

/** 두 문항 라벨이 실질적으로 같은가 — 함정이 되돌려졌는지 판정하는 잣대 */
function sameBox(want: GoldenBox, got: GoldenBox): boolean {
  if (want.number !== got.number) return false
  if ((want.kind ?? null) !== (got.kind ?? null)) return false
  if (want.choices.length !== got.choices.length) return false
  return want.choices.every((c) => {
    const o = got.choices.find((x) => x.label === c.label)
    return !!o && boxIou(c.box, o.box) >= CHOICE_SAME_IOU
  })
}

/** 재현 가능한 난수 — 같은 seed면 같은 함정이 나와야 감사가 성립한다 */
function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}
