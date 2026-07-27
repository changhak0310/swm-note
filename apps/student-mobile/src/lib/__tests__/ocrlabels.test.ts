// 마커 OCR → 선지 라벨 교정 가드 (scan/ocr.ts labelsFromMarkerReads).
//
// 교정은 순서 기반 라벨보다 OCR을 더 믿는 일이라 문턱이 높아야 한다 — 여기서는
// "어떤 읽기가 교정을 무산시키는가"를 못박는다. 실측 배경: 마커 오독은 전부
// 신뢰도 0~22였고 정독은 90 이상이었다 (쎈·베이직쎈 OCR 대조 276/280).
import { describe, expect, it } from 'vitest'
import { labelsFromMarkerReads } from '../scan/ocr'

const read = (digits: string, confidence = 95) => ({ digits, confidence })

describe('labelsFromMarkerReads', () => {
  it('마커 하나를 놓친 그룹 — 인쇄값 1·3·4·5를 그대로 돌려준다', () => {
    expect(labelsFromMarkerReads([read('1'), read('3'), read('4'), read('5')])).toEqual([1, 3, 4, 5])
  })

  it('완비 그룹은 1..5 그대로', () => {
    expect(labelsFromMarkerReads(['1', '2', '3', '4', '5'].map((d) => read(d)))).toEqual([1, 2, 3, 4, 5])
  })

  it('하나라도 못 읽으면 교정하지 않는다', () => {
    expect(labelsFromMarkerReads([read('1'), read(''), read('3')])).toBeNull()
    expect(labelsFromMarkerReads([read('1'), null, read('3')])).toBeNull()
  })

  it('자신 없는 읽기가 섞이면 교정하지 않는다', () => {
    expect(labelsFromMarkerReads([read('1'), read('3', 22), read('4')])).toBeNull()
  })

  it('강증가가 깨지면(오독 신호) 교정하지 않는다', () => {
    expect(labelsFromMarkerReads([read('1'), read('3'), read('3')])).toBeNull()
    expect(labelsFromMarkerReads([read('2'), read('1')])).toBeNull()
  })

  it('1~5 밖의 값이나 여러 자리는 교정하지 않는다', () => {
    expect(labelsFromMarkerReads([read('1'), read('8')])).toBeNull()
    expect(labelsFromMarkerReads([read('1'), read('23')])).toBeNull()
    expect(labelsFromMarkerReads([read('0'), read('1')])).toBeNull()
  })

  it('빈 입력은 null', () => {
    expect(labelsFromMarkerReads([])).toBeNull()
  })
})
