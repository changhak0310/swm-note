// 실제 스캔본 PDF 검출 실측 — 텍스트 레이어 없는 문제집.
//
//   SCAN_PDF=~/Downloads/스캔본.pdf npx vitest run scan.real
//   PAGES=20,45,90 로 페이지 지정 (기본은 몇 쪽 표본)
//
// PDF는 저작물이라 리포에 넣지 않는다. 경로가 없으면 조용히 건너뛴다.
// 래스터는 앱과 같은 폭(1700px)으로 만든다 — scanRaster.ts 참고. 폭이 다르면 가는
// 선지 링이 끊기고 안 끊기고가 갈려, 테스트가 통과해도 앱에서는 깨진다.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectScan } from '../scan/detect'
import { scanRegions } from '../scan/regions'
import { detectMarks } from '../liveDetect'
import { APP_SCAN_WIDTH, pageRaster } from './scanRaster'
import { openPdf } from './pdfDoc'
import type { Point, Stroke } from '../../types'

function circleOn(box: { x: number; y: number; w: number; h: number }, t: number): Stroke {
  const r = Math.min(box.h, box.w) * 0.6
  const cx = box.x + Math.min(box.h, box.w) / 2
  const cy = box.y + box.h / 2
  const points: Point[] = []
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2
    points.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, p: 0.5, t })
  }
  return { id: `s${t}`, regionId: null, attemptNo: 1, tool: 'pen', points }
}

/**
 * 손으로 확인한 정답 — 쎈 수학1 스캔본. 페이지 그림을 직접 읽어 적었다.
 *   total  그 쪽의 문항 수 (0 = 표지·구성·개념정리 쪽)
 *   choice 그중 객관식 수 (나머지는 주관식·서술형)
 *   left   왼쪽 단에 있는 문항 수
 *
 * 번호의 '값'은 검출하지 않으므로(설계상 OCR 없음) 값 대신 개수·단 배치로 검증한다.
 * 이 세 값이 다 맞으면 번호를 하나도 흘리지 않았고 없는 것을 만들지도 않았다는 뜻이다.
 */
const TRUTH: Record<number, { total: number; choice: number; left: number }> = {
  2: { total: 0, choice: 0, left: 0 },     // 구성과 특징 (미니 페이지 그림들)
  8: { total: 0, choice: 0, left: 0 },     // 개념 정리 — 상자 안에 ①~⑤ 나열이 있다
  9: { total: 37, choice: 0, left: 17 },   // 기본 문제 — 짧은 주관식 37개가 2×2 격자로
  12: { total: 6, choice: 4, left: 3 },    // 0050~0055
  20: { total: 6, choice: 4, left: 3 },    // 0109~0114
  21: { total: 5, choice: 3, left: 3 },    // 0115~0119
  30: { total: 6, choice: 4, left: 3 },    // 0187~0192, 유형 머리띠 있음
  45: { total: 6, choice: 3, left: 3 },    // 0282~0287, 세로·2+2+1 배치 혼재
  60: { total: 0, choice: 0, left: 0 },    // 개념 정리 — 단원 표제가 번호처럼 생겼다
  100: { total: 6, choice: 4, left: 3 },   // 0659~0664
  110: { total: 5, choice: 3, left: 2 },   // 0725~0729, 꼬리말 "(교사용)"이 번호와 닮았다
  150: { total: 5, choice: 2, left: 2 },   // 0994~0998, 보기 상자 있음
  160: { total: 6, choice: 2, left: 3 },   // 1070~1075, 주관식이 넷
  175: { total: 2, choice: 2, left: 1 },   // 1162~1163, 한 쪽에 두 문항뿐
  180: { total: 5, choice: 0, left: 2 },   // 1178~1182, 마지막 쪽 — 전부 주관식
}

const PDF = process.env.SCAN_PDF?.replace(/^~/, process.env.HOME ?? '~')
const suite = PDF && existsSync(PDF) ? describe : describe.skip

