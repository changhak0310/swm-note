import { describe, expect, it } from 'vitest'
import { parseAnswerTokenLine } from '../answerKey'
import { readLinePath, readTokenPath, tokenOffsets } from '../extract/textPath'
import { GEOM_MAX_GAP, adjacent, markSequenceGaps, mergePaths } from '../extract/merge'
import { buildSections } from '../extract/sections'
import {
  EXTRACTOR_VERSION,
  emptyExtract,
  parseExtract,
  problemKey,
  summarize,
  toCsv,
  validate,
  type AnswerKeyExtract,
  type ProblemAnswer,
} from '../extract/schema'
import { runTextExtract } from '../extract/run'
import type { TextLine, TextToken } from '../pdfText'
import type { RawAnswer } from '../extract/textPath'

// ---------- 도우미 ----------

/** 토큰을 x축으로 나란히 놓은 한 줄 */
function line(strs: string[], opts: { y?: number; gap?: number; w?: number } = {}): TextLine {
  const { y = 100, gap = 4, w = 10 } = opts
  let x = 20
  const tokens: TextToken[] = strs.map((str) => {
    const box = { x, y, w: w * Math.max(1, str.length), h: 12 }
    x += box.w + gap
    return { str, box }
  })
  return { text: strs.join(''), tokens }
}

/** lib/hash.ts의 sha256Short 규약 */
const SOURCE = 'sha256:0123456789abcdef'

function extractOf(problems: ProblemAnswer[], sections = ['S1']): AnswerKeyExtract {
  const x = emptyExtract({
    source: SOURCE,
    sourceName: 'book.pdf',
    pages: 10,
    methods: ['token', 'line'],
    extractedAt: '2026-07-28T00:00:00.000Z',
  })
  x.sections = sections.map((id) => ({ id, title: id, startPage: 1, from: 1, to: 99 }))
  x.problems = problems
  return x
}

function problem(over: Partial<ProblemAnswer> & { number: number }): ProblemAnswer {
  return {
    sectionId: 'S1',
    value: '3',
    choice: true,
    page: 1,
    numBox: { x: 20, y: 100, w: 10, h: 12 },
    valueBox: { x: 34, y: 100, w: 10, h: 12 },
    agreement: 2,
    paths: 2,
    flags: [],
    reviewed: false,
    ...over,
  }
}

// ---------- 경로 A: 토큰 ----------

describe('readTokenPath', () => {
  it('정답표 트리플 — 값이 기존 파서와 같다', () => {
    // 기존 parseAnswerTokenLine과 동치를 고정한다. 위치를 붙이려고 다시 쓴 것이지
    // 판정 규칙을 바꾼 게 아니다.
    const strs = ['1', '②', '2', '12', '①', '4', '23', '③', '2']
    const mine = readTokenPath([line(strs)], 3).map((r) => ({ num: r.number, value: r.value }))
    expect(mine).toEqual(parseAnswerTokenLine(strs))
  })

  it('단답형 — 배점이 따라올 때만', () => {
    const strs = ['20', '48', '4', '30', '780', '4']
    const got = readTokenPath([line(strs)], 1)
    expect(got.map((r) => [r.number, r.value, r.choice])).toEqual([
      [20, '48', false],
      [30, '780', false],
    ])
  })

  it('번호·답의 토큰 상자를 남긴다 — 열 어긋남 검산의 재료', () => {
    const [r] = readTokenPath([line(['1', '②', '2'])], 5)
    expect(r.numBox).not.toBeNull()
    expect(r.valueBox).not.toBeNull()
    expect(r.valueBox!.x).toBeGreaterThan(r.numBox!.x)
    expect(r.page).toBe(5)
  })
})

// ---------- 경로 B: 줄 텍스트 ----------

describe('readLinePath', () => {
  it('원문자 패턴', () => {
    const got = readLinePath([line(['1', '.', '③', ' ', '2', '.', '⑤'])], 1)
    expect(got.map((r) => [r.number, r.value])).toEqual([
      [1, '3'],
      [2, '5'],
    ])
  })

  it('원문자가 하나라도 맞으면 숫자 패턴은 시도하지 않는다', () => {
    // answerKey.ts와 같은 규칙 — 오검출 방지
    const got = readLinePath([line(['1', '.', '③', ' ', '7', ')', '4'])], 1)
    expect(got).toHaveLength(1)
  })

  it('문자 위치를 토큰 상자로 되짚는다', () => {
    const l = line(['12', '.', '④'])
    const [r] = readLinePath([l], 1)
    expect(r.numBox).toEqual(l.tokens[0].box)
    expect(r.valueBox).toEqual(l.tokens[2].box)
  })
})

