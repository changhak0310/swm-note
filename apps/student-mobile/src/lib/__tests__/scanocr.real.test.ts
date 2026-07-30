// 스캔 검출 결과를 OCR로 되읽는 실측 — 픽셀 검출이 "올바른 것"을 잡았는지 글자로 확인한다.
//
//   SCAN_PDF=~/Downloads/스캔본.pdf npx vitest run scanocr
//   PAGES=20,45 로 페이지 지정 (기본은 번호 정답을 아는 쪽 전부)
//
// 두 가지를 본다:
//   1. 선지 마커 — 픽셀로 찾은 링 안의 숫자를 OCR로 읽어 ordinal과 대조한다.
//      "선지는 순서대로 찍힌다"는 가정(detect.ts groupMarkers)의 실측 검증이다.
//   2. 문제 번호 — 번호 자리 크롭을 숫자 OCR로 읽어(readNumber, 앱과 같은 경로)
//      손으로 확인한 실제 번호와 대조한다.
//
// PDF는 저작물이라 리포에 넣지 않는다. 경로가 없으면 조용히 건너뛴다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { detectScan } from '../scan/detect'
import {
  configureOcr,
  prepareCrop,
  pxRect,
  readMarkerDigit,
  readNumber,
  terminateOcr,
} from '../scan/ocr'
import { reconcileNumbering } from '../scan/numbering'
import { scanRegions } from '../scan/regions'
import { APP_SCAN_WIDTH, pageRaster } from './scanRaster'
import { openPdf } from './pdfDoc'

/** DUMP=디렉터리 — tesseract에 실제로 넘어간 전처리 크롭을 BMP로 떨군다 (오독 튜닝용) */
const DUMP = process.env.DUMP
function dump(name: string, url: string | null) {
  if (!DUMP || !url) return
  writeFileSync(join(DUMP, `${name}.bmp`), Buffer.from(url.split(',')[1], 'base64'))
}

/**
 * 손으로 확인한 문제 번호 — 쎈 수학1 스캔본. scan.real.test.ts의 TRUTH와 같은 쪽이고,
 * 거기서는 개수만 검증하지만 여기서는 값까지 검증한다. 번호는 연속 구간이라 [시작, 끝]로 적는다.
 */
const NUM_TRUTH: Record<number, [number, number]> = {
  12: [50, 55],     // 0050~0055
  20: [109, 114],   // 0109~0114
  21: [115, 119],   // 0115~0119
  30: [187, 192],   // 0187~0192
  45: [282, 287],   // 0282~0287
  100: [659, 664],  // 0659~0664
  110: [725, 729],  // 0725~0729
  150: [994, 998],  // 0994~0998
  160: [1070, 1075], // 1070~1075
  175: [1162, 1163], // 1162~1163
  180: [1178, 1182], // 1178~1182
}

/** 이 책의 번호는 4자리 0채움 표기다 ("0050") */
const label = (n: number) => String(n).padStart(4, '0')

const PDF = process.env.SCAN_PDF?.replace(/^~/, process.env.HOME ?? '~')
const suite = PDF && existsSync(PDF) ? describe : describe.skip

