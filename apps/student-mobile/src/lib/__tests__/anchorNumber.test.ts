// 번호 형식(A-1)과 선지 최소 개수(C-1) — 실측에서 나온 두 규칙을 못박는다.
//
// 배경은 규칙 문서 §4.2.2 · §4.2.3. 요약하면:
//   - "수학의 신 문제.pdf"는 문항 번호가 `8-1` 꼴이라 통째로 안 잡혔다 (157개)
//   - 그것을 살리자 이번엔 `⑴⑵` 소문항이 선지로 잡혀 어긋난 박스가 늘었다 → C-1을 4로
import { describe, expect, it } from 'vitest'
import { runPipeline } from '../psp/pipeline'
import type { PageInput, Span } from '../psp/types'

const BODY_FS = 0.012
const ANCHOR_FS = 0.016
const CIRCLED = '①②③④⑤'

function span(text: string, x: number, y: number, w: number, fontSize = BODY_FS): Span {
  return { text, bbox: [x, y, x + w, y + fontSize], fontSize, bold: false }
}

/** probe(§4.1)가 텍스트 PDF로 인정하려면 쪽당 span이 20개 이상이어야 한다 */
function filler(y: number): Span[] {
  return Array.from({ length: 11 }, (_, i) => span('본문', 0.2 + i * 0.055, y, 0.045))
}

type Item = { number: string; choices: number }

/** 문항을 세로로 쌓은 한 쪽. 번호는 컬럼 좌단(A-2)·본문보다 큼(A-3)·라인 선두(A-4) */
function pageOf(items: Item[]): PageInput {
  const spans: Span[] = []
  items.forEach((item, i) => {
    const top = 0.08 + i * 0.28
    spans.push(span(item.number, 0.06, top, 0.03, ANCHOR_FS))
    spans.push(...filler(top))
    spans.push(...filler(top + 0.05))
    for (let k = 0; k < item.choices; k++) {
      // 선지는 문항 텍스트 범위의 아래쪽에 둔다 (C-3)
      spans.push(span(CIRCLED[k], 0.1, top + 0.12 + k * 0.03, 0.02))
    }
  })
  return { index: 0, width: 600, height: 840, spans }
}

function problemsOf(items: Item[]) {
  return runPipeline([pageOf(items)], { jobId: 't' }).problems
}

describe('A-1 — "유형-문항" 꼴 번호', () => {
  it('8-1 꼴을 번호로 인정한다 (실측 수학의 신)', () => {
    const ps = problemsOf([
      { number: '8-1', choices: 0 },
      { number: '8-2', choices: 0 },
      { number: '8-3', choices: 0 },
    ])
    expect(ps.map((p) => p.number)).toEqual(['8-1', '8-2', '8-3'])
  })

  it('numberInt는 유형×1000+문항 — 같은 유형 안에서 1씩 는다', () => {
    const ps = problemsOf([
      { number: '8-1', choices: 0 },
      { number: '8-2', choices: 0 },
    ])
    expect(ps.map((p) => p.numberInt)).toEqual([8001, 8002])
  })

  it('유형이 바뀌면 크게 뛴다 — 유형 경계를 가로질러 빈칸을 메우지 않게', () => {
    const ps = problemsOf([
      { number: '8-2', choices: 0 },
      { number: '9-1', choices: 0 },
    ])
    const [a, b] = ps.map((p) => p.numberInt!)
    expect(b - a).toBeGreaterThan(5) // GAP_MAX
  })

  it('붙임표가 en dash여도 ASCII로 정규화한다 — id가 서체에 안 흔들린다', () => {
    const ps = problemsOf([
      { number: '8–1', choices: 0 },
      { number: '8–2', choices: 0 },
    ])
    expect(ps.map((p) => p.number)).toEqual(['8-1', '8-2'])
  })

  it('네 자리 이상은 번호가 아니다', () => {
    const ps = problemsOf([
      { number: '2027-06', choices: 0 },
      { number: '8-1', choices: 0 },
    ])
    expect(ps.map((p) => p.number)).toEqual(['8-1'])
  })
})