describe('tokenOffsets', () => {
  it('문자 인덱스 → 그 문자를 담은 토큰', () => {
    const l = line(['ab', 'cde', 'f'])
    const o = tokenOffsets(l)
    expect(o.boxAt(0)).toEqual(l.tokens[0].box)
    expect(o.boxAt(1)).toEqual(l.tokens[0].box)
    expect(o.boxAt(2)).toEqual(l.tokens[1].box)
    expect(o.boxAt(5)).toEqual(l.tokens[2].box)
    expect(o.boxAt(99)).toBeNull()
    expect(o.boxAt(-1)).toBeNull()
  })
})

// ---------- 기하 ----------

describe('adjacent', () => {
  const num = { x: 20, y: 100, w: 10, h: 12 }

  it('같은 행에서 바로 옆이면 통과', () => {
    expect(adjacent(num, { x: 34, y: 100, w: 10, h: 12 })).toBe(true)
  })

  it('다른 행이면 실패', () => {
    expect(adjacent(num, { x: 34, y: 160, w: 10, h: 12 })).toBe(false)
  })

  it('열을 건너뛸 만큼 멀면 실패 — 다단 표 열 어긋남', () => {
    expect(adjacent(num, { x: 30 + GEOM_MAX_GAP + 20, y: 100, w: 10, h: 12 })).toBe(false)
  })

  it('위치를 모르면 판단하지 않는다', () => {
    expect(adjacent(null, null)).toBe(true)
  })
})

// ---------- 합의 ----------

function raw(over: Partial<RawAnswer> & { number: number; path: RawAnswer['path'] }): RawAnswer {
  return {
    value: '3',
    choice: true,
    page: 1,
    numBox: { x: 20, y: 100, w: 10, h: 12 },
    valueBox: { x: 34, y: 100, w: 10, h: 12 },
    ...over,
  }
}

describe('mergePaths', () => {
  it('두 경로가 같은 답 → agreement 2, 플래그 없음', () => {
    const { problems, conflicts } = mergePaths([
      [raw({ path: 'token', number: 1, value: '3' })],
      [raw({ path: 'line', number: 1, value: '3' })],
    ])
    expect(problems[0]).toMatchObject({ agreement: 2, paths: 2, flags: [] })
    expect(conflicts).toHaveLength(0)
  })

  it('갈리면 conflict — 이 목록이 곧 검수 큐다', () => {
    const { problems, conflicts } = mergePaths([
      [raw({ path: 'token', number: 1, value: '3' })],
      [raw({ path: 'line', number: 1, value: '5' })],
    ])
    expect(problems[0].flags).toContain('conflict')
    expect(problems[0].agreement).toBe(1)
    expect(conflicts[0].votes).toHaveLength(2)
  })

  it('한 경로만 값을 내면 single_path', () => {
    const { problems } = mergePaths([[raw({ path: 'token', number: 7 })], []])
    expect(problems[0].flags).toContain('single_path')
  })

  it('같은 경로가 같은 문항을 두 번 읽어도 표는 한 장', () => {
    const { problems } = mergePaths([
      [raw({ path: 'token', number: 1 }), raw({ path: 'token', number: 1 })],
      [raw({ path: 'line', number: 1 })],
    ])
    expect(problems[0].paths).toBe(2)
  })

  it('번호와 답이 멀면 geometry — 형식은 완벽한데 전부 틀리는 실패를 잡는다', () => {
    const far = { x: 300, y: 100, w: 10, h: 12 }
    const { problems } = mergePaths([
      [raw({ path: 'token', number: 1, valueBox: far })],
      [raw({ path: 'line', number: 1, valueBox: far })],
    ])
    expect(problems[0].flags).toContain('geometry')
  })

  it('단원이 다르면 같은 번호라도 다른 문항이다', () => {
    const { problems } = mergePaths(
      [[raw({ path: 'token', number: 1, page: 1 }), raw({ path: 'token', number: 1, page: 9 })]],
      (r) => (r.page < 5 ? 'S1' : 'S2'),
    )
    expect(problems).toHaveLength(2)
    expect(problems.map((p) => problemKey(p.sectionId, p.number))).toEqual(['S1#1', 'S2#1'])
  })
})

// ---------- 단원 추론 ----------

