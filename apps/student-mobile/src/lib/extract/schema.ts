// 정답지 추출 결과 스키마 v1 (영구 자산)
//
// 이 스키마는 "한 번 뽑으면 평생 쓴다"는 전제 위에 있다. 그래서 값만 담지 않고
// **나중에 무엇을 다시 해야 하는지 판단할 정보**를 같이 담는다.
//
//   source         PDF 지문 (lib/hash.ts 규약) — 다른 파일이면 즉시 안다
//   extractorVersion / methods   어떤 코드가 뽑았나
//   agreement      몇 개의 경로가 같은 답을 냈나 → 6개월 뒤 "agreement < 2만 재처리"가 가능해진다
//   numBox/valueBox  원본 위치 → PDF 없이도 재검증·크롭이 된다
//   reviewed       사람이 확인했나 → 재처리해도 사람 손이 두 번 들지 않는다
//
// 이 필드들이 없으면 선택지가 "전량 재처리" 하나뿐이 되고, 그 순간 "1번만 돌린다"는
// 전제가 무너진다.
//
// ★ 키는 number가 아니라 (sectionId, number)다. 문제집은 단원마다 번호가 1부터 리셋된다.
//   번호만 키로 잡으면 나중에 학생이 스캔한 쪽과 매칭할 때 통째로 어긋난다.
//
// ☞ `answerAudit.ts`와 하는 일이 다르다. 저기는 답지로 **검출을 감사**하고(좌표 없음),
//   여기는 답지 자체를 **영구 산출물로 굳힌다**(좌표·합의·출처 포함).
import type { Box } from '../../types'

export const SCHEMA_VERSION = 1 as const

/** 이 값을 올리면 기존 산출물을 재처리해야 하는지 판단할 수 있다 */
export const EXTRACTOR_VERSION = 'text-path-0.1'

/** 값을 낸 읽기 경로. 서로 다르게 틀려야 합의가 신호가 된다 */
export type PathId = 'token' | 'line' | 'grid' | 'ocr' | 'manual'

export type ProblemFlag =
  /** 번호 수열에 빈칸 — 이 앞뒤로 누락이 있다 */
  | 'seq_gap'
  /** 같은 (단원, 번호)가 둘 이상 */
  | 'duplicate'
  /** 경로들이 서로 다른 답을 냈다 → 검수 큐 */
  | 'conflict'
  /** 한 경로만 값을 냈다 → 교차검증이 없다 */
  | 'single_path'
  /** 번호와 답이 너무 떨어져 있다 — 다단 표 열 어긋남 의심 (가장 위험한 조용한 실패) */
  | 'geometry'
  /** 위치를 못 기록했다 — 재검증 불가 */
  | 'no_box'

export type ProblemAnswer = {
  /** 단원/유형 식별자. 번호가 리셋되는 단위 */
  sectionId: string
  /** 단원 안에서의 문항 번호 */
  number: number
  /** 정답. 객관식은 '1'~'5', 주관식은 원문 */
  value: string
  /** 객관식인가 — 답 분포 검정의 분모가 된다 */
  choice: boolean
  page: number
  /** 번호 글자 위치 (정규화 MAX_W 좌표) */
  numBox: Box | null
  /** 답 글자 위치. numBox와의 x 인접성이 열 어긋남을 잡는다 */
  valueBox: Box | null
  /** 같은 답을 낸 경로 수 */
  agreement: number
  /** 이 문항에 값을 낸 전체 경로 수 */
  paths: number
  flags: ProblemFlag[]
  reviewed: boolean
}

export type Section = {
  id: string
  /** 사람이 읽는 이름 — 단원 헤더 텍스트 */
  title: string
  startPage: number
  /** 이 단원의 문항 번호 범위 */
  from: number
  to: number
}

export type AnswerKeyExtract = {
  schema: typeof SCHEMA_VERSION
  /** PDF 지문. `lib/hash.ts`의 `sha256Short` 규약 (`sha256:` + 앞 16자리) */
  source: string
  sourceName: string
  pages: number
  sections: Section[]
  problems: ProblemAnswer[]
  provenance: {
    extractorVersion: string
    /** 실제로 돌린 읽기 경로 */
    methods: PathId[]
    extractedAt: string
    reviewedAt: string | null
    reviewer: string | null
  }
}

// ---------- 키 ----------

export function problemKey(sectionId: string, number: number): string {
  return `${sectionId}#${number}`
}

// ---------- 생성 ----------

export function emptyExtract(meta: {
  source: string
  sourceName: string
  pages: number
  methods: PathId[]
  extractedAt: string
}): AnswerKeyExtract {
  return {
    schema: SCHEMA_VERSION,
    source: meta.source,
    sourceName: meta.sourceName,
    pages: meta.pages,
    sections: [],
    problems: [],
    provenance: {
      extractorVersion: EXTRACTOR_VERSION,
      methods: meta.methods,
      extractedAt: meta.extractedAt,
      reviewedAt: null,
      reviewer: null,
    },
  }
}

// ---------- 검증 ----------

export type Violation = {
  level: 'error' | 'warn'
  code: string
  message: string
  /** 해당 문항 키 (문서 전체 위반이면 null) */
  key: string | null
}

const CHOICE_VALUES = new Set(['1', '2', '3', '4', '5'])

