// 텍스트 경로 읽기 — 서로 다르게 틀리는 경로들
//
// `answerKey.ts`는 두 방식을 갖고 있지만 "토큰 우선, 실패하면 텍스트"로 **하나로 합쳐** 쓴다.
// 여기서는 그 둘을 **독립된 경로로 갈라** 각각 끝까지 읽는다. 이유는 앙상블이다 —
// 두 경로가 서로 다르게 틀리기 때문에, 합의는 라벨 없이 얻는 신뢰도 신호가 된다.
// (`answerKey.ts` 주석이 이미 증거다: 붙인 줄 텍스트로는 "16|2|3"이 "1623"이 되어 복원할 수 없다.)
//
// 원본과 달리 **토큰 위치를 같이 기록한다.** 번호와 답이 얼마나 떨어져 있는지를 코드로
// 검산해야 다단 정답표의 열 어긋남 — 형식은 완벽한데 전부 틀리는 실패 — 을 잡을 수 있다.
import type { TextLine, TextToken } from '../pdfText'
import type { Box } from '../../types'
import type { PathId } from './schema'

const CIRCLED = '①②③④⑤'

/**
 * 번호 상한. `answerKey.ts`는 수능 모의고사(1~30)에 맞춰져 있다.
 * 문제집 정답지는 단원당 100문항을 넘기도 하므로 호출자가 넓혀 쓴다.
 * 기본값을 30으로 둔 것은 기존 파서와의 동치를 테스트로 고정하기 위해서다.
 */
export const DEFAULT_MAX_NUMBER = 30

export type WalkOptions = { maxNumber?: number }

export type RawAnswer = {
  path: PathId
  number: number
  value: string
  choice: boolean
  page: number
  numBox: Box | null
  valueBox: Box | null
}

// ---------- 공통: 문항|정답|배점 트리플 훑기 ----------

/**
 * 토큰 배열을 문항|정답|배점으로 훑는다. `parseAnswerTokenLine`과 값 판정 규칙이 같다.
 * 열 단위로 잘라 넣기 위해 줄이 아니라 **토큰 배열**을 받는다.
 */
export function walkTriples(
  tokens: TextToken[],
  page: number,
  path: PathId,
  opts: WalkOptions = {},
): RawAnswer[] {
  const maxNumber = opts.maxNumber ?? DEFAULT_MAX_NUMBER
  const out: RawAnswer[] = []
  const strs = tokens.map((t) => t.str)
  let i = 0
  while (i < strs.length) {
    const numTok = strs[i].trim()
    // 3자리까지 받고 범위로 거른다 — maxNumber=30이면 기존 2자리 규칙과 결과가 같다
    if (/^\d{1,3}$/.test(numTok)) {
      const num = Number(numTok)
      const ans = strs[i + 1]?.trim()
      const pts = strs[i + 2]?.trim()
      const ptsOk = pts !== undefined && /^[2-4]$/.test(pts)
      if (num >= 1 && num <= maxNumber && ans) {
        const circ = CIRCLED.indexOf(ans)
        if (circ >= 0) {
          out.push(at(path, num, String(circ + 1), true, page, tokens, i, i + 1))
          i += ptsOk ? 3 : 2
          continue
        }
        // 단답형: 정답이 1~3자리 수이고 뒤에 배점이 따라올 때만 — 오검출 방지
        if (/^\d{1,3}$/.test(ans) && ptsOk) {
          out.push(at(path, num, ans, false, page, tokens, i, i + 1))
          i += 3
          continue
        }
      }
    }
    i++
  }
  return out
}

// ---------- 경로 A: 토큰 ----------

export function readTokenPath(
  lines: TextLine[],
  page: number,
  opts: WalkOptions = {},
): RawAnswer[] {
  return lines.flatMap((l) => walkTriples(l.tokens, page, 'token', opts))
}

// ---------- 경로 B: 줄 텍스트 정규식 ----------

/**
 * 붙인 줄 텍스트를 정규식으로 훑는다. 토큰 경로가 놓치는 조판(번호와 답이 한 토큰에
 * 붙어 나오는 경우)을 잡고, 대신 배점과 다음 번호가 붙어 없는 문항을 만들기도 한다
 * — 그래서 두 경로다. 합의가 갈리는 자리가 곧 검수 큐다.
 */
export function readLinePath(
  lines: TextLine[],
  page: number,
  opts: WalkOptions = {},
): RawAnswer[] {
  const maxNumber = opts.maxNumber ?? DEFAULT_MAX_NUMBER
  const digits = maxNumber > 99 ? 3 : 2
  const patterns = [
    new RegExp(`(\\d{1,${digits}})\\s*[.)]?\\s*([①②③④⑤])`, 'g'),
    new RegExp(`(\\d{1,${digits}})\\s*[.)]?\\s*([1-5])(?!\\d)`, 'g'),
  ]

  const out: RawAnswer[] = []
  for (const line of lines) {
    const offsets = tokenOffsets(line)
    for (const pattern of patterns) {
      const found: RawAnswer[] = []
      pattern.lastIndex = 0
      for (const m of line.text.matchAll(pattern)) {
        const number = Number(m[1])
        if (number < 1 || number > maxNumber) continue
        const start = m.index ?? 0
        // 두 번째 그룹은 항상 매치의 끝에 붙는다 — 끝에서 길이만큼 되짚으면 시작 위치다
        const valAt = start + m[0].length - m[2].length
        found.push({
          path: 'line',
          number,
          value: CIRCLED.includes(m[2]) ? String(CIRCLED.indexOf(m[2]) + 1) : m[2],
          choice: true,
          page,
          numBox: offsets.boxAt(start),
          valueBox: offsets.boxAt(valAt),
        })
      }
      // 원문자 패턴이 하나라도 맞으면 숫자 패턴은 시도하지 않는다 — 오검출 방지
      if (found.length) {
        out.push(...found)
        break
      }
    }
  }
  return out
}

// ---------- 조각 ----------

function at(
  path: PathId,
  number: number,
  value: string,
  choice: boolean,
  page: number,
  tokens: TextToken[],
  numIdx: number,
  valIdx: number,
): RawAnswer {
  return {
    path,
    number,
    value,
    choice,
    page,
    numBox: tokens[numIdx]?.box ?? null,
    valueBox: tokens[valIdx]?.box ?? null,
  }
}

/**
 * 줄 텍스트의 문자 위치 → 그 문자를 담은 토큰의 상자.
 * `pdfText.pushLine`이 토큰 문자열을 구분자 없이 이어 붙이므로 offset이 그대로 맞는다.
 */
export function tokenOffsets(line: TextLine): { boxAt(index: number): Box | null } {
  const starts: number[] = []
  let acc = 0
  for (const t of line.tokens) {
    starts.push(acc)
    acc += t.str.length
  }
  return {
    boxAt(index: number) {
      if (index < 0 || index >= acc) return null
      let hit = 0
      for (let i = 0; i < starts.length; i++) {
        if (starts[i] <= index) hit = i
        else break
      }
      return line.tokens[hit]?.box ?? null
    },
  }
}
