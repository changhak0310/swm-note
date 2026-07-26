// pdf.js ↔ PSP 어댑터
//
// ★ PDF 좌하단 원점 → 정규화 좌상단 원점 변환은 이 파일에서만 일어난다 (PRD §2, 준비도 #2).
// 파이프라인 내부는 변환을 모른다.
import { OPS, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { MAX_W } from '../geometry'
import type { Box, ChoiceLabel, Region as AppRegion } from '../../types'
import type { PipelineResult } from './pipeline'
import { toPageBBox, type BBox, type PageInput, type Problem, type Span } from './types'

// ---------- pdf.js → PageInput ----------

const BOLD = /bold|black|heavy|semibold|extrabold|-bd\b/i

/**
 * 한 페이지의 텍스트 span·도형 bbox를 정규화 좌표로 뽑는다.
 * withFigures=false면 operator list 파싱을 건너뛴다 (텍스트만 필요할 때 훨씬 빠름).
 */
export async function pageInput(
  pdf: PDFDocumentProxy,
  pageNo: number,
  withFigures = true,
): Promise<PageInput> {
  const page = await pdf.getPage(pageNo)
  const view = page.getViewport({ scale: 1 })
  const W = view.width
  const H = view.height

  const content = await page.getTextContent()
  const spans: Span[] = []
  for (const item of content.items) {
    if (!('str' in item) || item.str.trim() === '') continue
    const h = item.height
    const x = item.transform[4]
    // ★ 좌하단 원점 → 좌상단 원점. 이 한 줄이 전체 좌표계 변환 지점이다
    const yTop = H - item.transform[5] - h
    spans.push({
      text: item.str,
      bbox: [x / W, yTop / H, (x + item.width) / W, (yTop + h) / H],
      fontSize: h / H,
      bold: isBold(page, item.fontName),
    })
  }

  const figures = withFigures ? await extractFigures(page, W, H) : { images: [], drawings: [] }

  return {
    index: pageNo - 1,     // PSP는 0-based (§3.1)
    width: W,
    height: H,
    spans,
    images: figures.images,
    drawings: figures.drawings,
  }
}

export async function documentInput(
  pdf: PDFDocumentProxy,
  withFigures = true,
): Promise<PageInput[]> {
  const out: PageInput[] = []
  for (let i = 1; i <= pdf.numPages; i++) out.push(await pageInput(pdf, i, withFigures))
  return out
}

/**
 * A-3의 bold 판정. pdf.js는 PyMuPDF와 달리 span별 bold 비트를 주지 않으므로
 * 로드된 폰트 이름으로 추정한다. 실패하면 false — A-3은 "폰트 크기 또는 bold"라
 * 크기 조건만으로도 성립한다.
 */
function isBold(page: { commonObjs: { has(k: string): boolean; get(k: string): unknown } }, fontName?: string): boolean {
  if (!fontName) return false
  try {
    if (!page.commonObjs.has(fontName)) return false
    const font = page.commonObjs.get(fontName) as { name?: string; black?: boolean; bold?: boolean }
    if (font?.bold || font?.black) return true
    return BOLD.test(font?.name ?? '')
  } catch {
    return false
  }
}

// ---------- FIGURE 소스 추출 ----------
//
// PyMuPDF의 get_images()/get_drawings()에 해당하는 경로가 pdf.js에는 없어
// operator list를 직접 훑는다. 페이지 회전은 다루지 않는다 — 문제집 PDF는 회전이 없다.

async function extractFigures(
  page: {
    getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>
  },
  W: number,
  H: number,
): Promise<{ images: BBox[]; drawings: BBox[] }> {
  const ops = OPS as unknown as Record<string, number>

  let list: { fnArray: number[]; argsArray: unknown[] }
  try {
    list = await page.getOperatorList()
  } catch {
    return { images: [], drawings: [] }
  }

  const images: BBox[] = []
  const drawings: BBox[] = []

  // CTM 스택. [a, b, c, d, e, f]
  let ctm: number[] = [1, 0, 0, 1, 0, 0]
  const stack: number[][] = []

  const apply = (m: number[], x: number, y: number): [number, number] => [
    m[0] * x + m[2] * y + m[4],
    m[1] * x + m[3] * y + m[5],
  ]

  /** PDF 사용자 공간의 사각형 → 정규화 좌상단 원점 bbox */
  const toBBox = (pts: [number, number][]): BBox => {
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    return [
      Math.min(...xs) / W,
      (H - Math.max(...ys)) / H,
      Math.max(...xs) / W,
      (H - Math.min(...ys)) / H,
    ]
  }

  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i]
    const args = list.argsArray[i] as unknown[]

    if (fn === ops.save) stack.push([...ctm])
    else if (fn === ops.restore) ctm = stack.pop() ?? ctm
    else if (fn === ops.transform) ctm = multiply(ctm, args as number[])
    else if (
      fn === ops.paintImageXObject ||
      fn === ops.paintInlineImageXObject ||
      fn === ops.paintImageMaskXObject
    ) {
      // 이미지는 단위 정사각형에 그려지고 CTM으로 배치된다
      const corners: [number, number][] = [
        apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 0, 1), apply(ctm, 1, 1),
      ]
      images.push(toBBox(corners))
    } else if (fn === ops.constructPath) {
      const box = pathBounds(args)
      if (box) {
        const corners: [number, number][] = [
          apply(ctm, box[0], box[1]), apply(ctm, box[2], box[1]),
          apply(ctm, box[0], box[3]), apply(ctm, box[2], box[3]),
        ]
        drawings.push(toBBox(corners))
      }
    }
  }

  return { images: images.filter(finite), drawings: drawings.filter(finite) }
}