/** `lib/hash.ts`의 `sha256Short`가 내는 모양 — 규약이 갈리면 팩이 조용히 안 붙는다 */
const SOURCE_RE = /^sha256:[0-9a-f]{16}$/

/**
 * 스키마 위반과 무결성 점검. 검산기(답 분포·수열)와는 다르다 —
 * 여기서는 "형식이 맞는가"만 본다. 형식이 깨진 산출물을 저장하면
 * 영구 자산이 아니라 영구 부채가 된다.
 */
export function validate(x: AnswerKeyExtract): Violation[] {
  const out: Violation[] = []
  const err = (code: string, message: string, key: string | null = null) =>
    out.push({ level: 'error', code, message, key })
  const warn = (code: string, message: string, key: string | null = null) =>
    out.push({ level: 'warn', code, message, key })

  if (x.schema !== SCHEMA_VERSION) {
    err('schema_version', `스키마 버전 ${x.schema} — 이 코드는 v${SCHEMA_VERSION}만 읽는다`)
  }
  if (!SOURCE_RE.test(x.source)) {
    err('source', 'source가 sha256Short 규약이 아니다 — 원본 대조가 불가능하다')
  }
  if (x.pages <= 0) err('pages', '쪽수가 0 이하')

  const sectionIds = new Set(x.sections.map((s) => s.id))
  if (x.sections.length === 0 && x.problems.length > 0) {
    warn('no_sections', '단원이 하나도 없다 — 번호만으로는 키가 되지 않는다')
  }

  const seen = new Set<string>()
  let noBox = 0
  for (const p of x.problems) {
    const key = problemKey(p.sectionId, p.number)
    if (seen.has(key)) err('duplicate_key', `키 중복: ${key}`, key)
    seen.add(key)

    if (!sectionIds.has(p.sectionId)) {
      err('unknown_section', `sections에 없는 단원: ${p.sectionId}`, key)
    }
    if (!Number.isInteger(p.number) || p.number <= 0) {
      err('bad_number', `문항 번호가 양의 정수가 아니다: ${p.number}`, key)
    }
    if (p.value === '') err('empty_value', '정답이 비었다', key)
    if (p.choice && !CHOICE_VALUES.has(p.value)) {
      err('bad_choice', `객관식인데 답이 1~5가 아니다: ${p.value}`, key)
    }
    if (p.page < 1 || p.page > x.pages) err('bad_page', `쪽 범위 밖: ${p.page}`, key)
    if (p.agreement < 1) err('bad_agreement', 'agreement가 1 미만', key)
    if (p.agreement > p.paths) err('bad_agreement', 'agreement가 paths보다 크다', key)
    if (!p.numBox || !p.valueBox) noBox++
  }

  if (noBox > 0) {
    warn('no_box', `위치 없는 문항 ${noBox}개 — PDF 없이 재검증할 수 없다`)
  }

  return out
}

// ---------- 직렬화 ----------

export function parseExtract(json: string): AnswerKeyExtract {
  const raw = JSON.parse(json) as AnswerKeyExtract
  if (raw?.schema !== SCHEMA_VERSION) {
    throw new Error(`스키마 v${raw?.schema}는 읽을 수 없다 (이 코드는 v${SCHEMA_VERSION})`)
  }
  const bad = validate(raw).filter((v) => v.level === 'error')
  if (bad.length) throw new Error(`검증 실패 ${bad.length}건: ${bad[0].message}`)
  return raw
}

// ---------- 요약 ----------

export type ExtractSummary = {
  problems: number
  sections: number
  choice: number
  /** 모든 경로가 일치한 문항 */
  unanimous: number
  /** 한 경로만 값을 낸 문항 */
  singlePath: number
  /** 경로가 갈린 문항 — 검수 큐 크기 */
  conflicts: number
  flagged: number
  reviewed: number
}

export function summarize(x: AnswerKeyExtract): ExtractSummary {
  const has = (p: ProblemAnswer, f: ProblemFlag) => p.flags.includes(f)
  return {
    problems: x.problems.length,
    sections: x.sections.length,
    choice: x.problems.filter((p) => p.choice).length,
    unanimous: x.problems.filter((p) => p.paths > 1 && p.agreement === p.paths).length,
    singlePath: x.problems.filter((p) => has(p, 'single_path')).length,
    conflicts: x.problems.filter((p) => has(p, 'conflict')).length,
    flagged: x.problems.filter((p) => p.flags.length > 0).length,
    reviewed: x.problems.filter((p) => p.reviewed).length,
  }
}

// ---------- 내보내기 ----------

const CSV_COLS = ['단원', '번호', '정답', '객관식', '쪽', '합의', '경로', '플래그', '검수'] as const

function cell(v: string | number | boolean): string {
  const s = typeof v === 'boolean' ? (v ? 'Y' : '') : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(x: AnswerKeyExtract): string {
  const rows = [CSV_COLS.join(',')]
  for (const p of x.problems) {
    rows.push(
      [
        p.sectionId,
        p.number,
        p.value,
        p.choice,
        p.page,
        p.agreement,
        p.paths,
        p.flags.join(' '),
        p.reviewed,
      ]
        .map(cell)
        .join(','),
    )
  }
  // Excel이 UTF-8로 열도록 BOM을 붙인다
  return '﻿' + rows.join('\n')
}
