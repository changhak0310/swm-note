import { describe, expect, it } from 'vitest'
import { splitChoices, type ChoiceToken } from '../segment'
import type { Box, ChoiceLabel } from '../../types'

function token(label: ChoiceLabel, x: number, y: number): ChoiceToken {
  return { label, box: { x, y, w: 12, h: 12 } }
}

describe('splitChoices', () => {
  it('한 줄 5개 — 우측 경계는 다음 기호의 x, 마지막은 ansBox 우측', () => {
    const ansBox: Box = { x: 0, y: 0, w: 500, h: 16 }
    const tokens = ([1, 2, 3, 4, 5] as ChoiceLabel[]).map((l) => token(l, (l - 1) * 100, 0))

    const choices = splitChoices(tokens, ansBox)
    expect(choices).toHaveLength(5)
    expect(choices[0].box).toMatchObject({ x: 0, w: 100 })
    expect(choices[3].box).toMatchObject({ x: 300, w: 100 })
    expect(choices[4].box).toMatchObject({ x: 400, w: 100 })   // 500까지
  })

  it('2줄 3+2 — 줄별로 나눈 뒤 각 줄 마지막만 ansBox 우측까지', () => {
    const ansBox: Box = { x: 0, y: 0, w: 300, h: 50 }
    const tokens = [
      token(1, 0, 0), token(2, 100, 0), token(3, 200, 0),
      token(4, 0, 30), token(5, 100, 30),
    ]

    const choices = splitChoices(tokens, ansBox)
    expect(choices).toHaveLength(5)
    expect(choices[2].box).toMatchObject({ x: 200, w: 100 })   // 1줄 마지막 → 300까지
    expect(choices[3].box).toMatchObject({ x: 0, w: 100 })     // 2줄 시작
    expect(choices[4].box).toMatchObject({ x: 100, w: 200 })   // 2줄 마지막 → 300까지
    // 줄이 다르면 세로 범위도 다르다
    expect(choices[0].box.y).toBe(0)
    expect(choices[4].box.y).toBe(30)
  })

  it('한 줄에 하나씩 — 모든 선지가 ansBox 우측까지', () => {
    const ansBox: Box = { x: 0, y: 0, w: 200, h: 150 }
    const tokens = ([1, 2, 3, 4, 5] as ChoiceLabel[]).map((l) => token(l, 0, (l - 1) * 30))

    const choices = splitChoices(tokens, ansBox)
    expect(choices).toHaveLength(5)
    for (const c of choices) expect(c.box).toMatchObject({ x: 0, w: 200 })
  })

  it('토큰이 없으면 빈 배열 — 주관식', () => {
    expect(splitChoices([], { x: 0, y: 0, w: 100, h: 20 })).toEqual([])
  })
})
