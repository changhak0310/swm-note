// 답지 대조 — **사람이 라벨을 한 쪽도 만들지 않고** 검출을 감사한다.
//
// 답지는 출판사가 만든 것이라 우리 검출기와 완전히 독립이다. 거기서 두 가지를 공짜로 얻는다.
//
//   ① 문항 번호의 전체 목록 — 몇 번이 있어야 하는가. 놓친 번호가 그대로 드러난다.
//   ② 각 문항이 객관식인가 — 정답이 ①~⑤ 원문자면 객관식이다. **M2의 독립 근거다.**
//
// ★ 이것이 골든 라벨을 대신하지는 못한다. 좌표를 말해 주지 않으므로 M1·M3·M4는 못 잰다.
//   대신 **라벨할 쪽을 고르는 데** 쓴다 — 번호가 어긋나는 쪽에 실패가 몰려 있다.
import { parseAnswerTable } from './answerKey'
import type { Region } from '../types'

export type AnswerKind = 'choice' | 'subjective'

/** 문항 번호 → 정답과 그 유형 */
export type BookAnswers = Map<number, { value: string; kind: AnswerKind }>

export type AnswerLine = { text: string; tokens: string[] }

const CIRCLED = /[①②③④⑤]/

/**
 * 검출 번호의 이 비율까지 중복이면 아직 "번호가 유일하다"로 본다.
 *
 * 실측: 수능은 30개 중 8개가 중복인데(0.27) 재현율·객관식 판정이 모두 100%였다 — 같은
 * 번호가 두 쪽에 걸친 것이지 번호 체계가 깨진 것이 아니다. 수학의 신은 29개 중 26개(0.90)로
 * 성격이 다르다. 0.5는 그 둘 사이다.
 */
const DUPLICATE_TOLERANCE = 0.5

/**
 * 답지에서 문항 번호·정답·유형을 뽑는다.
 *
 * 값 자체는 `answerKey.ts`의 파서를 그대로 쓴다(채점이 쓰는 것과 같은 코드여야 한다).
 * 여기서 더 얻는 것은 **유형**뿐이다 — 정답 글자가 원문자였는지. 그 정보는 채점에 필요 없어
 * `ParsedAnswer`에 없고, 감사에는 꼭 필요하다.
 *
 * ★ 값만으로는 유형을 못 가른다. 단답형 정답이 "3"인 문항과 ③인 문항이 똑같이 '3'이 된다.
 *   그래서 원문자 여부를 따로 훑는다.
 */
export function parseAnswerBook(lines: AnswerLine[]): BookAnswers {
  const values = parseAnswerTable(lines)
  const circled = circledNumbers(lines)
  const out: BookAnswers = new Map()
  for (const [num, value] of values) {
    out.set(num, { value, kind: circled.has(num) ? 'choice' : 'subjective' })
  }
  return out
}

/** 정답이 원문자로 적힌 문항 번호 — 붙은 줄과 토큰 양쪽에서 훑는다 */
function circledNumbers(lines: AnswerLine[]): Set<number> {
  const out = new Set<number>()
  for (const line of lines) {
    for (const m of line.text.matchAll(/(\d{1,4})\s*[.)]?\s*[①②③④⑤]/g)) {
      out.add(Number(m[1]))
    }
    // 정답표는 칸이 토큰으로 쪼개져 와서 붙은 줄로는 안 잡힌다 ("16|②|3")
    for (let i = 0; i + 1 < line.tokens.length; i++) {
      const num = line.tokens[i].trim()
      if (/^\d{1,4}$/.test(num) && CIRCLED.test(line.tokens[i + 1].trim())) out.add(Number(num))
    }
  }
  return out
}

// ---------- 대조 ----------

export type KindMismatch = {
  num: number
  answer: string
  expected: AnswerKind
  detected: AnswerKind
}

