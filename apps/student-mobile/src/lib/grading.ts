// 객관식 기하 판정 (§7.2)
// 동그라미·빗금·체크·밑줄이 모두 "닫힌 고리 / 열린 마크" 한 규칙으로 처리된다.
// 전제: 지우개는 스트로크 단위 — 픽셀 지우개면 지운 자국이 후보를 오염시킨다.
import type { Attempt, AnswerEntry, Box, Region, Stroke, Point, RetryList } from '../types'
import { boxCenter, isClosedLoop, pointInPolygon, ratioInside, expand } from './geometry'

// 열린 마크가 선지 박스와 이 비율 미만으로 겹치면 마크로 보지 않는다
const MIN_OVERLAP = 0.25

/**
 * 열린 마크를 볼 때 선지 박스를 넓히는 여유 — 학생은 박스보다 크게 긋는다.
 *
 * ★ 절대값과 상대값 중 **작은 쪽**을 쓴다. 예전에는 4(정규화 좌표) 고정이었는데, 선지 띠가
 *   작은 조판에서는 사방 4씩 넓히면 상자가 배 이상 부풀어 **이웃 줄을 통째로 삼킨다.**
 *   실측 수학의 신 p3: 3+2 배치의 띠 높이가 5.4인데 13.4가 되어, ④에 친 체크가 ①의 상자에도
 *   100% 들어갔다. 그러면 겹침 비율이 둘 다 1.0이 되고, 동점 규칙이 없던 시절에는 먼저
 *   순회한 낮은 번호가 이겨 ④→①·⑤→②로 읽혔다 (판정 기하 상한 99.83%의 정체).
 *
 *   상한 4는 그대로 두었다 — 짧은 변이 16 이상인 보통 크기 선지에서는 값이 4로 같아
 *   기존 동작이 바뀌지 않는다. 작은 띠에서만 줄어든다.
 */
const CHOICE_PAD_MAX = 4
const CHOICE_PAD_RATIO = 0.25

function choicePad(box: Box): number {
  return Math.min(CHOICE_PAD_MAX, Math.min(box.w, box.h) * CHOICE_PAD_RATIO)
}

/** 겹침 비율이 이 안에서 같으면 동점으로 본다 */
const RATIO_EPS = 1e-6

export function detectChoice(region: Region, strokes: Stroke[]): number | null {
  const candidates: { label: number; at: number }[] = []

  for (const s of strokes) {
    if (s.points.length === 0) continue
    if (s.tool === 'hi') continue        // 형광펜은 답 마크가 아니다
    const label = isClosedLoop(s.points)
      ? choiceInsideLoop(s.points, region.choices)     // 고리 내부에 중심이 들어오는 선지
      : choiceByOverlap(s.points, region.choices)      // 겹치는 점 비율 최대
    if (label) candidates.push({ label, at: lastTime(s) })
  }

  if (!candidates.length) return null
  return candidates.sort((a, b) => b.at - a.at)[0].label   // 마지막 스트로크 우선
}

function choiceInsideLoop(pts: Point[], choices: Region['choices']): number | null {
  let best: { label: number; d: number } | null = null
  // 고리 중심에 가장 가까운 선지를 고른다 — 큰 고리가 여러 선지를 덮는 경우 대비
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
  for (const c of choices) {
    // 판정점 두 개 — 선지 박스는 기호부터 다음 기호 직전까지라 중심이 오른쪽으로 치우친다.
    // 기호(박스 왼쪽의 정사각 영역)에만 동그라미를 쳐도, 답 전체를 감싸도 잡히게 둘 다 본다
    const sym = { x: c.box.x + Math.min(c.box.h, c.box.w) / 2, y: c.box.y + c.box.h / 2 }
    const center = boxCenter(c.box)
    const hit = [sym, center].find((p) => pointInPolygon(p.x, p.y, pts))
    if (!hit) continue
    const d = Math.hypot(hit.x - cx, hit.y - cy)
    if (!best || d < best.d) best = { label: c.label, d }
  }
  return best ? best.label : null
}

