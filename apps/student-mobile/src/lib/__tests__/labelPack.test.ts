// 라벨 팩의 계약.
//
// 여기서 가장 중요한 것은 "쓴다"가 아니라 **"안 쓴다"** 쪽이다. 잘못 앉은 라벨은 검출
// 실패보다 나쁘다 — 검출 실패는 박스가 없어 눈에 보이지만, 잘못된 라벨은 자신 있게
// 조용히 전부 틀린다.
import { describe, expect, it } from 'vitest'
import {
  decidePack,
  matchPack,
  packCovers,
  packRegions,
  verifyPlacement,
  type LabelPack,
} from '../labelPack'
import { emptyGolden, type GoldenBox, type GoldenSet } from '../psp/golden'
import { MAX_W } from '../geometry'
import type { Box, ChoiceLabel, Region } from '../../types'
import type { Raster as ScanRaster } from '../scan/components'

const HASH = 'sha256:abc0000000000000'

const choiceBox = (i: number): Box => ({ x: 10, y: 100 + i * 18, w: 120, h: 16 })

function gbox(page: number, number: string, n = 5): GoldenBox {
  return {
    id: `g${page}-${number}`,
    page,
    number,
    bbox: { x: 0, y: 60, w: 300, h: 140 },
    kind: n >= 2 ? 'choice' : 'subjective',
    choices: Array.from({ length: n }, (_, i) => ({ label: (i + 1) as ChoiceLabel, box: choiceBox(i) })),
  }
}

const golden = (boxes: GoldenBox[], pages: number[]): GoldenSet => ({
  ...emptyGolden('t.pdf', 10),
  sourceHash: HASH,
  boxes,
  reviewedPages: pages,
})

const pack = (g: GoldenSet): LabelPack => ({ sourceHash: HASH, golden: g, importedAt: 0 })

/**
 * 합성 래스터 — 흰 종이에 검은 사각형을 찍는다.
 * 좌표는 앱 좌표(MAX_W 기준)로 받아 래스터 픽셀로 옮긴다.
 */
function raster(width: number, height: number, blots: Box[]): ScanRaster {
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255)
  const k = width / MAX_W
  for (const b of blots) {
    for (let y = Math.floor(b.y * k); y < Math.ceil((b.y + b.h) * k) && y < height; y++) {
      for (let x = Math.floor(b.x * k); x < Math.ceil((b.x + b.w) * k) && x < width; x++) {
        const o = (y * width + x) * 4
        rgba[o] = rgba[o + 1] = rgba[o + 2] = 0
      }
    }
  }
  return { width, height, rgba }
}

/** 선지 기호 자리마다 잉크를 찍은 래스터 — 라벨이 맞게 앉은 페이지 */
function inkedAt(regions: Region[]): ScanRaster {
  const blots = regions.flatMap((r) =>
    r.choices.map((c) => {
      const side = Math.min(c.box.w, c.box.h)
      return { x: c.box.x + 1, y: c.box.y + 1, w: side - 2, h: c.box.h - 2 }
    }),
  )
  return raster(760, 1000, blots)
}

describe('범위 — 쪽 단위', () => {
  it('확인 완료한 쪽만 덮는다', () => {
    const g = golden([gbox(1, '12')], [1])
    expect(packCovers(g, 1)).toBe(true)
    expect(packCovers(g, 2)).toBe(false)
  })

  it('구역이 0개여도 확인했으면 덮는다 — "문항 없음"도 정답이다', () => {
    expect(packCovers(golden([], [3]), 3)).toBe(true)
  })
})

describe('라벨 → 구역', () => {
  it('좌표를 그대로 쓰고 id는 다시 열어도 같다', () => {
    const g = golden([gbox(1, '12')], [1])
    const a = packRegions(g, 1, 'live:x')
    const b = packRegions(g, 1, 'live:x')
    expect(a[0].id).toBe(b[0].id)
    expect(a[0].bounds).toEqual({ x: 0, y: 60, w: 300, h: 140 })
    expect(a[0].choices).toHaveLength(5)
    expect(a[0].answerType).toBe('choice')
    expect(a[0].numLabel).toBe('12')
  })

  it('주관식은 주관식으로 넘어간다', () => {
    const g = golden([gbox(1, '12', 0)], [1])
    expect(packRegions(g, 1, 'd')[0].answerType).toBe('integer')
  })
})

describe('배치 검증', () => {
  const regions = packRegions(golden([gbox(1, '12')], [1]), 1, 'd')

  it('라벨 자리에 인쇄물이 있으면 통과', () => {
    const c = verifyPlacement(inkedAt(regions), regions)
    expect(c.ok).toBe(true)
    expect(c.inked).toBe(c.sampled)
  })

  it('★ 좌표가 통째로 밀리면 걸러낸다 — 조용히 전부 틀리는 것을 막는 유일한 장치', () => {
    const shifted = regions.map((r) => ({
      ...r,
      choices: r.choices.map((c) => ({ ...c, box: { ...c.box, y: c.box.y + 300 } })),
    }))
    // 잉크는 원래 자리에 있는데 라벨은 300 아래를 가리킨다
    expect(verifyPlacement(inkedAt(regions), shifted).ok).toBe(false)
  })

  it('빈 종이면 걸러낸다', () => {
    expect(verifyPlacement(raster(760, 1000, []), regions).ok).toBe(false)
  })

  it('잴 것이 없으면 막지 않는다', () => {
    expect(verifyPlacement(raster(760, 1000, []), []).ok).toBe(true)
  })
})