/**
 * constructPath 인자에서 경로 경계를 얻는다.
 * pdf.js 5.x는 [ops, coords, minMax] 형태로 minMax를 직접 주지만,
 * 버전에 따라 형태가 달라 좌표 배열 스캔으로도 떨어진다.
 */
function pathBounds(args: unknown[]): [number, number, number, number] | null {
  // ★ pdf.js 5.x는 minMax를 Float32Array로 준다. Array.isArray는 여기서 false다 —
  //   이걸 놓치면 벡터 경로가 전부 버려져 FIGURE 탐지가 통째로 죽는다.
  const minMax = numArray(args[2])
  if (minMax && minMax.length >= 4 && minMax.every(Number.isFinite)) {
    return [minMax[0], minMax[1], minMax[2], minMax[3]]
  }

  // 버전에 따라 좌표 배열이 한 겹 더 감싸여 오기도 한다
  let coords = numArray(args[1])
  const raw = args[1]
  if (!coords && Array.isArray(raw) && raw.length === 1) coords = numArray(raw[0])
  const flat = coords ?? []
  if (flat.length < 4) return null
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i + 1 < flat.length; i += 2) {
    xs.push(flat[i])
    ys.push(flat[i + 1])
  }
  if (!xs.length) return null
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** 숫자 배열(Array 또는 TypedArray)이면 일반 배열로, 아니면 null */
function numArray(x: unknown): number[] | null {
  if (Array.isArray(x)) return x.every((v) => typeof v === 'number') ? (x as number[]) : null
  if (ArrayBuffer.isView(x) && !(x instanceof DataView)) return Array.from(x as unknown as number[])
  return null
}

function multiply(a: number[], b: number[]): number[] {
  return [
    b[0] * a[0] + b[1] * a[2],
    b[0] * a[1] + b[1] * a[3],
    b[2] * a[0] + b[3] * a[2],
    b[2] * a[1] + b[3] * a[3],
    b[4] * a[0] + b[5] * a[2] + a[4],
    b[4] * a[1] + b[5] * a[3] + a[5],
  ]
}

const finite = (b: BBox) => b.every(Number.isFinite) && b[2] > b[0] && b[3] > b[1]

// ---------- PSP Problem → 앱 Region ----------

/**
 * 정규화 [0,1] → 앱의 MAX_W 기준 좌표.
 * 앱은 폭으로 정규화하므로 y는 페이지 종횡비만큼 늘어난다.
 */
function toBox(b: BBox, pageW: number, pageH: number): Box {
  const sy = (MAX_W * pageH) / pageW
  return { x: b[0] * MAX_W, y: b[1] * sy, w: (b[2] - b[0]) * MAX_W, h: (b[3] - b[1]) * sy }
}

/**
 * PRD §4.2가 정의한 본문 영역을 앱 좌표로. V-2 커버리지의 분모다.
 *
 * 커버리지를 "페이지 텍스트 전체 범위"로 재면 머리말·꼬리말을 올바르게 제외하는 쪽이
 * 손해를 본다. 두 알고리즘을 비교할 때는 이 값을 공통 분모로 써야 공정하다.
 */
export function contentExtents(result: PipelineResult): { page: number; box: Box }[] {
  return result.layouts.map((l) => ({
    page: l.pageIndex + 1,
    box: toBox(l.contentBox, l.width, l.height),
  }))
}

/**
 * PSP 산출물을 앱 Region으로 변환한다.
 *
 * Region.id는 기존 `segmentPage`와 같은 `{docId}:p{page}:n{num}` 규약을 유지한다 —
 * 알고리즘을 바꿔도 이미 입력된 정답·필기 귀속·채점 이력이 보존돼야 하기 때문이다.
 *
 * choices[].box에는 표시용 bbox가 아니라 RULE-HITBOX가 산출한 hitbox를 싣는다.
 * 이 필드의 소비자가 grading.ts의 hit-test이기 때문이다.
 */
export function toAppRegions(result: PipelineResult, docId: string): AppRegion[] {
  const dims = new Map(result.layouts.map((l) => [l.pageIndex, { w: l.width, h: l.height }]))

  return result.problems.map((p) => {
    const d = dims.get(p.pageIndex) ?? { w: 1, h: 1 }
    const conv = (b: BBox) => toBox(b, d.w, d.h)
    const rel = (b: BBox) => conv(toPageBBox(b, p.bbox))

    const items = p.regions
      .filter((r) => r.kind === 'CHOICE_ITEM' && r.ordinal !== null && r.ordinal >= 1 && r.ordinal <= 5)
      .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))

    const choices = items.map((r) => ({
      label: r.ordinal as ChoiceLabel,
      box: rel(r.hitbox ?? r.bbox),
    }))

    const pick = (kind: string) => p.regions.find((r) => r.kind === kind)

    return {
      id: `${docId}:p${p.pageIndex + 1}:n${p.number}`,
      docId,
      page: p.pageIndex + 1,      // 앱은 1-based
      bounds: conv(p.bbox),
      numBox: conv(p.numberBBox),
      numLabel: p.number,
      stemBox: pick('STEM') && rel(pick('STEM')!.bbox),
      ansBox: pick('CHOICES') && rel(pick('CHOICES')!.bbox),
      choices,
      ansSynth: choices.length === 0,
      figBox: pick('FIGURE') && rel(pick('FIGURE')!.bbox),
      workBox: pick('WORK_AREA') && rel(pick('WORK_AREA')!.bbox),
      answerType: choices.length >= 2 ? 'choice' : 'integer',
    } satisfies AppRegion
  })
}