describe('buildSections — 번호 리셋만 있을 때', () => {
  it('번호가 크게 줄어드는 곳을 단원 경계로 본다', () => {
    // 문제집은 단원마다 1번부터 다시 시작한다. 이걸 무시하면 서로 다른 문항이
    // 같은 키로 겹쳐 조용히 덮어써진다.
    const reads = [1, 2, 3, 4, 5, 1, 2, 3].map((n, i) =>
      raw({ path: 'token', number: n, page: i < 5 ? 1 : 2 }),
    )
    const { sections, sectionOf } = buildSections(reads, [])
    expect(sections.map((s) => s.id)).toEqual(['S1', 'S2'])
    expect(sections[1]).toMatchObject({ startPage: 2, from: 1, to: 3 })
    expect(sectionOf(reads[0])).toBe('S1')
    expect(sectionOf(reads[5])).toBe('S2')
  })

  it('한 쪽 안에서 살짝 뒤섞이는 것은 경계가 아니다', () => {
    const reads = [1, 2, 4, 3, 5].map((n) => raw({ path: 'token', number: n, page: 1 }))
    expect(buildSections(reads, []).sections).toHaveLength(1)
  })

  it('입력을 정렬하지 않는다 — 리셋 신호는 문서 순서에만 있다', () => {
    const reads = [10, 11, 12, 1, 2, 3].map((n) => raw({ path: 'token', number: n, page: 1 }))
    expect(buildSections(reads, []).sections).toHaveLength(2)
  })

  it('다른 경로의 읽기도 같은 단원으로 찾는다 — (쪽, y)로 조회한다', () => {
    const reads = [1, 2, 3, 4, 5, 1, 2].map((n, i) =>
      raw({ path: 'token', number: n, page: i < 5 ? 1 : 2 }),
    )
    const { sectionOf } = buildSections(reads, [])
    expect(sectionOf(raw({ path: 'line', number: 2, page: 2 }))).toBe('S2')
    expect(sectionOf(raw({ path: 'line', number: 2, page: 1 }))).toBe('S1')
  })

  it('빈 입력', () => {
    expect(buildSections([], []).sections).toEqual([])
  })
})

describe('markSequenceGaps', () => {
  it('번호가 건너뛰면 앞뒤 문항에 표시한다', () => {
    const ps = markSequenceGaps([problem({ number: 1 }), problem({ number: 5 })])
    expect(ps[0].flags).toContain('seq_gap')
    expect(ps[1].flags).toContain('seq_gap')
  })

  it('연속이면 표시하지 않는다', () => {
    const ps = markSequenceGaps([problem({ number: 1 }), problem({ number: 2 })])
    expect(ps.every((p) => p.flags.length === 0)).toBe(true)
  })

  it('단원이 다르면 리셋을 빈칸으로 보지 않는다', () => {
    const ps = markSequenceGaps([
      problem({ number: 30, sectionId: 'S1' }),
      problem({ number: 1, sectionId: 'S2' }),
    ])
    expect(ps.every((p) => p.flags.length === 0)).toBe(true)
  })
})

// ---------- 스키마 ----------

describe('validate', () => {
  it('정상 산출물은 error 없음', () => {
    const v = validate(extractOf([problem({ number: 1 })]))
    expect(v.filter((x) => x.level === 'error')).toEqual([])
  })

  it('지문이 sha256Short 규약이 아니면 error — 원본 대조가 불가능하다', () => {
    // hash.ts 주석: 라벨러와 런타임의 해시가 조금이라도 다르면 조용히 안 붙는다
    const x = extractOf([])
    x.source = 'a'.repeat(64)
    expect(validate(x).some((v) => v.code === 'source')).toBe(true)
  })

  it('객관식인데 답이 1~5 밖이면 error', () => {
    const v = validate(extractOf([problem({ number: 1, value: '7' })]))
    expect(v.some((x) => x.code === 'bad_choice')).toBe(true)
  })

  it('키가 겹치면 error', () => {
    const v = validate(extractOf([problem({ number: 1 }), problem({ number: 1 })]))
    expect(v.some((x) => x.code === 'duplicate_key')).toBe(true)
  })

  it('sections에 없는 단원이면 error', () => {
    const v = validate(extractOf([problem({ number: 1, sectionId: 'S9' })]))
    expect(v.some((x) => x.code === 'unknown_section')).toBe(true)
  })

  it('위치가 없으면 warn — 재검증이 불가능하다', () => {
    const v = validate(extractOf([problem({ number: 1, numBox: null, valueBox: null })]))
    expect(v.some((x) => x.code === 'no_box' && x.level === 'warn')).toBe(true)
  })

  it('쪽 범위 밖이면 error', () => {
    const v = validate(extractOf([problem({ number: 1, page: 99 })]))
    expect(v.some((x) => x.code === 'bad_page')).toBe(true)
  })
})

describe('parseExtract', () => {
  it('왕복한다', () => {
    const x = extractOf([problem({ number: 1 })])
    expect(parseExtract(JSON.stringify(x))).toEqual(x)
  })

  it('버전이 다르면 거부한다', () => {
    const x = { ...extractOf([]), schema: 99 }
    expect(() => parseExtract(JSON.stringify(x))).toThrow(/스키마/)
  })

  it('error가 있으면 거부한다 — 깨진 산출물은 영구 부채가 된다', () => {
    const x = extractOf([problem({ number: 1, value: '9' })])
    expect(() => parseExtract(JSON.stringify(x))).toThrow(/검증 실패/)
  })
})

