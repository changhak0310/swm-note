// PDF 로드·렌더 (pdf.js)
// 워커 버전과 본체 버전은 반드시 일치해야 한다 — 번들러 URL 임포트로 강제한다.
// legacy 빌드 사용 — 구형 WebView(Chrome <140)에 없는 Promise.try,
// Uint8Array.toHex/fromBase64 등을 pdf.js가 자체 폴리필한다.
// workerSrc 대신 래퍼(pdfWorker.ts)를 workerPort로 넘긴다.
import './polyfills'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { extractLines, type TextLine } from './pdfText'
import type { Raster } from './scan/components'

pdfjs.GlobalWorkerOptions.workerPort = new Worker(
  new URL('./pdfWorker.ts', import.meta.url),
  { type: 'module' },
)

export type { PDFDocumentProxy }

// 캔버스별 진행 중 렌더 — 새 렌더 시작 전에 이전 것을 취소한다.
// (같은 캔버스에 렌더가 겹치면 pdf.js가 throw: "Cannot use the same canvas…")
const activeRenders = new WeakMap<HTMLCanvasElement, { cancel(): void }>()

export async function loadPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({ data }).promise
}

/**
 * 페이지를 캔버스에 렌더한다.
 * 백킹 스토어는 devicePixelRatio × 줌 배율로 잡는다 — 확대 시 획이 뭉개지지 않게 (§5)
 */
export async function renderPage(
  pdf: PDFDocumentProxy,
  pageNo: number,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  zoom = 1,
): Promise<{ cssHeight: number }> {
  const page = await pdf.getPage(pageNo)
  const base = page.getViewport({ scale: 1 })
  const cssHeight = (base.height / base.width) * cssWidth

  const dpr = window.devicePixelRatio || 1
  const renderScale = (cssWidth / base.width) * dpr * zoom
  const viewport = page.getViewport({ scale: renderScale })

  activeRenders.get(canvas)?.cancel()

  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  canvas.style.width = `${cssWidth * zoom}px`
  canvas.style.height = `${cssHeight * zoom}px`

  const ctx = canvas.getContext('2d')!
  const task = page.render({ canvasContext: ctx, viewport, canvas })
  activeRenders.set(canvas, task)
  try {
    await task.promise
  } catch (e) {
    // 취소는 정상 흐름 — 더 최신 렌더가 이어서 그린다
    if ((e as Error)?.name !== 'RenderingCancelledException') throw e
  }
  return { cssHeight }
}

/**
 * 페이지를 화면 밖 캔버스에 그려 픽셀을 돌려준다 — 스캔본 분석용 (lib/scan).
 *
 * 텍스트 레이어가 없는 PDF에서는 이 픽셀이 유일한 입력이다. 폭은 마커 링이
 * 25~30px로 잡히는 크기여야 한다 (lib/scan/detect.ts의 임계값 기준).
 */
export async function renderPageBitmap(
  pdf: PDFDocumentProxy,
  pageNo: number,
  targetWidth: number,
): Promise<Raster> {
  const page = await pdf.getPage(pageNo)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: targetWidth / base.width })

  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  // 600dpi 스캔을 1/3로 줄인다. 기본 축소는 계단이 생겨 가는 링이 끊길 수 있다
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // 스캔 이미지가 페이지를 다 덮지 않을 수 있다 — 투명 배경을 잉크로 오인하지 않게
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvasContext: ctx, viewport, canvas }).promise
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  canvas.width = 0                       // 캔버스 백킹 스토어 즉시 해제 (모바일 메모리)
  canvas.height = 0
  return { width, height, rgba: data }
}

// ---------- 텍스트 추출 ----------
// 실제 추출 로직은 pdfText.ts에 있다 — 워커 배선 없이 Node에서도 돌려야 하기 때문이다.

export type { TextToken, TextLine } from './pdfText'

export async function getPageLines(pdf: PDFDocumentProxy, pageNo: number): Promise<TextLine[]> {
  return extractLines(await pdf.getPage(pageNo))
}

/** gradable 판정 — 텍스트 레이어 유무 (1페이지 기준) */
export async function hasTextLayer(pdf: PDFDocumentProxy): Promise<boolean> {
  const page = await pdf.getPage(1)
  const content = await page.getTextContent()
  return content.items.some((i) => 'str' in i && i.str.trim() !== '')
}

/** 문서 목록용 썸네일 — 1페이지를 작게 렌더한 dataURL */
export async function renderThumbnail(pdf: PDFDocumentProxy, width = 160): Promise<string> {
  const page = await pdf.getPage(1)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: width / base.width })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport, canvas }).promise
  return canvas.toDataURL('image/jpeg', 0.7)
}
