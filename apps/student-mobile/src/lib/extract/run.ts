// 텍스트 경로 실행 — PDF 한 권 → 스키마 v1 산출물 + 검산 리포트
//
// 3경로로 읽고(토큰 / 줄텍스트 / 열), 합의를 세고, 단원을 붙이고, 검산 4종을 돌린다.
// pdf.js를 직접 import하지 않는다 — 줄 추출 함수를 주입받아 Node에서도 그대로 돈다.
import type { TextLine } from '../pdfText'
import { markSequenceGaps, mergePaths, type Conflict } from './merge'
import { readLinePath, readTokenPath, type RawAnswer } from './textPath'
import { readGridPath } from './columns'
import { buildSections, detectSectionHeaders, type SectionHeader } from './sections'
import { runChecks, type CheckReport } from './checks'
import { emptyExtract, type AnswerKeyExtract } from './schema'

/** 문제집 정답지의 번호 상한. 수능용 30에 맞춰진 기본값을 여기서 넓힌다 */
export const BOOK_MAX_NUMBER = 300

const RE_CIRCLED = /[①-⑤]/g

export type RunOptions = {
  pages: number
  getLines: (page: number) => Promise<TextLine[]>
  /** `lib/hash.ts`의 `sha256Short` 결과 */
  source: string
  sourceName: string
  /** 호출자가 넘긴다 — 테스트가 시간에 흔들리지 않게 */
  extractedAt: string
  maxNumber?: number
  onPage?: (done: number, total: number) => void
  signal?: { aborted: boolean }
}

export type RunResult = {
  extract: AnswerKeyExtract
  conflicts: Conflict[]
  /** 경로별로 몇 개를 읽었나 — 격차 자체가 정보다 */
  perPath: { token: number; line: number; grid: number }
  headers: SectionHeader[]
  circledPerPage: Record<number, number>
  checks: CheckReport
}

export async function runTextExtract(opts: RunOptions): Promise<RunResult> {
  const maxNumber = opts.maxNumber ?? BOOK_MAX_NUMBER
  const walk = { maxNumber }

  const tokenReads: RawAnswer[] = []
  const lineReads: RawAnswer[] = []
  const gridReads: RawAnswer[] = []
  const headers: SectionHeader[] = []
  const circledPerPage: Record<number, number> = {}

  for (let p = 1; p <= opts.pages; p++) {
    if (opts.signal?.aborted) break
    try {
      const lines = await opts.getLines(p)
      tokenReads.push(...readTokenPath(lines, p, walk))
      lineReads.push(...readLinePath(lines, p, walk))
      gridReads.push(...readGridPath(lines, p, walk))
      headers.push(...detectSectionHeaders(lines, p))

      let circled = 0
      for (const l of lines) {
        RE_CIRCLED.lastIndex = 0
        circled += (l.text.match(RE_CIRCLED) ?? []).length
      }
      circledPerPage[p] = circled
    } catch {
      // 한 쪽이 깨져도 나머지를 읽는다
    }
    opts.onPage?.(p, opts.pages)
  }

  // 단원 경계는 **한 경로의 문서 순서**로 잡는다. 여러 경로를 이어붙이면 순서가 깨져
  // 리셋 신호가 사라진다 (sections.ts 주석). 열 경로는 열마다 훑느라 순서가 뒤섞이므로
  // 기준으로 쓰지 않는다 — 토큰과 줄 중 더 많이 읽은 쪽을 쓴다.
  const reference = lineReads.length > tokenReads.length ? lineReads : tokenReads
  const { sections, sectionOf } = buildSections(reference, headers)
  const { problems, conflicts } = mergePaths([tokenReads, lineReads, gridReads], sectionOf)

  const extract = emptyExtract({
    source: opts.source,
    sourceName: opts.sourceName,
    pages: opts.pages,
    methods: ['token', 'line', 'grid'],
    extractedAt: opts.extractedAt,
  })
  extract.sections = sections
  extract.problems = markSequenceGaps(problems)

  return {
    extract,
    conflicts,
    perPath: { token: tokenReads.length, line: lineReads.length, grid: gridReads.length },
    headers,
    circledPerPage,
    checks: runChecks(extract, circledPerPage),
  }
}
