// 필기 레이어 (§6.2, §6.3, F-04)
// 확정 레이어: 보이는 스트로크 전부 — 변경 시 1회 갱신
// 활성 레이어: 지금 그리는 스트로크 하나·올가미 경로·선택 표시 — pointermove마다 갱신
// 펜·마우스 = 필기·지우개, 손가락 = 스크롤·핀치(PageStack이 버블링으로 처리).
// 단 '손가락 필기'를 켜면 한 손가락도 필기 — 두 번째 손가락이 닿으면 획을 버리고 핀치로 넘긴다
import { useEffect, useRef, useState } from 'react'
import type { Box, Point, Region, Stroke, StrokeTool } from '../types'
import { MAX_W, expand, pointInBox, pointInPolygon, toNorm } from '../lib/geometry'
import { attribute } from '../lib/attribution'
import { penState } from '../lib/penState'
import { isStrokeVisible, useInkStore } from '../stores/inkStore'
import { COLOR_HEX, useToolStore } from '../stores/toolStore'

const PEN_BASE_WIDTH = 2.4        // 정규화 좌표계 기준
const HI_WIDTH = 14
const HI_COLOR = 'rgba(255, 208, 0, 0.38)'
const LASSO_MIN_INSIDE = 0.5      // 스트로크 점의 이 비율 이상이 올가미 안이면 선택

type Props = {
  page: number
  regions: Region[]
  width: number
  height: number
}

type Selection = { ids: string[]; bbox: Box }

