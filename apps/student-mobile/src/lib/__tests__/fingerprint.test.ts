// 쪽 지문의 계약.
//
// 여기서 중요한 것은 "닮은 것을 붙인다"보다 **"안 닮은 것을 안 붙인다"**다.
// 지문이 헐거우면 남의 책 라벨이 조용히 붙는다 — 검출 실패보다 나쁜 실패다(§11.3).
import { describe, expect, it } from 'vitest'
import { alignPages, distance, fingerprint, FP_MAX_DISTANCE } from '../fingerprint'
import type { Raster } from '../scan/components'

/** 회색조 값을 주는 함수로 래스터를 만든다 */
function make(width: number, height: number, shade: (x: number, y: number) => number): Raster {
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = shade(x, y)
      const o = (y * width + x) * 4
      rgba[o] = rgba[o + 1] = rgba[o + 2] = v
    }
  }
  return { width, height, rgba }
}

/** 재현 가능한 난수 */
function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/**
 * 조판을 흉내낸 쪽 — 흰 종이에 글 덩어리가 쪽마다 다른 자리에 놓인다.
 *
 * ★ 처음에는 줄무늬 하나로 만들었는데, 9칸으로 줄이면 어느 seed든 "왼쪽 2칸 뒤에 세로
 *   경계"로 보여 서로 구별이 안 됐다. 지문의 문제가 아니라 표본의 문제였다 —
 *   실제 쪽은 가로·세로 양쪽으로 구조가 있다.
 */
function page(seed: number): Raster {
  const rnd = lcg(seed)
  const blocks = Array.from({ length: 14 }, () => ({
    x: Math.floor(rnd() * 95),
    y: Math.floor(rnd() * 145),
    w: 8 + Math.floor(rnd() * 24),
    h: 4 + Math.floor(rnd() * 12),
  }))
  return make(120, 160, (x, y) =>
    blocks.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) ? 20 : 245,
  )
}

describe('지문', () => {
  it('같은 그림은 같은 지문', () => {
    expect(fingerprint(page(1))).toBe(fingerprint(page(1)))
  })

  it('16자리 16진수다', () => {
    expect(fingerprint(page(3))).toMatch(/^[0-9a-f]{16}$/)
  })

  it('★ 재압축·밝기 변화를 견딘다 — 이게 안 되면 L1이 성립하지 않는다', () => {
    const original = page(2)
    // 전체를 밝게 + 픽셀마다 잡음
    const noisy = make(120, 160, (x, y) => {
      const o = (y * 120 + x) * 4
      const v = original.rgba[o] * 0.85 + 30 + ((x * 7 + y * 13) % 9) - 4
      return Math.max(0, Math.min(255, v))
    })
    expect(distance(fingerprint(original), fingerprint(noisy))).toBeLessThanOrEqual(FP_MAX_DISTANCE)
  })

  it('크기가 달라도 같은 쪽으로 본다 — 렌더 폭이 같을 필요가 없다', () => {
    const small = make(60, 80, (x, y) => (y % 12 < 4 && x > 10 ? 20 : 245))
    const large = make(240, 320, (x, y) => (y % 48 < 16 && x > 40 ? 20 : 245))
    expect(distance(fingerprint(small), fingerprint(large))).toBeLessThanOrEqual(FP_MAX_DISTANCE)
  })

  it('다른 쪽은 확실히 갈린다', () => {
    expect(distance(fingerprint(page(1)), fingerprint(page(5)))).toBeGreaterThan(FP_MAX_DISTANCE)
  })
})

describe('쪽 맞추기', () => {
  const book = [1, 2, 3, 4, 5, 6].map((i) => fingerprint(page(i)))

  it('같은 파일이면 오프셋 0', () => {
    const a = alignPages(book, book)
    expect(a?.offset).toBe(0)
    expect(a?.matched).toBe(6)
  })

  it('★ 표지가 잘린 사본 — 통째로 밀린 것을 찾아낸다', () => {
    // 팩은 1~6쪽을 알고, 새 파일은 앞 2쪽이 잘려 3쪽부터 시작한다
    const trimmed = book.slice(2)
    const a = alignPages(book, trimmed)
    expect(a?.offset).toBe(-2)
    expect(a?.matched).toBe(4)
  })

  it('앞에 쪽이 더 붙은 사본도 찾아낸다', () => {
    const padded = [fingerprint(page(90)), fingerprint(page(91)), ...book]
    expect(alignPages(book, padded)?.offset).toBe(2)
  })

  it('남의 책이면 붙이지 않는다', () => {
    const other = [20, 21, 22, 23, 24, 25].map((i) => fingerprint(page(i)))
    expect(alignPages(book, other)).toBeNull()
  })

  it('겹치는 쪽이 두셋뿐이면 붙이지 않는다 — 우연히 닮을 수 있다', () => {
    const barely = [fingerprint(page(1)), fingerprint(page(2))]
    expect(alignPages(barely, barely)).toBeNull()
  })

  it('지문을 모르는 쪽(null)은 견주지 않는다', () => {
    const partial = [book[0], null, book[2], null, book[4], book[5]]
    const a = alignPages(partial, book)
    expect(a?.offset).toBe(0)
    expect(a?.comparable).toBe(4)
  })

  it('빈 목록이면 null', () => {
    expect(alignPages([], book)).toBeNull()
    expect(alignPages(book, [])).toBeNull()
  })
})
