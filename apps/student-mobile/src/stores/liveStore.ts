// 라이브 노트 상태 — 펜이 닿은 페이지를 그때 분석한다.
//
// 에디터(documentStore)와 다른 점:
//   - 업로드 시 전 페이지를 분할하지 않는다. 페이지마다 펜 접촉이 신호다.
//   - 정답지·채점·회차가 없다. "이 문항에서 무엇을 골랐나"만 실시간으로 보여준다.
//   - 문서 레코드를 만들지 않는다. 필기만 `live:{파일명}` 키로 저장돼 같은 파일을
//     다시 열면 이어서 쓴다. 노트 목록에는 나오지 않는다.
import { create } from 'zustand'
import type { Box, ChoiceLabel, Region } from '../types'
import * as db from '../lib/db'
import { MAX_W } from '../lib/geometry'
import type { LiveMarks } from '../lib/liveDetect'
import {
  getPageLines,
  hasTextLayer,
  loadPdf,
  renderPageBitmap,
  type PDFDocumentProxy,
} from '../lib/pdf'
import { runPipeline } from '../lib/psp'
import { pageInput, toAppRegions } from '../lib/psp/adapter'
import type { PageInput } from '../lib/psp/types'
import type { Raster } from '../lib/scan/components'
import { detectScan } from '../lib/scan/detect'
import {
  labelsFromMarkerReads,
  pxRect,
  readMarkerDigit,
  readNumber,
  type OcrRead,
} from '../lib/scan/ocr'
import { reconcileNumbering, type NumberRead } from '../lib/scan/numbering'
import { scanRegions, type ScanRegionResult } from '../lib/scan/regions'
import { segmentPage } from '../lib/segment'
import { mergeRegions, verifyChoices, type PrintedMark } from '../lib/verify/merge'
import { useInkStore } from './inkStore'

/**
 * 스캔 분석 해상도 (px 폭).
 *
 * 마커 링이 25~30px로 잡히는 크기여야 한다 — lib/scan/detect.ts의 임계값이
 * 그 실측(쎈 수학1, 1653px에서 27px)에 맞춰져 있다. 더 키우면 느려지기만 한다.
 */
const SCAN_WIDTH = 1700

/**
 * 벡터 PDF를 스캔 경로로 볼 때의 렌더 폭.
 *
 * 스캔본은 이미 거친 픽셀이라 1700이면 선지 링이 25~30px로 잡히지만, 벡터 PDF를 그
 * 폭으로 렌더하면 링 획이 1px 아래로 깎여 잉크 문턱을 못 넘는다 — 실측 hi_math p15의
 * 선지 30개 중 엄격 마스크 1개·느슨 마스크 8개만 링으로 잡혔다. 폭을 올리면 살아난다:
 * 2200에서 21개, 2800에서 30개, 3400에서 30개. 3400은 잡음까지 커져(문항 32→59) 손해다.
 */
const VECTOR_SCAN_WIDTH = 2800

export type AnalysisStatus = 'idle' | 'running' | 'done' | 'empty' | 'failed'
export type AnalysisSource = 'psp' | 'v1' | 'scan'

/**
 * 분석 경로.
 *   text — 텍스트 레이어를 읽는다. 문서를 통독하고 페이지 몫을 꺼낸다.
 *   scan — 픽셀을 본다. 페이지마다 독립이라 통독이 없다 (lib/scan).
 */
export type AnalysisMode = 'text' | 'scan'

export type PageAnalysis = {
  status: AnalysisStatus
  regions: Region[]
  source: AnalysisSource | null
  ms: number
  note?: string                    // 실패 사유 / PSP를 못 쓴 이유
}

export const IDLE_ANALYSIS: PageAnalysis = { status: 'idle', regions: [], source: null, ms: 0 }

// PDF 프록시는 직렬화 불가 — 상태가 아니라 모듈 캐시로 둔다 (documentStore와 같은 이유)
let livePdf: PDFDocumentProxy | null = null
/** 이 문서의 스캔 렌더 폭 — 파일을 열 때 정해진다 (벡터인지 스캔본인지에 따라) */
let scanWidth = SCAN_WIDTH

export function getLivePdf(): PDFDocumentProxy | null {
  return livePdf
}

