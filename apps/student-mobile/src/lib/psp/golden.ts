// 골든셋 — 사람이 정한 정답 구역과, 그에 대한 알고리즘 채점
//
// 지금까지의 IoU는 "두 알고리즘이 얼마나 다른가"만 쟀다. 어느 쪽이 옳은지는
// 정답 라벨 없이는 말할 수 없다. 이 모듈이 그 기준을 담는다 (PRD 준비도 #14).
//
// 좌표는 앱과 같은 MAX_W 정규화 좌표 — toAppRegions()의 산출물과 바로 맞댈 수 있다.
import type { Box, ChoiceLabel, Region as AppRegion } from '../../types'
import { boxIou } from './compare'

export const GOLDEN_FORMAT = 3
/** 읽어 줄 수 있는 형식 — v1은 kind가 없는 것으로 올려 읽는다 */
const READABLE_FORMATS = [1, 2, 3]

export type GoldenChoice = { label: ChoiceLabel; box: Box }

/**
 * 문항 유형. `choices`가 비었다는 것만으로는 주관식인지 "아직 선지를 안 그렸는지"
 * 알 수 없어 M2(객관식 판정)를 잴 수 없었다. 그 둘을 가르는 것이 이 필드다.
 * 없으면 "유형 미지정" — M2 분모에서 빠진다.
 */
export type GoldenKind = 'choice' | 'subjective'

export type GoldenBox = {
  id: string
  page: number              // 1-based
  number: string
  bbox: Box
  kind?: GoldenKind
  /** 비어 있으면 "선지를 라벨링하지 않았다" — 주관식이라는 뜻이 아니다 (그건 kind가 말한다) */
  choices: GoldenChoice[]
}

export type GoldenSet = {
  format: number
  source: string            // 파일명
  /** 원본 PDF의 내용 해시 — 라벨과 파일이 짝인지 확인한다 (코퍼스는 리포에 없다) */
  sourceHash?: string
  /**
   * 쪽 지문 (index = 쪽−1). 같은 책의 **다른 파일**에 라벨을 붙일 때 쓴다 (§11.3 L1).
   *
   * 해시(L0)는 바이트가 하나만 달라도 안 맞는다. 재압축·재다운로드·표지 잘림은 흔하고,
   * 그때도 조판은 그대로라 쪽 그림으로 짝을 찾을 수 있다. 없으면 L0만 쓴다.
   */
  pageFingerprints?: (string | null)[]
  pageCount: number
  /**
   * 사람이 확인을 끝낸 페이지 (1-based).
   *
   * 여기 없는 페이지는 "아직 라벨링 안 함"이라 채점에서 빠진다.
   * 여기 있는데 상자가 없으면 "문항이 없는 것이 정답"이다 — 문제집은 절반 가까이가
   * 표지·머리말·개념 설명이라 이 구분이 없으면 미검출과 정상을 구별할 수 없다.
   */
  reviewedPages: number[]
  boxes: GoldenBox[]
  updatedAt: string
}

export function emptyGolden(source: string, pageCount: number): GoldenSet {
  return {
    format: GOLDEN_FORMAT,
    source,
    pageCount,
    reviewedPages: [],
    boxes: [],
    updatedAt: '',
  }
}

/** 저장된 JSON을 신뢰하지 않고 최소한만 검사한다 */
export function parseGolden(text: string): GoldenSet {
  const raw = JSON.parse(text) as Partial<GoldenSet>
  if (!raw || typeof raw !== 'object') throw new Error('골든셋 형식이 아닙니다.')
  if (!READABLE_FORMATS.includes(Number(raw.format))) {
    throw new Error(`지원하지 않는 형식 버전: ${raw.format}`)
  }
  if (!Array.isArray(raw.boxes) || !Array.isArray(raw.reviewedPages)) {
    throw new Error('boxes / reviewedPages가 없습니다.')
  }
  return {
    format: GOLDEN_FORMAT,
    source: String(raw.source ?? ''),
    ...(raw.sourceHash ? { sourceHash: String(raw.sourceHash) } : {}),
    ...(Array.isArray(raw.pageFingerprints)
      ? { pageFingerprints: raw.pageFingerprints.map((f) => (typeof f === 'string' ? f : null)) }
      : {}),
    pageCount: Number(raw.pageCount ?? 0),
    reviewedPages: raw.reviewedPages.map(Number).filter(Number.isFinite),
    boxes: raw.boxes.filter(isGoldenBox),
    updatedAt: String(raw.updatedAt ?? ''),
  }
}

