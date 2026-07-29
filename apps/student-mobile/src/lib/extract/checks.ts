// 검산기 4종 — 라벨 없이 돌아가는 무료 검증
//
// 정답지에는 사람 라벨 없이도 검산할 수 있는 구조가 들어 있다. 이 넷이 99%의 실제 엔진이다:
// 자동 정확도를 올리는 게 아니라, **틀렸을 때 조용히 넘어가지 않게** 만든다.
//
//   C1 수열      단원 안에서 번호가 1..N 연속인가        → 누락·중복
//   C2 답 분포   ①~⑤가 대략 균등한가 (χ²)               → **열 어긋남**
//   C3 쪽 연결   이전 쪽 마지막 +1 = 다음 쪽 첫 번호      → 쪽 통째 유실
//   C4 커버리지  원문자 개수 대비 파싱된 객관식 수         → 파서가 놓친 양
//
// ★ C2가 가장 중요하다. 다단 표 열 어긋남은 번호가 전부 있고 형식도 완벽해서
//   C1·C3를 통과한다. 답 분포만 무너진다 — 그래서 이 검정이 없으면 검출되지 않는다.
import type { AnswerKeyExtract, ProblemAnswer } from './schema'
import { problemKey } from './schema'

export type CheckId = 'sequence' | 'distribution' | 'page_link' | 'coverage'
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip'

export type CheckResult = {
  id: CheckId
  label: string
  status: CheckStatus
  /** 한 줄 결론 */
  headline: string
  /** 근거 숫자 */
  detail: string
  /** 문제가 된 문항 키 — 검수 큐로 넘어간다 */
  keys: string[]
}

/** χ² 임계값, 자유도 4(선지 5개 − 1), 유의수준 0.01 */
export const CHI2_CRIT_DF4 = 13.277

/** 답 분포 검정에 필요한 최소 표본. 이보다 적으면 균등성을 말할 수 없다 */
export const DIST_MIN_N = 30

// ---------- C1 수열 ----------

export function checkSequence(x: AnswerKeyExtract): CheckResult {
  const missing: string[] = []
  let expected = 0
  let found = 0

  for (const s of x.sections) {
    const nums = new Set(x.problems.filter((p) => p.sectionId === s.id).map((p) => p.number))
    if (nums.size === 0) continue
    const from = Math.min(...nums)
    const to = Math.max(...nums)
    for (let n = from; n <= to; n++) {
      expected++
      if (nums.has(n)) found++
      else missing.push(problemKey(s.id, n))
    }
  }

  const ratio = expected ? found / expected : 1
  return {
    id: 'sequence',
    label: '번호 수열',
    status: missing.length === 0 ? 'pass' : ratio >= 0.95 ? 'warn' : 'fail',
    headline: missing.length === 0 ? '빈칸 없음' : `${missing.length}개 빠짐`,
    detail: `${found}/${expected} (${Math.round(ratio * 100)}%)`,
    keys: missing.slice(0, 200),
  }
}

// ---------- C2 답 분포 ----------

export function checkDistribution(x: AnswerKeyExtract): CheckResult {
  const counts = [0, 0, 0, 0, 0]
  for (const p of x.problems) {
    if (!p.choice) continue
    const i = Number(p.value) - 1
    if (i >= 0 && i < 5) counts[i]++
  }
  const n = counts.reduce((a, b) => a + b, 0)
  const shown = counts.map((c, i) => `${'①②③④⑤'[i]}${c}`).join(' ')

  if (n < DIST_MIN_N) {
    return {
      id: 'distribution',
      label: '답 분포',
      status: 'skip',
      headline: `표본 ${n}개 — 판정 보류`,
      detail: `${shown} · 최소 ${DIST_MIN_N}개 필요`,
      keys: [],
    }
  }

  const e = n / 5
  const chi2 = counts.reduce((s, o) => s + ((o - e) * (o - e)) / e, 0)
  const worst = counts.indexOf(Math.max(...counts))

  return {
    id: 'distribution',
    label: '답 분포',
    status: chi2 < CHI2_CRIT_DF4 ? 'pass' : chi2 < CHI2_CRIT_DF4 * 2 ? 'warn' : 'fail',
    headline: chi2 < CHI2_CRIT_DF4 ? '균등' : `${'①②③④⑤'[worst]}에 쏠림 — 열 어긋남 의심`,
    detail: `χ²=${chi2.toFixed(1)} (임계 ${CHI2_CRIT_DF4}) · ${shown}`,
    keys: [],
  }
}

