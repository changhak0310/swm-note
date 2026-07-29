// 열 분해 · 단원 검출 · 검산 4종
import { describe, expect, it } from 'vitest'
import { COL_GAP_MIN, medianTokenGap, readGridPath, splitRuns } from '../extract/columns'
import { buildSections, detectSectionHeaders, scoreHeader } from '../extract/sections'
import {
  CHI2_CRIT_DF4,
  DIST_MIN_N,
  checkCoverage,
  checkDistribution,
  checkPageLink,
  checkSequence,
  runChecks,
} from '../extract/checks'
import { emptyExtract, type AnswerKeyExtract, type ProblemAnswer } from '../extract/schema'
import { readTokenPath, walkTriples } from '../extract/textPath'
import { runTextExtract } from '../extract/run'
import type { TextLine, TextToken } from '../pdfText'
import type { RawAnswer } from '../extract/textPath'

// ---------- 도우미 ----------

/** 토큰을 x축으로 놓되, 항목별 간격을 지정할 수 있다 (열 경계 재현용) */
function row(
  items: { str: string; gap?: number }[],
  opts: { y?: number; h?: number; x0?: number } = {},
): TextLine {
  const { y = 100, h = 12, x0 = 20 } = opts
  let x = x0
  const tokens: TextToken[] = items.map((it, i) => {
    if (i > 0) x += it.gap ?? 4
    const box = { x, y, w: 10 * Math.max(1, it.str.length), h }
    x += box.w
    return { str: it.str, box }
  })
  return { text: items.map((i) => i.str).join(''), tokens }
}

const t = (str: string, gap?: number) => ({ str, gap })

function raw(over: Partial<RawAnswer> & { number: number }): RawAnswer {
  return {
    path: 'token',
    value: '3',
    choice: true,
    page: 1,
    numBox: { x: 20, y: 100, w: 10, h: 12 },
    valueBox: { x: 34, y: 100, w: 10, h: 12 },
    ...over,
  }
}

const SOURCE = 'sha256:0123456789abcdef'

function extractOf(problems: ProblemAnswer[], sections: string[] = ['S1']): AnswerKeyExtract {
  const x = emptyExtract({
    source: SOURCE,
    sourceName: 'b.pdf',
    pages: 20,
    methods: ['token'],
    extractedAt: 'now',
  })
  x.sections = sections.map((id) => ({ id, title: id, startPage: 1, from: 1, to: 999 }))
  x.problems = problems
  return x
}

function problem(over: Partial<ProblemAnswer> & { number: number }): ProblemAnswer {
  return {
    sectionId: 'S1',
    value: '3',
    choice: true,
    page: 1,
    numBox: null,
    valueBox: null,
    agreement: 3,
    paths: 3,
    flags: [],
    reviewed: false,
    ...over,
  }
}

// ---------- 번호 범위 ----------

describe('walkTriples — 번호 상한', () => {
  it('기본값 30은 기존 파서와 같은 범위다', () => {
    const line = row([t('45'), t('③'), t('2')])
    expect(walkTriples(line.tokens, 1, 'token')).toHaveLength(0)
  })

  it('문제집 정답지는 상한을 넓혀 읽는다', () => {
    // answerKey.ts는 수능 30문항에 맞춰져 있다. 문제집은 단원당 100문항을 넘는다.
    const line = row([t('45'), t('③'), t('2')])
    const got = walkTriples(line.tokens, 1, 'token', { maxNumber: 300 })
    expect(got.map((r) => [r.number, r.value])).toEqual([[45, '3']])
  })

  it('3자리 번호', () => {
    const line = row([t('120'), t('⑤'), t('3')])
    expect(readTokenPath([line], 1, { maxNumber: 300 })[0].number).toBe(120)
  })
})

// ---------- 열 분해 ----------

describe('splitRuns', () => {
  it('큰 간격에서 끊는다', () => {
    const line = row([t('1'), t('③', 4), t('2', 4), t('11', 80), t('⑤', 4), t('3', 4)])
    const runs = splitRuns(line.tokens, 40)
    expect(runs.map((r) => r.map((x) => x.str))).toEqual([
      ['1', '③', '2'],
      ['11', '⑤', '3'],
    ])
  })

  it('간격이 없으면 한 덩어리', () => {
    const line = row([t('1'), t('③'), t('2')])
    expect(splitRuns(line.tokens, 40)).toHaveLength(1)
  })
})

