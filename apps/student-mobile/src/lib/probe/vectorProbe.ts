// 1단계 측정 — 정답지 PDF가 텍스트 경로로 풀리는가
//
// 이 파일은 알고리즘이 아니라 **측정**이다. 재는 것은 둘이고, 반드시 따로 재야 한다.
//
//   (1) 텍스트가 있는가         — 없으면 OCR 경로를 새로 지어야 한다 (2~3주)
//   (2) 지금 파서가 몇 쌍 뽑나   — 텍스트가 있는데 못 뽑으면 파서만 고치면 된다 (며칠)
//
// **둘의 간격이 곧 남은 작업량이다.** 하나로 뭉치면 "텍스트는 멀쩡한데 파서가 1..30만
// 훑어서 못 뽑는 책"이 스캔본으로 오분류되고, 짓지 않아도 될 OCR 경로를 짓게 된다.
// 실제로 `answerKey.ts`의 현행 파서는 수능 모의고사(1~30문항)에 맞춰져 있어
// 문제집 정답지(1~100+)에서는 낮게 나오는 게 정상이다 — 그건 파서 문제지 PDF 문제가 아니다.
//
// 워커 배선 없이 Node에서도 돌도록 pdf.js를 직접 import하지 않는다 (pdfText.ts와 같은 규율).
// 페이지 객체와 이미지 op 코드는 호출자가 넘긴다.
import { extractLines, type TextLine } from '../pdfText'
import { parseAnswerTable } from '../answerKey'
import type { ViewportLike } from '../pdfCoords'

export type ProbePageLike = {
  getViewport(o: { scale: number }): ViewportLike
  getTextContent(): Promise<{ items: unknown[] }>
  getOperatorList?(): Promise<{ fnArray: ArrayLike<number> }>
}

export type ProbeDocLike = {
  numPages: number
  getPage(n: number): Promise<ProbePageLike>
}

export type Verdict = 'VECTOR' | 'MIXED' | 'SCAN' | 'ERROR'

export type PageProbe = {
  page: number
  /** 텍스트 토큰(조각) 수 — 스캔본은 0 */
  tokens: number
  /** 공백 제외 문자 수 */
  chars: number
  /** 한글 음절 수 — 토큰은 많은데 이게 0이면 cMap 미적용 의심 (pdf.ts 주석 참고) */
  hangul: number
  /** 순수 정수 토큰 수 — 문항 번호 후보의 상한 */
  digits: number
  /** ①~⑨ 개수 — 객관식 답이 텍스트로 나오는지의 직접 증거 */
  circled: number
  /** 이미지 그리기 op 수. -1 = 검사 안 함 */
  imagePaints: number
  /** 현행 parseAnswerTable이 이 쪽에서 뽑은 (번호, 답) 쌍 수 */
  pairs: number
  /** 텍스트 페이지로 볼 수 있는가 */
  textual: boolean
}

export type DocProbe = {
  file: string
  bytes: number
  pages: number
  /** 실제로 잰 페이지 번호 (균등 간격 표본) */
  sampled: number[]
  perPage: PageProbe[]
  totals: {
    textualPages: number
    textualRatio: number
    chars: number
    hangul: number
    circled: number
    digits: number
    imagePaints: number
    /** 표본 전체에서 뽑힌 서로 다른 문항 번호 수 */
    pairs: number
  }
  verdict: Verdict
  /** 사람이 읽는 판정 사유 — 표에서 이것만 봐도 다음 행동이 정해져야 한다 */
  note: string
  error?: string
}

// ---------- 임계값 ----------
// 근거를 같이 적는다. 나중에 만질 사람이 어느 표본이 이 값을 미는지 알아야 한다.

/**
 * 텍스트 페이지 판정. 스캔본은 0, 벡터 정답지 한 쪽은 보통 수백 토큰이다.
 * 30으로 잡은 이유: 쪽번호·머리말만 텍스트로 있는 간지·표지가 걸리지 않게.
 */
const TEXTUAL_MIN_TOKENS = 30

/** 문서 판정 — 텍스트 쪽 비율 */
const VECTOR_MIN_RATIO = 0.8
const SCAN_MAX_RATIO = 0.2

