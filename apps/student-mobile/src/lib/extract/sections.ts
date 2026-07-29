// 단원 검출 — 키의 절반
//
// 번호가 줄어드는 곳만 보고 단원을 나누면 두 가지를 못 한다:
//   · 단원 **이름**을 모른다 (S1, S2로 남는다)
//   · 한 쪽에 단원이 둘 시작하면 구분하지 못한다
//
// 여기서는 정답지의 단원 헤더 줄을 찾아 그 두 가지를 채우고, 번호 리셋은
// **헤더를 못 찾았을 때의 보조 신호**로 내린다.
//
// 판정은 게이트 사슬이 아니라 점수다 (게이트를 10단 쌓으면 각 단이 1%씩만 틀려도
// 생존율이 90%로 떨어진다 — 계획서 §5).
import type { TextLine } from '../pdfText'
import type { RawAnswer } from './textPath'
import type { Section } from './schema'

export type SectionHeader = { page: number; y: number; title: string }

/** 헤더로 인정할 점수 하한 */
export const HEADER_MIN_SCORE = 4

/** 이 배수보다 큰 글자가 있으면 제목 조판으로 본다 */
export const HEADER_SIZE_RATIO = 1.15

const RE_HANGUL = /[가-힣]/g
const RE_CIRCLED = /[①-⑨]/
/** "01 다항식", "Ⅰ. 집합", "유형 03", "1단원", "02강" 같은 머리 */
const RE_HEADING = /^\s*(\d{1,2}\s*[.)]?\s|[ⅠⅡⅢⅣⅤⅥ]|유형|단원|\d{1,2}\s*강)/

function count(s: string, re: RegExp): number {
  re.lastIndex = 0
  let n = 0
  while (re.exec(s) !== null) n++
  return n
}

/** 그 쪽 글자 높이의 중앙값 — 제목 조판을 상대적으로 판단하기 위한 기준 */
export function medianHeight(lines: TextLine[]): number {
  const hs = lines.flatMap((l) => l.tokens.map((t) => t.box.h)).sort((a, b) => a - b)
  return hs.length ? hs[Math.floor(hs.length / 2)] : 0
}

/**
 * 한 줄이 단원 헤더인가. 점수와 근거를 같이 돌려준다 —
 * 임계값을 만질 사람이 어느 신호가 얼마를 밀었는지 봐야 한다.
 */
export function scoreHeader(line: TextLine, medH: number): { score: number; why: string[] } {
  const text = line.text.trim()
  const why: string[] = []
  let score = 0

  const maxH = Math.max(0, ...line.tokens.map((t) => t.box.h))
  if (medH > 0 && maxH >= medH * HEADER_SIZE_RATIO) {
    score += 2
    why.push('큰 글자')
  }
  if (count(text, RE_HANGUL) >= 2) {
    score += 2
    why.push('한글')
  }
  if (RE_HEADING.test(text)) {
    score += 1
    why.push('머리 패턴')
  }
  if (text.length >= 2 && text.length <= 40) {
    score += 1
    why.push('길이')
  }
  // 원문자가 있으면 정답표 행이다 — 헤더일 수 없다
  if (RE_CIRCLED.test(text)) {
    score -= 4
    why.push('원문자(감점)')
  }
  // 숫자가 절반을 넘으면 표다
  const digits = count(text, /\d/g)
  if (text.length > 0 && digits / text.length > 0.4) {
    score -= 3
    why.push('숫자 과다(감점)')
  }

  return { score, why }
}

export function detectSectionHeaders(lines: TextLine[], page: number): SectionHeader[] {
  const medH = medianHeight(lines)
  const out: SectionHeader[] = []
  for (const line of lines) {
    const { score } = scoreHeader(line, medH)
    if (score >= HEADER_MIN_SCORE) {
      out.push({ page, y: line.tokens[0]?.box.y ?? 0, title: line.text.trim() })
    }
  }
  return out
}

// ---------- 단원 배정 ----------

type Bound = { id: string; title: string; page: number; y: number }

/** 문서 위치 — 위치를 모르면 y=0으로 두어 그 쪽의 맨 앞으로 본다 */
function pos(r: RawAnswer): { page: number; y: number } {
  return { page: r.page, y: r.numBox?.y ?? 0 }
}

function before(a: { page: number; y: number }, b: { page: number; y: number }): boolean {
  return a.page < b.page || (a.page === b.page && a.y <= b.y)
}

/**
 * 헤더 + 번호 리셋으로 단원을 세운다.
 *
 * `reads`는 **문서 순서**여야 한다 (리셋 신호는 순서에만 있다 — 번호로 정렬하면 사라진다).
 * 헤더가 있으면 그것이 경계이자 이름이 되고, 헤더 없이 번호가 `drop` 이상 떨어지면
 * 이름 없는 경계를 하나 만든다 — 이름을 모르는 것과 단원을 놓치는 것은 다른 문제다.
 */
export function buildSections(
  reads: RawAnswer[],
  headers: SectionHeader[],
  opts: { drop?: number } = {},
): { sections: Section[]; sectionOf: (r: RawAnswer) => string } {
  const drop = opts.drop ?? 3
  const sortedHeaders = [...headers].sort((a, b) => a.page - b.page || a.y - b.y)
  const bounds: Bound[] = []
  const nextId = () => `S${bounds.length + 1}`

  let usedHeader = -1
  let prevNumber = -Infinity

  for (const r of reads) {
    const p = pos(r)

    // 이 문항 앞에 새로 등장한 헤더가 있으면 그 헤더가 경계다
    let latest = usedHeader
    for (let i = usedHeader + 1; i < sortedHeaders.length; i++) {
      const h = sortedHeaders[i]
      if (before({ page: h.page, y: h.y }, p)) latest = i
      else break
    }
    if (latest > usedHeader) {
      const h = sortedHeaders[latest]
      bounds.push({ id: nextId(), title: h.title, page: h.page, y: h.y })
      usedHeader = latest
      prevNumber = -Infinity
    }

    if (bounds.length === 0) {
      bounds.push({ id: nextId(), title: '', page: r.page, y: p.y })
    } else if (prevNumber - r.number >= drop) {
      // 헤더를 못 찾았지만 번호가 리셋됐다 — 이름 없는 단원으로라도 나눈다
      bounds.push({ id: nextId(), title: '', page: r.page, y: p.y })
    }
    prevNumber = r.number
  }

  const sectionOf = (r: RawAnswer): string => {
    const p = pos(r)
    let hit = bounds[0]?.id ?? 'S1'
    for (const b of bounds) {
      if (before({ page: b.page, y: b.y }, p)) hit = b.id
      else break
    }
    return hit
  }

  // 범위는 실제 배정 결과로 채운다
  const range = new Map<string, { from: number; to: number }>()
  for (const r of reads) {
    const id = sectionOf(r)
    const cur = range.get(id) ?? { from: r.number, to: r.number }
    range.set(id, { from: Math.min(cur.from, r.number), to: Math.max(cur.to, r.number) })
  }

  const sections: Section[] = bounds.map((b) => ({
    id: b.id,
    title: b.title || b.id,
    startPage: b.page,
    from: range.get(b.id)?.from ?? 0,
    to: range.get(b.id)?.to ?? 0,
  }))

  return { sections, sectionOf }
}