describe('medianTokenGap', () => {
  it('간격 중앙값', () => {
    expect(medianTokenGap([row([t('a'), t('b', 5), t('c', 5)])])).toBe(5)
  })

  it('토큰이 하나면 0', () => {
    expect(medianTokenGap([row([t('a')])])).toBe(0)
  })
})

describe('readGridPath — 열 어긋남 구조적 차단', () => {
  it('열 경계를 넘어 짝짓지 않는다', () => {
    // 왼쪽 열의 배점이 빠져 토큰 경로는 "3"(왼쪽 번호)과 "⑤"(오른쪽 답)를 붙일 수 있다.
    // 열 경로는 경계에서 끊기므로 그 짝이 만들어지지 않는다.
    const line = row([t('1'), t('③', 4), t('3', 90), t('⑤', 4), t('2', 4)])
    const grid = readGridPath([line], 1, { maxNumber: 300 })
    expect(grid.map((r) => [r.number, r.value])).toEqual([
      [1, '3'],
      [3, '5'],
    ])
    // 열 안에서만 짝지었으므로 번호와 답이 같은 열에 있다
    for (const r of grid) {
      expect(r.valueBox!.x - (r.numBox!.x + r.numBox!.w)).toBeLessThan(COL_GAP_MIN * 5)
    }
  })

  it('평범한 한 열짜리 표는 토큰 경로와 같은 결과', () => {
    const line = row([t('1'), t('③'), t('2'), t('2'), t('⑤'), t('3')])
    const grid = readGridPath([line], 1, { maxNumber: 300 })
    const token = readTokenPath([line], 1, { maxNumber: 300 })
    expect(grid.map((r) => [r.number, r.value])).toEqual(token.map((r) => [r.number, r.value]))
  })
})

// ---------- 단원 헤더 ----------

describe('scoreHeader', () => {
  it('큰 글자 + 한글 + 머리 패턴이면 헤더', () => {
    const line = row([t('01'), t(' 다항식의 연산')], { h: 18 })
    expect(scoreHeader(line, 12).score).toBeGreaterThanOrEqual(4)
  })

  it('원문자가 있으면 정답표 행이다 — 감점', () => {
    const line = row([t('1'), t('③'), t('2')], { h: 18 })
    expect(scoreHeader(line, 12).score).toBeLessThan(4)
  })

  it('숫자만 있는 줄은 헤더가 아니다', () => {
    const line = row([t('12'), t('34'), t('56')], { h: 18 })
    expect(scoreHeader(line, 12).score).toBeLessThan(4)
  })

  it('본문 크기의 짧은 한글도 헤더로 보지 않는다', () => {
    const line = row([t('풀이')], { h: 12 })
    expect(scoreHeader(line, 12).score).toBeLessThan(4)
  })
})

describe('detectSectionHeaders', () => {
  it('제목 줄만 뽑는다', () => {
    const lines = [
      row([t('01'), t(' 다항식의 연산')], { h: 18, y: 40 }),
      row([t('1'), t('③'), t('2'), t('2'), t('⑤'), t('3')], { h: 12, y: 80 }),
    ]
    const got = detectSectionHeaders(lines, 3)
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ page: 3, y: 40 })
    expect(got[0].title).toContain('다항식')
  })
})