function choiceByOverlap(pts: Point[], choices: Region['choices']): number | null {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length

  let best: { label: number; ratio: number; d: number } | null = null
  for (const c of choices) {
    const ratio = ratioInside(pts, expand(c.box, choicePad(c.box)))
    if (ratio < MIN_OVERLAP) continue
    // 판정점은 기호와 박스 중심 둘 다 본다 — choiceInsideLoop과 같은 규약
    const sym = { x: c.box.x + Math.min(c.box.h, c.box.w) / 2, y: c.box.y + c.box.h / 2 }
    const mid = boxCenter(c.box)
    const d = Math.min(Math.hypot(sym.x - cx, sym.y - cy), Math.hypot(mid.x - cx, mid.y - cy))
    // ★ 동점이면 마크 중심에 가까운 쪽. 예전에는 순회 순서(= 번호 순)로 갈려, 여러 상자에
    //   똑같이 걸친 마크가 **언제나 낮은 번호로** 읽혔다. 닫힌 고리 경로는 이미 거리로
    //   가르고 있었다 — 열린 마크만 규칙이 달랐던 것이다
    const better =
      !best ||
      ratio > best.ratio + RATIO_EPS ||
      (Math.abs(ratio - best.ratio) <= RATIO_EPS && d < best.d)
    if (better) best = { label: c.label, ratio, d }
  }
  return best ? best.label : null
}

function lastTime(s: Stroke): number {
  return s.points[s.points.length - 1]?.t ?? 0
}

// ---------- 문항 채점 ----------

export function gradeRegion(
  region: Region,
  strokes: Stroke[],              // 이 region에 귀속된 + 현재 회차의 스트로크만
  entry: AnswerEntry | undefined,
  attemptNo: number,
  gradedAt: number,
): Attempt {
  const base = { docId: region.docId, regionId: region.id, no: attemptNo, gradedAt }

  // 1차는 choice만 채점 — 나머지 유형은 정답이 있어도 판정하지 않는다
  if (region.answerType !== 'choice' || region.choices.length === 0) {
    return { ...base, detected: null, result: entry ? 'unattempted' : 'nokey' }
  }
  if (!entry) {
    return { ...base, detected: null, result: 'nokey' }
  }

  const detected = detectChoice(region, strokes)
  if (detected === null) {
    return { ...base, detected: null, result: 'unattempted' }
  }
  return {
    ...base,
    detected: String(detected),
    result: String(detected) === entry.value ? 'correct' : 'incorrect',
  }
}

/**
 * 다시풀기 목록 — 오답 이력 기준 누적 관리.
 *
 * 한 번이라도 틀린 문항은 3연속 정답(졸업)까지 regionIds에 남는다:
 * - 이번 채점의 오답은 항상 추가
 * - 이번 채점으로 3연속 정답을 달성한 문항은 graduated로 옮겨져
 *   요약에 '졸업'으로 한 번 표시되고, 다음 채점부터는 완전히 사라진다
 */
export function buildRetryList(
  docId: string,
  attempts: Attempt[],                          // 이번 채점 회차 결과
  attemptsByRegion: Record<string, Attempt[]>,  // 문항별 전체 회차 (이번 회차 포함)
  prev: RetryList | null,
  gradedAt: number,
): RetryList {
  const wrongNow = attempts.filter((a) => a.result === 'incorrect').map((a) => a.regionId)
  const candidates = [...new Set([...(prev?.regionIds ?? []), ...wrongNow])]

  const regionIds: string[] = []
  const graduated: string[] = []
  for (const id of candidates) {
    const consec = consecutiveCorrect(attemptsByRegion[id] ?? [])
    if (consec >= 3) graduated.push(id)
    else regionIds.push(id)
  }
  return { docId, gradedAt, regionIds, graduated }
}

/** 한 문제의 최신 회차부터 이어진 연속 정답 수 — 3연속이면 졸업 (시안2 ReviewChecks) */
export function consecutiveCorrect(attempts: Attempt[]): number {
  const sorted = [...attempts].sort((a, b) => b.no - a.no)
  let count = 0
  for (const a of sorted) {
    if (a.result === 'correct') count++
    else break
  }
  return count
}
