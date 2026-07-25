// 구역 분할 (§7.4)
// 수능형 1~2단 문제지: 줄 시작의 "N." 번호 토큰을 앵커로 잡고
// 다음 번호까지를 문항 bounds로, 구역 내 ①~⑤ 토큰을 choices[]로 보존한다.
import type { Box, ChoiceLabel, Region } from '../types'
import { MAX_W } from './geometry'

// 알고리즘이 바뀌면 올린다. SegmentCache.segmentVersion 불일치 시 재계산 (§4)
export const SEGMENT_VERSION = 2

export type ChoiceToken = { label: ChoiceLabel; box: Box }

/**
 * 개별 선지 기호 토큰 → 선지 상자 배열.
 *
 *   각 선지 상자의 우측 경계 = 같은 줄 다음 선지 기호의 x 직전
 *   줄의 마지막 선지의 우측 경계 = ansBox 우측 경계
 *
 * 이 규칙 하나로 한 줄 5개 / 2줄 3+2 / 한 줄에 하나씩이 모두 처리된다.
 */
export function splitChoices(tokens: ChoiceToken[], ansBox: Box): Region['choices'] {
  if (tokens.length === 0) return []

  // 세로 중심이 겹치는 토큰끼리 줄로 묶는다
  const sorted = [...tokens].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)
  const rows: ChoiceToken[][] = []
  for (const t of sorted) {
    const row = rows[rows.length - 1]
    if (row && overlapsVertically(row[0].box, t.box)) row.push(t)
    else rows.push([t])
  }

  const choices: Region['choices'] = []
  for (const row of rows) {
    row.sort((a, b) => a.box.x - b.box.x)
    const top = Math.min(...row.map((t) => t.box.y))
    const bottom = Math.max(...row.map((t) => t.box.y + t.box.h))
    for (let i = 0; i < row.length; i++) {
      const left = row[i].box.x
      const right = i + 1 < row.length ? row[i + 1].box.x : ansBox.x + ansBox.w
      choices.push({
        label: row[i].label,
        box: { x: left, y: top, w: right - left, h: bottom - top },
      })
    }
  }
  return choices.sort((a, b) => a.label - b.label)
}

function overlapsVertically(a: Box, b: Box): boolean {
  const ac = a.y + a.h / 2
  const bc = b.y + b.h / 2
  return bc < a.y + a.h && ac < b.y + b.h && Math.abs(ac - bc) < Math.max(a.h, b.h)
}

// ---------- 페이지 분할 파이프라인 ----------

export type TextToken = { str: string; box: Box }
export type TextLine = { text: string; tokens: TextToken[] }

const CIRCLED = '①②③④⑤'
// 번호 전용 토큰: "1." / "12." / "1" (뒤 토큰이 "."로 시작). 소수 "1.5"는 한 토큰이라 걸러진다
const NUM_DOT = /^(\d{1,2})\s*\.$/
const NUM_ONLY = /^(\d{1,2})$/
const LEFT_TOL = 20      // 열 좌단 정렬 허용 오차 — 본문 중간 숫자 오검출 방지
const PAD = 6

type Cand = { num: number; numBox: Box }

/**
 * 페이지를 문항 Region으로 분할한다.
 * 1) 줄 시작의 번호 토큰을 후보로 수집
 * 2) 중앙(380) 기준 열 배정, 열 좌단 정렬로 필터
 * 3) 다음 번호(또는 열 하단)까지가 bounds
 * 4) 구역 내 원문자 → splitChoices, 없으면 주관식(integer)
 * Region.id는 결정적(docId:p{page}:n{num}) — 재분할해도 정답·기록이 보존된다
 */