describe('종합 판단', () => {
  const g = golden([gbox(1, '12')], [1])
  const regions = packRegions(g, 1, 'd')
  const good = inkedAt(regions)

  it('해시가 같고 쪽이 라벨됐고 배치가 맞으면 쓴다', () => {
    const d = decidePack(matchPack([pack(g)], HASH, null), 1, 'd', good)
    expect(d.use).toBe(true)
    if (d.use) expect(d.regions).toHaveLength(1)
  })

  it('★ 다른 파일의 라벨은 쓰지 않는다 — 파일명이 아니라 내용 해시로 문다', () => {
    const d = decidePack(matchPack([pack(g)], 'sha256:다른해시', null), 1, 'd', good)
    expect(d.use).toBe(false)
    if (!d.use) expect(d.reason).toBe('이 문서의 라벨 팩 없음')
  })

  it('라벨 안 된 쪽은 검출로 떨어뜨린다 — 계층은 쪽 단위다', () => {
    const d = decidePack(matchPack([pack(g)], HASH, null), 2, 'd', good)
    expect(d.use).toBe(false)
    if (!d.use) expect(d.reason).toBe('이 쪽은 라벨되지 않음')
  })

  it('배치 검증에 실패하면 이유를 남기고 떨어뜨린다 — 조용히 넘어가면 안 된다', () => {
    const d = decidePack(matchPack([pack(g)], HASH, null), 1, 'd', raster(760, 1000, []))
    expect(d.use).toBe(false)
    if (!d.use) expect(d.reason).toMatch(/인쇄물이 없다/)
  })

  it('"이 쪽에는 문항이 없다"는 라벨도 그대로 따른다', () => {
    const empty = golden([], [4])
    const d = decidePack(matchPack([pack(empty)], HASH, null), 4, 'd', raster(760, 1000, []))
    expect(d.use).toBe(true)
    if (d.use) expect(d.regions).toEqual([])
  })

  it('팩이 없으면 검출이다', () => {
    const d = decidePack(matchPack([], HASH, null), 1, 'd', good)
    expect(d.use).toBe(false)
  })
})

describe('신원 — 지문으로 붙이기 (L1)', () => {
  const g = golden([gbox(3, '12')], [3])
  const regions = packRegions(g, 3, 'd')
  const good = inkedAt(regions)
  // 팩은 1~6쪽의 지문을 안다.
  //
  // ★ 값을 아무렇게나 고르면 안 된다. 처음에 'aaaa…','bbbb…' 꼴로 적었더니 서로 8비트밖에
  //   안 떨어져 문턱(12) 안에 들어왔고, 모든 쪽이 모든 쪽과 짝이 돼 오프셋이 0으로 나왔다.
  //   지문의 문제가 아니라 표본의 문제였다 — 아래 여섯은 서로 최소 16비트 떨어져 있다.
  const fps = [
    'ffff000000000000',
    '0000ffff00000000',
    '00000000ffff0000',
    '000000000000ffff',
    'ffffffff00000000',
    '00000000ffffffff',
  ]
  const withFps: LabelPack = { ...pack(g), golden: { ...g, pageFingerprints: fps } }

  it('해시가 같으면 지문을 보지 않는다 — 오프셋 0', () => {
    const m = matchPack([withFps], HASH, fps)
    expect(m?.via).toBe('hash')
    expect(m?.offset).toBe(0)
  })

  it('★ 해시가 달라도 지문이 맞으면 붙는다 — 재압축·재다운로드본', () => {
    const m = matchPack([withFps], 'sha256:재압축본', fps)
    expect(m?.via).toBe('fingerprint')
    expect(m?.offset).toBe(0)
    expect(decidePack(m, 3, 'd', good).use).toBe(true)
  })

  it('★ 표지가 잘려 쪽이 밀려도 그 밀림만큼 옮겨 붙인다', () => {
    // 새 파일은 앞 2쪽이 없다 — 팩의 3쪽이 이 문서의 1쪽이다
    const m = matchPack([withFps], 'sha256:표지없음', fps.slice(2))
    expect(m?.offset).toBe(-2)

    const d = decidePack(m, 1, 'd', good)
    expect(d.use).toBe(true)
    // 구역의 page는 **문서 기준**이어야 한다 — 팩 기준이면 필기가 엉뚱한 쪽에 붙는다
    if (d.use) expect(d.regions[0].page).toBe(1)
  })

  it('남의 책 지문이면 붙지 않는다', () => {
    const other = [
      '0f0f0f0f0f0f0f0f',
      'f0f0f0f0f0f0f0f0',
      '3333333333333333',
      'cccccccccccccccc',
    ]
    expect(matchPack([withFps], 'sha256:남의책', other)).toBeNull()
  })

  it('지문이 없는 팩은 해시로만 붙는다', () => {
    expect(matchPack([pack(g)], 'sha256:다름', fps)).toBeNull()
  })

  it('지문으로 붙어도 배치 검증은 그대로 한다 — 지문은 "어느 쪽"만 답한다', () => {
    const m = matchPack([withFps], 'sha256:재스캔본', fps)
    const d = decidePack(m, 3, 'd', raster(760, 1000, []))
    expect(d.use).toBe(false)
    if (!d.use) expect(d.reason).toMatch(/인쇄물이 없다/)
  })
})
