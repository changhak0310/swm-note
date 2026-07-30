// 스캔 PDF 페이지 → 래스터. 실측 테스트 세 벌(scan.real · scanocr.real)이 공유한다.
//
// ★ 앱과 같은 픽셀을 만들어야 한다. 앱은 캔버스로 페이지를 정확히 SCAN_WIDTH(1700)에
//   맞춰 그리는데(pdf.ts renderPageBitmap), Node에는 캔버스가 없어 내장 이미지를 직접
//   리샘플한다. 예전에는 정수배 축소(1653px 원본이면 손대지 않음)라 앱보다 살짝 작았고,
//   그 작은 차이로 링 끊김·색 번짐 판정이 갈렸다 — 실측 베이직쎈 p17: 1653px에서는
//   멀쩡하던 ②가 앱 해상도(1700px)에서는 링이 끊겨 사라졌다.
//   축소는 면적 평균, 확대는 쌍선형 — 캔버스의 imageSmoothingQuality='high'와 같은 성격이다.
import type { Raster } from '../scan/components'

/** 앱의 SCAN_WIDTH (stores/documentStore.ts) */
export const APP_SCAN_WIDTH = 1700

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

/**
 * 페이지의 스캔 이미지를 targetWidth 폭 래스터로. 이미지가 없는 페이지는 null.
 * (텍스트 PDF나 표지처럼 그림이 없는 쪽)
 */
export async function pageRaster(
  pdfjs: PdfjsModule,
  pdf: { getPage(n: number): Promise<any> },
  pageNo: number,
  targetWidth = APP_SCAN_WIDTH,
): Promise<Raster | null> {
  const page = await pdf.getPage(pageNo)
  const list = await page.getOperatorList()
  const i = list.fnArray.indexOf((pdfjs as any).OPS.paintImageXObject)
  if (i < 0) return null
  const img: any = page.objs.get((list.argsArray[i] as any)[0])
  const { width: sw, height: sh, data: src } = img
  const comp = img.kind === 1 ? 1 : img.kind === 2 ? 3 : 4

  const w = Math.max(1, Math.round(targetWidth))
  const h = Math.max(1, Math.round((sh * w) / sw))
  const rgba = new Uint8ClampedArray(w * h * 4)
  const sx = sw / w
  const sy = sh / h
  const at = (x: number, y: number, c: number) =>
    src[(Math.min(sh - 1, y) * sw + Math.min(sw - 1, x)) * comp + c]

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      if (sx >= 1 || sy >= 1) {
        // 축소 — 원본에서 이 픽셀이 덮는 사각형의 평균
        const x0 = Math.floor(x * sx)
        const x1 = Math.max(x0 + 1, Math.ceil((x + 1) * sx))
        const y0 = Math.floor(y * sy)
        const y1 = Math.max(y0 + 1, Math.ceil((y + 1) * sy))
        let r = 0
        let g = 0
        let b = 0
        let n = 0
        for (let yy = y0; yy < y1; yy++) {
          for (let xx = x0; xx < x1; xx++) {
            r += at(xx, yy, 0)
            g += at(xx, yy, 1)
            b += at(xx, yy, 2)
            n++
          }
        }
        rgba[o] = r / n
        rgba[o + 1] = g / n
        rgba[o + 2] = b / n
      } else {
        // 확대 — 쌍선형
        const fx = (x + 0.5) * sx - 0.5
        const fy = (y + 0.5) * sy - 0.5
        const x0 = Math.max(0, Math.floor(fx))
        const y0 = Math.max(0, Math.floor(fy))
        const tx = fx - x0
        const ty = fy - y0
        for (let c = 0; c < 3; c++) {
          const top = at(x0, y0, c) * (1 - tx) + at(x0 + 1, y0, c) * tx
          const bottom = at(x0, y0 + 1, c) * (1 - tx) + at(x0 + 1, y0 + 1, c) * tx
          rgba[o + c] = top * (1 - ty) + bottom * ty
        }
      }
      rgba[o + 3] = 255
    }
  }
  return { width: w, height: h, rgba }
}