export function segmentPage(docId: string, page: number, lines: TextLine[]): Region[] {
  const tokens = lines.flatMap((l) => l.tokens)
  if (!tokens.length) return []

  // 줄은 페이지 전체 폭으로 묶이므로(2단이 한 줄로 합쳐짐) 열별로 쪼개
  // 각 열의 첫 토큰만 번호 앵커 후보로 본다
  const mid = MAX_W / 2
  const cands: Cand[] = []
  for (const line of lines) {
    const colToks: TextToken[][] = [[], []]
    for (const t of line.tokens) (t.box.x + t.box.w / 2 < mid ? colToks[0] : colToks[1]).push(t)
    for (const toks of colToks) {
      const [t0, t1] = toks
      if (!t0) continue
      let m = NUM_DOT.exec(t0.str.trim())
      if (!m && NUM_ONLY.test(t0.str.trim()) && t1?.str.trim().startsWith('.')) {
        m = NUM_ONLY.exec(t0.str.trim())
      }
      if (!m) continue
      const num = Number(m[1])
      if (num < 1 || num > 50) continue
      cands.push({ num, numBox: t0.box })
    }
  }
  if (!cands.length) return []

  const cols: Cand[][] = [[], []]
  for (const c of cands) (c.numBox.x < mid ? cols[0] : cols[1]).push(c)

  const regions: Region[] = []
  for (let ci = 0; ci < 2; ci++) {
    if (!cols[ci].length) continue
    const left = Math.min(...cols[ci].map((c) => c.numBox.x))
    const col = cols[ci]
      .filter((c) => c.numBox.x <= left + LEFT_TOL)
      .sort((a, b) => a.numBox.y - b.numBox.y)

    // 열 실측 경계 — 열에 속한 토큰의 최대 우측·하단
    const colTokens = tokens.filter((t) =>
      ci === 0 ? t.box.x + t.box.w / 2 < mid : t.box.x + t.box.w / 2 >= mid,
    )
    const colRight = Math.min(
      Math.max(...colTokens.map((t) => t.box.x + t.box.w)) + PAD,
      ci === 0 ? mid - PAD : MAX_W - PAD,
    )
    const colBottom = Math.max(...colTokens.map((t) => t.box.y + t.box.h))

    const seen = new Set<number>()
    for (let i = 0; i < col.length; i++) {
      const c = col[i]
      if (seen.has(c.num)) continue
      seen.add(c.num)
      const top = c.numBox.y - PAD
      const bottom = i + 1 < col.length ? col[i + 1].numBox.y - PAD : colBottom + PAD
      const x = left - PAD
      const bounds: Box = { x, y: top, w: colRight - x, h: bottom - top }
      regions.push(buildRegion(docId, page, c, bounds, tokens))
    }
  }
  return regions.sort((a, b) => Number(a.numLabel) - Number(b.numLabel))
}

function buildRegion(docId: string, page: number, cand: Cand, bounds: Box, all: TextToken[]): Region {
  const inside = all.filter((t) => {
    const cx = t.box.x + t.box.w / 2
    const cy = t.box.y + t.box.h / 2
    return cx >= bounds.x && cx <= bounds.x + bounds.w && cy >= bounds.y && cy <= bounds.y + bounds.h
  })

  // 원문자 토큰 → 선지. 같은 라벨 중복은 첫 것만 (그림 속 재등장 방어)
  const choiceToks: ChoiceToken[] = []
  const seenLabel = new Set<number>()
  for (const t of inside.slice().sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
    const idx = CIRCLED.indexOf(t.str.trim().charAt(0))
    if (idx < 0) continue
    const label = (idx + 1) as ChoiceLabel
    if (seenLabel.has(label)) continue
    seenLabel.add(label)
    choiceToks.push({ label, box: t.box })
  }

  let ansBox: Box | undefined
  let choices: Region['choices'] = []
  if (choiceToks.length >= 2) {
    const minX = Math.min(...choiceToks.map((t) => t.box.x))
    const minY = Math.min(...choiceToks.map((t) => t.box.y))
    const maxY = Math.max(...choiceToks.map((t) => t.box.y + t.box.h))
    // 우측 경계는 열 우단까지 — 마지막 선지의 답 텍스트("⑤ 9")를 포함해야 동그라미가 잡힌다
    ansBox = { x: minX - 2, y: minY - 2, w: bounds.x + bounds.w - PAD - (minX - 2), h: maxY - minY + 4 }
    choices = splitChoices(choiceToks, ansBox)
  }

  const stemBottom = ansBox ? ansBox.y : bounds.y + Math.min(60, bounds.h * 0.4)
  const workTop = ansBox ? ansBox.y + ansBox.h + 4 : stemBottom
  return {
    id: `${docId}:p${page}:n${cand.num}`,
    docId,
    page,
    bounds,
    numBox: cand.numBox,
    numLabel: String(cand.num),
    stemBox: { x: bounds.x, y: bounds.y, w: bounds.w, h: stemBottom - bounds.y },
    ansBox,
    choices,
    ansSynth: choices.length === 0,
    workBox: { x: bounds.x, y: workTop, w: bounds.w, h: Math.max(0, bounds.y + bounds.h - workTop) },
    answerType: choices.length >= 2 ? 'choice' : 'integer',
  }
}
