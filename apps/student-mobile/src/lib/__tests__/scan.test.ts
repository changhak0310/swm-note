import { describe, expect, it } from 'vitest'
import { detectScan } from '../scan/detect'
import { scanRegions } from '../scan/regions'
import { detectMarks } from '../liveDetect'
import { MAX_W } from '../geometry'
import type { Point, Stroke } from '../../types'

// ---------- 합성 스캔 페이지 ----------
// 실제 스캔본의 기하만 흉내 낸다: 색 번호 · 링 마커 · 본문 글자 덩어리.

// 앱이 실제로 렌더하는 크기(SCAN_WIDTH=1700)를 그대로 쓴다. 링의 굵기/지름 비율이
// 검출의 핵심 판별자라 크기를 줄이면 실제와 다른 것을 재게 된다
const W = 1700
const H = 2340
const MARK = 27                     // 마커 지름 — 실측(쎈 수학1, 1700px 렌더)과 같다

function page() {
  const rgba = new Uint8ClampedArray(W * H * 4).fill(255)
  return {
    raster: { width: W, height: H, rgba },
    rect(x: number, y: number, w: number, h: number, c: [number, number, number]) {
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
          const o = (yy * W + xx) * 4
          rgba[o] = c[0]
          rgba[o + 1] = c[1]
          rgba[o + 2] = c[2]
        }
      }
    },
    /** 선지 마커 — 가는 테두리 원 + 안쪽에 떨어져 있는 숫자 */
    marker(x: number, y: number) {
      const r = MARK / 2
      const cx = x + r
      const cy = y + r
      for (let a = 0; a < 900; a++) {
        const t = (a / 900) * Math.PI * 2
        const px = Math.round(cx + Math.cos(t) * (r - 0.5))
        const py = Math.round(cy + Math.sin(t) * (r - 0.5))
        const o = (py * W + px) * 4
        rgba[o] = rgba[o + 1] = rgba[o + 2] = 20
      }
      this.rect(Math.round(cx - 2), Math.round(cy - 6), 4, 12, [20, 20, 20])
    },
    /** 본문 한 줄 — 글자 크기 덩어리를 늘어놓는다 */
    line(x: number, y: number, len: number) {
      for (let i = 0; i < len; i++) this.rect(x + i * 26, y, 19, 22, [30, 30, 30])
    },
    /** 문제 번호 — 유채색 글자 4개 */
    number(x: number, y: number) {
      for (let i = 0; i < 4; i++) this.rect(x + i * 20, y, 15, 26, [20, 60, 200])
    },
  }
}

/** ①②③ / ④⑤ 3+2 배치 한 벌 */
function choices(p: ReturnType<typeof page>, x: number, y: number) {
  for (let i = 0; i < 3; i++) p.marker(x + i * 200, y)
  for (let i = 0; i < 2; i++) p.marker(x + i * 200, y + 60)
}

function problem(p: ReturnType<typeof page>, x: number, y: number, stemLines = 3) {
  p.number(x, y)
  for (let i = 0; i < stemLines; i++) p.line(x, y + 46 + i * 34, 18)
  choices(p, x, y + 46 + stemLines * 34 + 20)
}

function circleAt(box: { x: number; y: number; w: number; h: number }): Stroke {
  const r = Math.min(box.h, box.w) * 0.6
  const cx = box.x + Math.min(box.h, box.w) / 2
  const cy = box.y + box.h / 2
  const points: Point[] = []
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2
    points.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, p: 0.5, t: 1 })
  }
  return { id: 'c', regionId: null, attemptNo: 1, tool: 'pen', points }
}

describe('스캔 검출', () => {
  it('1단 두 문항 — 번호와 선지 5개를 찾는다', () => {
    const p = page()
    problem(p, 110, 150)
    problem(p, 110, 800)
    const layout = detectScan(p.raster)

    expect(layout.markers).toHaveLength(10)
    expect(layout.headings).toHaveLength(2)
    expect(layout.columns).toHaveLength(1)

    const { regions } = scanRegions(layout, p.raster, 'd', 3)
    expect(regions).toHaveLength(2)
    for (const r of regions) {
      expect(r.answerType).toBe('choice')
      expect(r.choices.map((c) => c.label)).toEqual([1, 2, 3, 4, 5])
      expect(r.numBox).toBeDefined()
    }
    // 좌표계는 앱 규약(MAX_W 폭 기준)이다
    expect(regions[0].bounds.x + regions[0].bounds.w).toBeLessThanOrEqual(MAX_W)
  })

  it('2단 — 가운데 거터로 갈린다', () => {
    const p = page()
    problem(p, 110, 150)
    problem(p, 900, 150)
    const layout = detectScan(p.raster)
    expect(layout.columns).toHaveLength(2)

    const { regions } = scanRegions(layout, p.raster, 'd', 1)
    expect(regions).toHaveLength(2)
    // 한 단의 문항이 다른 단을 침범하지 않는다
    const [a, b] = regions.sort((x, y) => x.bounds.x - y.bounds.x)
    expect(a.bounds.x + a.bounds.w).toBeLessThanOrEqual(b.bounds.x + 1)
  })

  it('선지에 친 동그라미를 되읽는다', () => {
    const p = page()
    problem(p, 110, 150)
    problem(p, 900, 150)
    const layout = detectScan(p.raster)
    const { regions } = scanRegions(layout, p.raster, 'd', 1)

    for (const r of regions) {
      for (const c of r.choices) {
        expect(detectMarks(regions, [circleAt(c.box)])).toEqual({ [r.id]: c.label })
      }
    }
  })

  it('선지 판정 박스는 서로 겹치지 않는다 — 두 선지가 동시에 잡히면 채점이 무너진다', () => {
    const p = page()
    problem(p, 110, 150)
    const { regions } = scanRegions(detectScan(p.raster), p.raster, 'd', 1)
    const boxes = regions[0].choices.map((c) => c.box)
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const ov =
          Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
          Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
        expect(ov).toBe(0)
      }
    }
  })

  it('본문 글자의 고리(ㅇ·ㅁ)는 마커가 아니다', () => {
    const p = page()
    problem(p, 110, 150)
    // 속이 빈 작은 사각형을 본문 줄에 섞는다 — 한글 ㅁ·ㅇ 흉내
    for (let i = 0; i < 12; i++) {
      const x = 110 + i * 46
      const y = 1400
      p.rect(x, y, 21, 21, [30, 30, 30])
      p.rect(x + 5, y + 5, 11, 11, [255, 255, 255])
    }
    const layout = detectScan(p.raster)
    expect(layout.markers.every((m) => m.y0 < 1300)).toBe(true)
  })

  it('문항이 없는 쪽은 빈 결과를 낸다 — 표지·개념 정리', () => {
    const p = page()
    for (let i = 0; i < 20; i++) p.line(110, 180 + i * 38, 30)
    const { regions } = scanRegions(detectScan(p.raster), p.raster, 'd', 1)
    expect(regions).toHaveLength(0)
  })
})