export function InkCanvas({ page, regions, width, height }: Props) {
  const committedRef = useRef<HTMLCanvasElement>(null)
  const activeRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef<Point[] | null>(null)
  const erasing = useRef(false)
  const activePointerId = useRef<number | null>(null)   // 한 번에 한 획만
  const lassoPath = useRef<Point[] | null>(null)
  const dragStart = useRef<Point | null>(null)
  const dragDelta = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 })

  const [selection, setSelection] = useState<Selection | null>(null)
  const [draggingSel, setDraggingSel] = useState(false)

  const strokes = useInkStore((s) => s.strokesByPage[page])
  const rounds = useInkStore((s) => s.rounds)
  const viewRounds = useInkStore((s) => s.viewRounds)
  const revealRegionId = useInkStore((s) => s.revealRegionId)
  const tool = useToolStore((s) => s.tool)

  const k = width / MAX_W
  const dpr = window.devicePixelRatio || 1

  // 확정 레이어 — 표시 규칙(회차·열람·orphan)을 통과한 스트로크만.
  // 선택 이동 중에는 선택된 획을 활성 레이어가 그리므로 여기서 뺀다
  useEffect(() => {
    const ctx = setupCanvas(committedRef.current, width, height, dpr)
    if (!ctx) return
    const hidden = draggingSel && selection ? new Set(selection.ids) : null
    for (const s of strokes ?? []) {
      if (hidden?.has(s.id)) continue
      if (!isStrokeVisible(s, rounds, viewRounds, revealRegionId)) continue
      drawStroke(ctx, s.points, k * dpr, s.tool ?? 'pen', s.color ?? COLOR_HEX.blue)
    }
  }, [strokes, rounds, viewRounds, revealRegionId, width, height, k, dpr, draggingSel, selection])

  useEffect(() => {
    setupCanvas(activeRef.current, width, height, dpr)
  }, [width, height, dpr])

  // 도구가 바뀌거나 실행취소·다시실행이 일어나면 선택 해제
  const histSeq = useInkStore((s) => s.histSeq)
  useEffect(() => {
    setSelection(null)
    lassoPath.current = null
    clearActive()
  }, [tool, histSeq])

  // 선택 표시 (이동 중이 아닐 때) — 활성 레이어에 점선 테두리
  useEffect(() => {
    if (draggingSel) return
    clearActive()
    if (selection) drawSelectionBox(activeRef.current, selection.bbox, k * dpr)
  }, [selection, draggingSel, k, dpr, width, height])

  const clearActive = () => {
    const cv = activeRef.current
    cv?.getContext('2d')?.clearRect(0, 0, cv.width, cv.height)
  }

  const normPoint = (e: { clientX: number; clientY: number; pressure?: number; timeStamp: number }): Point => {
    const rect = activeRef.current!.getBoundingClientRect()
    const { x, y } = toNorm(e.clientX, e.clientY, rect)
    return { x, y, p: e.pressure || 0.5, t: e.timeStamp }
  }

  const isInkPointer = (e: React.PointerEvent) =>
    e.pointerType === 'pen' ||
    e.pointerType === 'mouse' ||                    // 마우스는 손바닥일 수 없다 — 항상 허용
    (e.pointerType === 'touch' && useToolStore.getState().fingerDraw)

  const cancelActive = () => {
    drawing.current = null
    erasing.current = false
    lassoPath.current = null
    dragStart.current = null
    activePointerId.current = null
    penState.active = false
    setDraggingSel(false)
    clearActive()
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'text') return                     // 텍스트 레이어가 받는다
    if (!isInkPointer(e)) return                    // 손가락은 PageStack이 스크롤로 받는다
    if (activePointerId.current !== null) {
      cancelActive()                                // 두 번째 접촉 = 핀치 의도 — 진행 중 획 폐기
      return
    }
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    activePointerId.current = e.pointerId
    penState.active = true
    const p = normPoint(e)

    if (tool === 'lasso') {
      if (selection && pointInBox(p.x, p.y, expand(selection.bbox, 8))) {
        dragStart.current = p                       // 선택 영역 잡고 이동 시작
        dragDelta.current = { dx: 0, dy: 0 }
        setDraggingSel(true)
      } else {
        setSelection(null)
        lassoPath.current = [p]
      }
      return
    }
    if (tool === 'eraser') {
      erasing.current = true
      useInkStore.getState().eraseAt(page, p.x, p.y)
    } else {
      drawing.current = [p]
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId !== activePointerId.current) return
    if (!isInkPointer(e) || e.buttons === 0) return
    e.stopPropagation()

    if (dragStart.current) {                        // 선택 이동 미리보기
      const p = normPoint(e)
      dragDelta.current = { dx: p.x - dragStart.current.x, dy: p.y - dragStart.current.y }
      previewSelectionMove()
      return
    }
    if (lassoPath.current) {                        // 올가미 경로
      lassoPath.current.push(normPoint(e))
      clearActive()
      drawLassoPath(activeRef.current, lassoPath.current, k * dpr)
      return
    }
    if (erasing.current) {
      const p = normPoint(e)
      useInkStore.getState().eraseAt(page, p.x, p.y)
      return
    }
    if (!drawing.current) return
    const native = e.nativeEvent
    const events = native.getCoalescedEvents?.() ?? [native]   // 중간 좌표 손실 방지 (§6.3)
    for (const ev of events) drawing.current.push(normPoint(ev))

    const cv = activeRef.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    ctx.clearRect(0, 0, cv.width, cv.height)
    const { tool: t, color } = useToolStore.getState()
    drawStroke(ctx, drawing.current, k * dpr, t === 'hi' ? 'hi' : 'pen', COLOR_HEX[color])
  }

  const previewSelectionMove = () => {
    const cv = activeRef.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx || !selection) return
    const { dx, dy } = dragDelta.current
    ctx.clearRect(0, 0, cv.width, cv.height)
    const sel = new Set(selection.ids)
    for (const s of strokes ?? []) {
      if (!sel.has(s.id)) continue
      const moved = s.points.map((pt) => ({ ...pt, x: pt.x + dx, y: pt.y + dy }))
      drawStroke(ctx, moved, k * dpr, s.tool ?? 'pen', s.color ?? COLOR_HEX.blue)
    }
    drawSelectionBox(cv, { ...selection.bbox, x: selection.bbox.x + dx, y: selection.bbox.y + dy }, k * dpr)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId !== activePointerId.current) return
    if (!isInkPointer(e)) return
    activePointerId.current = null
    penState.active = false
    penState.lastUpAt = Date.now()

    if (dragStart.current) {                        // 선택 이동 확정
      const { dx, dy } = dragDelta.current
      dragStart.current = null
      setDraggingSel(false)
      if (selection && (dx !== 0 || dy !== 0)) {
        useInkStore.getState().moveStrokes(page, selection.ids, dx, dy)
        setSelection({ ids: selection.ids, bbox: { ...selection.bbox, x: selection.bbox.x + dx, y: selection.bbox.y + dy } })
      }
      return
    }
    if (lassoPath.current) {                        // 올가미 확정 → 선택 계산
      const path = lassoPath.current
      lassoPath.current = null
      clearActive()
      if (path.length >= 3) {
        const picked = (strokes ?? []).filter(
          (s) =>
            isStrokeVisible(s, rounds, viewRounds, revealRegionId) &&
            insideRatio(s.points, path) >= LASSO_MIN_INSIDE,
        )
        setSelection(picked.length ? { ids: picked.map((s) => s.id), bbox: strokesBBox(picked) } : null)
      }
      return
    }
    if (erasing.current) {
      erasing.current = false
      return
    }
    const points = drawing.current
    drawing.current = null
    clearActive()
    if (!points || points.length < 2) return

    const ink = useInkStore.getState()
    const { tool: t, color } = useToolStore.getState()
    const stroke: Stroke = {
      id: crypto.randomUUID(),
      regionId: null,
      attemptNo: 1,
      tool: (t === 'hi' ? 'hi' : 'pen') as StrokeTool,
      color: COLOR_HEX[color],
      points,
    }
    // 귀속은 pointerup에서 1회만, 회차는 귀속된 문제의 현재 회차 (F-04·F-09)
    stroke.regionId = attribute(stroke, regions)
    stroke.attemptNo = ink.roundOf(stroke.regionId)
    ink.commitStroke(page, stroke)
  }

  const deleteSelection = () => {
    if (!selection) return
    useInkStore.getState().deleteStrokes(page, selection.ids)
    setSelection(null)
  }

  return (
    <div className="absolute inset-0" style={{ touchAction: 'none' }}>
      <canvas ref={committedRef} className="absolute inset-0" />
      <canvas
        ref={activeRef}
        className="absolute inset-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {selection && !draggingSel && (
        <button
          onClick={deleteSelection}
          className="absolute z-10 rounded-full bg-[var(--ink-800)] px-4 py-1.5 text-[13px] font-semibold text-white shadow-[var(--shadow-md)]"
          style={{
            left: Math.max(4, (selection.bbox.x + selection.bbox.w) * k - 52),
            top: Math.max(4, selection.bbox.y * k - 42),
          }}
        >
          삭제
        </button>
      )}
    </div>
  )
}

