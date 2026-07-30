// 필기 상태 — 확정된 스트로크와 문제별 회차를 보관한다.
// 그리는 중인 활성 스트로크는 InkCanvas 로컬(ref)에 있다 — pointermove마다
// 스토어를 갱신하면 리렌더가 프레임을 잡아먹는다.
//
// 회차(F-09)는 전역 카운터가 아니라 문제별이다. 화면에는 각 문제의
// "열람 중 회차"(기본 = 현재 회차)의 스트로크만 보이고, 이전 회차는 숨겨
// 원래 workBox를 다시 쓴다. orphan 스트로크는 항상 보인다.
import { create } from 'zustand'
import type { Region, Stroke, TextItem } from '../types'
import * as db from '../lib/db'
import { attribute } from '../lib/attribution'
import { distToStroke } from '../lib/geometry'

// 스트로크 단위 지우개 히트 반경 (정규화 좌표)
const ERASE_RADIUS = 10

type UndoOp =
  | { type: 'add'; page: number; stroke: Stroke }
  | { type: 'erase'; page: number; strokes: Stroke[] }
  | { type: 'move'; page: number; strokeIds: string[]; dx: number; dy: number }

type InkState = {
  docId: string | null
  strokesByPage: Record<number, Stroke[]>
  textsByPage: Record<number, TextItem[]>
  rounds: Record<string, number>          // regionId → 현재 회차
  viewRounds: Record<string, number>      // regionId → 열람 중 회차 (칩 전환, UI 한정)
  revealRegionId: string | null           // 재풀이 중 "지난 풀이 보기" 대상
  undoStack: UndoOp[]                     // 세션 한정 실행취소
  redoStack: UndoOp[]                     // 새 조작이 들어오면 비운다
  histSeq: number                         // undo/redo 실행 횟수 — 선택 해제 신호용

  setDoc: (docId: string | null) => Promise<void>
  loadPage: (page: number) => Promise<void>
  roundOf: (regionId: string | null) => number
  reattributePage: (page: number, regions: Region[]) => void
  commitStroke: (page: number, stroke: Stroke) => void
  eraseAt: (page: number, x: number, y: number) => void
  moveStrokes: (page: number, strokeIds: string[], dx: number, dy: number) => void
  deleteStrokes: (page: number, strokeIds: string[]) => void
  upsertText: (page: number, item: TextItem) => void
  deleteText: (page: number, id: string) => void
  undo: () => void
  redo: () => void
  bumpRound: (regionIds: string[]) => Promise<void>
  setViewRound: (regionId: string, no: number | null) => void
  setReveal: (regionId: string | null) => void
}

/** 화면·지우개가 공유하는 표시 규칙 */
export function isStrokeVisible(
  s: Stroke,
  rounds: Record<string, number>,
  viewRounds: Record<string, number>,
  revealRegionId: string | null,
): boolean {
  if (!s.regionId) return true                       // orphan은 항상 표시
  if (revealRegionId === s.regionId) return true     // 지난 풀이 보기
  const shown = viewRounds[s.regionId] ?? rounds[s.regionId] ?? 1
  return s.attemptNo === shown
}