const RE_HANGUL = /[가-힣]/g
const RE_CIRCLED = /[①-⑨]/g
const RE_PURE_INT = /^\d{1,3}$/

/**
 * 균등 간격 표본. 앞 N쪽만 보면 표지·목차만 재게 되고, 정작 정답표가 뒤에 있으면
 * 그 책을 통째로 SCAN으로 오분류한다.
 */
export function samplePages(total: number, limit: number): number[] {
  if (total <= 0) return []
  if (limit <= 0 || total <= limit) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }
  const out: number[] = []
  for (let i = 0; i < limit; i++) {
    // 양 끝을 포함하도록 (limit-1)로 나눈다
    const p = Math.round(1 + (i * (total - 1)) / (limit - 1))
    if (out[out.length - 1] !== p) out.push(p)
  }
  return out
}

function countMatches(s: string, re: RegExp): number {
  re.lastIndex = 0
  let n = 0
  while (re.exec(s) !== null) n++
  return n
}

async function countImagePaints(
  page: ProbePageLike,
  imageOps: readonly number[],
): Promise<number> {
  if (!page.getOperatorList || imageOps.length === 0) return -1
  try {
    const { fnArray } = await page.getOperatorList()
    const set = new Set(imageOps)
    let n = 0
    for (let i = 0; i < fnArray.length; i++) if (set.has(fnArray[i])) n++
    return n
  } catch {
    return -1
  }
}

export async function probePage(
  page: ProbePageLike,
  pageNo: number,
  opts: { imageOps?: readonly number[] } = {},
): Promise<PageProbe> {
  const lines: TextLine[] = await extractLines(page)

  let tokens = 0
  let chars = 0
  let hangul = 0
  let digits = 0
  let circled = 0

  for (const line of lines) {
    for (const t of line.tokens) {
      tokens++
      const s = t.str
      chars += s.replace(/\s+/g, '').length
      hangul += countMatches(s, RE_HANGUL)
      circled += countMatches(s, RE_CIRCLED)
      if (RE_PURE_INT.test(s.trim())) digits++
    }
  }

  // 현행 파서를 그대로 태운다 — "지금 코드로 몇 개가 나오나"가 알고 싶은 값이다
  const parsed = parseAnswerTable(
    lines.map((l) => ({ text: l.text, tokens: l.tokens.map((t) => t.str) })),
  )

  return {
    page: pageNo,
    tokens,
    chars,
    hangul,
    digits,
    circled,
    imagePaints: await countImagePaints(page, opts.imageOps ?? []),
    pairs: parsed.size,
    textual: tokens >= TEXTUAL_MIN_TOKENS,
  }
}

/**
 * 판정과 사유. 사유 문자열이 곧 다음 행동이다 —
 * "파서 수정"이면 며칠, "OCR 경로"면 몇 주다.
 */
export function classify(perPage: PageProbe[]): { verdict: Verdict; note: string } {
  if (perPage.length === 0) return { verdict: 'ERROR', note: '잰 페이지 없음' }

  const textualPages = perPage.filter((p) => p.textual).length
  const ratio = textualPages / perPage.length
  const circled = perPage.reduce((s, p) => s + p.circled, 0)
  const hangul = perPage.reduce((s, p) => s + p.hangul, 0)
  const chars = perPage.reduce((s, p) => s + p.chars, 0)
  const pairs = perPage.reduce((s, p) => s + p.pairs, 0)

  if (ratio < SCAN_MAX_RATIO) {
    return { verdict: 'SCAN', note: '텍스트 레이어 없음 — OCR 경로 필요' }
  }

  if (ratio < VECTOR_MIN_RATIO) {
    return {
      verdict: 'MIXED',
      note: `텍스트 쪽 ${Math.round(ratio * 100)}% — 나머지 쪽만 OCR`,
    }
  }

  // 여기부터는 텍스트가 충분히 있다. 남은 건 "답이 텍스트로 나오나"다.
  if (chars > 0 && hangul === 0) {
    return {
      verdict: 'VECTOR',
      note: '⚠ 한글 0자 — cMap 미적용 의심. 글자가 조용히 안 나온다 (pdf.ts 주석 참고)',
    }
  }
  if (circled === 0) {
    return {
      verdict: 'VECTOR',
      note: '⚠ 원문자 0개 — 답이 숫자 표기이거나 글리프 매핑 없음. 미리보기로 확인 필요',
    }
  }
  if (pairs === 0) {
    return {
      verdict: 'VECTOR',
      note: `원문자 ${circled}개 있으나 파싱 0쌍 — 조판이 현행 파서와 다름. 파서 수정으로 해결`,
    }
  }
  if (pairs < circled * 0.5) {
    return {
      verdict: 'VECTOR',
      note: `원문자 ${circled} → 파싱 ${pairs}쌍 — 파서가 놓치는 중 (번호 범위·조판). 파서 수정`,
    }
  }
  return { verdict: 'VECTOR', note: `텍스트 경로 가능 — 파싱 ${pairs}쌍` }
}

