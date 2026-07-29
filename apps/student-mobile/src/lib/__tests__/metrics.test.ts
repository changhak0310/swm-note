// M4(마킹 귀속) 지표의 계약 — 이 테스트가 "인식 95%"의 정의다.
//
// 특히 못박는 것 하나: **되읽기가 못 잡던 실패를 M4는 잡는다.** 검출 박스가 인쇄물에서
// 통째로 밀려도 되읽기는 100%를 내지만(규칙 문서 §5), M4는 인쇄 자리에서 표기를 만들기
// 때문에 그만큼 그대로 깎인다.
import { describe, expect, it } from 'vitest'
import { MARK_KINDS, markStroke, scoreAttribution, type MarkKind } from '../metrics'
import { emptyGolden, type GoldenBox, type GoldenSet } from '../psp/golden'
import { isClosedLoop } from '../geometry'
import type { Box, ChoiceLabel, Region } from '../../types'

const ROW_PITCH = 18

/** i번째(0-based) 세로 선지 박스 */
const choiceBox = (i: number, dy = 0): Box => ({ x: 10, y: 100 + i * ROW_PITCH + dy, w: 120, h: 16 })

const boxes = (dy = 0) =>
  Array.from({ length: 5 }, (_, i) => ({ label: (i + 1) as ChoiceLabel, box: choiceBox(i, dy) }))

function goldenBox(page = 1, number = '12'): GoldenBox {
  return {
    id: `g${page}-${number}`,
    page,
    number,
    bbox: { x: 0, y: 60, w: 300, h: 140 },
    kind: 'choice',
    choices: boxes(),
  }
}

function set(bs: GoldenBox[], reviewedPages = [1]): GoldenSet {
  return { ...emptyGolden('t.pdf', 5), boxes: bs, reviewedPages }
}

function predicted(dy = 0, page = 1, id = 'p1'): Region {
  return {
    id,
    docId: 'd',
    page,
    bounds: { x: 0, y: 60, w: 300, h: 140 },
    choices: boxes(dy),
    ansSynth: false,
    answerType: 'choice',
  }
}

describe('표기 생성', () => {
  const box = choiceBox(0)

  it('동그라미와 wrap은 닫힌 고리, 체크는 열린 마크다', () => {
    expect(isClosedLoop(markStroke(box, 'circle').points)).toBe(true)
    expect(isClosedLoop(markStroke(box, 'wrap').points)).toBe(true)
    // 체크가 닫힌 고리로 잡히면 겹침 경로(사용자 표기의 주류)를 아예 안 재게 된다
    expect(isClosedLoop(markStroke(box, 'check').points)).toBe(false)
  })

  it('wrap은 선지 박스 안에 머문다 — 이웃을 침범하면 지표가 거짓 실패를 만든다', () => {
    for (const p of markStroke(box, 'wrap').points) {
      expect(p.x).toBeGreaterThanOrEqual(box.x)
      expect(p.x).toBeLessThanOrEqual(box.x + box.w)
      expect(p.y).toBeGreaterThanOrEqual(box.y)
      expect(p.y).toBeLessThanOrEqual(box.y + box.h)
    }
  })
})