export const useInkStore = create<InkState>((set, get) => ({
  docId: null,
  strokesByPage: {},
  textsByPage: {},
  rounds: {},
  viewRounds: {},
  revealRegionId: null,
  undoStack: [],
  redoStack: [],
  histSeq: 0,

  setDoc: async (docId) => {
    set({
      docId,
      strokesByPage: {},
      textsByPage: {},
      rounds: {},
      viewRounds: {},
      revealRegionId: null,
      undoStack: [],
      redoStack: [],
    })
    if (docId) {
      const state = await db.getAttemptState(docId)
      if (get().docId === docId) set({ rounds: state?.byRegion ?? {} })
    }
  },

  loadPage: async (page) => {
    const { docId, strokesByPage } = get()
    if (!docId || strokesByPage[page]) return
    const ink = await db.getPageInk(docId, page)
    set((s) => ({
      strokesByPage: { ...s.strokesByPage, [page]: ink?.strokes ?? [] },
      textsByPage: { ...s.textsByPage, [page]: ink?.texts ?? [] },
    }))
  },

  roundOf: (regionId) => (regionId ? (get().rounds[regionId] ?? 1) : 1),

  /**
   * 이 쪽의 획을 지금 구역에 다시 귀속시킨다 — 분석이 끝난 직후에 부른다.
   *
   * 구역은 펜이 닿은 뒤에 나오므로 첫 획은 주인 없이 확정된다 (regionId = null).
   * 그대로 두면 그 획은 영원히 orphan이라 채점에서 빠지고, 재풀이 때 가려지지도 않는다.
   * 살아 있는 구역에 이미 귀속된 획은 건드리지 않는다 — 다시 분석해 id가 바뀐 구역을
   * 가리키던 획만 새 주인을 찾는다.
   */
  reattributePage: (page, regions) => {
    const { docId, strokesByPage } = get()
    const strokes = docId ? strokesByPage[page] : undefined
    if (!docId || !strokes?.length) return
    const alive = new Set(regions.map((r) => r.id))

    let changed = false
    const next = strokes.map((s) => {
      if (s.regionId && alive.has(s.regionId)) return s
      const regionId = attribute(s, regions)
      if (regionId === s.regionId) return s
      changed = true
      // 회차는 새 주인의 현재 회차 — 그 문항을 풀던 중에 그은 획이다 (F-09)
      return { ...s, regionId, attemptNo: regionId ? (get().rounds[regionId] ?? 1) : s.attemptNo }
    })
    if (!changed) return

    set((s) => ({ strokesByPage: { ...s.strokesByPage, [page]: next } }))
    schedulePageSave(get, docId, page)
  },

  commitStroke: (page, stroke) => {
    const { docId } = get()
    if (!docId) return
    set((s) => ({
      strokesByPage: {
        ...s.strokesByPage,
        [page]: [...(s.strokesByPage[page] ?? []), stroke],
      },
      undoStack: [...s.undoStack, { type: 'add', page, stroke }],
      redoStack: [],
    }))
    schedulePageSave(get, docId, page)
  },

  eraseAt: (page, x, y) => {
    const { strokesByPage, rounds, viewRounds, revealRegionId } = get()
    // 보이는 스트로크만 지운다 — 숨겨진 이전 회차를 건드리면 안 된다
    const hit = (strokesByPage[page] ?? []).filter(
      (s) =>
        isStrokeVisible(s, rounds, viewRounds, revealRegionId) &&
        distToStroke(x, y, s.points) < ERASE_RADIUS,
    )
    if (hit.length) get().deleteStrokes(page, hit.map((s) => s.id))
  },

  moveStrokes: (page, strokeIds, dx, dy) => {
    const { docId } = get()
    if (!docId || !strokeIds.length || (dx === 0 && dy === 0)) return
    set((s) => ({
      strokesByPage: {
        ...s.strokesByPage,
        [page]: (s.strokesByPage[page] ?? []).map((st) =>
          strokeIds.includes(st.id) ? translateStroke(st, dx, dy) : st,
        ),
      },
      undoStack: [...s.undoStack, { type: 'move', page, strokeIds, dx, dy }],
      redoStack: [],
    }))
    schedulePageSave(get, docId, page)
  },

  deleteStrokes: (page, strokeIds) => {
    const { docId, strokesByPage } = get()
    if (!docId || !strokeIds.length) return
    const idSet = new Set(strokeIds)
    const removed = (strokesByPage[page] ?? []).filter((s) => idSet.has(s.id))
    if (!removed.length) return
    set((s) => ({
      strokesByPage: {
        ...s.strokesByPage,
        [page]: (s.strokesByPage[page] ?? []).filter((st) => !idSet.has(st.id)),
      },
      undoStack: [...s.undoStack, { type: 'erase', page, strokes: removed }],
      redoStack: [],
    }))
    schedulePageSave(get, docId, page)
  },

  upsertText: (page, item) => {
    const { docId } = get()
    if (!docId) return
    set((s) => {
      const texts = s.textsByPage[page] ?? []
      const i = texts.findIndex((t) => t.id === item.id)
      const next = i >= 0 ? texts.map((t) => (t.id === item.id ? item : t)) : [...texts, item]
      return { textsByPage: { ...s.textsByPage, [page]: next } }
    })
    schedulePageSave(get, docId, page)
  },

  deleteText: (page, id) => {
    const { docId } = get()
    if (!docId) return
    set((s) => ({
      textsByPage: {
        ...s.textsByPage,
        [page]: (s.textsByPage[page] ?? []).filter((t) => t.id !== id),
      },
    }))
    schedulePageSave(get, docId, page)
  },

  undo: () => {
    const { docId, undoStack } = get()
    if (!docId || !undoStack.length) return
    const op = undoStack[undoStack.length - 1]
    set((s) => ({
      strokesByPage: { ...s.strokesByPage, [op.page]: applyOp(s.strokesByPage[op.page] ?? [], op, true) },
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, op],
      histSeq: s.histSeq + 1,
    }))
    schedulePageSave(get, docId, op.page)
  },

  redo: () => {
    const { docId, redoStack } = get()
    if (!docId || !redoStack.length) return
    const op = redoStack[redoStack.length - 1]
    set((s) => ({
      strokesByPage: { ...s.strokesByPage, [op.page]: applyOp(s.strokesByPage[op.page] ?? [], op, false) },
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, op],
      histSeq: s.histSeq + 1,
    }))
    schedulePageSave(get, docId, op.page)
  },

  bumpRound: async (regionIds) => {
    const { docId } = get()
    if (!docId || !regionIds.length) return
    const rounds = { ...get().rounds }
    for (const id of regionIds) rounds[id] = (rounds[id] ?? 1) + 1
    set({ rounds })
    await db.putAttemptState({ docId, byRegion: rounds })
  },

  setViewRound: (regionId, no) =>
    set((s) => {
      const viewRounds = { ...s.viewRounds }
      if (no === null) delete viewRounds[regionId]
      else viewRounds[regionId] = no
      return { viewRounds }
    }),

  setReveal: (regionId) => set({ revealRegionId: regionId }),
}))

