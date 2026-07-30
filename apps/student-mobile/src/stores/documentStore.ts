// 문서·구역·채점·재풀이 상태 — 화면 3개(목록/에디터/정답 입력)의 플로우 전부
//
// 구역(문항)은 **펜이 닿은 쪽을 그때 분석해서** 나온다. 업로드 시점에는 아무것도
// 나누지 않는다 — 분석은 페이지 그림에서 ①~⑤ 링과 번호 자리를 찾는 스캔 경로(lib/scan)라
// 텍스트 레이어가 없는 스캔본도 채점할 수 있다. 자세한 규칙은
// docs/research/객관식_인식.md, 아래 「분석」 절 참조.
import { create } from 'zustand'
import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import type { AnswerEntry, AnswerKey, Attempt, Box, ChoiceLabel, Document, Region, RetryList } from '../types'
import * as db from '../lib/db'
import {
  getPageLines,
  hasTextLayer,
  loadPdf,
  renderPageBitmap,
  renderThumbnail,
  type PDFDocumentProxy,
} from '../lib/pdf'
import { segmentPage } from '../lib/segment'
import { buildEntries, parseAnswerLines, parseAnswerTable } from '../lib/answerKey'
import { buildRetryList, consecutiveCorrect, gradeRegion } from '../lib/grading'
import { attribute } from '../lib/attribution'
import { MAX_W } from '../lib/geometry'
import { sha256Short } from '../lib/hash'
import type { LiveMarks } from '../lib/liveDetect'
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
import { useInkStore } from './inkStore'

export type SheetMode = 'hidden' | 'summary' | 'resolve' | 'pill'

/** 채점 결과 신호 — 이동이 필요한 경우를 호출자(라우터)에게 알린다 */
export type GradeOutcome = 'graded' | 'need-answers' | 'unavailable'

const MAX_PDF_BYTES = 100 * 1024 * 1024

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
 * 텍스트 레이어를 무시하고 스캔 경로만 쓴다.
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

/**
 * 구역 캐시 버전 (SegmentCache.segmentVersion). 불일치하는 캐시는 버리고 다시 분석한다.
 *
 * v1 텍스트 분할(segmentPage, SEGMENT_VERSION=2)이 남긴 캐시와 구분하려고 10부터 센다 —
 * 그쪽 구역 id는 `:n{번호}`, 이쪽은 `:s{순번}`이라 섞이면 채점 이력이 엉뚱한 문항에 붙는다.
 */
const ANALYSIS_VERSION = 10

// PDF 프록시는 직렬화 불가 — 상태가 아니라 모듈 캐시로 유지한다
const pdfCache = new Map<string, PDFDocumentProxy>()

export function getCachedPdf(docId: string): PDFDocumentProxy | undefined {
  return pdfCache.get(docId)
}

// ---------- 열린 문서의 분석 부속 (문서를 닫을 때 함께 버린다) ----------

/** 이 문서의 스캔 렌더 폭 — 문서를 열 때 정해진다 (벡터인지 스캔본인지에 따라) */
let scanWidth = SCAN_WIDTH
/** 이 문서에 맞는 라벨 팩 — 내용 해시(L0) 또는 쪽 지문(L1)으로 찾는다 (§11.3) */
let docPack: PackMatch | null = null
/** 돌고 있는 쪽 분석 — 같은 쪽을 두 번 돌리지 않는다 (펜 접촉과 전 쪽 훑기가 겹칠 수 있다) */
const inflight = new Map<number, Promise<void>>()

export type AnalysisStatus = 'idle' | 'running' | 'done' | 'empty' | 'failed'
export type AnalysisSource = 'psp' | 'v1' | 'scan' | 'pack' | 'stored'

/**
 * 분석 경로.
 *   text — 텍스트 레이어를 읽는다. 문서를 통독하고 페이지 몫을 꺼낸다.
 *   scan — 픽셀을 본다. 페이지마다 독립이라 통독이 없다 (lib/scan).
 */
export type AnalysisMode = 'text' | 'scan'

/** 쪽 분석 상태. 결과 구역은 regionsByPage에 있다 — 구역의 출처는 한 곳뿐이다 */
export type PageAnalysis = {
  status: AnalysisStatus
  source: AnalysisSource | null
  ms: number
  note?: string                    // 실패 사유 / PSP를 못 쓴 이유
}

export const IDLE_ANALYSIS: PageAnalysis = { status: 'idle', source: null, ms: 0 }

export type ListMeta = {
  regionCount: number
  lastResult: { wrong: number; total: number } | null   // "12문항 중 3개 틀림"
  pendingGrade: boolean                                 // 필기 있음 + 채점 이력 없음
  fileMissing: boolean
}

type ScrollTarget = { page: number; y?: number; seq: number }

