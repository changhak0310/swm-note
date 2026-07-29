import { describe, expect, it } from 'vitest'
import { classify, samplePages, summarize, toCsv, type PageProbe } from '../probe/vectorProbe'

function page(p: Partial<PageProbe> & { page: number }): PageProbe {
  return {
    tokens: 0,
    chars: 0,
    hangul: 0,
    digits: 0,
    circled: 0,
    imagePaints: -1,
    pairs: 0,
    textual: false,
    ...p,
  }
}

/** 텍스트가 정상인 한 쪽 */
function textual(p: number, over: Partial<PageProbe> = {}): PageProbe {
  return page({ page: p, tokens: 400, chars: 900, hangul: 300, digits: 60, textual: true, ...over })
}

describe('samplePages', () => {
  it('limit 0이면 전체', () => {
    expect(samplePages(5, 0)).toEqual([1, 2, 3, 4, 5])
  })

  it('총 쪽수가 limit 이하면 전체', () => {
    expect(samplePages(3, 8)).toEqual([1, 2, 3])
  })

  it('균등 간격 — 양 끝을 포함한다', () => {
    // 앞 N쪽만 보면 표지·목차만 재게 되고 뒤쪽 정답표를 통째로 놓친다
    const s = samplePages(45, 5)
    expect(s[0]).toBe(1)
    expect(s[s.length - 1]).toBe(45)
    expect(s).toHaveLength(5)
  })

  it('빈 문서', () => {
    expect(samplePages(0, 8)).toEqual([])
  })
})

describe('classify', () => {
  it('텍스트 0 → SCAN (OCR 경로 필요)', () => {
    const v = classify([page({ page: 1 }), page({ page: 2 }), page({ page: 3 })])
    expect(v.verdict).toBe('SCAN')
  })

  it('절반만 텍스트 → MIXED', () => {
    expect(classify([textual(1), textual(2), page({ page: 3 }), page({ page: 4 })]).verdict).toBe(
      'MIXED',
    )
  })

  it('텍스트 + 원문자 + 파싱 → VECTOR', () => {
    const v = classify([
      textual(1, { circled: 40, pairs: 40 }),
      textual(2, { circled: 40, pairs: 38 }),
    ])
    expect(v.verdict).toBe('VECTOR')
    expect(v.note).toContain('텍스트 경로 가능')
  })

  it('원문자는 많은데 파싱이 0 → 파서 문제로 지목한다', () => {
    // 이 구분이 이 파일의 존재 이유다. PDF는 멀쩡한데 현행 파서가 못 뽑는 경우
    // (answerKey.ts는 1~30번만 훑는다) SCAN으로 오분류하면 없어도 될 OCR 경로를 짓게 된다
    const v = classify([textual(1, { circled: 50, pairs: 0 }), textual(2, { circled: 50 })])
    expect(v.verdict).toBe('VECTOR')
    expect(v.note).toContain('파서 수정')
  })

  it('원문자 절반도 못 뽑으면 파서가 놓치는 중', () => {
    const v = classify([textual(1, { circled: 100, pairs: 10 })])
    expect(v.verdict).toBe('VECTOR')
    expect(v.note).toContain('놓치는 중')
  })

  it('글자는 있는데 한글 0 → cMap 미적용을 의심한다', () => {
    // pdf.ts 주석의 함정: cMap이 없으면 한글이 조용히 0자가 된다
    const v = classify([textual(1, { hangul: 0, circled: 30, pairs: 30 })])
    expect(v.note).toContain('cMap')
  })

  it('텍스트는 충분한데 원문자 0 → 답이 텍스트로 안 나온다', () => {
    const v = classify([textual(1, { circled: 0 })])
    expect(v.verdict).toBe('VECTOR')
    expect(v.note).toContain('원문자 0개')
  })

  it('잰 쪽이 없으면 ERROR', () => {
    expect(classify([]).verdict).toBe('ERROR')
  })
})

describe('summarize / toCsv', () => {
  const docs = [
    { verdict: 'VECTOR' as const },
    { verdict: 'VECTOR' as const },
    { verdict: 'SCAN' as const },
    { verdict: 'MIXED' as const },
  ].map((d, i) => ({
    file: `book-${i}.pdf`,
    bytes: 1000,
    pages: 45,
    sampled: [1, 2],
    perPage: [],
    totals: {
      textualPages: 2,
      textualRatio: 1,
      chars: 10,
      hangul: 5,
      circled: 3,
      digits: 4,
      imagePaints: 0,
      pairs: 3,
    },
    note: '사유, 쉼표 포함',
    ...d,
  }))

  it('권 수와 비율', () => {
    const s = summarize(docs)
    expect(s).toMatchObject({ files: 4, vector: 2, mixed: 1, scan: 1, error: 0 })
    expect(s.vectorRatio).toBeCloseTo(0.5)
  })

  it('CSV — 헤더 + 행, 쉼표는 따옴표로 감싼다', () => {
    const lines = toCsv(docs).split('\n')
    expect(lines).toHaveLength(5)
    expect(lines[1]).toContain('"사유, 쉼표 포함"')
  })
})