describe('buildSections — 헤더가 있을 때', () => {
  it('헤더가 경계이자 이름이 된다', () => {
    const headers = [
      { page: 1, y: 30, title: '01 다항식' },
      { page: 1, y: 300, title: '02 나머지정리' },
    ]
    const reads = [
      raw({ number: 1, page: 1, numBox: { x: 20, y: 60, w: 10, h: 12 } }),
      raw({ number: 2, page: 1, numBox: { x: 20, y: 80, w: 10, h: 12 } }),
      raw({ number: 1, page: 1, numBox: { x: 20, y: 330, w: 10, h: 12 } }),
    ]
    const { sections, sectionOf } = buildSections(reads, headers)
    // ★ 한 쪽에 단원이 둘 — (쪽, 번호) 경계로는 구분되지 않던 경우
    expect(sections.map((s) => s.title)).toEqual(['01 다항식', '02 나머지정리'])
    expect(sectionOf(reads[0])).toBe('S1')
    expect(sectionOf(reads[2])).toBe('S2')
  })

  it('헤더를 못 찾으면 번호 리셋으로라도 나눈다', () => {
    const reads = [1, 2, 3, 4, 5, 1, 2].map((n, i) =>
      raw({ number: n, page: 1, numBox: { x: 20, y: 60 + i * 20, w: 10, h: 12 } }),
    )
    const { sections } = buildSections(reads, [])
    expect(sections).toHaveLength(2)
    // 이름은 모르지만 단원은 놓치지 않는다 — 둘은 다른 문제다
    expect(sections[1].title).toBe('S2')
  })
})

// ---------- 검산 4종 ----------

describe('checkSequence', () => {
  it('연속이면 pass', () => {
    const r = checkSequence(extractOf([1, 2, 3].map((n) => problem({ number: n }))))
    expect(r.status).toBe('pass')
  })

  it('빠진 번호를 키로 돌려준다', () => {
    const r = checkSequence(extractOf([1, 2, 5].map((n) => problem({ number: n }))))
    expect(r.status).toBe('fail')
    expect(r.keys).toEqual(['S1#3', 'S1#4'])
  })

  it('단원마다 따로 센다 — 리셋은 빈칸이 아니다', () => {
    const r = checkSequence(
      extractOf(
        [
          problem({ number: 1, sectionId: 'S1' }),
          problem({ number: 2, sectionId: 'S1' }),
          problem({ number: 1, sectionId: 'S2' }),
        ],
        ['S1', 'S2'],
      ),
    )
    expect(r.status).toBe('pass')
  })
})

describe('checkDistribution — 열 어긋남 탐지기', () => {
  const spread = (counts: number[]): ProblemAnswer[] =>
    counts.flatMap((c, i) =>
      Array.from({ length: c }, (_, k) =>
        problem({ number: i * 100 + k + 1, value: String(i + 1) }),
      ),
    )

  it('표본이 적으면 판정하지 않는다', () => {
    expect(checkDistribution(extractOf(spread([2, 2, 2, 2, 2]))).status).toBe('skip')
  })

  it('균등하면 pass', () => {
    const r = checkDistribution(extractOf(spread([12, 12, 12, 12, 12])))
    expect(r.status).toBe('pass')
    expect(r.detail).toContain('χ²')
  })

  it('한 선지로 쏠리면 fail — 수열·쪽연결은 통과하는 실패다', () => {
    // 열이 한 칸 밀리면 답이 한쪽으로 몰린다. 다른 검산은 전부 통과한다.
    const r = checkDistribution(extractOf(spread([60, 5, 5, 5, 5])))
    expect(r.status).toBe('fail')
    expect(r.headline).toContain('쏠림')
  })

  it('임계값', () => {
    expect(CHI2_CRIT_DF4).toBeCloseTo(13.277, 2)
    expect(DIST_MIN_N).toBe(30)
  })

  it('주관식은 세지 않는다', () => {
    const r = checkDistribution(extractOf([problem({ number: 1, choice: false, value: '48' })]))
    expect(r.status).toBe('skip')
  })
})

describe('checkPageLink', () => {
  it('쪽이 이어지면 pass', () => {
    const r = checkPageLink(
      extractOf([
        problem({ number: 1, page: 1 }),
        problem({ number: 2, page: 1 }),
        problem({ number: 3, page: 2 }),
      ]),
    )
    expect(r.status).toBe('pass')
  })

  it('쪽 경계에서 번호가 튀면 잡는다', () => {
    const r = checkPageLink(
      extractOf([problem({ number: 2, page: 1 }), problem({ number: 9, page: 2 })]),
    )
    expect(r.status).toBe('warn')
    expect(r.keys).toEqual(['S1#9'])
  })

  it('떨어진 쪽은 보지 않는다 — 그건 수열 검산의 몫', () => {
    const r = checkPageLink(
      extractOf([problem({ number: 2, page: 1 }), problem({ number: 9, page: 5 })]),
    )
    expect(r.status).toBe('pass')
  })
})