describe('계열 — 책 단위 다수결', () => {
  /** 여러 쪽짜리 문서. 마지막 쪽만 다른 계열을 쓴다 */
  function docOf(pages: { number: string; choices: number; chars?: string }[][]): PageInput[] {
    return pages.map((items, index) => {
      const spans: Span[] = []
      items.forEach((item, i) => {
        const top = 0.08 + i * 0.28
        spans.push(span(item.number, 0.06, top, 0.03, ANCHOR_FS))
        spans.push(...filler(top))
        spans.push(...filler(top + 0.05))
        const chars = item.chars ?? CIRCLED
        for (let k = 0; k < item.choices; k++) {
          spans.push(span(chars[k], 0.1, top + 0.12 + k * 0.03, 0.02))
        }
      })
      return { index, width: 600, height: 840, spans }
    })
  }

  it('문서 다수 계열이 아닌 뭉치는 선지가 아니다 — 소문항 ⑴⑵⑶⑷ (실측 수학의 신 p46)', () => {
    // 앞 두 쪽은 ①~⑤ 선지, 마지막 쪽은 ⑴⑵⑶⑷ 소문항 넷
    const ps = runPipeline(
      docOf([
        [{ number: '1', choices: 5 }, { number: '2', choices: 5 }],
        [{ number: '3', choices: 5 }, { number: '4', choices: 5 }],
        [{ number: '5', choices: 4, chars: '⑴⑵⑶⑷⑸' }],
      ]),
      { jobId: 'f' },
    ).problems

    const mc = ps.filter((p) => p.problemType === 'MULTIPLE_CHOICE')
    expect(mc).toHaveLength(4)                       // 1~4번만
    expect(ps.find((p) => p.number === '5')!.problemType).not.toBe('MULTIPLE_CHOICE')
  })

  it('그림 라벨 ㉠~㉤도 같은 규칙으로 걸린다 (실측 수학의 신 p80)', () => {
    const ps = runPipeline(
      docOf([
        [{ number: '1', choices: 5 }, { number: '2', choices: 5 }],
        [{ number: '3', choices: 5 }, { number: '4', choices: 5 }],
        [{ number: '5', choices: 5, chars: '㉠㉡㉢㉣㉤' }],
      ]),
      { jobId: 'f' },
    ).problems
    expect(ps.find((p) => p.number === '5')!.problemType).not.toBe('MULTIPLE_CHOICE')
  })

  it('다수 계열이 ⑴⑵⑶이면 그쪽이 선지가 된다 — 책마다 자동으로 맞춘다', () => {
    // 통합 조건: 계열을 상수로 못박지 않는다. 그 책이 실제로 쓰는 것을 따른다
    const ps = runPipeline(
      docOf([
        [{ number: '1', choices: 5, chars: '⑴⑵⑶⑷⑸' }, { number: '2', choices: 5, chars: '⑴⑵⑶⑷⑸' }],
        [{ number: '3', choices: 5, chars: '⑴⑵⑶⑷⑸' }, { number: '4', choices: 5, chars: '⑴⑵⑶⑷⑸' }],
        [{ number: '5', choices: 4 }],
      ]),
      { jobId: 'f' },
    ).problems
    const mc = ps.filter((p) => p.problemType === 'MULTIPLE_CHOICE')
    expect(mc.map((p) => p.number)).toEqual(['1', '2', '3', '4'])
  })
})

describe('C-1 — 선지 최소 개수', () => {
  it('5개면 객관식이다', () => {
    const [p] = problemsOf([{ number: '1', choices: 5 }])
    expect(p.problemType).toBe('MULTIPLE_CHOICE')
    expect(p.regions.filter((r) => r.kind === 'CHOICE_ITEM')).toHaveLength(5)
  })

  it('4개도 객관식이다', () => {
    const [p] = problemsOf([{ number: '1', choices: 4 }])
    expect(p.problemType).toBe('MULTIPLE_CHOICE')
  })

  it('둘뿐이면 객관식이 아니다 — ⑴⑵ 소문항 오인 방지 (실측 수학의 신)', () => {
    const [p] = problemsOf([{ number: '1', choices: 2 }])
    expect(p.problemType).not.toBe('MULTIPLE_CHOICE')
    expect(p.regions.filter((r) => r.kind === 'CHOICE_ITEM')).toHaveLength(0)
  })

  it('셋도 객관식이 아니다', () => {
    const [p] = problemsOf([{ number: '1', choices: 3 }])
    expect(p.problemType).not.toBe('MULTIPLE_CHOICE')
  })

  it('마커는 보였는데 못 세우면 FLAG_CHOICES_MISSING이 붙는다', () => {
    const [p] = problemsOf([{ number: '1', choices: 2 }])
    expect(p.flags).toContain('FLAG_CHOICES_MISSING')
  })
})
