// 문서·구역·채점·재풀이 상태 — 화면 3개(목록/에디터/정답 입력)의 플로우 전부
import { create } from 'zustand'
import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import type { AnswerEntry, AnswerKey, Attempt, Document, Region, RetryList } from '../types'
import * as db from '../lib/db'
import {
  getPageLines,
  hasTextLayer,
  loadPdf,
  renderThumbnail,
  type PDFDocumentProxy,
} from '../lib/pdf'
import { SEGMENT_VERSION, segmentPage } from '../lib/segment'
import { buildEntries, parseAnswerLines, parseAnswerTable } from '../lib/answerKey'
import { buildRetryList, consecutiveCorrect, gradeRegion } from '../lib/grading'
import { useInkStore } from './inkStore'

export type Screen = 'list' | 'editor' | 'answers' | 'gallery' | 'compare' | 'golden' | 'live'
export type SheetMode = 'hidden' | 'summary' | 'resolve' | 'pill'

const MAX_PDF_BYTES = 100 * 1024 * 1024

// PDF 프록시는 직렬화 불가 — 상태가 아니라 모듈 캐시로 유지한다
const pdfCache = new Map<string, PDFDocumentProxy>()

export function getCachedPdf(docId: string): PDFDocumentProxy | undefined {
  return pdfCache.get(docId)
}

export type ListMeta = {
  regionCount: number
  lastResult: { wrong: number; total: number } | null   // "12문항 중 3개 틀림"
  pendingGrade: boolean                                 // 필기 있음 + 채점 이력 없음
  fileMissing: boolean
}

type ScrollTarget = { page: number; y?: number; seq: number }