/**
 * 문서 통독 결과 — 페이지별 구역.
 *
 * 분석 단위는 페이지지만 읽는 단위는 문서다. PSP의 판단 근거 절반이 문서 전체
 * 통계이기 때문이다 — 머리말·꼬리말은 "3페이지 이상에서 반복"으로 걸러내고(§4.2),
 * 본문 폰트 중앙값·번호 정렬 기준선·쪽번호도 여러 장을 겹쳐 봐야 나온다.
 * 실측(수능 20p): 앞뒤 2쪽만 보고 자르면 20쪽 중 13쪽이 전체 통독과 달랐다.
 * 쪽번호가 문항 번호로 잡히고, 그 가짜 앵커가 앞 문항을 잘라 선지를 통째로 잃었다.
 *
 * 대신 통독은 첫 펜 접촉 때 한 번만 한다. 텍스트 추출은 쪽당 6ms 남짓이고
 * 페이지마다 await로 끊기므로 획이 끊기지는 않는다.
 */
type DocPass = { byPage: Map<number, Region[]>; error?: string }
let docPass: Promise<DocPass> | null = null

type LiveState = {
  fileName: string | null
  docKey: string | null            // 필기 저장 키 (`live:{파일명}`)
  mode: AnalysisMode
  pageCount: number
  pageAspects: number[]
  pages: Record<number, PageAnalysis>
  marksByPage: Record<number, LiveMarks>
  /**
   * regionId → 문제 번호 자리를 잘라낸 그림 (dataURL).
   *
   * 스캔본 배지의 최초 표기이자 OCR 실패 시의 폴백이다. 번호 값은 뒤이어 숫자 OCR이
   * numLabel로 채우는데(fillNumberLabels), 그 전에도·못 읽어도 "무엇을 번호로 봤는지"는
   * 그 자리 픽셀 그대로 보여준다 — 잘못 잡았으면 눈에 바로 띈다. 텍스트 PDF에는 필요 없다.
   */
  numCrops: Record<string, string>
  loading: boolean
  message: string | null
  showZones: boolean
  showHitboxes: boolean

  openFile: (file: File) => Promise<void>
  analyzePage: (page: number) => Promise<void>
  reanalyzePage: (page: number) => Promise<void>
  reportMarks: (page: number, marks: LiveMarks) => void
  resume: () => void               // 화면 재진입 — 필기 스토어를 이 문서로 되돌린다
  leave: () => void
  toggleZones: () => void
  toggleHitboxes: () => void
  dismissMessage: () => void
}

export const useLiveStore = create<LiveState>((set, get) => ({
  fileName: null,
  docKey: null,
  mode: 'text',
  pageCount: 0,
  pageAspects: [],
  pages: {},
  marksByPage: {},
  numCrops: {},
  loading: false,
  message: null,
  showZones: false,
  showHitboxes: false,

  openFile: async (file) => {
    set({ loading: true, message: null })
    try {
      const pdf = await loadPdf(await file.arrayBuffer())
      const pageAspects: number[] = []
      for (let p = 1; p <= pdf.numPages; p++) {
        const vp = (await pdf.getPage(p)).getViewport({ scale: 1 })
        pageAspects.push(vp.height / vp.width)
      }

      // 텍스트 레이어 유무가 분석 경로를 가른다 (스캔본은 픽셀에서 찾는다).
      // 텍스트 레이어가 쓸 만하면 1단(텍스트)을 쓴다. 어느 쪽이든 3단(픽셀)은 항상 돈다.
      // 렌더 폭은 원본 성격으로 정한다: 벡터는 더 크게 그려야 선지 링이 살아난다
      const vector = await hasTextLayer(pdf)
      const mode: AnalysisMode = vector ? 'text' : 'scan'
      scanWidth = vector ? VECTOR_SCAN_WIDTH : SCAN_WIDTH

      livePdf = pdf
      docPass = null
      const docKey = `live:${file.name}`
      await useInkStore.getState().setDoc(docKey)

      set({
        fileName: file.name,
        docKey,
        mode,
        pageCount: pdf.numPages,
        pageAspects,
        pages: {},
        marksByPage: {},
        numCrops: {},
        loading: false,
        message:
          mode === 'scan'
            ? '텍스트가 없는 스캔본이야. 펜이 닿으면 그 쪽 이미지에서 ①~⑤ 링과 번호 자리를 찾고, 번호 값(0109 같은)은 숫자 OCR로 읽어 배지에 띄워.'
            : null,
      })
    } catch (e) {
      set({
        loading: false,
        message:
          (e as Error)?.name === 'PasswordException'
            ? '암호가 걸린 PDF는 열 수 없어.'
            : 'PDF를 읽을 수 없어. 다른 파일을 골라줘.',
      })
    }
  },

  // 펜 접촉 신호. 같은 페이지에 몇 번을 대도 분석은 한 번만 돈다
  analyzePage: async (page) => {
    const status = get().pages[page]?.status
    if (status && status !== 'idle') return
    await analyze(page, set, get)
  },

  reanalyzePage: async (page) => {
    if (get().pages[page]?.status === 'running') return
    docPass = null                   // 통독부터 다시 — 실패가 일시적이었을 수 있다
    await analyze(page, set, get)
  },

  // 마크는 필기에서 파생된 값이라 여기 저장하지 않는다 — 화면 요약용 사본만 받는다
  reportMarks: (page, marks) =>
    set((s) => {
      if (sameMarks(s.marksByPage[page], marks)) return s
      return { marksByPage: { ...s.marksByPage, [page]: marks } }
    }),

  resume: () => {
    const { docKey } = get()
    if (docKey && useInkStore.getState().docId !== docKey) void useInkStore.getState().setDoc(docKey)
  },

  leave: () => {
    void db.flushPendingSaves()
  },

  toggleZones: () => set((s) => ({ showZones: !s.showZones })),
  toggleHitboxes: () => set((s) => ({ showHitboxes: !s.showHitboxes })),
  dismissMessage: () => set({ message: null }),
}))

