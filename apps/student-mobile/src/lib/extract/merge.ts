// 경로 합의 — 라벨 없이 신뢰도를 만드는 유일하게 정직한 방법
//
// 같은 (단원, 번호)에 대해 여러 경로가 낸 값을 모아 다수결한다.
//   전원 일치  → 확정
//   갈림       → `conflict` — 검수 큐로 간다
//   한 경로만  → `single_path` — 교차검증이 없다는 뜻이지 틀렸다는 뜻은 아니다
//
// ★ 같은 경로를 여러 번 돌리는 것은 소용이 없다. 같은 방향으로 틀린다.
//   `readTokenPath`와 `readLinePath`가 서로 다르게 틀리기 때문에 합의가 신호가 된다.
import type { RawAnswer } from './textPath'
import { problemKey, type PathId, type ProblemAnswer, type ProblemFlag } from './schema'
import type { Box } from '../../types'

/**
 * 번호와 답이 이만큼 넘게 떨어져 있으면 다른 열의 답을 붙였을 수 있다 (정규화 MAX_W=760 기준).
 * 60은 2단 정답표의 열 간격보다 좁게 잡은 초기값 — 실측으로 고칠 자리다.
 * 이 검사가 없으면 다단 표 열 어긋남이 "형식은 완벽한데 전부 틀린" 채로 통과한다.
 */
export const GEOM_MAX_GAP = 60

export type Conflict = {
  key: string
  /** 경로별로 낸 값 */
  votes: { path: PathId; value: string }[]
}

export type MergeResult = {
  problems: ProblemAnswer[]
  conflicts: Conflict[]
}

/** 번호와 답 상자가 같은 행에서 인접한가 — 열 어긋남 방어 */
export function adjacent(numBox: Box | null, valueBox: Box | null): boolean {
  if (!numBox || !valueBox) return true // 위치를 모르면 판단하지 않는다 (no_box로 따로 잡힌다)
  const sameRow =
    Math.abs(numBox.y + numBox.h / 2 - (valueBox.y + valueBox.h / 2)) <
    Math.max(numBox.h, valueBox.h) * 0.8
  const gap = valueBox.x - (numBox.x + numBox.w)
  return sameRow && gap >= -numBox.w && gap <= GEOM_MAX_GAP
}

/**
 * 경로별 읽기 결과 → 문항 목록.
 * `sectionOf`는 읽기를 단원에 배정한다 (기본: 단일 단원).
 */
export function mergePaths(
  reads: RawAnswer[][],
  sectionOf: (r: RawAnswer) => string = () => 'S1',
): MergeResult {
  const pathCount = reads.length
  const groups = new Map<string, { sectionId: string; items: RawAnswer[] }>()

  for (const read of reads) {
    for (const r of read) {
      const sectionId = sectionOf(r)
      const key = problemKey(sectionId, r.number)
      const g = groups.get(key) ?? { sectionId, items: [] }
      g.items.push(r)
      groups.set(key, g)
    }
  }

  const problems: ProblemAnswer[] = []
  const conflicts: Conflict[] = []

  for (const [key, { sectionId, items }] of groups) {
    // 경로마다 첫 값만 센다 — 한 경로가 같은 문항을 두 번 읽어도 표를 두 장 갖지 않는다
    const byPath = new Map<PathId, RawAnswer>()
    for (const r of items) if (!byPath.has(r.path)) byPath.set(r.path, r)

    const tally = new Map<string, RawAnswer[]>()
    for (const r of byPath.values()) {
      const arr = tally.get(r.value) ?? []
      arr.push(r)
      tally.set(r.value, arr)
    }

    const ranked = [...tally.entries()].sort((a, b) => b[1].length - a[1].length)
    const [value, winners] = ranked[0]
    const win = winners[0]
    const paths = byPath.size

    const flags: ProblemFlag[] = []
    if (ranked.length > 1) {
      flags.push('conflict')
      conflicts.push({
        key,
        votes: [...byPath.values()].map((r) => ({ path: r.path, value: r.value })),
      })
    }
    if (paths < 2 && pathCount > 1) flags.push('single_path')
    if (!win.numBox || !win.valueBox) flags.push('no_box')
    else if (!adjacent(win.numBox, win.valueBox)) flags.push('geometry')

    problems.push({
      sectionId,
      number: win.number,
      value,
      choice: win.choice,
      page: win.page,
      numBox: win.numBox,
      valueBox: win.valueBox,
      agreement: winners.length,
      paths,
      flags,
      reviewed: false,
    })
  }

  problems.sort((a, b) => a.sectionId.localeCompare(b.sectionId) || a.number - b.number)
  return { problems, conflicts }
}

// ---------- 수열 빈칸 ----------

/** 단원별로 번호가 연속인지 본다. 빈칸 앞뒤 문항에 `seq_gap`을 붙인다 */
export function markSequenceGaps(problems: ProblemAnswer[]): ProblemAnswer[] {
  const bySection = new Map<string, ProblemAnswer[]>()
  for (const p of problems) {
    const arr = bySection.get(p.sectionId) ?? []
    arr.push(p)
    bySection.set(p.sectionId, arr)
  }
  for (const arr of bySection.values()) {
    arr.sort((a, b) => a.number - b.number)
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].number - arr[i - 1].number > 1) {
        for (const p of [arr[i - 1], arr[i]]) {
          if (!p.flags.includes('seq_gap')) p.flags.push('seq_gap')
        }
      }
    }
  }
  return problems
}