function isGoldenBox(b: unknown): b is GoldenBox {
  const g = b as GoldenBox
  return (
    !!g &&
    typeof g.id === 'string' &&
    Number.isFinite(g.page) &&
    !!g.bbox &&
    Number.isFinite(g.bbox.x) &&
    Number.isFinite(g.bbox.y) &&
    g.bbox.w > 0 &&
    g.bbox.h > 0
  )
}

// ---------- 채점 ----------

/** AC-1의 판정선. 이 이상 겹치면 "경계를 맞혔다"고 본다 */
export const IOU_MATCH = 0.7

export type PageScore = {
  page: number
  golden: number
  predicted: number
  hit: number               // IoU ≥ 임계값
  meanIou: number
}

export type GoldenScore = {
  /** 채점된 페이지 수 (= reviewedPages 중 실제로 존재하는 페이지) */
  pages: number
  golden: number
  predicted: number
  /** IoU ≥ 임계값으로 짝지어진 수 */
  hit: number
  precision: number         // hit / predicted
  recall: number            // hit / golden  ← AC-1 경계 정확도
  f1: number
  /** 짝지어진 모든 쌍(임계값 무관)의 평균 IoU — 경계가 얼마나 정확한지 */
  meanIou: number
  /** 골든에 없는데 만들어낸 구역 */
  falsePositives: { page: number; number: string }[]
  /** 골든에 있는데 놓친 구역 */
  misses: { page: number; number: string }[]
  /** 번호까지 맞은 비율 (짝지어진 것 중) */
  numberAccuracy: number
  /** 선지가 라벨링된 문항에 대한 AC-2 — 라벨 개수를 전부 맞힌 비율 */
  choiceRecall: number | null
  /**
   * M0 — 문항 쪽 / 비문항 쪽(표지·개념·해설) 판정 정확도.
   * "구역을 하나라도 냈는가"와 "정답에 구역이 있는가"를 견준다. 해설 쪽 오검출이 여기서 드러난다.
   */
  pageTypeAccuracy: number
  /** M2 — 객관식/주관식 판정 정확도. kind가 적힌 문항만 분모에 든다 (없으면 null) */
  choiceTypeAccuracy: number | null
  perPage: PageScore[]
}

/**
 * 예측 구역을 골든셋에 맞대어 채점한다.
 * reviewedPages에 없는 페이지는 통째로 제외한다 — 라벨이 없는 곳을 틀렸다고 셀 수 없다.
 */