// ============================================================ 분석

type SetState = (partial: Partial<LiveState> | ((s: LiveState) => Partial<LiveState>)) => void
type GetState = () => LiveState

async function analyze(page: number, set: SetState, get: GetState) {
  const { docKey, pageCount, mode } = get()
  const pdf = livePdf
  if (!pdf || !docKey) return

  // 통독 중에 다른 파일을 열 수 있다. 그때 도착한 결과는 남의 문서 것이라 버린다
  const put = (a: PageAnalysis) =>
    set((s) => (s.docKey === docKey ? { pages: { ...s.pages, [page]: a } } : s))
  put({ ...IDLE_ANALYSIS, status: 'running' })

  const t0 = performance.now()
  try {
    // ---------- 1단 · 텍스트 ----------
    // 텍스트 레이어가 쓸 만하면 조판 좌표를 그대로 읽는다. 첫 접촉에서 문서를 통독한다
    // (PSP의 판단 근거 절반이 문서 전체 통계다). 두 페이지를 동시에 건드려도 통독은 한 번.
    let textRegions: Region[] = []
    let passError: string | undefined
    if (mode === 'text') {
      docPass ??= runDocPass(pdf, docKey, pageCount)
      const pass = await docPass
      passError = pass.error
      textRegions = pass.byPage.get(page) ?? []
      // 폴백은 PSP가 문서째로 실패했을 때만이다. 통독이 성공했는데 이 쪽에 문항이
      // 없다면 그건 실패가 아니라 답이다 — 표지·목차·개념정리·해설이 그렇다.
      if (pass.error) {
        const v1 = segmentPage(docKey, page, await getPageLines(pdf, page))
        if (v1.length) textRegions = v1
      }
    }

    // ---------- 3단 · 픽셀 ----------
    // 텍스트와 완전히 독립한 신호다. 텍스트 경로가 놓친 문항을 여기서 되찾는다 —
    // 실측: hi_math +15문항, 수학의 신 +51문항(47→98). 되찾은 선지의 91~95%가
    // 인쇄된 ①~⑤ 자리와 일치했다(2단 검증). 페이지마다 독립이라 통독이 없다.
    const raster = await renderPageBitmap(pdf, page, scanWidth)
    const scan = scanRegions(detectScan(raster), raster, docKey, page)
    // 텍스트가 있는 문서에서는 픽셀 쪽 주관식을 받지 않는다 — 그건 텍스트가 이미 봤고,
    // 픽셀 경로의 주관식 판정은 번호에 의존해 헛문항을 만든다
    const pixelRegions =
      mode === 'text' ? scan.regions.filter((r) => r.choices.length >= 2) : scan.regions

    // ---------- 2단 · 위치 검증 ----------
    // 선지 박스가 인쇄된 기호 자리에 붙었는지 확인하고 어긋나면 고친다.
    // 텍스트가 성하면 토큰 위치가 곧 정답이라 OCR보다 정확하고 공짜다.
    // 텍스트가 없는 스캔본에서는 refineScanRegions의 링 숫자 OCR이 같은 일을 한다.
    const merged = mergeRegions(textRegions, pixelRegions)
    const marks = mode === 'text' ? await printedMarks(pdf, page) : []
    const regions = merged.map((m) =>
      marks.length ? verifyChoices(m.region, marks).region : m.region,
    )

    // 번호 값을 못 읽는 문항은 번호 자리를 잘라 배지에 그대로 띄운다
    const crops: Record<string, string> = {}
    for (const r of regions) {
      if (!r.numBox || r.numLabel) continue
      const url = cropDataUrl(raster, r.numBox)
      if (url) crops[r.id] = url
    }
    if (Object.keys(crops).length) {
      set((s) => (s.docKey === docKey ? { numCrops: { ...s.numCrops, ...crops } } : s))
    }

    const fromPixel = merged.filter((m) => m.source === 'pixel').length
    put({
      status: regions.length ? 'done' : 'empty',
      regions,
      source: regions.length ? (mode === 'text' ? 'psp' : 'scan') : null,
      ms: performance.now() - t0,
      note:
        passError ??
        (fromPixel ? `텍스트가 놓쳐 픽셀에서 되찾은 문항 ${fromPixel}개` : undefined),
    })

    // 번호 값·선지 라벨 OCR은 뒤에서 돈다 — 첫 OCR은 모델을 내려받아 수 초가 걸릴 수
    // 있고, 그동안에도 선지 판정과 크롭 배지는 이미 동작해야 한다
    const needOcr = regions.filter((r) => !r.numLabel)
    if (needOcr.length) void refineScanRegions(raster, needOcr, scan.markerRects, docKey, page, set)
  } catch (e) {
    put({
      ...IDLE_ANALYSIS,
      status: 'failed',
      ms: performance.now() - t0,
      note: e instanceof Error ? e.message : String(e),
    })
  }
}