export type AnswerAudit = {
  /** 답지에 있는 문항 수 */
  expected: number
  /** 검출이 번호를 붙인 문항 수 */
  detected: number
  matched: number
  /** 답지에 있는데 검출이 못 찾은 번호 — 이게 곧 라벨할 쪽의 후보다 */
  missing: number[]
  /** 검출이 만들어 냈는데 답지에 없는 번호 */
  extra: number[]
  /** matched / expected */
  numberRecall: number
  /** 중복 검출된 번호 — 한 문항을 둘로 쪼갠 자리, 또는 번호가 단원마다 다시 시작하는 책 */
  duplicated: number[]
  /**
   * **이 감사를 믿어도 되는가.**
   *
   * 대조 전체가 "문항 번호는 문서 안에서 유일하다"를 전제한다. 단원마다 1번부터 다시
   * 시작하는 문제집에서는 그 전제가 깨지고, 그러면 재현율도 객관식 판정도 뜻을 잃는다 —
   * 실측 "수학의 신": 번호 1~26이 전부 중복이고 재현율이 37.8%로 나왔지만, 그 책의 실제
   * 문항은 360개다(§9.2). 숫자가 낮은 게 아니라 **잣대가 안 맞는 것**이다.
   *
   * 그래서 낮은 수치를 결론으로 내놓기 전에 이 값을 먼저 본다.
   */
  reliable: boolean
  /** 중복 비율 — reliable의 근거 */
  duplicateRate: number
  kind: {
    compared: number
    agreed: number
    accuracy: number | null
    mismatches: KindMismatch[]
  }
}

/**
 * 검출 결과를 답지에 맞대어 본다.
 *
 * `numLabel`이 있는 구역만 견준다 — 스캔 경로는 설계상 번호 값을 읽지 않으므로(§4.3),
 * 이 감사는 텍스트 경로나 번호 OCR을 거친 결과에 쓴다.
 */
export function auditAgainstAnswers(regions: Region[], answers: BookAnswers): AnswerAudit {
  const byNum = new Map<number, Region[]>()
  for (const r of regions) {
    if (!r.numLabel) continue
    const n = Number(r.numLabel)
    if (!Number.isFinite(n)) continue
    const arr = byNum.get(n)
    if (arr) arr.push(r)
    else byNum.set(n, [r])
  }

  const missing: number[] = []
  const mismatches: KindMismatch[] = []
  let matched = 0
  let compared = 0
  let agreed = 0

  for (const [num, ans] of [...answers].sort((a, b) => a[0] - b[0])) {
    const hit = byNum.get(num)
    if (!hit) {
      missing.push(num)
      continue
    }
    matched++
    // 유형은 하나라도 객관식으로 봤으면 객관식으로 친다 (한 문항이 둘로 쪼개진 경우 대비)
    const detected: AnswerKind = hit.some(
      (r) => r.answerType === 'choice' && r.choices.length >= 2,
    )
      ? 'choice'
      : 'subjective'
    compared++
    if (detected === ans.kind) agreed++
    else mismatches.push({ num, answer: ans.value, expected: ans.kind, detected })
  }

  const extra = [...byNum.keys()].filter((n) => !answers.has(n)).sort((a, b) => a - b)
  const duplicated = [...byNum.entries()]
    .filter(([, rs]) => rs.length > 1)
    .map(([n]) => n)
    .sort((a, b) => a - b)

  // 번호가 문서 안에서 유일하다는 전제가 깨지면 이 감사 전체가 못 믿을 것이 된다
  const duplicateRate = byNum.size ? duplicated.length / byNum.size : 0

  return {
    expected: answers.size,
    detected: byNum.size,
    matched,
    missing,
    extra,
    numberRecall: answers.size ? matched / answers.size : 0,
    duplicated,
    reliable: byNum.size > 0 && duplicateRate <= DUPLICATE_TOLERANCE,
    duplicateRate,
    kind: {
      compared,
      agreed,
      accuracy: compared ? agreed / compared : null,
      mismatches,
    },
  }
}

/**
 * 놓친 번호가 몰려 있는 구간 — 라벨할 쪽을 고르는 데 쓴다.
 *
 * 낱개로 놓친 번호는 그 문항 하나의 문제지만, 연속으로 놓쳤으면 **그 쪽이 통째로 무너진
 * 것**이라 원인이 다르다(단 판정·페이지 유형 오판). 후자가 먼저 볼 곳이다.
 */
export function missingRuns(missing: number[], minRun = 2): { from: number; to: number }[] {
  const runs: { from: number; to: number }[] = []
  let start = -1
  let prev = -Infinity
  const flush = (end: number) => {
    if (start >= 0 && end - start + 1 >= minRun) runs.push({ from: start, to: end })
    start = -1
  }
  for (const n of [...missing].sort((a, b) => a - b)) {
    if (n === prev + 1) {
      if (start < 0) start = prev
    } else {
      flush(prev)
      start = -1
    }
    prev = n
  }
  flush(prev)
  return runs
}