type DocumentState = {
  documents: Document[]
  listMeta: Record<string, ListMeta>
  toast: string | null

  // 업로드 플로우 (F-02)
  importing: boolean
  answerPdfPromptDocId: string | null    // 문제지 업로드 직후 정답지 슬롯 프롬프트

  // 열린 문서 (에디터)
  doc: Document | null
  regionsByPage: Record<number, Region[]>
  pageAspects: number[]                  // 페이지 h/w 비율 (세로 스크롤 레이아웃)
  attemptsAll: Record<string, Attempt[]> // regionId → 전체 회차 기록
  answerKey: AnswerKey | null
  retryList: RetryList | null
  sheet: SheetMode
  resolvingRegionId: string | null
  grading: boolean
  scrollTarget: ScrollTarget | null
  visiblePage: number
  showZoneDebug: boolean

  // 분석 (펜 접촉 → 그 쪽 인식)
  mode: AnalysisMode
  analysis: Record<number, PageAnalysis>
  /** regionId → 학생이 체크한 선지. 필기에서 파생된 값이라 저장하지 않는다 (화면 요약용 사본) */
  marksByPage: Record<number, LiveMarks>
  /**
   * regionId → 문제 번호 자리를 잘라낸 그림 (dataURL).
   *
   * 스캔본 배지의 최초 표기이자 OCR 실패 시의 폴백이다. 번호 값은 뒤이어 숫자 OCR이
   * numLabel로 채우는데(fillNumberLabels), 그 전에도·못 읽어도 "무엇을 번호로 봤는지"는
   * 그 자리 픽셀 그대로 보여준다 — 잘못 잡았으면 눈에 바로 띈다. 텍스트 PDF에는 필요 없다.
   */
  numCrops: Record<string, string>
  /** 전 쪽 훑기 진행률 — 채점·정답 입력이 아직 안 본 쪽을 분석하는 동안 */
  sweep: { done: number; total: number } | null
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

  // ---------- 목록 ----------
  loadDocuments: () => Promise<void>
  importPdf: (file: File) => Promise<void>
  // 정답지 슬롯을 마치면 열어야 할 문서 id를 돌려준다 — 이동은 호출자(라우터)가 한다
  attachAnswerPdf: (file: File) => Promise<string | null>
  skipAnswerPdf: () => Promise<string | null>
  deleteDocument: (id: string) => Promise<void>
  restoreDocument: (id: string) => Promise<void>
  purgeDocument: (id: string) => Promise<void>
  renameDocument: (id: string, name: string) => Promise<void>

  // ---------- 에디터 ----------
  /** 문서를 열어 화면 상태를 채운다. 열 수 없으면 false (라우터가 목록으로 되돌린다) */
  openDocument: (id: string) => Promise<boolean>
  /** 문서 화면을 떠날 때의 정리 — 열린 문서가 없으면 아무것도 하지 않는다(멱등) */
  leaveDocument: () => void
  setVisiblePage: (page: number) => void

  // ---------- 분석 ----------
  /** 펜 접촉 신호. 이미 분석한 쪽은 다시 돌지 않는다 */
  analyzePage: (page: number) => Promise<void>
  reanalyzePage: (page: number) => Promise<void>
  /** 아직 안 본 쪽을 전부 분석한다 — 채점·정답 입력은 전 쪽의 문항을 알아야 한다 */
  analyzeAllPages: () => Promise<void>
  reportMarks: (page: number, marks: LiveMarks) => void
  /** 라벨 팩 JSON을 들여온다. 해시가 이 문서와 다르면 저장만 해 둔다 */
  importLabelPack: (file: File) => Promise<void>

  grade: () => Promise<GradeOutcome>
  startResolve: (regionId: string) => Promise<void>
  backToSummary: () => void
  collapseSheet: () => void
  expandSheet: () => void
  toggleReveal: () => void

  // ---------- 정답 (F-05 / F-06) ----------
  setAnswer: (regionId: string, value: string | null) => Promise<void>
  importAnswerPdfFile: (file: File) => Promise<number>
  parseInlineKey: (pages: number[]) => Promise<number>
  convertRegionToChoice: (regionId: string) => Promise<void>

  showToast: (msg: string) => void
  toggleZoneDebug: () => void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documents: [],
  listMeta: {},
  toast: null,
  importing: false,
  answerPdfPromptDocId: null,
  doc: null,
  regionsByPage: {},
  pageAspects: [],
  attemptsAll: {},
  answerKey: null,
  retryList: null,
  sheet: 'hidden',
  resolvingRegionId: null,
  grading: false,
  scrollTarget: null,
  visiblePage: 1,
  showZoneDebug: false,
  mode: 'scan',
  analysis: {},
  marksByPage: {},
  numCrops: {},
  sweep: null,
  pack: null,

  // ============================================================ 목록

  loadDocuments: async () => {
    const documents = await db.listDocuments()
    const listMeta: Record<string, ListMeta> = {}
    for (const d of documents) {
      let regionCount = d.regionCount
      if (regionCount === undefined) {
        regionCount = 0
        for (let p = 1; p <= d.pageCount; p++) {
          regionCount += (await db.getSegments(d.id, p))?.regions.length ?? 0
        }
      }
      const attempts = await db.getAttempts(d.id)
      const latest = latestPerRegion(attempts)
      const graded = Object.values(latest).filter(
        (a) => a.result === 'correct' || a.result === 'incorrect',
      )
      // "n개 틀림"은 오답 이력 기준 — 다시풀기 목록에서 아직 졸업(3연속 정답)하지
      // 못한 문항 수. 재풀이 미응답으로 오답 표시가 사라지는 것을 막는다
      const retry = await db.getRetryList(d.id)
      const byRegion: Record<string, Attempt[]> = {}
      for (const a of attempts) (byRegion[a.regionId] ??= []).push(a)
      const unresolved = (retry?.regionIds ?? []).filter(
        (id) => consecutiveCorrect(byRegion[id] ?? []) < 3,
      ).length
      const inkPages = await (await db.getDB()).getAllFromIndex('ink', 'docId', d.id)
      const hasInk = inkPages.some((p) => p.strokes.length > 0)
      const fileMissing = Capacitor.isNativePlatform()
        ? !(await nativeFileExists(d.problemPdfPath))
        : !pdfCache.has(d.id)
      listMeta[d.id] = {
        regionCount,
        lastResult: graded.length ? { wrong: unresolved, total: regionCount } : null,
        pendingGrade: hasInk && attempts.length === 0,
        fileMissing,
      }
    }
    set({ documents, listMeta })
  },

  importPdf: async (file) => {
    // F-02 검증 — 인식 실패는 정상 경로다. 에러가 아니라 안내로 처리한다.
    if (file.size > MAX_PDF_BYTES) {
      get().showToast('100MB 이하 파일만 올릴 수 있습니다')
      return
    }
    set({ importing: true })
    try {
      const data = await file.arrayBuffer()
      // ★ 해시를 먼저 뜬다 — pdf.js는 넘긴 버퍼의 소유권을 가져가 detach 할 수 있다.
      //   이 값이 라벨 팩의 신원 확인 열쇠다 (§11.3 L0)
      const contentHash = await sha256Short(data)
      let pdf: PDFDocumentProxy
      try {
        pdf = await loadPdf(data.slice(0))
      } catch (e) {
        get().showToast(
          (e as Error)?.name === 'PasswordException'
            ? '암호가 걸린 PDF는 열 수 없습니다'
            : 'PDF를 읽을 수 없습니다. 다른 파일을 선택하세요',
        )
        return
      }

      const id = crypto.randomUUID()
      const path = `documents/${id}.pdf`
      if (Capacitor.isNativePlatform()) {
        await Filesystem.writeFile({
          path,
          data: toBase64(data),
          directory: Directory.Data,
          recursive: true,
        })
      }
      pdfCache.set(id, pdf)

      // 구역 분할은 업로드 때 하지 않는다 — 펜이 닿은 쪽을 그때 분석한다 (아래 「분석」).
      // 그래서 문항 수는 0으로 시작해 분석한 쪽만큼 늘어난다
      const doc: Document = {
        id,
        name: file.name.replace(/\.pdf$/i, ''),
        problemPdfPath: path,
        contentHash,
        pageCount: pdf.numPages,
        regionCount: 0,
        thumbnail: await renderThumbnail(pdf),
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
        lastPage: 1,
      }
      await db.putDocument(doc)

      await get().loadDocuments()
      // 정답지는 같은 화면에서 별도 슬롯으로 받는다 (F-02)
      set({ answerPdfPromptDocId: id })
    } catch (e) {
      // 어떤 실패도 스피너에 갇히지 않고 안내로 흘려보낸다 (설계 원칙 4)
      console.error('importPdf failed', e)
      get().showToast('PDF를 읽을 수 없습니다. 다른 파일을 선택하세요')
    } finally {
      set({ importing: false })
    }
  },

  attachAnswerPdf: async (file) => {
    const docId = get().answerPdfPromptDocId
    if (!docId) return null
    set({ answerPdfPromptDocId: null })
    const doc = await db.getDocument(docId)
    if (!doc) return null

    if (file.size > MAX_PDF_BYTES) {
      get().showToast('100MB 이하 파일만 올릴 수 있습니다')
      return docId
    }
    try {
      const data = await file.arrayBuffer()
      const answerPdf = await loadPdf(data.slice(0))
      const path = `documents/${docId}-answers.pdf`
      if (Capacitor.isNativePlatform()) {
        await Filesystem.writeFile({
          path,
          data: toBase64(data),
          directory: Directory.Data,
          recursive: true,
        })
      }
      doc.answerPdfPath = path
      await db.putDocument(doc)

      // 정답지는 채점 대상이 아니다 — 텍스트만 추출한다 (F-02 규칙 2)
      const count = await parseAnswerPdf(docId, doc.pageCount, answerPdf)
      if (count === 0) {
        get().showToast('정답지에서 정답을 찾지 못했습니다. 직접 입력해주세요')
      }
    } catch {
      get().showToast('정답지 PDF를 읽을 수 없습니다. 직접 입력해주세요')
    }
    return docId
  },

  skipAnswerPdf: async () => {
    const docId = get().answerPdfPromptDocId
    set({ answerPdfPromptDocId: null })
    return docId
  },

  // 삭제는 휴지통으로(soft delete) — 복원 가능. 영구 삭제는 purgeDocument
  deleteDocument: async (id) => {
    const doc = await db.getDocument(id)
    if (!doc) return
    doc.deletedAt = Date.now()
    await db.putDocument(doc)
    await get().loadDocuments()
  },

  restoreDocument: async (id) => {
    const doc = await db.getDocument(id)
    if (!doc) return
    delete doc.deletedAt
    await db.putDocument(doc)
    await get().loadDocuments()
  },

  purgeDocument: async (id) => {
    const doc = await db.getDocument(id)
    await db.deleteDocumentData(id)
    pdfCache.delete(id)
    if (doc && Capacitor.isNativePlatform()) {
      for (const path of [doc.problemPdfPath, doc.answerPdfPath]) {
        if (!path) continue
        try {
          await Filesystem.deleteFile({ path, directory: Directory.Data })
        } catch {
          // 이미 없는 파일 — F-01 파일 없음 케이스
        }
      }
    }
    await get().loadDocuments()
  },

  renameDocument: async (id, name) => {
    const doc = await db.getDocument(id)
    if (!doc || !name.trim()) return
    doc.name = name.trim()
    await db.putDocument(doc)
    await get().loadDocuments()
  },

  // ============================================================ 에디터

  openDocument: async (id) => {
    const doc = await db.getDocument(id)
    if (!doc) return false
    if (get().listMeta[id]?.fileMissing && !pdfCache.has(id)) {
      get().showToast('원본 PDF 파일이 없어 열 수 없습니다')
      return false
    }
    if (!pdfCache.has(id)) {
      const data = await readPdfFile(doc.problemPdfPath)
      if (!data) {
        get().showToast('원본 PDF 파일이 없어 열 수 없습니다')
        return false
      }
      pdfCache.set(id, await loadPdf(data))
    }
    const pdf = pdfCache.get(id)!

    doc.lastOpenedAt = Date.now()
    await db.putDocument(doc)

    // 인식 경로는 텍스트 레이어 유무로 갈린다 (SCAN_ONLY면 언제나 스캔 경로).
    // 렌더 폭은 그래도 텍스트 유무로 정한다 — 벡터는 더 크게 그려야 선지 링이 살아난다
    const vector = await hasTextLayer(pdf)
    const mode: AnalysisMode = SCAN_ONLY || !vector ? 'scan' : 'text'
    scanWidth = vector ? VECTOR_SCAN_WIDTH : SCAN_WIDTH
    docPass = null
    inflight.clear()

    // 라벨 팩 찾기 — 파일명이 아니라 내용으로 문다 (§11.3).
    //   L0 내용 해시가 같은 팩이 있으면 그것
    //   없으면 L1 쪽 지문으로 — 재압축·재다운로드·표지 잘림 사본을 여기서 건진다
    const packs = await db.listGoldenPacks()
    docPack = matchPack(packs, doc.contentHash ?? null, null)
    if (!docPack && packs.some((p) => p.golden.pageFingerprints?.length)) {
      // 지문을 뜨는 값이 있을 때만 뜬다 — 96쪽에 1~2초 든다
      docPack = matchPack(packs, doc.contentHash ?? null, await pageFingerprints(pdf, renderPageBitmap))
    }

    // 세로 연속 스크롤 레이아웃을 위해 전 페이지 비율을 미리 계산한다
    const pageAspects: number[] = []
    const regionsByPage: Record<number, Region[]> = {}
    const analysis: Record<number, PageAnalysis> = {}
    for (let p = 1; p <= doc.pageCount; p++) {
      const page = await pdf.getPage(p)
      const vp = page.getViewport({ scale: 1 })
      pageAspects.push(vp.height / vp.width)

      // 전에 분석해 둔 쪽은 그대로 쓴다 — 펜이 닿아도 다시 돌지 않는다.
      // 버전이 다른 캐시(v1 텍스트 분할)는 버린다 (F-10)
      const seg = await db.getSegments(id, p)
      if (seg?.segmentVersion === ANALYSIS_VERSION) {
        regionsByPage[p] = seg.regions
        analysis[p] = { status: seg.regions.length ? 'done' : 'empty', source: 'stored', ms: 0 }
      }
    }

    // 목록 표시용 문항 수 갱신 — 지난번에 분석한 쪽까지의 합이다
    const totalRegions = Object.values(regionsByPage).reduce((n, r) => n + r.length, 0)
    if (doc.regionCount !== totalRegions) {
      doc.regionCount = totalRegions
      await db.putDocument(doc)
    }

    const attempts = await db.getAttempts(id)
    await useInkStore.getState().setDoc(id)

    set({
      doc,
      regionsByPage,
      pageAspects,
      mode,
      analysis,
      marksByPage: {},
      numCrops: {},
      sweep: null,
      pack: packSummary(docPack),
      attemptsAll: groupByRegion(attempts),
      answerKey: (await db.getAnswerKey(id)) ?? null,
      retryList: (await db.getRetryList(id)) ?? null,
      sheet: attempts.length ? 'pill' : 'hidden',
      resolvingRegionId: null,
      visiblePage: doc.lastPage,
      scrollTarget: { page: doc.lastPage, seq: Date.now() },   // 재진입 복원 (F-10)
    })
    return true
  },

  leaveDocument: () => {
    if (!get().doc) return
    void db.flushPendingSaves()
    void useInkStore.getState().setDoc(null)
    docPass = null
    docPack = null
    inflight.clear()
    set({
      doc: null,
      regionsByPage: {},
      pageAspects: [],
      attemptsAll: {},
      answerKey: null,
      retryList: null,
      sheet: 'hidden',
      resolvingRegionId: null,
      scrollTarget: null,
      analysis: {},
      marksByPage: {},
      numCrops: {},
      sweep: null,
      pack: null,
    })
    void get().loadDocuments()
  },

  setVisiblePage: (page) => {
    const { doc } = get()
    if (!doc) return
    if (get().visiblePage !== page) set({ visiblePage: page })
    if (doc.lastPage === page) return
    doc.lastPage = page
    db.scheduleSave(`doc:${doc.id}:lastPage`, async () => {
      const current = get().doc
      if (current?.id === doc.id) await db.putDocument({ ...current, lastPage: page })
    })
  },

  // ============================================================ 분석

  analyzePage: async (page) => {
    const status = get().analysis[page]?.status
    if (status && status !== 'idle' && status !== 'failed') return
    await runAnalyze(page, false, set, get)
  },

  reanalyzePage: async (page) => {
    if (inflight.has(page)) return
    docPass = null                   // 통독부터 다시 — 실패가 일시적이었을 수 있다
    set((s) => ({ analysis: { ...s.analysis, [page]: IDLE_ANALYSIS } }))
    await runAnalyze(page, true, set, get)
  },

  /**
   * 아직 안 본 쪽을 전부 분석한다.
   *
   * 채점과 정답 입력은 문서 전체의 문항을 알아야 한다 — 펜이 닿은 쪽만 알면 나머지는
   * "문항 없음"과 구별되지 않는다. 여기서는 숫자 OCR까지 기다린다: 정답지·정답표 매칭이
   * `Region.numLabel`로 걸리므로(answerKey.buildEntries) 번호 값 없이 넘어가면 정답이
   * 하나도 안 붙는다.
   */
  analyzeAllPages: async () => {
    const doc = get().doc
    if (!doc) return
    const docId = doc.id
    // 끝난 쪽만 건너뛴다. 돌고 있는 쪽도 목록에 넣어 기다린다 — runAnalyze가 같은 분석을
    // 두 번 돌리지 않으므로, 방금 펜이 닿아 도는 쪽을 안 기다리면 그 쪽 문항이 채점에서 빠진다
    const pending: number[] = []
    for (let p = 1; p <= doc.pageCount; p++) {
      const status = get().analysis[p]?.status
      if (status !== 'done' && status !== 'empty') pending.push(p)
    }
    if (!pending.length) return

    set({ sweep: { done: 0, total: pending.length } })
    try {
      for (let i = 0; i < pending.length; i++) {
        if (get().doc?.id !== docId) return          // 문서를 닫았다 — 남의 문서를 훑지 않는다
        await runAnalyze(pending[i], true, set, get)
        set((s) => (s.doc?.id === docId ? { sweep: { done: i + 1, total: pending.length } } : s))
      }
    } finally {
      set((s) => (s.doc?.id === docId ? { sweep: null } : s))
    }
  },

  // 마크는 필기에서 파생된 값이라 여기 저장하지 않는다 — 화면 요약용 사본만 받는다
  reportMarks: (page, marks) =>
    set((s) => {
      if (sameMarks(s.marksByPage[page], marks)) return s
      return { marksByPage: { ...s.marksByPage, [page]: marks } }
    }),

  // 라벨 팩 들여오기 — GoldenLabeler가 내보낸 JSON을 그대로 받는다
  importLabelPack: async (file) => {
    try {
      const golden = parseGolden(await file.text())
      if (!golden.sourceHash) {
        get().showToast('이 라벨에는 원본 해시가 없습니다. 라벨러에서 다시 내보내주세요')
        return
      }
      const pack = { sourceHash: golden.sourceHash, golden, importedAt: Date.now() }
      await db.putGoldenPack(pack)

      // 지금 열린 문서의 것이 아니면 저장만 해 둔다 — 그 문서를 열면 그때 붙는다
      const doc = get().doc
      if (!doc || golden.sourceHash !== doc.contentHash) {
        get().showToast(`저장했습니다. 지금 연 문서의 라벨은 아닙니다 (${golden.source})`)
        return
      }
      docPack = { pack, offset: 0, via: 'hash' }
      // 이미 분석한 쪽은 검출 결과라 팩으로 다시 세운다
      set({ pack: packSummary(docPack), analysis: {}, regionsByPage: {}, marksByPage: {}, numCrops: {} })
      get().showToast(`라벨 팩이 붙었습니다 — ${golden.reviewedPages.length}쪽이 사람이 확인한 정답입니다`)
    } catch (e) {
      get().showToast(e instanceof Error ? e.message : String(e))
    }
  },

  grade: async () => {
    const { doc, answerKey } = get()
    if (!doc || get().grading) return 'unavailable'
    // 선행조건: 정답이 1문항 이상 (F-07). 없으면 정답 입력으로 흘려보낸다 (F-05).
    // 전 쪽 훑기보다 먼저 본다 — 정답이 없으면 훑어도 채점할 것이 없다
    if (!answerKey || answerKey.entries.length === 0) {
      get().showToast('정답이 없습니다. 먼저 정답을 입력해주세요')
      return 'need-answers'
    }

    set({ grading: true })
    const minDelay = new Promise((r) => setTimeout(r, 1100))   // 시안2 채점 모달 체감 시간
    try {
      // 펜이 닿지 않은 쪽은 아직 문항을 모른다 — 여기서 남은 쪽을 분석한다
      await get().analyzeAllPages()
      const regionsByPage = get().regionsByPage
      if (Object.values(regionsByPage).every((r) => r.length === 0)) {
        get().showToast('이 PDF에서 문항을 찾지 못했습니다')
        return 'unavailable'
      }

      await db.flushPendingSaves()
      const rounds = useInkStore.getState().rounds
      const entryOf = new Map(answerKey.entries.map((e) => [e.regionId, e]))
      const gradedAt = Date.now()
      const all: Attempt[] = []

      for (let p = 1; p <= doc.pageCount; p++) {
        const regions = regionsByPage[p] ?? []
        if (!regions.length) continue
        const ink = await db.getPageInk(doc.id, p)
        const strokes = ink?.strokes ?? []
        // 분석 전에 그린 획은 귀속되지 않은 채 저장된다 (regionId = null) — 지금 구역으로
        // 주인을 찾아 준다. 그러지 않으면 그 획은 채점에서 통째로 빠진다
        const ownerOf = new Map(strokes.map((s) => [s.id, s.regionId ?? attribute(s, regions)]))
        for (const r of regions) {
          const no = rounds[r.id] ?? 1
          const mine = strokes.filter((s) => ownerOf.get(s.id) === r.id && s.attemptNo === no)
          all.push(gradeRegion(r, mine, entryOf.get(r.id), no, gradedAt))
        }
      }

      await db.putAttempts(all)

      const merged = { ...get().attemptsAll }
      for (const a of all) {
        const arr = (merged[a.regionId] ?? []).filter((x) => x.no !== a.no)
        merged[a.regionId] = [...arr, a]
      }

      // 오답 이력 기준 누적 목록 — 3연속 정답(졸업)까지 유지
      const retryList = buildRetryList(doc.id, all, merged, get().retryList, gradedAt)
      await db.putRetryList(retryList)

      await minDelay
      set({ attemptsAll: merged, retryList, sheet: 'summary', resolvingRegionId: null })
      useInkStore.setState({ viewRounds: {}, revealRegionId: null })

      // 채점 직후 안내 (F-07 예외)
      const gradedNow = all.filter((a) => a.result === 'correct' || a.result === 'incorrect')
      const nokey = all.filter((a) => a.result === 'nokey').length
      const graduated = retryList.graduated ?? []
      if (gradedNow.length === 0) {
        get().showToast('답에 동그라미를 쳤나요? 답 표시를 찾지 못했습니다')
      } else if (graduated.length > 0) {
        const labels = graduated
          .map((id) => findRegion(regionsByPage, id)?.region.numLabel)
          .filter(Boolean)
          .map((n) => `${n}번`)
          .join('·')
        get().showToast(`${labels} 3연속 정답 — 졸업! 🎉`)
      } else if (nokey > 0) {
        get().showToast(`${nokey}문항은 정답이 없어 채점하지 못했습니다`)
      }
      return 'graded'
    } finally {
      set({ grading: false })
    }
  },

  startResolve: async (regionId) => {
    const ink = useInkStore.getState()
    const current = ink.rounds[regionId] ?? 1
    const attempts = get().attemptsAll[regionId] ?? []
    const gradedAtCurrent = attempts.some((a) => a.no === current)
    // 현재 회차가 이미 채점됐을 때만 새 회차를 연다 — 재진입 시 이중 증가 방지
    if (gradedAtCurrent) await ink.bumpRound([regionId])
    ink.setReveal(null)
    ink.setViewRound(regionId, null)

    const found = findRegion(get().regionsByPage, regionId)
    set({
      sheet: 'resolve',
      resolvingRegionId: regionId,
      scrollTarget: found
        ? { page: found.page, y: found.region.bounds.y, seq: Date.now() }
        : null,
    })

    // 최초 실행 안내 — 필기가 사라지는 것처럼 보인다 (F-09)
    if (!localStorage.getItem('puri-retry-hint')) {
      localStorage.setItem('puri-retry-hint', '1')
      get().showToast('이전 풀이는 회차 버튼에서 볼 수 있어요')
    }
  },

  backToSummary: () => {
    useInkStore.getState().setReveal(null)
    set({ sheet: 'summary', resolvingRegionId: null })
  },

  collapseSheet: () => {
    useInkStore.getState().setReveal(null)
    set({ sheet: 'pill', resolvingRegionId: null })
  },

  expandSheet: () => set({ sheet: 'summary' }),

  toggleReveal: () => {
    const ink = useInkStore.getState()
    const { resolvingRegionId } = get()
    if (!resolvingRegionId) return
    ink.setReveal(ink.revealRegionId === resolvingRegionId ? null : resolvingRegionId)
  },

  // ============================================================ 정답

  setAnswer: async (regionId, value) => {
    const { doc } = get()
    if (!doc) return
    const entries = (get().answerKey?.entries ?? []).filter((e) => e.regionId !== regionId)
    if (value !== null) entries.push({ regionId, value, source: 'manual' })
    const key: AnswerKey = { docId: doc.id, entries }
    await db.putAnswerKey(key)               // 입력 즉시 저장 (F-06 규칙 6)
    set({ answerKey: key })
  },

  importAnswerPdfFile: async (file) => {
    const { doc } = get()
    if (!doc) return 0
    try {
      const pdf = await loadPdf(await file.arrayBuffer())
      const count = await parseAnswerPdf(doc.id, doc.pageCount, pdf)
      set({ answerKey: (await db.getAnswerKey(doc.id)) ?? null })
      if (count === 0) get().showToast('정답지에서 정답을 찾지 못했습니다. 직접 입력해주세요')
      return count
    } catch {
      get().showToast('정답지 PDF를 읽을 수 없습니다')
      return 0
    }
  },

  // 문제지 내 정답표 (F-05 규칙 2 — 사용자가 페이지를 지정한다)
  parseInlineKey: async (pages) => {
    const { doc } = get()
    const pdf = doc ? pdfCache.get(doc.id) : undefined
    if (!doc || !pdf) return 0
    const lines: string[] = []
    for (const p of pages) {
      if (p < 1 || p > doc.pageCount) continue
      for (const l of await getPageLines(pdf, p)) lines.push(l.text)
    }
    const answers = parseAnswerLines(lines)
    const regions = Object.values(get().regionsByPage).flat()
    const entries = buildEntries(answers, regions, 'inlineKey')
    const count = await mergeEntries(doc.id, entries, ['inlineKey'])
    set({ answerKey: (await db.getAnswerKey(doc.id)) ?? null })
    return count
  },

  convertRegionToChoice: async (regionId) => {
    const { doc, regionsByPage } = get()
    if (!doc) return
    const found = findRegion(regionsByPage, regionId)
    if (!found) return
    await db.setRegionAnswerType(doc.id, found.page, regionId, 'choice')
    set({
      regionsByPage: {
        ...regionsByPage,
        [found.page]: regionsByPage[found.page].map((r) =>
          r.id === regionId ? { ...r, answerType: 'choice' } : r,
        ),
      },
    })
  },

  // ============================================================ 공통

  showToast: (msg) => {
    if (toastTimer) clearTimeout(toastTimer)
    set({ toast: msg })
    toastTimer = setTimeout(() => set({ toast: null }), 3500)
  },

  toggleZoneDebug: () => set((s) => ({ showZoneDebug: !s.showZoneDebug })),
}))

