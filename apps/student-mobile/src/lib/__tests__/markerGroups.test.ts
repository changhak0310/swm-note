// 페이지 전역 선지 뭉치 (B-8) — 앵커 없이도 뭉치가 서는가, 그리고 가짜는 걸러지는가.
//
// 이 모듈의 값은 "앵커가 죽어도 살아남는 것"이라, 픽스처에는 **앵커를 아예 넣지 않는다.**
// 번호 span이 없어도 뭉치가 나와야 한다.
import { describe, expect, it } from 'vitest'
import { layoutPages } from '../psp/layout'
import { findMarkerGroups } from '../psp/markerGroups'
import type { PageInput, Span } from '../psp/types'

const BODY_FS = 0.012
const CIRCLED = '①②③④⑤'
const PAREN = '⑴⑵⑶⑷⑸'

function span(text: string, x: number, y: number, w = 0.02): Span {
  return { text, bbox: [x, y, x + w, y + BODY_FS], fontSize: BODY_FS, bold: false }
}

/** 본문 한 줄 — 뭉치가 아닌 글자가 있어야 단 판정·라인 구성이 실제와 비슷해진다 */
function body(y: number, left = 0.1, n = 6): Span[] {
  return Array.from({ length: n }, (_, i) => span('가나다', left + i * 0.06, y, 0.05))
}

function page(spans: Span[], index = 0): PageInput {
  return { index, width: 600, height: 840, spans }
}

/** 마커 5개를 한 줄에 늘어놓는다 (①②③④⑤) */
function rowOfFive(y: number, left = 0.1, chars = CIRCLED): Span[] {
  return Array.from({ length: 5 }, (_, i) => span(chars[i], left + i * 0.14, y))
}

/** 세로로 한 개씩 — 행 시작 x가 같다 */
function colOfFive(top: number, left = 0.1, pitch = 0.03, chars = CIRCLED): Span[] {
  return Array.from({ length: 5 }, (_, i) => span(chars[i], left, top + i * pitch))
}

function groupsOf(spans: Span[]) {
  return findMarkerGroups(layoutPages([page(spans)])[0], BODY_FS)
}

describe('선지 뭉치 — 앵커 없이', () => {
  it('한 줄 5선지를 뭉치 하나로 묶는다', () => {
    const groups = groupsOf([...body(0.2), ...rowOfFive(0.4), ...body(0.6)])
    expect(groups).toHaveLength(1)
    expect(groups[0].markers.map((m) => m.ordinal)).toEqual([1, 2, 3, 4, 5])
    expect(groups[0].family).toBe('circled-digit')
  })

  it('세로 5선지도 묶는다', () => {
    const groups = groupsOf([...body(0.15), ...colOfFive(0.3), ...body(0.75)])
    expect(groups).toHaveLength(1)
    expect(groups[0].markers.map((m) => m.ordinal)).toEqual([1, 2, 3, 4, 5])
  })

  it('한 페이지의 두 문항을 따로 묶는다', () => {
    // 문항 사이에는 발문이 들어가 세로로 크게 벌어진다
    const groups = groupsOf([
      ...body(0.1), ...rowOfFive(0.2),
      ...body(0.5), ...rowOfFive(0.7),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].bbox[1]).toBeLessThan(groups[1].bbox[1])
  })

  it('번호 span이 하나도 없어도 뭉치가 선다 — 이 모듈의 존재 이유', () => {
    // 앵커 후보가 될 만한 것이 전혀 없는 페이지
    const spans = [...body(0.3), ...rowOfFive(0.5)]
    expect(spans.some((s) => /^\d/.test(s.text))).toBe(false)
    expect(groupsOf(spans)).toHaveLength(1)
  })
})