type DocumentState = {
  screen: Screen
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
  showZoneDebug: boolean

  // ---------- 목록 ----------
  loadDocuments: () => Promise<void>
  importPdf: (file: File) => Promise<void>
  attachAnswerPdf: (file: File) => Promise<void>
  skipAnswerPdf: () => Promise<void>
  deleteDocument: (id: string) => Promise<void>
  restoreDocument: (id: string) => Promise<void>
  purgeDocument: (id: string) => Promise<void>
  renameDocument: (id: string, name: string) => Promise<void>

  // ---------- 에디터 ----------
  openDocument: (id: string) => Promise<void>
  closeDocument: () => void
  setVisiblePage: (page: number) => void
  grade: () => Promise<void>
  startResolve: (regionId: string) => Promise<void>
  backToSummary: () => void
  collapseSheet: () => void
  expandSheet: () => void
  toggleReveal: () => void

  // ---------- 정답 (F-05 / F-06) ----------
  openAnswers: () => void
  closeAnswers: () => void
  setAnswer: (regionId: string, value: string | null) => Promise<void>
  importAnswerPdfFile: (file: File) => Promise<number>
  parseInlineKey: (pages: number[]) => Promise<number>
  convertRegionToChoice: (regionId: string) => Promise<void>

  showToast: (msg: string) => void
  showLive: () => void
  closeLive: () => void
  showGallery: () => void
  closeGallery: () => void
  showCompare: () => void
  showGolden: () => void
  closeGolden: () => void
  closeCompare: () => void
  toggleZoneDebug: () => void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useDocumentStore = create<DocumentState>((set, get) => ({
  screen: 'list',
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
  showZoneDebug: false,

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

      const gradable = await hasTextLayer(pdf)

      // 구역 분할은 업로드 시 1회 (F-03)
      let regionCount = 0
      for (let p = 1; p <= pdf.numPages; p++) {
        const lines = await getPageLines(pdf, p)
        const regions = segmentPage(id, p, lines)
        regionCount += regions.length
        await db.putSegments({ docId: id, page: p, regions, segmentVersion: SEGMENT_VERSION })
      }

      const doc: Document = {
        id,
        name: file.name.replace(/\.pdf$/i, ''),
        problemPdfPath: path,
        pageCount: pdf.numPages,
        regionCount,
        thumbnail: await renderThumbnail(pdf),
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
        lastPage: 1,
        gradable: gradable && regionCount > 0,   // 문항 0개면 채점 비활성 (F-03 예외)
      }
      await db.putDocument(doc)

      if (!gradable) {
        get().showToast(
          '이 PDF는 자동 채점을 지원하지 않습니다. 필기는 그대로 사용할 수 있습니다',
        )
      }
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
    if (!docId) return
    set({ answerPdfPromptDocId: null })
    const doc = await db.getDocument(docId)
    if (!doc) return

    if (file.size > MAX_PDF_BYTES) {
      get().showToast('100MB 이하 파일만 올릴 수 있습니다')
      await get().openDocument(docId)
      return
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
    await get().openDocument(docId)
  },

  skipAnswerPdf: async () => {
    const docId = get().answerPdfPromptDocId
    set({ answerPdfPromptDocId: null })
    if (docId) await get().openDocument(docId)
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
    if (!doc) return
    if (get().listMeta[id]?.fileMissing && !pdfCache.has(id)) {
      get().showToast('원본 PDF 파일이 없어 열 수 없습니다')
      return
    }
    if (!pdfCache.has(id)) {
      const data = await readPdfFile(doc.problemPdfPath)
      if (!data) {
        get().showToast('원본 PDF 파일이 없어 열 수 없습니다')
        return
      }
      pdfCache.set(id, await loadPdf(data))
    }
    const pdf = pdfCache.get(id)!

    doc.lastOpenedAt = Date.now()
    await db.putDocument(doc)

    // 세로 연속 스크롤 레이아웃을 위해 전 페이지 비율을 미리 계산한다
    const pageAspects: number[] = []
    const regionsByPage: Record<number, Region[]> = {}
    for (let p = 1; p <= doc.pageCount; p++) {
      const page = await pdf.getPage(p)
      const vp = page.getViewport({ scale: 1 })
      pageAspects.push(vp.height / vp.width)

      const seg = await db.getSegments(id, p)
      if (seg && seg.segmentVersion === SEGMENT_VERSION) {
        regionsByPage[p] = seg.regions
      } else {
        // 알고리즘 버전 불일치 시 재계산 (F-10)
        const lines = await getPageLines(pdf, p)
        const regions = segmentPage(id, p, lines)
        await db.putSegments({ docId: id, page: p, regions, segmentVersion: SEGMENT_VERSION })
        regionsByPage[p] = regions
      }
    }

    // 재분할로 문항 수가 달라졌으면 목록 표시용 카운트 갱신.
    // 문항이 인식됐다는 건 텍스트 레이어가 있다는 뜻 — 과거 빌드에서 잘못 저장된
    // gradable=false도 여기서 복구한다
    const totalRegions = Object.values(regionsByPage).reduce((n, r) => n + r.length, 0)
    const fixGradable = totalRegions > 0 && !doc.gradable
    if (doc.regionCount !== totalRegions || fixGradable) {
      doc.regionCount = totalRegions
      if (fixGradable) doc.gradable = true
      await db.putDocument(doc)
    }

    const attempts = await db.getAttempts(id)
    await useInkStore.getState().setDoc(id)

    set({
      screen: 'editor',
      doc,
      regionsByPage,
      pageAspects,
      attemptsAll: groupByRegion(attempts),
      answerKey: (await db.getAnswerKey(id)) ?? null,
      retryList: (await db.getRetryList(id)) ?? null,
      sheet: attempts.length ? 'pill' : 'hidden',
      resolvingRegionId: null,
      scrollTarget: { page: doc.lastPage, seq: Date.now() },   // 재진입 복원 (F-10)
    })
  },

  closeDocument: () => {
    void db.flushPendingSaves()
    void useInkStore.getState().setDoc(null)
    set({
      screen: 'list',
      doc: null,
      regionsByPage: {},
      pageAspects: [],
      attemptsAll: {},
      answerKey: null,
      retryList: null,
      sheet: 'hidden',
      resolvingRegionId: null,
      scrollTarget: null,
    })
    void get().loadDocuments()
  },

  setVisiblePage: (page) => {
    const { doc } = get()
    if (!doc || doc.lastPage === page) return
    doc.lastPage = page
    db.scheduleSave(`doc:${doc.id}:lastPage`, async () => {
      const current = get().doc
      if (current?.id === doc.id) await db.putDocument({ ...current, lastPage: page })
    })
  },

  grade: async () => {
    const { doc, answerKey, regionsByPage } = get()
    if (!doc || get().grading) return
    if (!doc.gradable) {
      get().showToast('이 PDF는 자동 채점을 지원하지 않습니다')
      return
    }
    // 선행조건: 정답이 1문항 이상 (F-07). 없으면 정답 입력으로 흘려보낸다 (F-05)
    if (!answerKey || answerKey.entries.length === 0) {
      get().showToast('정답이 없습니다. 먼저 정답을 입력해주세요')
      set({ screen: 'answers' })
      return
    }

    set({ grading: true })
    const minDelay = new Promise((r) => setTimeout(r, 1100))   // 시안2 채점 모달 체감 시간
    try {
      await db.flushPendingSaves()
      const rounds = useInkStore.getState().rounds
      const entryOf = new Map(answerKey.entries.map((e) => [e.regionId, e]))
      const gradedAt = Date.now()
      const all: Attempt[] = []

      for (let p = 1; p <= doc.pageCount; p++) {
        const ink = await db.getPageInk(doc.id, p)
        for (const r of regionsByPage[p] ?? []) {
          const no = rounds[r.id] ?? 1
          const strokes = (ink?.strokes ?? []).filter(
            (s) => s.regionId === r.id && s.attemptNo === no,
          )
          all.push(gradeRegion(r, strokes, entryOf.get(r.id), no, gradedAt))
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

  openAnswers: () => set({ screen: 'answers' }),
  closeAnswers: () => set({ screen: 'editor' }),

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

  // 라이브 노트 — 문서 레코드 없이 도는 별도 화면 (liveStore가 상태를 갖는다)
  showLive: () => set({ screen: 'live' }),
  closeLive: () => set({ screen: 'list' }),

  showGallery: () => set({ screen: 'gallery' }),
  closeGallery: () => set({ screen: 'list' }),
  showCompare: () => set({ screen: 'compare' }),
  showGolden: () => set({ screen: 'golden' }),
  closeGolden: () => set({ screen: 'list' }),
  closeCompare: () => set({ screen: 'list' }),
  toggleZoneDebug: () => set((s) => ({ showZoneDebug: !s.showZoneDebug })),
}))

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
