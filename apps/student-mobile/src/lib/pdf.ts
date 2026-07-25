// PDF 로드·렌더 (pdf.js)
// 워커 버전과 본체 버전은 반드시 일치해야 한다 — 번들러 URL 임포트로 강제한다.
// legacy 빌드 사용 — 구형 WebView(Chrome <140)에 없는 Promise.try,
// Uint8Array.toHex/fromBase64 등을 pdf.js가 자체 폴리필한다.
// workerSrc 대신 래퍼(pdfWorker.ts)를 workerPort로 넘긴다.
import './polyfills'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { MAX_W } from './geometry'
import type { Box } from '../types'

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

// ---------- 텍스트 추출 ----------

export type TextToken = { str: string; box: Box }
export type TextLine = { text: string; tokens: TextToken[] }

/**
 * 페이지 텍스트를 정규화 좌표(MAX_W 기준)의 토큰으로 뽑고, 같은 줄 글자를 이어 붙인다.
 * PDF는 글자를 조각내서 주므로("[3점]" → "[","3","점","]") 줄 단위 결합이 전제다 (§7.3)
 */
export async function getPageLines(pdf: PDFDocumentProxy, pageNo: number): Promise<TextLine[]> {
  const page = await pdf.getPage(pageNo)
  const base = page.getViewport({ scale: 1 })
  const f = MAX_W / base.width
  const content = await page.getTextContent()

  const tokens: TextToken[] = []
  for (const item of content.items) {
    if (!('str' in item) || item.str.trim() === '') continue
    const h = item.height * f
    tokens.push({
      str: item.str,
      box: {
        x: item.transform[4] * f,
        // PDF 좌표는 좌하단 원점 — 좌상단 원점 정규화 좌표로 뒤집는다
        y: (base.height - item.transform[5]) * f - h,
        w: item.width * f,
        h,
      },
    })
  }

  // 세로 중심이 가까운 토큰끼리 줄로 묶는다
  const sorted = tokens.sort((a, b) => a.box.y + a.box.h / 2 - (b.box.y + b.box.h / 2))
  const lines: TextLine[] = []
  let current: TextToken[] = []
  for (const t of sorted) {
    const prev = current[current.length - 1]
    const sameLine =
      prev &&
      Math.abs(t.box.y + t.box.h / 2 - (prev.box.y + prev.box.h / 2)) <
        Math.max(t.box.h, prev.box.h) * 0.6
    if (sameLine) current.push(t)
    else {
      if (current.length) pushLine(lines, current)
      current = [t]
    }
  }
  if (current.length) pushLine(lines, current)
  return lines
}

function pushLine(lines: TextLine[], tokens: TextToken[]) {
  tokens.sort((a, b) => a.box.x - b.box.x)
  lines.push({ text: tokens.map((t) => t.str).join(''), tokens })
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
