// 열 분해 — 다단 정답표에서 (번호, 답)이 열을 건너뛰지 못하게 한다
//
// 정답표는 `번호 답 배점 | 번호 답 배점 | …`이 옆으로 반복되는 조판이다.
// `extractLines`는 한 **시각적 행 전체**를 한 줄로 묶으므로, 토큰 경로가 행을 훑다가
// 배점이 없거나 조판이 어긋난 자리에서 **다음 열의 답을 끌어다 붙일 수 있다.**
// 그 실패는 형식이 완벽해서 수열 검산도 통과한다 — 가장 위험한 조용한 실패다.
//
// 여기서는 행을 **열 단위로 먼저 자르고** 각 열 안에서만 트리플을 훑는다.
// 열 경계를 넘는 짝짓기가 구조적으로 불가능해진다.
//
// ★ 이 경로는 토큰 경로의 "독립된 제3의 의견"이 아니라 **제약을 건 재독**이다.
//   둘이 갈리는 자리는 곧 "토큰 경로가 열을 건너뛴 자리"를 가리킨다.
import type { TextLine, TextToken } from '../pdfText'
import { walkTriples, type RawAnswer, type WalkOptions } from './textPath'

/**
 * 열 경계로 볼 최소 간격 = 그 쪽 토큰 간격 중앙값 × 이 배수.
 * 3.0은 "글자 사이 간격의 세 배쯤 벌어지면 다른 열"이라는 뜻 — 실측으로 조정할 자리다.
 * 너무 낮으면 한 열이 쪼개지고(문항 유실), 너무 높으면 열이 붙는다(열 어긋남 재발).
 */
export const COL_GAP_FACTOR = 3.0

/** 중앙값이 0에 가까운 쪽(토큰이 붙어 나오는 조판)에서 바닥값 */
export const COL_GAP_MIN = 6

/** 한 쪽의 토큰 간 x 간격 중앙값 */
export function medianTokenGap(lines: TextLine[]): number {
  const gaps: number[] = []
  for (const line of lines) {
    const t = [...line.tokens].sort((a, b) => a.box.x - b.box.x)
    for (let i = 1; i < t.length; i++) {
      const g = t[i].box.x - (t[i - 1].box.x + t[i - 1].box.w)
      if (g >= 0) gaps.push(g)
    }
  }
  if (!gaps.length) return 0
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]
}

/** 큰 간격에서 토큰 배열을 끊는다 */
export function splitRuns(tokens: TextToken[], gapMin: number): TextToken[][] {
  const sorted = [...tokens].sort((a, b) => a.box.x - b.box.x)
  const runs: TextToken[][] = []
  let cur: TextToken[] = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const prev = sorted[i - 1].box
      const gap = sorted[i].box.x - (prev.x + prev.w)
      if (gap >= gapMin) {
        runs.push(cur)
        cur = []
      }
    }
    cur.push(sorted[i])
  }
  if (cur.length) runs.push(cur)
  return runs
}

/** 경로 C: 열 단위로 잘라 읽는다 */
export function readGridPath(
  lines: TextLine[],
  page: number,
  opts: WalkOptions = {},
): RawAnswer[] {
  const median = medianTokenGap(lines)
  const gapMin = Math.max(COL_GAP_MIN, median * COL_GAP_FACTOR)
  const out: RawAnswer[] = []
  for (const line of lines) {
    for (const run of splitRuns(line.tokens, gapMin)) {
      out.push(...walkTriples(run, page, 'grid', opts))
    }
  }
  return out
}
