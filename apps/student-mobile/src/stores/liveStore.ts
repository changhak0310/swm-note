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
import { sha256Short } from '../lib/hash'
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
import { decidePack, matchPack, pageFingerprints, type PackMatch } from '../lib/labelPack'
import { parseGolden } from '../lib/psp/golden'
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

/**
 * 텍스트 레이어를 무시하고 스캔 경로만 쓴다 — 브랜치 `feature/scan-only-recognition`의 실험.
 *
 * 두 경로를 하나로 줄이면 유지할 규칙이 반으로 준다. 다만 스캔 경로는 문제집 스캔본에
 * 맞춰 조정돼 있다 — 선지는 "정사각 링", 문제 번호는 "색을 띤 글자"로 찾는다. 텍스트 PDF를
 * 픽셀로 렌더하면 링은 그대로 잡히지만, 번호가 검정이면 색 조건에서 떨어져 번호 자리를
 * 첫 선지로 대신한다(numSynth) — 선지 판정은 살고 번호 배지만 잃는다.
 *
 * 실측 비교는 `npx vitest run scanonly` (scanonly.real.test.ts).
 * 되돌리려면 false로 두면 된다 — 텍스트 경로 코드는 그대로 살려 뒀다.
 */
const SCAN_ONLY = true

export type AnalysisStatus = 'idle' | 'running' | 'done' | 'empty' | 'failed'
export type AnalysisSource = 'psp' | 'v1' | 'scan' | 'pack'

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
/** 이 문서의 내용 해시. 라벨 팩의 신원 확인 열쇠다 (§11.3 L0) */
let liveHash: string | null = null
/** 이 문서에 맞는 라벨 팩 — 해시(L0) 또는 쪽 지문(L1)으로 찾는다 */
let livePack: PackMatch | null = null

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
  /** 이 문서에 붙은 라벨 팩 요약 — 없으면 null (§11.2 계층 A) */
  pack: {
    source: string
    pages: number
    boxes: number
    /** 어떻게 붙었나 — 내용 해시(L0) / 쪽 지문(L1) */
    via: 'hash' | 'fingerprint'
    /** 팩의 p쪽 ↔ 이 문서의 (p + offset)쪽 */
    offset: number
  } | null

  openFile: (file: File) => Promise<void>
  analyzePage: (page: number) => Promise<void>
  reanalyzePage: (page: number) => Promise<void>
  reportMarks: (page: number, marks: LiveMarks) => void
  resume: () => void               // 화면 재진입 — 필기 스토어를 이 문서로 되돌린다
  leave: () => void
  toggleZones: () => void
  toggleHitboxes: () => void
  dismissMessage: () => void
  /** 라벨 팩 JSON을 들여온다. 해시가 이 문서와 다르면 붙지 않는다 */
  importPack: (file: File) => Promise<void>
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
  pack: null,

  openFile: async (file) => {
    set({ loading: true, message: null })
    try {
      const bytes = await file.arrayBuffer()
      // ★ 해시를 먼저 뜬다 — pdf.js는 넘긴 버퍼의 소유권을 가져가 detach 할 수 있다
      const hash = await sha256Short(bytes)
      const pdf = await loadPdf(bytes)
      const pageAspects: number[] = []
      for (let p = 1; p <= pdf.numPages; p++) {
        const vp = (await pdf.getPage(p)).getViewport({ scale: 1 })
        pageAspects.push(vp.height / vp.width)
      }

      // 텍스트 레이어 유무가 분석 경로를 가른다 (스캔본은 픽셀에서 찾는다).
      // SCAN_ONLY면 텍스트가 있어도 픽셀에서 찾는다 — 이 브랜치의 실험 (아래 주석).
      // 다만 렌더 폭은 텍스트 유무로 정한다: 벡터는 더 크게 그려야 선지 링이 살아난다
      const vector = await hasTextLayer(pdf)
      const mode: AnalysisMode = SCAN_ONLY || !vector ? 'scan' : 'text'
      scanWidth = vector ? VECTOR_SCAN_WIDTH : SCAN_WIDTH

      livePdf = pdf
      docPass = null
      liveHash = hash
      // 라벨 팩 찾기 — 파일명이 아니라 내용으로 문다 (§11.3).
      //   L0 내용 해시가 같은 팩이 있으면 그것
      //   없으면 L1 쪽 지문으로 — 재압축·재다운로드·표지 잘림 사본을 여기서 건진다
      const packs = await db.listGoldenPacks()
      livePack = matchPack(packs, hash, null)
      if (!livePack && packs.some((p) => p.golden.pageFingerprints?.length)) {
        // 지문을 뜨는 값이 있을 때만 뜬다 — 96쪽에 1~2초 든다
        const fps = await pageFingerprints(pdf, renderPageBitmap)
        livePack = matchPack(packs, hash, fps)
      }
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
        pack: packSummary(livePack),
        message: livePack
          ? `라벨 팩이 붙었어 — ${livePack.pack.golden.reviewedPages.length}쪽이 사람이 확인한 정답이야` +
            (livePack.via === 'fingerprint'
              ? ` (파일은 다르지만 쪽 그림이 같아서 붙였어${livePack.offset ? `, 쪽 ${livePack.offset > 0 ? '+' : ''}${livePack.offset} 밀림` : ''}).`
              : '.') +
            ' 나머지 쪽은 평소대로 픽셀에서 찾아.'
          : mode !== 'scan'
            ? null
            : SCAN_ONLY
              ? '스캔 경로로만 분석해. 텍스트 레이어가 있어도 쓰지 않고, 펜이 닿은 쪽 이미지에서 ①~⑤ 링과 번호 자리를 직접 찾아.'
              : '텍스트가 없는 스캔본이야. 펜이 닿으면 그 쪽 이미지에서 번호 자리와 ①~⑤를 찾고, 번호 값(0109 같은)은 숫자 OCR로 읽어 배지에 띄워.',
      })
    } catch (e) {
      liveHash = null
      livePack = null
      set({
        loading: false,
        pack: null,
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

  // 라벨 팩 들여오기 — GoldenLabeler가 내보낸 JSON을 그대로 받는다
  importPack: async (file) => {
    try {
      const golden = parseGolden(await file.text())
      if (!golden.sourceHash) {
        set({ message: '이 라벨에는 원본 해시가 없어. 라벨러에서 다시 내보내 줘.' })
        return
      }
      const pack = { sourceHash: golden.sourceHash, golden, importedAt: Date.now() }
      await db.putGoldenPack(pack)

      // 지금 열려 있는 문서의 것이 아니면 저장만 해 둔다 — 그 파일을 열면 그때 붙는다
      if (liveHash && golden.sourceHash !== liveHash) {
        set({
          message: `저장했어. 다만 지금 연 파일의 라벨은 아니야 (${golden.source}) — 그 파일을 열면 자동으로 붙어.`,
        })
        return
      }
      livePack = { pack, offset: 0, via: 'hash' as const }
      set({
        pack: packSummary(livePack),
        // 이미 분석한 쪽은 검출 결과라 팩으로 다시 세운다
        pages: {},
        marksByPage: {},
        message: `라벨 팩이 붙었어 — ${golden.reviewedPages.length}쪽이 사람이 확인한 정답이야.`,
      })
    } catch (e) {
      set({ message: e instanceof Error ? e.message : String(e) })
    }
  },
}))