// ============================================================ 분석
//
// 분석 단위는 페이지다. 신호는 펜 접촉이고(InkCanvas.onInkStart), 결과 구역은
// regionsByPage에 들어가면서 segments 스토어에도 저장된다 — 다음에 열면 다시 돌지 않는다.

type SetState = (
  partial: Partial<DocumentState> | ((s: DocumentState) => Partial<DocumentState>),
) => void
type GetState = () => DocumentState

/**
 * 문서 통독 결과 — 페이지별 구역 (텍스트 경로 전용).
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

/** 같은 쪽을 두 번 돌리지 않는다 — 펜 접촉과 전 쪽 훑기가 같은 쪽에서 만날 수 있다 */
function runAnalyze(page: number, awaitRefine: boolean, set: SetState, get: GetState): Promise<void> {
  const existing = inflight.get(page)
  if (existing) return existing
  const started = analyze(page, awaitRefine, set, get).finally(() => {
    if (inflight.get(page) === started) inflight.delete(page)
  })
  inflight.set(page, started)
  return started
}

async function analyze(page: number, awaitRefine: boolean, set: SetState, get: GetState) {
  const { doc, mode } = get()
  if (!doc) return
  const docId = doc.id
  const pdf = pdfCache.get(docId)
  if (!pdf) return

  // 분석 중에 문서를 닫거나 다른 문서를 열 수 있다. 그때 도착한 결과는 남의 것이라 버린다
  const putStatus = (a: PageAnalysis) =>
    set((s) => (s.doc?.id === docId ? { analysis: { ...s.analysis, [page]: a } } : s))
  const putResult = async (regions: Region[], a: PageAnalysis) => {
    if (get().doc?.id !== docId) return
    set((s) => ({
      analysis: { ...s.analysis, [page]: a },
      regionsByPage: { ...s.regionsByPage, [page]: regions },
    }))
    await db.putSegments({ docId, page, regions, segmentVersion: ANALYSIS_VERSION })
    // 분석 전에 그린 획은 주인이 없다 — 이제 찾아 준다 (inkStore.reattributePage)
    useInkStore.getState().reattributePage(page, regions)
    saveRegionCount(docId, set, get)
  }

  putStatus({ ...IDLE_ANALYSIS, status: 'running' })

  const t0 = performance.now()
  try {
    // ---------- 스캔 경로 ----------
    // 페이지마다 독립이다. 픽셀 검출은 이웃 페이지를 볼 이유가 없어 통독하지 않는다
    if (mode === 'scan') {
      const raster = await renderPageBitmap(pdf, page, scanWidth)

      // ---------- 계층 A: 라벨 팩 (§11.2) ----------
      // 사람이 확인한 쪽은 검출하지 않는다. 다만 **애매하면 쓰지 않는다** — 해시가 다르거나
      // 라벨 자리에 인쇄물이 없으면 이유를 남기고 검출로 떨어진다 (§11.3·11.4)
      const decision = decidePack(docPack, page, docId, raster)
      if (decision.use) {
        await putResult(decision.regions, {
          status: decision.regions.length ? 'done' : 'empty',
          source: decision.regions.length ? 'pack' : null,
          ms: performance.now() - t0,
          note: `라벨 팩 (사람이 확인한 쪽 · 배치 확인 ${decision.check.inked}/${decision.check.sampled})`,
        })
        return
      }
      // 팩이 있는데 이 쪽에서 안 쓴 이유는 남긴다 — 조용히 검출로 떨어지면 아무도 모른다
      const packNote =
        docPack && decision.reason !== '이 쪽은 라벨되지 않음'
          ? `라벨 팩 미적용: ${decision.reason}`
          : undefined

      const layout = detectScan(raster)
      const { regions, synthesizedHeadings, markerRects } = scanRegions(layout, raster, docId, page)

      // 번호 값을 못 읽는 대신 번호 자리를 잘라 둔다 — 배지에 그대로 띄운다
      const crops: Record<string, string> = {}
      for (const r of regions) {
        if (!r.numBox) continue
        const url = cropDataUrl(raster, r.numBox)
        if (url) crops[r.id] = url
      }
      set((s) => (s.doc?.id === docId ? { numCrops: { ...s.numCrops, ...crops } } : s))

      await putResult(regions, {
        status: regions.length ? 'done' : 'empty',
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
      // 그동안에도 선지 판정과 크롭 배지는 이미 동작해야 한다.
      // 전 쪽 훑기(채점·정답 입력)는 번호 값이 필요하므로 기다린다
      if (regions.length) {
        const refining = refineScanRegions(raster, regions, markerRects, docId, page, set, get)
        if (awaitRefine) await refining
        else void refining
      }
      return
    }

    // ---------- 텍스트 경로 ----------
    // 첫 접촉이면 여기서 문서를 통독한다. 두 페이지를 동시에 건드려도 통독은 한 번이다
    docPass ??= runDocPass(pdf, docId, doc.pageCount)
    const pass = await docPass

    let regions = pass.byPage.get(page) ?? []
    let source: AnalysisSource | null = regions.length ? 'psp' : null

    // 폴백은 PSP가 문서째로 실패했을 때만이다. 통독이 성공했는데 이 쪽에 문항이
    // 없다면 그건 실패가 아니라 답이다 — 표지·목차·개념정리·해설이 그렇다.
    // (실측 hi_math 51쪽 중 문항 페이지는 24쪽뿐) 거기에 v1을 덧대면 없는 문항이 생긴다.
    if (pass.error) {
      const v1 = segmentPage(docId, page, await getPageLines(pdf, page))
      if (v1.length) {
        regions = v1
        source = 'v1'
      }
    }

    await putResult(regions, {
      status: regions.length ? 'done' : 'empty',
      source,
      ms: performance.now() - t0,
      note: pass.error,
    })
  } catch (e) {
    putStatus({
      ...IDLE_ANALYSIS,
      status: 'failed',
      ms: performance.now() - t0,
      note: e instanceof Error ? e.message : String(e),
    })
  }
}

async function runDocPass(
  pdf: PDFDocumentProxy,
  docId: string,
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
    for (const r of toAppRegions(runPipeline(inputs, { jobId: docId }), docId)) {
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
 * 스캔 분석 결과를 숫자 OCR로 보정한다 — 분석한 페이지만 온다.
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
 *
 * numLabel은 화면 표기뿐 아니라 정답 매칭의 열쇠다 (answerKey.buildEntries).
 */
async function refineScanRegions(
  raster: Raster,
  regions: Region[],
  markerRects: ScanRegionResult['markerRects'],
  docId: string,
  page: number,
  set: SetState,
  get: GetState,
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

  if (get().doc?.id !== docId) return
  const current = get().regionsByPage[page]
  if (!current) return
  // 보정은 라벨·번호만 고친다 — id가 그대로라 획 귀속·채점 이력은 건드릴 필요가 없다
  const patched = current.map((r) => {
    if (!relabels[r.id] && !numLabels[r.id]) return r
    return {
      ...r,
      ...(relabels[r.id] ? { choices: relabels[r.id] } : null),
      ...(numLabels[r.id] ? { numLabel: numLabels[r.id] } : null),
    }
  })
  set((s) => (s.doc?.id === docId ? { regionsByPage: { ...s.regionsByPage, [page]: patched } } : s))
  await db.putSegments({ docId, page, regions: patched, segmentVersion: ANALYSIS_VERSION })
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

/** 목록 카드의 "n문항" — 분석한 쪽이 늘면 함께 는다. 쓰기가 몰리지 않게 디바운스한다 */
function saveRegionCount(docId: string, set: SetState, get: GetState) {
  db.scheduleSave(`doc:${docId}:regionCount`, async () => {
    const doc = get().doc
    if (doc?.id !== docId) return
    const count = Object.values(get().regionsByPage).reduce((n, r) => n + r.length, 0)
    if (doc.regionCount === count) return
    const next = { ...doc, regionCount: count }
    await db.putDocument(next)
    set((s) => (s.doc?.id === docId ? { doc: next } : s))
  })
}

function packSummary(match: PackMatch | null): DocumentState['pack'] {
  if (!match) return null
  return {
    source: match.pack.golden.source,
    pages: match.pack.golden.reviewedPages.length,
    boxes: match.pack.golden.boxes.length,
    via: match.via,
    offset: match.offset,
  }
}

function sameMarks(a: LiveMarks | undefined, b: LiveMarks): boolean {
  if (!a) return Object.keys(b).length === 0
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => a[k] === b[k])
}

// ============================================================ 헬퍼

export function latestPerRegion(attempts: Attempt[]): Record<string, Attempt> {
  const latest: Record<string, Attempt> = {}
  for (const a of attempts) {
    if (!latest[a.regionId] || latest[a.regionId].no < a.no) latest[a.regionId] = a
  }
  return latest
}

function groupByRegion(attempts: Attempt[]): Record<string, Attempt[]> {
  const byRegion: Record<string, Attempt[]> = {}
  for (const a of attempts) (byRegion[a.regionId] ??= []).push(a)
  return byRegion
}

export function findRegion(
  regionsByPage: Record<number, Region[]>,
  regionId: string,
): { region: Region; page: number } | null {
  for (const [page, regions] of Object.entries(regionsByPage)) {
    const region = regions.find((r) => r.id === regionId)
    if (region) return { region, page: Number(page) }
  }
  return null
}

/** 정답지 PDF 파싱 → 문항 단위 병합. 반환값은 매칭된 문항 수 (F-05) */
async function parseAnswerPdf(
  docId: string,
  pageCount: number,
  answerPdf: PDFDocumentProxy,
): Promise<number> {
  const lines: { text: string; tokens: string[] }[] = []
  for (let p = 1; p <= answerPdf.numPages; p++) {
    for (const l of await getPageLines(answerPdf, p)) {
      lines.push({ text: l.text, tokens: l.tokens.map((t) => t.str) })
    }
  }
  // 정답표 표 구조(문항|정답|배점)는 토큰 단위로 파싱해야 단답형 정답까지 잡힌다
  const answers = parseAnswerTable(lines)

  const regions: Region[] = []
  for (let p = 1; p <= pageCount; p++) {
    const seg = await db.getSegments(docId, p)
    if (seg) regions.push(...seg.regions)
  }
  const entries = buildEntries(answers, regions, 'answerPdf')
  // 정답지 > 정답표 > 직접 입력 (F-05) — 정답지는 자동 소스를 덮고 manual은 유지한다
  return mergeEntries(docId, entries, ['answerPdf', 'inlineKey'])
}

async function mergeEntries(
  docId: string,
  incoming: AnswerEntry[],
  replaces: AnswerEntry['source'][],
): Promise<number> {
  const existing = (await db.getAnswerKey(docId))?.entries ?? []
  const merged = new Map(existing.map((e) => [e.regionId, e]))
  for (const e of incoming) {
    const prev = merged.get(e.regionId)
    if (!prev || replaces.includes(prev.source)) merged.set(e.regionId, e)
  }
  await db.putAnswerKey({ docId, entries: [...merged.values()] })
  return incoming.length
}

// ---------- Filesystem ----------

async function nativeFileExists(path: string): Promise<boolean> {
  try {
    await Filesystem.stat({ path, directory: Directory.Data })
    return true
  } catch {
    return false
  }
}

async function readPdfFile(path: string): Promise<ArrayBuffer | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const { data } = await Filesystem.readFile({ path, directory: Directory.Data })
    return fromBase64(data as string)
  } catch {
    return null
  }
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}