describe('M4 마킹 귀속', () => {
  it('예측이 인쇄와 같으면 만점 — 세 표기 방식 모두', () => {
    const s = scoreAttribution([predicted()], set([goldenBox()]))
    expect(s.total).toBe(5 * MARK_KINDS.length)
    expect(s.accuracy).toBe(1)
    expect(s.wrong).toBe(0)
    expect(s.missed).toBe(0)
    for (const k of MARK_KINDS) expect(s.byKind[k].correct).toBe(5)
  })

  it('★ 박스가 인쇄물에서 한 줄 밀리면 조용히 틀린다 (되읽기는 100%를 내던 상태)', () => {
    // 예측 선지가 통째로 한 행 아래로 밀렸다. 검출↔판정 계약은 여전히 자기일관이다
    const s = scoreAttribution([predicted(ROW_PITCH)], set([goldenBox()]))
    expect(s.accuracy).toBeLessThan(1)
    expect(s.wrong).toBeGreaterThan(0)
    // 인쇄된 ②에 쳤는데 ①로 읽힌다 — 사용자가 눈치채지 못하는 실패다
    expect(s.failures.some((f) => f.outcome === 'wrong' && f.got === '선지1')).toBe(true)
  })

  it('문항을 통째로 놓치면 그 선지가 전부 missed로 잡힌다', () => {
    const s = scoreAttribution([], set([goldenBox()]))
    expect(s.total).toBe(5 * MARK_KINDS.length)
    expect(s.missed).toBe(s.total)
    expect(s.accuracy).toBe(0)
    expect(s.wrong).toBe(0)
  })

  it('wrong과 missed를 합치지 않는다 — 값이 다른 실패다', () => {
    // 한 문항은 밀려서 잘못 읽히고(wrong), 다른 한 문항은 통째로 없다(missed)
    const g2: GoldenBox = {
      ...goldenBox(1, '13'),
      id: 'g1-13',
      bbox: { x: 400, y: 60, w: 300, h: 140 },
      choices: boxes().map((c) => ({ ...c, box: { ...c.box, x: 410 } })),
    }
    const s = scoreAttribution([predicted(ROW_PITCH)], set([goldenBox(), g2]))

    expect(s.correct + s.wrong + s.missed).toBe(s.total)
    expect(s.wrong).toBeGreaterThan(0)
    expect(s.missed).toBeGreaterThan(0)
    // 헤드라인(1 − accuracy)에 둘이 뭉개져 있으면 상한을 따로 걸 수 없다
    expect(s.wrongRate).toBeLessThan(1 - s.accuracy)
    expect(s.wrongRate).toBeCloseTo(s.wrong / s.total, 10)
  })

  it('다른 문항으로 귀속되면 구분해서 보고한다', () => {
    // 같은 쪽에 문항이 둘인데 예측은 하나뿐 — 아래 문항 표기가 위 문항으로 빨려 든다
    const g2: GoldenBox = {
      ...goldenBox(1, '13'),
      id: 'g1-13',
      bbox: { x: 0, y: 200, w: 300, h: 140 },
      choices: boxes(140),
    }
    const wide: Region = { ...predicted(), bounds: { x: 0, y: 60, w: 300, h: 400 }, choices: [...boxes(), ...boxes(140)].map((c, i) => ({ ...c, label: ((i % 5) + 1) as ChoiceLabel })) }
    const s = scoreAttribution([wide], set([goldenBox(), g2]))
    expect(s.failures.some((f) => f.got.startsWith('다른문항'))).toBe(true)
  })

  it('★ 문항 경계가 헐거워도 선지만 맞으면 만점 — 라벨 비용을 여기서 줄인다', () => {
    // bounds는 라벨에서 가장 애매하고 비싼 항목이다(그림·여백을 어디까지 넣나).
    // M4가 묻는 것은 경계가 아니라 "표기가 옳은 문항의 옳은 번호로 읽히는가"다.
    const loose: Region = { ...predicted(), bounds: { x: 0, y: 0, w: 760, h: 1000 } }
    const s = scoreAttribution([loose], set([goldenBox()]))
    expect(s.accuracy).toBe(1)

    // 반대로 선지가 어긋나면 경계가 완벽해도 깎인다 — 짝짓기 기준이 선지이기 때문이다
    const shifted = scoreAttribution([predicted(ROW_PITCH)], set([goldenBox()]))
    expect(shifted.accuracy).toBeLessThan(1)
  })

  it('선지를 라벨하지 않은 문항은 분모에 넣지 않는다', () => {
    const bare: GoldenBox = { ...goldenBox(), choices: [] }
    expect(scoreAttribution([predicted()], set([bare])).total).toBe(0)
  })

  it('확인하지 않은 페이지는 통째로 뺀다', () => {
    const s = scoreAttribution([predicted(0, 2, 'p2')], set([goldenBox(2)], [1]))
    expect(s.total).toBe(0)
  })

  it('표기 방식을 골라 잴 수 있다 — 방식마다 판정 경로가 다르다', () => {
    const kinds: MarkKind[] = ['check']
    const s = scoreAttribution([predicted()], set([goldenBox()]), { kinds })
    expect(s.total).toBe(5)
    expect(s.byKind.check.total).toBe(5)
    expect(s.byKind.circle.total).toBe(0)
  })
})