export function scoreAgainstGolden(
  predicted: AppRegion[],
  golden: GoldenSet,
  iouThreshold = IOU_MATCH,
): GoldenScore {
  const reviewed = new Set(golden.reviewedPages)
  const goldByPage = groupBy(golden.boxes.filter((b) => reviewed.has(b.page)), (b) => b.page)
  const predByPage = groupBy(predicted.filter((r) => reviewed.has(r.page)), (r) => r.page)

  const perPage: PageScore[] = []
  const falsePositives: GoldenScore['falsePositives'] = []
  const misses: GoldenScore['misses'] = []
  let hit = 0
  let goldenCount = 0
  let predCount = 0
  let iouSum = 0
  let pairCount = 0
  let numberHit = 0
  let choiceLabelled = 0
  let choiceHit = 0
  let pageTypeHit = 0
  let kindLabelled = 0
  let kindHit = 0

  for (const page of [...reviewed].sort((a, b) => a - b)) {
    const g = goldByPage.get(page) ?? []
    const p = predByPage.get(page) ?? []
    goldenCount += g.length
    predCount += p.length
    // M0 — 문항 쪽인가 아닌가. 개수가 아니라 유무만 본다
    if (g.length > 0 === p.length > 0) pageTypeHit++

    const pairs = matchRegions(g, p)
    let pageHit = 0
    let pageIouSum = 0

    for (const { gi, pi, iou } of pairs) {
      pairCount++
      iouSum += iou
      pageIouSum += iou
      if (iou >= iouThreshold) {
        hit++
        pageHit++
        if (g[gi].number === p[pi].numLabel) numberHit++
        if (g[gi].choices.length > 0) {
          choiceLabelled++
          if (matchesChoices(g[gi].choices, p[pi].choices, iouThreshold)) choiceHit++
        }
        // M2 — 유형을 적어 둔 문항만. 짝을 못 지은 문항은 M1이 이미 벌점을 줬다
        if (g[gi].kind) {
          kindLabelled++
          const predIsChoice = p[pi].answerType === 'choice' && p[pi].choices.length > 0
          if (predIsChoice === (g[gi].kind === 'choice')) kindHit++
        }
      }
    }

    const matchedG = new Set(pairs.filter((m) => m.iou >= iouThreshold).map((m) => m.gi))
    const matchedP = new Set(pairs.filter((m) => m.iou >= iouThreshold).map((m) => m.pi))
    g.forEach((b, i) => {
      if (!matchedG.has(i)) misses.push({ page, number: b.number })
    })
    p.forEach((r, i) => {
      if (!matchedP.has(i)) falsePositives.push({ page, number: r.numLabel ?? '?' })
    })

    perPage.push({
      page,
      golden: g.length,
      predicted: p.length,
      hit: pageHit,
      meanIou: pairs.length ? pageIouSum / pairs.length : 0,
    })
  }

  const precision = predCount ? hit / predCount : 0
  const recall = goldenCount ? hit / goldenCount : 0

  return {
    pages: reviewed.size,
    golden: goldenCount,
    predicted: predCount,
    hit,
    precision,
    recall,
    f1: precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0,
    meanIou: pairCount ? iouSum / pairCount : 0,
    falsePositives,
    misses,
    numberAccuracy: hit ? numberHit / hit : 0,
    choiceRecall: choiceLabelled ? choiceHit / choiceLabelled : null,
    pageTypeAccuracy: reviewed.size ? pageTypeHit / reviewed.size : 0,
    choiceTypeAccuracy: kindLabelled ? kindHit / kindLabelled : null,
    perPage,
  }
}

/**
 * IoU가 큰 쌍부터 욕심껏 짝짓는다.
 * 문항 구역은 서로 겹치지 않으므로(INV-2) 최적 매칭과 사실상 같은 결과가 나온다.
 */
export function matchRegions(
  golden: GoldenBox[],
  predicted: AppRegion[],
): { gi: number; pi: number; iou: number }[] {
  const all: { gi: number; pi: number; iou: number }[] = []
  golden.forEach((g, gi) =>
    predicted.forEach((p, pi) => {
      const iou = boxIou(g.bbox, p.bounds)
      if (iou > 0) all.push({ gi, pi, iou })
    }),
  )
  all.sort((a, b) => b.iou - a.iou)

  const usedG = new Set<number>()
  const usedP = new Set<number>()
  const out: { gi: number; pi: number; iou: number }[] = []
  for (const m of all) {
    if (usedG.has(m.gi) || usedP.has(m.pi)) continue
    usedG.add(m.gi)
    usedP.add(m.pi)
    out.push(m)
  }
  return out
}

/** AC-2 — 라벨된 선지를 전부, 각각 임계값 이상으로 맞혔는가 */
function matchesChoices(
  golden: GoldenChoice[],
  predicted: AppRegion['choices'],
  iouThreshold: number,
): boolean {
  if (predicted.length !== golden.length) return false
  return golden.every((g) => {
    const p = predicted.find((c) => c.label === g.label)
    return !!p && boxIou(g.box, p.box) >= iouThreshold
  })
}

function groupBy<T>(items: T[], key: (t: T) => number): Map<number, T[]> {
  const m = new Map<number, T[]>()
  for (const it of items) {
    const k = key(it)
    const arr = m.get(k) ?? []
    arr.push(it)
    m.set(k, arr)
  }
  return m
}