function packSummary(match: PackMatch | null): LiveState['pack'] {
  if (!match) return null
  return {
    source: match.pack.golden.source,
    pages: match.pack.golden.reviewedPages.length,
    boxes: match.pack.golden.boxes.length,
    via: match.via,
    offset: match.offset,
  }
}


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
    // ---------- 스캔 경로 ----------
    // 페이지마다 독립이다. 픽셀 검출은 이웃 페이지를 볼 이유가 없어 통독하지 않는다
    if (mode === 'scan') {
      const raster = await renderPageBitmap(pdf, page, scanWidth)

      // ---------- 계층 A: 라벨 팩 (§11.2) ----------
      // 사람이 확인한 쪽은 검출하지 않는다. 다만 **애매하면 쓰지 않는다** — 해시가 다르거나
      // 라벨 자리에 인쇄물이 없으면 이유를 남기고 검출로 떨어진다 (§11.3·11.4)
      const decision = decidePack(livePack, page, docKey, raster)
      if (decision.use) {
        put({
          status: decision.regions.length ? 'done' : 'empty',
          regions: decision.regions,
          source: decision.regions.length ? 'pack' : null,
          ms: performance.now() - t0,
          note: `라벨 팩 (사람이 확인한 쪽 · 배치 확인 ${decision.check.inked}/${decision.check.sampled})`,
        })
        return
      }
      // 팩이 있는데 이 쪽에서 안 쓴 이유는 남긴다 — 조용히 검출로 떨어지면 아무도 모른다
      const packNote =
        livePack && decision.reason !== '이 쪽은 라벨되지 않음' ? `라벨 팩 미적용: ${decision.reason}` : undefined

      const layout = detectScan(raster)
      const { regions, synthesizedHeadings, markerRects } = scanRegions(layout, raster, docKey, page)

      // 번호 값을 못 읽는 대신 번호 자리를 잘라 둔다 — 배지에 그대로 띄운다
      const crops: Record<string, string> = {}
      for (const r of regions) {
        if (!r.numBox) continue
        const url = cropDataUrl(raster, r.numBox)
        if (url) crops[r.id] = url
      }
      set((s) => (s.docKey === docKey ? { numCrops: { ...s.numCrops, ...crops } } : s))

      put({
        status: regions.length ? 'done' : 'empty',
        regions,
        source: regions.length ? 'scan' : null,
        ms: performance.now() - t0,
        note:
          [
            packNote,
            synthesizedHeadings
              ? `번호를 못 찾아 선지 위치로 대신한 문항 ${synthesizedHeadings}개`
              : undefined,
          ]
            .filter(Boolean)
            .join(' · ') || undefined,
      })
      // OCR 보정은 뒤에서 돈다 — 첫 OCR은 모델을 내려받아 수 초가 걸릴 수 있고,
      // 그동안에도 선지 판정과 크롭 배지는 이미 동작해야 한다
      if (regions.length) void refineScanRegions(raster, regions, markerRects, docKey, page, set)
      return
    }

    // ---------- 텍스트 경로 ----------
    // 첫 접촉이면 여기서 문서를 통독한다. 두 페이지를 동시에 건드려도 통독은 한 번이다
    docPass ??= runDocPass(pdf, docKey, pageCount)
    const pass = await docPass

    let regions = pass.byPage.get(page) ?? []
    let source: AnalysisSource | null = regions.length ? 'psp' : null

    // 폴백은 PSP가 문서째로 실패했을 때만이다. 통독이 성공했는데 이 쪽에 문항이
    // 없다면 그건 실패가 아니라 답이다 — 표지·목차·개념정리·해설이 그렇다.
    // (실측 hi_math 51쪽 중 문항 페이지는 24쪽뿐) 거기에 v1을 덧대면 없는 문항이 생긴다.
    if (pass.error) {
      const v1 = segmentPage(docKey, page, await getPageLines(pdf, page))
      if (v1.length) {
        regions = v1
        source = 'v1'
      }
    }

    put({
      status: regions.length ? 'done' : 'empty',
      regions,
      source,
      ms: performance.now() - t0,
      note: pass.error,
    })
  } catch (e) {
    put({
      ...IDLE_ANALYSIS,
      status: 'failed',
      ms: performance.now() - t0,
      note: e instanceof Error ? e.message : String(e),
    })
  }
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