const CIRCLED = '①②③④⑤'

/** 그 쪽에 인쇄된 선지 기호들 — 텍스트 레이어에서 그대로 읽는다 (2단 위치 검증의 기준) */
async function printedMarks(pdf: PDFDocumentProxy, page: number): Promise<PrintedMark[]> {
  const out: PrintedMark[] = []
  for (const line of await getPageLines(pdf, page)) {
    for (const t of line.tokens) {
      for (const ch of t.str) {
        const i = CIRCLED.indexOf(ch)
        if (i >= 0) out.push({ label: i + 1, box: t.box })
      }
    }
  }
  return out
}

async function runDocPass(
  pdf: PDFDocumentProxy,
  docKey: string,
  pageCount: number,
): Promise<DocPass> {
  const inputs: PageInput[] = []
  for (let p = 1; p <= pageCount; p++) {
    // ★ 도형을 함께 읽는다. 예전에는 "선지 판정에 도형은 필요 없다"며 껐는데
    //   실측에서 뒤집혔다 — 단 구분선이 도형으로 오고, 그 선이 없으면 단 판정이
    //   히스토그램으로 떨어져 애매해진다. 수능 20p에서 문항 46→38, 객관식 33→26으로
    //   줄었다(선지 박스가 통째로 안 붙는 문항 7개). 값은 쪽당 ~11ms이고 통독은
    //   첫 접촉 때 한 번뿐이라, 문항을 잃는 것보다 싸다.
    inputs.push(await pageInput(pdf, p, true))
  }

  const byPage = new Map<number, Region[]>()
  try {
    for (const r of toAppRegions(runPipeline(inputs, { jobId: docKey }), docKey)) {
      const arr = byPage.get(r.page)
      if (arr) arr.push(r)
      else byPage.set(r.page, [r])
    }
    return { byPage }
  } catch (e) {
    return { byPage, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 스캔 분석 결과를 숫자 OCR로 보정한다 — 펜이 닿은 페이지만 온다.
 *
 * 두 가지를 한다:
 *   1. 선지 라벨 교정 — 선지가 5개 미만으로 잡힌 그룹은 마커를 놓쳤을 수 있다
 *      (한국 문제집은 사실상 전부 5지선다). 그때 순서 기반 라벨은 통째로 밀려
 *      인쇄된 ③에 쳐도 ②로 읽힌다. 링 안의 숫자를 읽어 인쇄값에 맞춘다.
 *      5개 완비 그룹은 건드리지 않는다 — 순서가 곧 인쇄값이다 (OCR 대조 실측 155/155).
 *   2. 번호 값 — 문항 순서대로 읽어 수열로 검산한다(scan/numbering.ts). 정해진 문항만
 *      numLabel이 붙어 배지가 "0109번 ·"으로 바뀌고, 못 정한 문항은 크롭 그림 배지
 *      그대로다. 번호 자리를 마커로 대신한 문항(numSynth)은 건너뛴다 — 그 크롭은
 *      선지 번호지 문제 번호가 아니다.
 */
async function refineScanRegions(
  raster: Raster,
  regions: Region[],
  markerRects: ScanRegionResult['markerRects'],
  docKey: string,
  page: number,
  set: SetState,
) {
  const relabels: Record<string, Region['choices']> = {}
  const numLabels: Record<string, string> = {}
  try {
    for (const r of regions) {
      if (r.answerType !== 'choice' || r.choices.length >= 5) continue
      const rects = markerRects[r.id]
      if (!rects || rects.length !== r.choices.length) continue
      const reads: (OcrRead | null)[] = []
      for (const rect of rects) reads.push(await readMarkerDigit(raster, rect))
      const labels = labelsFromMarkerReads(reads)
      if (labels && labels.some((v, i) => v !== r.choices[i].label)) {
        relabels[r.id] = r.choices.map((c, i) => ({ ...c, label: labels[i] as ChoiceLabel }))
      }
    }

    // 번호는 한 자리씩 판단하지 않는다 — 문항 순서대로 읽어 수열로 검산한다.
    // 자신 없는 자리는 이웃이 세운 수열이 메운다 (scan/numbering.ts)
    const numbered = regions.filter((r) => r.numBox && !r.numSynth)
    const reads: NumberRead[] = []
    for (const r of numbered) reads.push(await readNumber(raster, pxRect(raster, r.numBox!)))
    const { labels } = reconcileNumbering(reads)
    for (let i = 0; i < numbered.length; i++) {
      if (labels[i]) numLabels[numbered[i].id] = labels[i]!
    }
  } catch {
    // 워커·모델 로드 실패(오프라인 등) — 순서 라벨과 크롭 배지로 충분하다
  }
  if (Object.keys(relabels).length === 0 && Object.keys(numLabels).length === 0) return

  set((s) => {
    if (s.docKey !== docKey) return s
    const a = s.pages[page]
    if (!a) return s
    const patched = a.regions.map((r) => {
      if (!relabels[r.id] && !numLabels[r.id]) return r
      return {
        ...r,
        ...(relabels[r.id] ? { choices: relabels[r.id] } : null),
        ...(numLabels[r.id] ? { numLabel: numLabels[r.id] } : null),
      }
    })
    return { pages: { ...s.pages, [page]: { ...a, regions: patched } } }
  })
}

/**
 * 앱 좌표(MAX_W 기준)의 박스를 래스터에서 잘라 dataURL로.
 *
 * 스캔본 배지에 "이걸 문제 번호로 봤다"를 그대로 보여주기 위한 것이다.
 * 번호 한 칸이라 크기가 작다 (실측 95×38px → PNG 1KB 안팎).
 */
function cropDataUrl(raster: Raster, box: Box): string | null {
  const k = raster.width / MAX_W                  // 앱 좌표 → 래스터 픽셀
  const pad = 2
  const x0 = Math.max(0, Math.floor(box.x * k) - pad)
  const y0 = Math.max(0, Math.floor(box.y * k) - pad)
  const x1 = Math.min(raster.width, Math.ceil((box.x + box.w) * k) + pad)
  const y1 = Math.min(raster.height, Math.ceil((box.y + box.h) * k) + pad)
  const w = x1 - x0
  const h = y1 - y0
  if (w <= 0 || h <= 0) return null

  const out = new ImageData(w, h)
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * raster.width + x0) * 4
    out.data.set(raster.rgba.subarray(src, src + w * 4), y * w * 4)
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.putImageData(out, 0, 0)
  const url = canvas.toDataURL('image/png')
  canvas.width = 0
  canvas.height = 0
  return url
}

function sameMarks(a: LiveMarks | undefined, b: LiveMarks): boolean {
  if (!a) return Object.keys(b).length === 0
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => a[k] === b[k])
}
