import { describe, expect, it } from 'vitest'
import {
  buildEntries,
  parseAnswerLine,
  parseAnswerLines,
  parseAnswerTable,
  parseAnswerTokenLine,
} from '../answerKey'
import { region } from './helpers'

describe('parseAnswerTokenLine', () => {
  it('정답표 트리플 — 선다·다열', () => {
    // "1|②|2|12|①|4|23|③|2" (문항|정답|배점 반복)
    expect(parseAnswerTokenLine(['1', '②', '2', '12', '①', '4', '23', '③', '2'])).toEqual([
      { num: 1, value: '2' },
      { num: 12, value: '1' },
      { num: 23, value: '3' },
    ])
  })

  it('단답형 다자리 정답 — 배점이 따라올 때만 잡는다', () => {
    expect(parseAnswerTokenLine(['20', '48', '4', '30', '780', '4'])).toEqual([
      { num: 20, value: '48' },
      { num: 30, value: '780' },
    ])
    // 배점 없는 "16 12"는 오검출 방지를 위해 무시
    expect(parseAnswerTokenLine(['16', '12'])).toEqual([])
  })

  it('머리글 행은 건너뛴다', () => {
    expect(parseAnswerTokenLine(['문항', '번호', '정답', '배점'])).toEqual([])
  })
})

describe('parseAnswerTable', () => {
  it('토큰 트리플 우선, 실패 시 줄 텍스트 폴백. 중복 번호는 첫 값 유지', () => {
    const map = parseAnswerTable([
      { text: '1②212①4', tokens: ['1', '②', '2', '12', '①', '4'] },
      { text: '23③223④2', tokens: ['23', '③', '2', '23', '④', '2'] },
      { text: '7. ⑤', tokens: ['7. ⑤'] },       // 트리플 불가 → 텍스트 폴백
    ])
    expect(map.get(1)).toBe('2')
    expect(map.get(12)).toBe('1')
    expect(map.get(23)).toBe('3')                 // 두 번째 23(④)은 무시
    expect(map.get(7)).toBe('5')
  })
})

describe('parseAnswerLine', () => {
  it('원문자 — "12. ③"', () => {
    expect(parseAnswerLine('12. ③')).toEqual([{ num: 12, value: '3' }])
  })

  it('숫자 — "12) 3"', () => {
    expect(parseAnswerLine('12) 3')).toEqual([{ num: 12, value: '3' }])
  })

  it('조각난 글자를 이어 붙인 줄 — 연속 표기', () => {
    expect(parseAnswerLine('1.①2.③3.⑤')).toEqual([
      { num: 1, value: '1' },
      { num: 2, value: '3' },
      { num: 3, value: '5' },
    ])
  })

  it('두 자리 문항 번호', () => {
    expect(parseAnswerLine('15) 4')).toEqual([{ num: 15, value: '4' }])
  })

  it('원문자가 있으면 숫자 패턴은 시도하지 않는다 — 오검출 방지', () => {
    // "2. 4"가 숫자 패턴에 걸리면 안 된다
    expect(parseAnswerLine('1. ② 다음 중 4를 고르면')).toEqual([{ num: 1, value: '2' }])
  })

  it('해설 문장이 아닌 표 형태만 다룬다 — 매치 없으면 빈 배열', () => {
    expect(parseAnswerLine('풀이 과정을 참고하시오')).toEqual([])
  })
})

describe('parseAnswerLines', () => {
  it('원문자/숫자 혼용 + 중복은 먼저 나온 값 유지', () => {
    const map = parseAnswerLines(['1. ② 2. ④', '3) 5', '1. ⑤'])
    expect(map.get(1)).toBe('2')
    expect(map.get(2)).toBe('4')
    expect(map.get(3)).toBe('5')
  })
})

describe('buildEntries', () => {
  it('numLabel로 Region에 매칭한다', () => {
    const regions = [
      region({ id: 'r1', bounds: { x: 0, y: 0, w: 10, h: 10 }, numLabel: '1' }),
      region({ id: 'r2', bounds: { x: 0, y: 20, w: 10, h: 10 }, numLabel: '2' }),
      region({ id: 'r9', bounds: { x: 0, y: 40, w: 10, h: 10 } }),   // numLabel 없음
    ]
    const answers = new Map([[1, '3'], [2, '5']])
    expect(buildEntries(answers, regions, 'answerPdf')).toEqual([
      { regionId: 'r1', value: '3', source: 'answerPdf' },
      { regionId: 'r2', value: '5', source: 'answerPdf' },
    ])
  })
})
