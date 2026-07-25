// 정답지·정답표 파싱 (§7.3)
// OCR을 쓰지 않는다. pdf.js getTextContent() 텍스트를 정규식으로 판정한다.
// 전제: PDF는 글자를 조각내서 주므로, 호출자가 같은 줄 글자를 이어 붙인 줄 단위로 넘긴다.
// 해설 문장("따라서 답은 ③이다")은 파싱하지 않는다 — 직접 입력으로 넘긴다.
import type { AnswerEntry, Region } from '../types'

const CIRCLED = '①②③④⑤'

const PATTERNS = [
  /(\d{1,2})\s*[.)]?\s*([①②③④⑤])/g,      // 12. ③
  /(\d{1,2})\s*[.)]?\s*([1-5])(?!\d)/g,     // 12) 3
]

export type ParsedAnswer = { num: number; value: string }

function toDigit(mark: string): string {
  const i = CIRCLED.indexOf(mark)
  return i >= 0 ? String(i + 1) : mark
}

/** 한 줄에서 문항 번호·정답 쌍을 모두 추출한다 */
export function parseAnswerLine(line: string): ParsedAnswer[] {
  for (const pattern of PATTERNS) {
    const out: ParsedAnswer[] = []
    for (const m of line.matchAll(pattern)) {
      out.push({ num: Number(m[1]), value: toDigit(m[2]) })
    }
    // 원문자 패턴이 하나라도 맞으면 숫자 패턴은 시도하지 않는다 — 오검출 방지
    if (out.length) return out
  }
  return []
}

/** 여러 줄 → 문항 번호별 정답. 같은 번호가 중복되면 먼저 나온 것을 유지한다 */
export function parseAnswerLines(lines: string[]): Map<number, string> {
  const answers = new Map<number, string>()
  for (const line of lines) {
    for (const { num, value } of parseAnswerLine(line)) {
      if (!answers.has(num)) answers.set(num, value)
    }
  }
  return answers
}

/**
 * 정답표(문항|정답|배점 반복) 토큰 트리플 파서 — 단답형 정답(다자리 수)까지 잡는다.
 * 붙여진 줄 텍스트로는 "16|2|3"이 "1623"이 되어 정규식으로 복원할 수 없다.
 */
export function parseAnswerTokenLine(strs: string[]): ParsedAnswer[] {
  const out: ParsedAnswer[] = []
  let i = 0
  while (i < strs.length) {
    const numTok = strs[i].trim()
    if (/^\d{1,2}$/.test(numTok)) {
      const num = Number(numTok)
      const ans = strs[i + 1]?.trim()
      const pts = strs[i + 2]?.trim()
      const ptsOk = pts !== undefined && /^[2-4]$/.test(pts)
      if (num >= 1 && num <= 30 && ans) {
        const circ = CIRCLED.indexOf(ans)
        if (circ >= 0) {
          out.push({ num, value: String(circ + 1) })
          i += ptsOk ? 3 : 2
          continue
        }
        // 단답형: 정답이 1~3자리 수이고 뒤에 배점이 따라올 때만 — 오검출 방지
        if (/^\d{1,3}$/.test(ans) && ptsOk) {
          out.push({ num, value: ans })
          i += 3
          continue
        }
      }
    }
    i++
  }
  return out
}

/** 줄 텍스트+토큰 → 정답 맵. 토큰 트리플 우선, 없으면 줄 텍스트 정규식 폴백 */
export function parseAnswerTable(lines: { text: string; tokens: string[] }[]): Map<number, string> {
  const answers = new Map<number, string>()
  for (const line of lines) {
    const parsed = parseAnswerTokenLine(line.tokens)
    const rows = parsed.length ? parsed : parseAnswerLine(line.text)
    for (const { num, value } of rows) {
      if (!answers.has(num)) answers.set(num, value)
    }
  }
  return answers
}

/** 파싱 결과를 Region.numLabel과 매칭해 AnswerEntry로 변환한다. source는 문항 단위 */
export function buildEntries(
  answers: Map<number, string>,
  regions: Region[],
  source: AnswerEntry['source'],
): AnswerEntry[] {
  const entries: AnswerEntry[] = []
  for (const r of regions) {
    if (!r.numLabel) continue
    const value = answers.get(Number(r.numLabel))
    if (value !== undefined) entries.push({ regionId: r.id, value, source })
  }
  return entries
}
