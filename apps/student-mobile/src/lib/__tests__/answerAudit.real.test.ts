// 답지 대조 실측 — **라벨을 한 쪽도 만들지 않고** 지금 검출의 실패 지점을 전수로 짚는다.
//
//   PURI_PROBLEM_PDF="~/Desktop/수학 문제집/문제/suneung27mo06_2.pdf" \
//   PURI_ANSWER_PDF="~/Desktop/수학 문제집/답지/suneung27mo06_2a.pdf" \
//   npx vitest run answeraudit
//
// 답지는 출판사가 만든 것이라 우리 검출기와 완전히 독립이다. 여기서 얻는 것은 둘이다 —
// 놓친 문항 번호(그 구간이 곧 라벨할 쪽)와 객관식 오판(M2의 독립 근거).
//
// ★ 텍스트 경로로 돈다. 스캔 경로는 설계상 번호 '값'을 읽지 않아(§4.3) 번호로 견줄 수 없다.
//   그래서 이 감사는 벡터 PDF에만 쓴다 — 표본 5권 중 3권이 벡터다.
import './canvasGlobals'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { auditAgainstAnswers, missingRuns, parseAnswerBook, type AnswerLine } from '../answerAudit'
import { extractLines } from '../pdfText'
import { runPipeline } from '../psp'
import { pageInput, toAppRegions } from '../psp/adapter'
import { openPdf } from './pdfDoc'
import type { PageInput } from '../psp/types'
import type { Region } from '../../types'

const expand = (p?: string) => p?.replace(/^~/, process.env.HOME ?? '~')
const PROBLEM = expand(process.env.PURI_PROBLEM_PDF)
const ANSWER = expand(process.env.PURI_ANSWER_PDF)

const ready = !!PROBLEM && !!ANSWER && existsSync(PROBLEM) && existsSync(ANSWER)
const suite = ready ? describe : describe.skip

suite('답지 대조', () => {
  it('검출 번호를 답지와 견준다', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

    // ---------- 답지 ----------
    const answerPdf = await openPdf(pdfjs, new Uint8Array(readFileSync(ANSWER!)))
    const lines: AnswerLine[] = []
    for (let p = 1; p <= answerPdf.numPages; p++) {
      for (const l of await extractLines(await answerPdf.getPage(p))) {
        lines.push({ text: l.text, tokens: l.tokens.map((t) => t.str) })
      }
    }
    const answers = parseAnswerBook(lines)

    // ---------- 문제집 ----------
    const pdf = await openPdf(pdfjs, new Uint8Array(readFileSync(PROBLEM!)))
    const inputs: PageInput[] = []
    for (let p = 1; p <= pdf.numPages; p++) inputs.push(await pageInput(pdf, p, true))
    const regions = toAppRegions(runPipeline(inputs, { jobId: 'audit' }), 'audit')

    const audit = auditAgainstAnswers(regions, answers)

    // ---------- 보고 ----------
    const choiceN = [...answers.values()].filter((a) => a.kind === 'choice').length
    console.log(
      `\n${PROBLEM!.split('/').pop()} · ${pdf.numPages}쪽` +
        `\n  답지   문항 ${audit.expected} (객관식 ${choiceN} · 주관식 ${audit.expected - choiceN})` +
        `\n  검출   번호 ${audit.detected} · 맞은 번호 ${audit.matched}` +
        ` · 번호 재현율 ${(audit.numberRecall * 100).toFixed(1)}%` +
        `\n  객관식 판정  ${audit.kind.agreed}/${audit.kind.compared}` +
        (audit.kind.accuracy === null ? '' : ` (${(audit.kind.accuracy * 100).toFixed(1)}%)`),
    )

    if (!audit.reliable) {
      console.log(
        `\n⚠ 이 책에는 이 감사를 쓸 수 없다 — 검출 번호의 ${(audit.duplicateRate * 100).toFixed(0)}%가 중복이다.` +
          `\n  단원마다 번호가 1부터 다시 시작하는 조판이면 "번호가 문서 안에서 유일하다"는` +
          `\n  전제가 깨지고, 위의 재현율·객관식 판정은 낮은 게 아니라 잣대가 안 맞는 것이다.` +
          `\n  그런 책은 답지 대신 손 라벨로 가야 한다.`,
      )
      return
    }

    if (audit.missing.length) {
      console.log(`\n놓친 번호 ${audit.missing.length}개: ${brief(audit.missing)}`)
      const runs = missingRuns(audit.missing)
      if (runs.length) {
        console.log('  연속 구간 (쪽이 통째로 무너진 자리 — 여기부터 라벨한다):')
        for (const r of runs) {
          console.log(`    ${r.from}~${r.to} (${r.to - r.from + 1}개) — ${around(r, regions)}`)
        }
      }
    }
    if (audit.extra.length) console.log(`\n없는 번호를 만듦 ${audit.extra.length}: ${brief(audit.extra)}`)
    if (audit.duplicated.length) console.log(`\n중복 검출 ${audit.duplicated.length}: ${brief(audit.duplicated)}`)
    if (audit.kind.mismatches.length) {
      console.log('\n객관식 오판 (답지 기준):')
      for (const m of audit.kind.mismatches.slice(0, 20)) {
        console.log(`  ${m.num}번 정답 "${m.answer}" — 답지 ${m.expected} ≠ 검출 ${m.detected}`)
      }
    }

    // 답지를 못 읽었으면 감사가 성립하지 않는다 — 조용히 통과시키지 않는다
    expect(audit.expected, '답지에서 문항을 하나도 못 읽었다').toBeGreaterThan(0)
  }, 900_000)
})

function brief(nums: number[], max = 40): string {
  const head = nums.slice(0, max).join(' ')
  return nums.length > max ? `${head} … (+${nums.length - max})` : head
}

/** 놓친 구간의 앞뒤로 검출된 번호가 있는 쪽 — 어느 쪽을 열어 봐야 하는지 */
function around(run: { from: number; to: number }, regions: Region[]): string {
  const numbered = regions
    .filter((r) => r.numLabel && Number.isFinite(Number(r.numLabel)))
    .map((r) => ({ n: Number(r.numLabel), page: r.page }))
    .sort((a, b) => a.n - b.n)
  const before = [...numbered].reverse().find((x) => x.n < run.from)
  const after = numbered.find((x) => x.n > run.to)
  if (!before && !after) return '쪽 모름'
  if (!before) return `p${after!.page} 앞`
  if (!after) return `p${before.page} 뒤`
  return before.page === after.page ? `p${before.page}` : `p${before.page}~p${after.page}`
}