/** 스트로크 점 중 다각형 내부 비율 */
function insideRatio(pts: Point[], poly: Point[]): number {
  if (!pts.length) return 0
  let n = 0
  for (const p of pts) if (pointInPolygon(p.x, p.y, poly)) n++
  return n / pts.length
}

function strokesBBox(list: Stroke[]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const s of list)
    for (const p of s.points) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function drawLassoPath(canvas: HTMLCanvasElement | null, pts: Point[], k: number) {
  const ctx = canvas?.getContext('2d')
  if (!ctx || pts.length < 2) return
  ctx.save()
  ctx.strokeStyle = '#26A65E'
  ctx.lineWidth = 1.5 * k
  ctx.setLineDash([6 * k, 5 * k])
  ctx.beginPath()
  ctx.moveTo(pts[0].x * k, pts[0].y * k)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * k, pts[i].y * k)
  ctx.stroke()
  ctx.restore()
}

function drawSelectionBox(canvas: HTMLCanvasElement | null, bbox: Box, k: number) {
  const ctx = canvas?.getContext('2d')
  if (!ctx) return
  const pad = 6
  ctx.save()
  ctx.strokeStyle = '#26A65E'
  ctx.lineWidth = 1.5 * k
  ctx.setLineDash([7 * k, 5 * k])
  ctx.strokeRect((bbox.x - pad) * k, (bbox.y - pad) * k, (bbox.w + pad * 2) * k, (bbox.h + pad * 2) * k)
  ctx.restore()
}

function setupCanvas(
  canvas: HTMLCanvasElement | null,
  width: number,
  height: number,
  dpr: number,
): CanvasRenderingContext2D | null {
  if (!canvas) return null
  canvas.width = Math.floor(width * dpr)     // 백킹 스토어는 DPR 반영 (§5)
  canvas.height = Math.floor(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  return canvas.getContext('2d')
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  pts: Point[],
  k: number,
  tool: StrokeTool,
  color: string,
) {
  if (pts.length === 0) return
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (tool === 'hi') {
    // 형광펜은 알파가 겹치면 얼룩지므로 한 획을 단일 패스로 그린다
    ctx.strokeStyle = HI_COLOR
    ctx.lineWidth = HI_WIDTH * k
    ctx.beginPath()
    ctx.moveTo(pts[0].x * k, pts[0].y * k)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * k, pts[i].y * k)
    ctx.stroke()
    return
  }
  // 필압 기반 굵기 — pressure 가정이 깨지면 균일 굵기로 교체 (§6.4)
  ctx.strokeStyle = color
  for (let i = 1; i < pts.length; i++) {
    ctx.beginPath()
    ctx.moveTo(pts[i - 1].x * k, pts[i - 1].y * k)
    ctx.lineTo(pts[i].x * k, pts[i].y * k)
    ctx.lineWidth = PEN_BASE_WIDTH * (0.5 + pts[i].p) * k
    ctx.stroke()
  }
}