describe('선지 뭉치 — 가짜 거르기', () => {
  it('셋뿐이면 뭉치가 아니다 (개념 정리 쪽의 "①… ②… ③…")', () => {
    const three = CIRCLED.slice(0, 3)
      .split('')
      .map((c, i) => span(c, 0.1, 0.3 + i * 0.05))
    expect(groupsOf([...body(0.2), ...three])).toHaveLength(0)
  })

  it('서수가 읽는 순서와 어긋나면 버린다 — 목차·본문에 흩어진 원문자', () => {
    // 자리는 ①②③④⑤ 순인데 인쇄된 서수가 뒤죽박죽이다
    const scrambled = [3, 1, 5, 2, 4].map((n, i) => span(CIRCLED[n - 1], 0.1 + i * 0.14, 0.4))
    expect(groupsOf([...body(0.2), ...scrambled])).toHaveLength(0)
  })

  it('1부터 시작하지 않으면 버린다', () => {
    const from2 = [2, 3, 4, 5].map((n, i) => span(CIRCLED[n - 1], 0.1 + i * 0.14, 0.4))
    expect(groupsOf([...body(0.2), ...from2])).toHaveLength(0)
  })

  it('행 시작 x가 흩어지면 버린다 (실측 쎈 p180의 증명 상자)', () => {
    // 세로 배치인데 줄마다 들여쓰기가 제각각 — 조판된 선지는 이렇지 않다
    const xs = [0.1, 0.35, 0.42, 0.72, 0.15]
    const scattered = xs.map((x, i) => span(CIRCLED[i], x, 0.3 + i * 0.03))
    expect(groupsOf([...body(0.2), ...scattered])).toHaveLength(0)
  })
})

describe('선지 뭉치 — 지면 미리보기 썸네일', () => {
  it('본문보다 한참 작은 마커 뭉치는 버린다 (실측 hi_math p7·p8 "이 책의 구성과 특징")', () => {
    // 썸네일 안의 선지 — 서수도 1..5고 한 줄에 가지런하지만 크기가 본문의 0.25배다.
    // 이 쪽은 본문 글자도 같이 작아서 "페이지 안 상대 크기"로는 절대 못 걸린다.
    const tiny = Array.from({ length: 5 }, (_, i) => ({
      text: CIRCLED[i],
      bbox: [0.1 + i * 0.04, 0.4, 0.1 + i * 0.04 + 0.005, 0.4 + BODY_FS * 0.25],
      fontSize: BODY_FS * 0.25,
      bold: false,
    })) as Span[]
    const smallBody = Array.from({ length: 8 }, (_, i) => ({
      text: '가나다',
      bbox: [0.1 + i * 0.04, 0.3, 0.1 + i * 0.04 + 0.03, 0.3 + BODY_FS * 0.25],
      fontSize: BODY_FS * 0.25,
      bold: false,
    })) as Span[]

    const layout = layoutPages([page([...smallBody, ...tiny])])[0]
    // 문서 전체 본문 크기를 넘기면 걸러진다
    expect(findMarkerGroups(layout, BODY_FS)).toHaveLength(0)
    // 페이지 안 크기(작은 본문)를 기준으로 삼으면 못 걸러낸다 — 첫 시도가 이렇게 실패했다
    expect(findMarkerGroups(layout, BODY_FS * 0.25)).toHaveLength(1)
  })
})

describe('선지 뭉치 — 계열', () => {
  it('페이지 다수결로 계열 하나만 쓴다', () => {
    // ⑴⑵가 둘 섞여 있어도 다수인 ①~⑤만 남는다
    const groups = groupsOf([
      ...body(0.2),
      span(PAREN[0], 0.1, 0.3), span(PAREN[1], 0.1, 0.34),
      ...rowOfFive(0.5),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].family).toBe('circled-digit')
  })

  it('⑴⑵만 둘 있는 쪽은 뭉치가 아니다 — 소문항 오인 방지 (실측 수학의 신 p18·p91)', () => {
    const groups = groupsOf([
      ...body(0.2),
      span(PAREN[0], 0.1, 0.4), span(PAREN[1], 0.1, 0.45),
      ...body(0.6),
    ])
    expect(groups).toHaveLength(0)
  })
})

describe('선지 뭉치 — 2단', () => {
  it('좌우 단의 뭉치를 섞지 않는다', () => {
    // 거터를 사이에 두고 같은 y에 뭉치가 하나씩
    const left = [...body(0.1, 0.06, 3), ...colOfFive(0.3, 0.08)]
    const right = [...body(0.1, 0.56, 3), ...colOfFive(0.3, 0.58)]
    const layout = layoutPages([page([...left, ...right])])[0]
    expect(layout.columns).toHaveLength(2)

    const groups = findMarkerGroups(layout, BODY_FS)
    expect(groups).toHaveLength(2)
    expect(new Set(groups.map((g) => g.columnIndex))).toEqual(new Set([0, 1]))
    for (const g of groups) expect(g.markers.map((m) => m.ordinal)).toEqual([1, 2, 3, 4, 5])
  })
})