// ---------- C3 쪽 연결 ----------

export function checkPageLink(x: AnswerKeyExtract): CheckResult {
  const broken: string[] = []
  let links = 0

  for (const s of x.sections) {
    const byPage = new Map<number, ProblemAnswer[]>()
    for (const p of x.problems) {
      if (p.sectionId !== s.id) continue
      const arr = byPage.get(p.page) ?? []
      arr.push(p)
      byPage.set(p.page, arr)
    }
    const pages = [...byPage.keys()].sort((a, b) => a - b)
    for (let i = 1; i < pages.length; i++) {
      // 연속한 쪽끼리만 본다 — 사이가 비면 그건 수열 검산의 몫이다
      if (pages[i] !== pages[i - 1] + 1) continue
      const last = Math.max(...byPage.get(pages[i - 1])!.map((p) => p.number))
      const first = Math.min(...byPage.get(pages[i])!.map((p) => p.number))
      links++
      if (first !== last + 1) broken.push(problemKey(s.id, first))
    }
  }

  return {
    id: 'page_link',
    label: '쪽 연결',
    status: broken.length === 0 ? 'pass' : broken.length <= 1 ? 'warn' : 'fail',
    headline: broken.length === 0 ? '끊김 없음' : `${broken.length}곳 끊김`,
    detail: `연결 지점 ${links}곳`,
    keys: broken,
  }
}

// ---------- C4 커버리지 ----------

/**
 * 쪽마다 텍스트에 있던 원문자 수를 받아, 그중 몇 개가 문항이 되었는지 본다.
 *
 * ☞ 해설 쪽의 "따라서 답은 ③이다" 같은 원문자도 세어지므로 **과소평가 쪽으로 치우친다.**
 *   그래서 임계를 낮게 잡았다. 100%가 아니라 "급격히 낮은 책"을 잡는 것이 목적이다.
 */
export function checkCoverage(
  x: AnswerKeyExtract,
  circledPerPage: Record<number, number>,
): CheckResult {
  const circled = Object.values(circledPerPage).reduce((a, b) => a + b, 0)
  const parsed = x.problems.filter((p) => p.choice).length

  if (circled === 0) {
    return {
      id: 'coverage',
      label: '커버리지',
      status: 'skip',
      headline: '원문자 0개 — 판정 보류',
      detail: '텍스트에 ①~⑤가 없다 (스캔본이거나 숫자 표기)',
      keys: [],
    }
  }

  const ratio = parsed / circled
  return {
    id: 'coverage',
    label: '커버리지',
    status: ratio >= 0.7 ? 'pass' : ratio >= 0.4 ? 'warn' : 'fail',
    headline: ratio >= 0.7 ? '대부분 잡음' : `원문자의 ${Math.round(ratio * 100)}%만 문항이 됐다`,
    detail: `파싱 ${parsed} / 원문자 ${circled} · 해설 쪽 원문자가 섞여 낮게 나온다`,
    keys: [],
  }
}

// ---------- 종합 ----------

export type CheckReport = {
  results: CheckResult[]
  /** 하나라도 fail이면 불합격 */
  verdict: 'pass' | 'warn' | 'fail'
  /** 검수 큐로 넘어갈 문항 수 (검산 + 플래그 합집합) */
  queue: number
}

export function runChecks(
  x: AnswerKeyExtract,
  circledPerPage: Record<number, number>,
): CheckReport {
  const results = [
    checkSequence(x),
    checkDistribution(x),
    checkPageLink(x),
    checkCoverage(x, circledPerPage),
  ]

  const verdict = results.some((r) => r.status === 'fail')
    ? 'fail'
    : results.some((r) => r.status === 'warn')
      ? 'warn'
      : 'pass'

  const keys = new Set(results.flatMap((r) => r.keys))
  for (const p of x.problems) {
    if (p.flags.length > 0) keys.add(problemKey(p.sectionId, p.number))
  }

  return { results, verdict, queue: keys.size }
}
