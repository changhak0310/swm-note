// 번호 수열 맞추기 (scan/numbering.ts) — 실측에서 나온 상황을 그대로 못박는다.
import { describe, expect, it } from 'vitest'
import { reconcileNumbering } from '../scan/numbering'

const r = (digits: string, confidence = 95) => ({ digits, confidence })

describe('reconcileNumbering', () => {
  it('자신 없는 자리를 수열로 메운다 (실측 베이직쎈 p49)', () => {
    // "07" 신뢰도 55, "09" 30, "11"은 "1"로 오독 — 나머지 셋이 수열을 세운다
    const { labels, filled } = reconcileNumbering([
      r('07', 55), r('08'), r('09', 30), r('10'), r('1', 70), r('12'),
    ])
    expect(labels).toEqual(['07', '08', '09', '10', '11', '12'])
    expect(filled).toBe(3)
  })

  it('못 읽은 자리도 메운다', () => {
    const { labels } = reconcileNumbering([r('0050'), r(''), r('0052'), r('0053')])
    expect(labels).toEqual(['0050', '0051', '0052', '0053'])
  })

  it('자릿수 표기를 기준점에서 가져온다', () => {
    const { labels } = reconcileNumbering([r('0009'), null, r('0011'), r('0012')])
    expect(labels[1]).toBe('0010')
  })

  it('기준점이 모자라면 지어내지 않는다', () => {
    const { labels, filled } = reconcileNumbering([r('07'), r('', 0), r('09', 30)])
    expect(labels).toEqual(['07', null, null])
    expect(filled).toBe(0)
  })

  it('수열을 이루지 않으면 읽은 값을 그대로 쓴다', () => {
    // 흩어진 값들 — 과반이 한 수열에 들지 못한다
    const { labels, filled } = reconcileNumbering([r('12'), r('45'), r('03'), r('77')])
    expect(labels).toEqual(['12', '45', '03', '77'])
    expect(filled).toBe(0)
  })

  it('자신 있는 읽기가 수열과 다르면 읽은 값이 이긴다', () => {
    // 마지막이 새 단원의 시작이라 번호가 튄다
    const { labels } = reconcileNumbering([r('01'), r('02'), r('03'), r('01')])
    expect(labels).toEqual(['01', '02', '03', '01'])
  })

  it('문항이 적으면 원래 읽기를 돌려준다', () => {
    expect(reconcileNumbering([r('05'), r('06')]).labels).toEqual(['05', '06'])
  })

  it('신뢰도가 낮고 기준점도 없으면 버린다', () => {
    expect(reconcileNumbering([r('1', 30), r('2', 20), r('3', 10)]).labels).toEqual([null, null, null])
  })
})