suite('스캔 검출', () => {
  it('샘플 페이지', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await openPdf(pdfjs, new Uint8Array(readFileSync(PDF!)))
    const TARGET = Number(process.env.TARGET_W || APP_SCAN_WIDTH)
    const raster = (pageNo: number) => pageRaster(pdfjs, pdf, pageNo, TARGET)

    const pages = (process.env.PAGES || Object.keys(TRUTH).join(',')).split(',').map(Number)
    let tp = 0, tc = 0, tf = 0, mk = 0, mkOk = 0, total = 0
    const misses: string[] = []
    // 정답 대비 — 문항/객관식/왼쪽단 세 값의 절대 오차 합
    let truthN = 0, errN = 0
    const wrong: string[] = []
    for (const p of pages) {
      const r = await raster(p)
      if (!r) { console.log(`p${p} 이미지 없음`); continue }
      const t1 = Date.now()
      const layout = detectScan(r)
      const { regions, synthesizedHeadings } = scanRegions(layout, r, 's', p)
      const ms = Date.now() - t1
      const choice = regions.filter((x) => x.choices.length >= 2)
      const full = choice.filter((x) => x.choices.length === 5)
      tp += regions.length; tc += choice.length; tf += full.length; total += Date.now() - t1
      for (const rg of choice) for (const c of rg.choices) {
        mk++
        const got = detectMarks(regions, [circleOn(c.box, 1000)])
        if (got[rg.id] === c.label) mkOk++
        else misses.push(`p${p} ${rg.id.split(':').pop()} 선지${c.label} → ${JSON.stringify(got)}`)
      }
      // 정답표는 쎈 표본의 것이다 — PAGES로 다른 책을 훑을 때는 통계만 본다
      const t = process.env.PAGES ? undefined : TRUTH[p]
      if (t) {
        const left = regions.filter((r) => {
          const b = r.numBox ?? r.bounds
          return b.x + b.w / 2 < 760 / 2
        }).length
        const err =
          Math.abs(regions.length - t.total) +
          Math.abs(choice.length - t.choice) +
          Math.abs(left - t.left)
        truthN += t.total + t.choice + t.left
        errN += err
        if (err) {
          wrong.push(
            `p${p} 정답 문항${t.total}/객관식${t.choice}/왼쪽${t.left}` +
            ` ≠ 검출 문항${regions.length}/객관식${choice.length}/왼쪽${left}`,
          )
        }
      }

      const g = new Map<number, number>()
      for (const m of layout.markers) g.set(m.group, (g.get(m.group) ?? 0) + 1)
      if (!process.env.QUIET) console.log(
        `p${String(p).padStart(3)} ${ms}ms 단${layout.columns.length} | 번호 ${layout.headings.length}` +
        ` 마커그룹[${[...g.values()].join(',')}] | 문항 ${regions.length} 객관식 ${choice.length}` +
        ` 선지5 ${full.length}${synthesizedHeadings ? ` 번호대체${synthesizedHeadings}` : ''}`)
    }
    console.log(`\n합계 ${pages.length}쪽 · 문항 ${tp} · 객관식 ${tc} · 선지5완비 ${tf}` +
      ` · 마킹 되읽기 ${mkOk}/${mk} · 평균 검출 ${(total / pages.length).toFixed(0)}ms`)

    if (misses.length) console.log('\n되읽기 실패:\n' + misses.join('\n'))
    if (truthN) {
      console.log(
        `\n정답 대비 번호 인식 ${(((truthN - errN) / truthN) * 100).toFixed(1)}%` +
        ` (기준값 ${truthN} · 오차 ${errN})`,
      )
      if (wrong.length) console.log(wrong.join('\n'))
    }

    // 번호 인식 — 정답을 아는 페이지에서는 99% 이상이어야 한다
    if (truthN) expect((truthN - errN) / truthN).toBeGreaterThanOrEqual(0.99)

    // 검출한 선지 한가운데 친 마크를 못 읽으면 검출이든 판정이든 어느 한쪽이 깨진 것이다
    expect(mkOk).toBe(mk)
    // 선지는 5개가 표준이다. 4개 이하가 흔하면 마커를 흘리고 있다는 뜻
    if (tc > 0) expect(tf / tc).toBeGreaterThan(0.9)
  }, 600_000)
})