describe('summarize / toCsv', () => {
  const x = extractOf([
    problem({ number: 1 }),
    problem({ number: 2, agreement: 1, flags: ['conflict'] }),
    problem({ number: 3, paths: 1, agreement: 1, flags: ['single_path'] }),
  ])

  it('검수 큐 크기를 센다', () => {
    expect(summarize(x)).toMatchObject({
      problems: 3,
      unanimous: 1,
      conflicts: 1,
      singlePath: 1,
      flagged: 2,
    })
  })

  it('CSV 헤더 + 행', () => {
    expect(toCsv(x).split('\n')).toHaveLength(4)
  })
})

describe('emptyExtract', () => {
  it('추출기 버전을 기록한다 — 나중에 재처리 여부를 판단하는 근거', () => {
    const x = emptyExtract({
      source: SOURCE,
      sourceName: 'a.pdf',
      pages: 1,
      methods: ['token'],
      extractedAt: 'now',
    })
    expect(x.provenance.extractorVersion).toBe(EXTRACTOR_VERSION)
    expect(x.provenance.reviewedAt).toBeNull()
  })
})

// ---------- 전체 실행 ----------

describe('runTextExtract', () => {
  it('경로들이 다르게 틀린다 — 합의만 확정, 갈린 것은 플래그', async () => {
    // 정답표 조판: 문항|정답|배점 반복. 붙인 줄 텍스트는 "1③22⑤3"이 된다.
    const pages: Record<number, TextLine[]> = {
      1: [line(['1', '③', '2', '2', '⑤', '3'])],
      2: [line(['3', '①', '2', '4', '④', '3'])],
    }
    const { extract, perPath } = await runTextExtract({
      pages: 2,
      getLines: async (p) => pages[p] ?? [],
      source: SOURCE,
      sourceName: 'book.pdf',
      extractedAt: '2026-07-28T00:00:00.000Z',
    })

    expect(extract.schema).toBe(1)
    expect(perPath.token).toBe(4)
    expect(perPath.line).toBe(4)
    expect(perPath.grid).toBe(4)

    const by = new Map(extract.problems.map((p) => [p.number, p]))

    // ★ 경로들이 실제로 다르게 틀린다는 증거.
    //   토큰·열 경로는 배점 칸을 건너뛰어 2·4번을 읽지만, 줄 텍스트 경로는 배점 '2'와
    //   다음 번호 '2'가 "22"로 붙어 22·24번이라는 없는 문항을 만든다.
    //   같은 방향으로 틀렸다면 합의는 신호가 아니라 착시가 된다.
    expect(by.get(1)).toMatchObject({ value: '3', agreement: 3, paths: 3, flags: [] })
    expect(by.get(3)).toMatchObject({ value: '1', agreement: 3, paths: 3, flags: [] })

    // 열 경로가 붙으면서 2·4번이 단일 경로에서 벗어났다 (토큰 + 열)
    expect(by.get(2)).toMatchObject({ value: '5', agreement: 2, paths: 2 })
    expect(by.get(2)!.flags).not.toContain('single_path')

    // 줄 경로만 본 유령 문항은 그대로 격리된다
    expect(by.get(22)!.flags).toContain('single_path')
    expect(by.get(24)!.flags).toContain('single_path')

    // 유령 22·24가 수열에 구멍을 내므로 4번도 검수 대상이 된다 — 오염이 전파되는 것을
    // 숨기지 않는다. 이 목록이 그대로 검수 큐다.
    const clean = extract.problems.filter((p) => p.flags.length === 0).map((p) => p.number)
    expect(clean).toEqual([1, 2, 3])

    expect(validate(extract).filter((v) => v.level === 'error')).toEqual([])
  })

  it('쪽 하나가 깨져도 나머지를 읽는다', async () => {
    const { extract } = await runTextExtract({
      pages: 2,
      getLines: async (p) => {
        if (p === 1) throw new Error('깨진 쪽')
        return [line(['1', '③', '2'])]
      },
      source: SOURCE,
      sourceName: 'book.pdf',
      extractedAt: 'now',
    })
    expect(extract.problems).toHaveLength(1)
  })

  it('중단하면 거기서 멈춘다', async () => {
    const signal = { aborted: false }
    let seen = 0
    const { extract } = await runTextExtract({
      pages: 10,
      getLines: async () => {
        seen++
        signal.aborted = true
        return [line(['1', '③', '2'])]
      },
      source: SOURCE,
      sourceName: 'book.pdf',
      extractedAt: 'now',
      signal,
    })
    expect(seen).toBe(1)
    expect(extract.problems).toHaveLength(1)
  })
})