function translateStroke(s: Stroke, dx: number, dy: number): Stroke {
  return { ...s, points: s.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) }
}

/** 조작 1건을 적용한다. invert=true면 역방향(실행취소) */
function applyOp(strokes: Stroke[], op: UndoOp, invert: boolean): Stroke[] {
  switch (op.type) {
    case 'add':
      return invert
        ? strokes.filter((st) => st.id !== op.stroke.id)
        : [...strokes, op.stroke]
    case 'erase':
      return invert
        ? [...strokes, ...op.strokes]
        : strokes.filter((st) => !op.strokes.some((r) => r.id === st.id))
    case 'move': {
      const dx = invert ? -op.dx : op.dx
      const dy = invert ? -op.dy : op.dy
      return strokes.map((st) => (op.strokeIds.includes(st.id) ? translateStroke(st, dx, dy) : st))
    }
  }
}

// 저장 단위는 페이지, 1초 디바운스 (§8). 실행 시점의 최신 상태를 쓴다.
function schedulePageSave(get: () => InkState, docId: string, page: number) {
  db.scheduleSave(`ink:${docId}:${page}`, async () => {
    const strokes = get().strokesByPage[page]
    if (get().docId !== docId || !strokes) return
    await db.putPageInk({ docId, page, strokes, texts: get().textsByPage[page] ?? [] })
  })
}