describe('checkCoverage', () => {
  it('원문자가 없으면 판정 보류', () => {
    expect(checkCoverage(extractOf([]), {}).status).toBe('skip')
  })

  it('대부분 잡으면 pass', () => {
    const ps = Array.from({ length: 9 }, (_, i) => problem({ number: i + 1 }))
    expect(checkCoverage(extractOf(ps), { 1: 10 }).status).toBe('pass')
  })

  it('원문자에 비해 문항이 턱없이 적으면 fail', () => {
    const ps = Array.from({ length: 2 }, (_, i) => problem({ number: i + 1 }))
    const r = checkCoverage(extractOf(ps), { 1: 50, 2: 50 })
    expect(r.status).toBe('fail')
    expect(r.headline).toContain('%')
  })
})

describe('runChecks', () => {
  it('하나라도 fail이면 불합격', () => {
    const report = runChecks(extractOf([1, 2, 9].map((n) => problem({ number: n }))), {})
    expect(report.verdict).toBe('fail')
    expect(report.results).toHaveLength(4)
  })

  it('검수 큐 = 검산 키 ∪ 플래그 문항', () => {
    const report = runChecks(
      extractOf([
        problem({ number: 1, flags: ['conflict'] }),
        problem({ number: 2 }),
        problem({ number: 5 }), // 3, 4가 빈다
      ]),
      {},
    )
    // 빈칸 S1#3, S1#4 + 플래그 S1#1
    expect(report.queue).toBe(3)
  })

  it('전부 깨끗하면 pass', () => {
    const ps = Array.from({ length: 40 }, (_, i) =>
      problem({ number: i + 1, value: String((i % 5) + 1) }),
    )
    const report = runChecks(extractOf(ps), { 1: 40 })
    expect(report.verdict).toBe('pass')
    expect(report.queue).toBe(0)
  })
})

// ---------- 통합 ----------

describe('runTextExtract — 3경로 + 검산', () => {
  it('헤더로 단원 이름을 붙이고 검산을 돌린다', async () => {
    const pages: Record<number, TextLine[]> = {
      1: [
        row([t('01'), t(' 다항식의 연산')], { h: 18, y: 30 }),
        row([t('1'), t('③'), t('2'), t('2'), t('⑤'), t('3')], { h: 12, y: 80 }),
      ],
      2: [row([t('3'), t('①'), t('2'), t('4'), t('④'), t('3')], { h: 12, y: 80 })],
    }
    const res = await runTextExtract({
      pages: 2,
      getLines: async (p) => pages[p] ?? [],
      source: SOURCE,
      sourceName: 'book.pdf',
      extractedAt: 'now',
    })

    expect(res.headers.map((h) => h.title)).toEqual(['01 다항식의 연산'])
    expect(res.extract.sections[0].title).toBe('01 다항식의 연산')
    expect(res.perPath.grid).toBeGreaterThan(0)
    expect(res.extract.provenance.methods).toEqual(['token', 'line', 'grid'])
    expect(res.checks.results.map((r) => r.id)).toEqual([
      'sequence',
      'distribution',
      'page_link',
      'coverage',
    ])
    // 원문자 개수를 쪽별로 세어 커버리지 검산에 넘긴다
    expect(res.circledPerPage).toEqual({ 1: 2, 2: 2 })
  })

  it('토큰과 열이 함께 본 문항은 합의가 올라간다', async () => {
    const pages: Record<number, TextLine[]> = {
      1: [row([t('1'), t('③'), t('2'), t('2'), t('⑤'), t('3')], { y: 80 })],
    }
    const res = await runTextExtract({
      pages: 1,
      getLines: async (p) => pages[p] ?? [],
      source: SOURCE,
      sourceName: 'b.pdf',
      extractedAt: 'now',
    })
    const one = res.extract.problems.find((p) => p.number === 1)!
    expect(one.agreement).toBeGreaterThanOrEqual(2)
  })
})