suite('스캔 검출 OCR 되읽기', () => {
  afterAll(() => terminateOcr())

  it('마커 ordinal과 번호 값을 OCR로 대조한다', async () => {
    const cache = join(process.cwd(), 'node_modules', '.cache', 'tesseract')
    mkdirSync(cache, { recursive: true })
    configureOcr({ cachePath: cache })

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await openPdf(pdfjs, new Uint8Array(readFileSync(PDF!)))
    const TARGET = Number(process.env.TARGET_W || APP_SCAN_WIDTH)
    const raster = (pageNo: number) => pageRaster(pdfjs, pdf, pageNo, TARGET)

    const pages = (process.env.PAGES || Object.keys(NUM_TRUTH).join(',')).split(',').map(Number)

    let markerN = 0, markerOk = 0
    let numN = 0, numOk = 0
    const markerMiss: string[] = []
    const numMiss: string[] = []

    for (const p of pages) {
      const r = await raster(p)
      if (!r) { console.log(`p${p} 이미지 없음`); continue }
      const layout = detectScan(r)
      const { regions } = scanRegions(layout, r, 's', p)

      // ---------- 1. 선지 마커 — 링 안의 숫자 = ordinal ----------
      const t0 = Date.now()
      for (const m of layout.markers) {
        markerN++
        const rect = { x0: m.x0, y0: m.y0, x1: m.x1, y1: m.y1 }
        const read = await readMarkerDigit(r, rect)
        if (read?.digits === String(m.ordinal)) markerOk++
        else {
          markerMiss.push(`p${p} g${m.group} ${m.ordinal} → "${read?.digits ?? ''}" (${read?.confidence.toFixed(0) ?? '-'})`)
          dump(`p${p}-g${m.group}-${m.ordinal}`, prepareCrop(r, rect, 'marker'))
        }
      }

      // ---------- 2. 문제 번호 — 크롭 OCR + 수열 검산 = 실제 번호 ----------
      // 앱(documentStore.refineScanRegions)과 같은 경로: numBox → pxRect → readNumber →
      // reconcileNumbering. 낱개 OCR만 보면 흔들리는 것이 정상이고, 수열까지 거쳐야
      // 배지에 뜨는 값이 나온다
      const numbered = regions.filter((rg) => rg.numBox && !rg.numSynth)
      const rawReads = []
      for (const rg of numbered) rawReads.push(await readNumber(r, pxRect(r, rg.numBox!)))
      const reads = reconcileNumbering(rawReads).labels.map((l) => l ?? '')
      // 정답표는 쎈 표본의 것이다 — PAGES로 다른 책을 돌릴 때는 값 대조 없이 로그만 본다
      const range = process.env.PAGES ? undefined : NUM_TRUTH[p]
      if (range) {
        const [lo, hi] = range
        const want = new Map<string, number>()
        for (let n = lo; n <= hi; n++) want.set(label(n), (want.get(label(n)) ?? 0) + 1)
        // 검출이 흘린 번호는 scan.real이 잡는다 — 여기서는 "읽은 것이 맞는 값인가"만 본다
        for (const got of reads) {
          numN++
          const left = want.get(got) ?? 0
          if (left > 0) { numOk++; want.set(got, left - 1) }
          else numMiss.push(`p${p} "${got}" (기대 ${label(lo)}~${label(hi)})`)
        }
      }

      if (!process.env.QUIET) console.log(
        `p${String(p).padStart(3)} 마커 ${layout.markers.length} · 번호 ${reads.length} [${reads.join(' ')}]` +
        ` · OCR ${Date.now() - t0}ms`)
    }

    console.log(`\n마커 ordinal 일치 ${markerOk}/${markerN}` +
      ` · 번호 값 일치 ${numOk}/${numN}`)
    if (markerMiss.length) console.log('\n마커 불일치:\n' + markerMiss.join('\n'))
    if (numMiss.length) console.log('\n번호 불일치:\n' + numMiss.join('\n'))

    // 마커는 순서 가정의 검증 — OCR 자체 오독을 감안해도 이 밑이면 검출이 틀린 것이다
    expect(markerN).toBeGreaterThan(0)
    expect(markerOk / markerN).toBeGreaterThanOrEqual(0.9)
    // 번호 읽기 — 배지에 그대로 띄우는 값이라 기준을 높게 잡는다.
    // (정답표는 쎈 기준이다. 다른 책은 PAGES로 돌려 마커 검증과 로그만 본다)
    // 수열 검산까지 거친 값이라 정답표 쪽에서는 하나도 틀리면 안 된다
    if (numN) expect(numOk).toBe(numN)
  }, 600_000)
})
