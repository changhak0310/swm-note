// 답지 대조기의 계약 — PDF 없이 돈다.
import { describe, expect, it } from 'vitest'
import {
  auditAgainstAnswers,
  missingRuns,
  parseAnswerBook,
  type BookAnswers,
} from '../answerAudit'
import type { ChoiceLabel, Region } from '../../types'

const line = (text: string, tokens: string[] = []) => ({ text, tokens })

function region(num: string, choices = 5): Region {
  return {
    id: `r${num}`,
    docId: 'd',
    page: 1,
    bounds: { x: 0, y: 0, w: 100, h: 100 },
    numLabel: num,
    choices: Array.from({ length: choices }, (_, i) => ({
      label: (i + 1) as ChoiceLabel,
      box: { x: i * 10, y: 80, w: 10, h: 10 },
    })),
    ansSynth: false,
    answerType: choices >= 2 ? 'choice' : 'integer',
  }
}

describe('답지 파싱', () => {
  it('원문자 정답은 객관식, 단답은 주관식으로 가른다', () => {
    const book = parseAnswerBook([line('1. ③  2. ①')])
    expect(book.get(1)).toEqual({ value: '3', kind: 'choice' })
    expect(book.get(2)).toEqual({ value: '1', kind: 'choice' })
  })

  it('★ 값만으로는 못 가르는 것을 가른다 — 단답 3과 ③', () => {
    // 20번은 단답형 정답 48, 21번은 ③. 둘 다 값은 숫자지만 유형이 다르다
    const book = parseAnswerBook([
      line('', ['20', '48', '4', '21', '③', '2']),
    ])
    expect(book.get(20)).toEqual({ value: '48', kind: 'subjective' })
    expect(book.get(21)).toEqual({ value: '3', kind: 'choice' })
  })

  it('정답표가 토큰으로 쪼개져 와도 원문자를 찾는다', () => {
    const book = parseAnswerBook([line('16②3', ['16', '②', '3'])])
    expect(book.get(16)?.kind).toBe('choice')
  })
})

describe('검출 대조', () => {
  const answers: BookAnswers = new Map([
    [1, { value: '3', kind: 'choice' }],
    [2, { value: '1', kind: 'choice' }],
    [3, { value: '48', kind: 'subjective' }],
  ])

  it('전부 맞히면 만점', () => {
    const a = auditAgainstAnswers([region('1'), region('2'), region('3', 0)], answers)
    expect(a.numberRecall).toBe(1)
    expect(a.missing).toEqual([])
    expect(a.kind.accuracy).toBe(1)
  })

  it('놓친 번호를 그대로 집어낸다 — 라벨할 쪽의 후보다', () => {
    const a = auditAgainstAnswers([region('1')], answers)
    expect(a.missing).toEqual([2, 3])
    expect(a.numberRecall).toBeCloseTo(1 / 3, 5)
  })

  it('없는 번호를 만들어 냈으면 extra로 잡는다', () => {
    const a = auditAgainstAnswers([region('1'), region('2'), region('3', 0), region('99')], answers)
    expect(a.extra).toEqual([99])
  })

  it('★ 객관식 오판을 잡는다 — 손 라벨 없이 M2를 재는 유일한 길', () => {
    // 3번은 답지상 단답형인데 검출은 선지를 붙였다 (본문 원문자를 선지로 오인)
    const a = auditAgainstAnswers([region('1'), region('2'), region('3', 5)], answers)
    expect(a.kind.accuracy).toBeCloseTo(2 / 3, 5)
    expect(a.kind.mismatches).toEqual([
      { num: 3, answer: '48', expected: 'subjective', detected: 'choice' },
    ])
  })

  it('한 문항을 둘로 쪼갠 자리를 알린다', () => {
    const a = auditAgainstAnswers(
      [region('1'), { ...region('1'), id: 'r1b' }, region('2'), region('3', 0)],
      answers,
    )
    expect(a.duplicated).toEqual([1])
    expect(a.reliable).toBe(true)          // 셋 중 하나뿐 — 번호 체계는 멀쩡하다
  })

  it('★ 번호가 단원마다 다시 시작하는 책은 감사 자체를 못 믿는다고 알린다', () => {
    // 검출 번호 전부가 중복 — "번호는 문서 안에서 유일하다"는 전제가 깨진 책이다.
    // 이걸 알리지 않으면 낮은 재현율을 검출 실패로 오해한다 (실측 수학의 신 37.8%)
    const dup = [region('1'), { ...region('1'), id: 'b' }, region('2'), { ...region('2'), id: 'c' }]
    const a = auditAgainstAnswers(dup, answers)
    expect(a.reliable).toBe(false)
    expect(a.duplicateRate).toBe(1)
  })

  it('번호가 없는 구역은 견주지 않는다 — 스캔 경로는 값을 안 읽는다', () => {
    const noNum = { ...region('1'), numLabel: undefined }
    expect(auditAgainstAnswers([noNum], answers).detected).toBe(0)
  })
})

describe('놓친 구간', () => {
  it('연속으로 놓친 곳만 묶는다 — 쪽이 통째로 무너진 자리다', () => {
    expect(missingRuns([3, 10, 11, 12, 20, 30, 31])).toEqual([
      { from: 10, to: 12 },
      { from: 30, to: 31 },
    ])
  })

  it('낱개는 구간이 아니다', () => {
    expect(missingRuns([1, 5, 9])).toEqual([])
  })
})