export async function probeDocument(
  pdf: ProbeDocLike,
  meta: { file: string; bytes: number },
  opts: {
    sampleLimit?: number
    imageOps?: readonly number[]
    onPage?: (done: number, total: number) => void
    signal?: { aborted: boolean }
  } = {},
): Promise<DocProbe> {
  const pages = pdf.numPages
  const sampled = samplePages(pages, opts.sampleLimit ?? 0)
  const perPage: PageProbe[] = []

  for (let i = 0; i < sampled.length; i++) {
    if (opts.signal?.aborted) break
    const no = sampled[i]
    try {
      perPage.push(await probePage(await pdf.getPage(no), no, { imageOps: opts.imageOps }))
    } catch {
      // 한 쪽이 깨져도 문서 전체를 버리지 않는다 — 0으로 세고 넘어간다
      perPage.push({
        page: no,
        tokens: 0,
        chars: 0,
        hangul: 0,
        digits: 0,
        circled: 0,
        imagePaints: -1,
        pairs: 0,
        textual: false,
      })
    }
    opts.onPage?.(i + 1, sampled.length)
  }

  const sum = (f: (p: PageProbe) => number) => perPage.reduce((s, p) => s + f(p), 0)
  const textualPages = perPage.filter((p) => p.textual).length
  const { verdict, note } = classify(perPage)

  return {
    file: meta.file,
    bytes: meta.bytes,
    pages,
    sampled,
    perPage,
    totals: {
      textualPages,
      textualRatio: perPage.length ? textualPages / perPage.length : 0,
      chars: sum((p) => p.chars),
      hangul: sum((p) => p.hangul),
      circled: sum((p) => p.circled),
      digits: sum((p) => p.digits),
      imagePaints: sum((p) => Math.max(0, p.imagePaints)),
      pairs: sum((p) => p.pairs),
    },
    verdict,
    note,
  }
}

// ---------- 요약 ----------

export type Summary = {
  files: number
  vector: number
  mixed: number
  scan: number
  error: number
  /** 텍스트 경로만으로 끝나는 비율 — 1단계가 답하려는 바로 그 숫자 */
  vectorRatio: number
}

export function summarize(docs: DocProbe[]): Summary {
  const count = (v: Verdict) => docs.filter((d) => d.verdict === v).length
  const vector = count('VECTOR')
  return {
    files: docs.length,
    vector,
    mixed: count('MIXED'),
    scan: count('SCAN'),
    error: count('ERROR'),
    vectorRatio: docs.length ? vector / docs.length : 0,
  }
}

// ---------- 내보내기 ----------

const CSV_COLS = [
  '파일',
  '쪽수',
  '표본쪽',
  '텍스트쪽',
  '텍스트비율',
  '문자',
  '한글',
  '숫자토큰',
  '원문자',
  '이미지op',
  '파싱쌍',
  '판정',
  '사유',
] as const

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(docs: DocProbe[]): string {
  const rows = [CSV_COLS.join(',')]
  for (const d of docs) {
    rows.push(
      [
        d.file,
        d.pages,
        d.sampled.length,
        d.totals.textualPages,
        d.totals.textualRatio.toFixed(2),
        d.totals.chars,
        d.totals.hangul,
        d.totals.digits,
        d.totals.circled,
        d.totals.imagePaints,
        d.totals.pairs,
        d.verdict,
        d.note,
      ]
        .map(csvCell)
        .join(','),
    )
  }
  // Excel이 UTF-8로 열도록 BOM을 붙인다
  return '﻿' + rows.join('\n')
}
