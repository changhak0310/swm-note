// 페이지 스택 (F-04) — 세로 연속 스크롤, 보이는 페이지 ±1만 렌더 (§6.1),
// 손가락 스크롤·핀치 확대는 수동 처리 (펜=필기, 손=스크롤·확대, 모드 전환 UI 없음)
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getCachedPdf, useDocumentStore } from '../stores/documentStore'
import { useInkStore } from '../stores/inkStore'
import { touchScrollBlocked } from '../lib/penState'
import { PdfCanvas } from './PdfCanvas'
import { InkCanvas } from './InkCanvas'
import { TextLayer } from './TextLayer'
import { GradeOverlay } from './GradeOverlay'
import { ZoneDebug } from './ZoneDebug'

const PAGE_GAP = 24
const MIN_ZOOM = 0.6
const MAX_ZOOM = 2.2

export function PageStack() {
  const doc = useDocumentStore((s) => s.doc)
  const pageAspects = useDocumentStore((s) => s.pageAspects)
  const regionsByPage = useDocumentStore((s) => s.regionsByPage)
  const scrollTarget = useDocumentStore((s) => s.scrollTarget)
  const showZoneDebug = useDocumentStore((s) => s.showZoneDebug)
  const setVisiblePage = useDocumentStore((s) => s.setVisiblePage)

  const containerRef = useRef<HTMLDivElement>(null)
  const [containerW, setContainerW] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [gestureScale, setGestureScale] = useState(1)
  const [range, setRange] = useState<[number, number]>([1, 2])

  // 손가락 제스처 추적
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinchStart = useRef<{ dist: number; zoom: number } | null>(null)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setContainerW(el.clientWidth))
    ro.observe(el)
    setContainerW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const pageW = Math.max(320, Math.min(containerW - 48, 900)) * zoom

  // 페이지 상단 오프셋 누적 (윈도잉·스크롤 복원용)
  const tops = useMemo(() => {
    const arr: number[] = []
    let y = PAGE_GAP
    for (const aspect of pageAspects) {
      arr.push(y)
      y += pageW * aspect + PAGE_GAP
    }
    return arr
  }, [pageAspects, pageW])

  const totalH = tops.length
    ? tops[tops.length - 1] + pageW * pageAspects[pageAspects.length - 1] + PAGE_GAP
    : 0

  const updateRange = () => {
    const el = containerRef.current
    if (!el || !tops.length) return
    const top = el.scrollTop
    const bottom = top + el.clientHeight
    let first = 1
    let last = 1
    for (let i = 0; i < tops.length; i++) {
      const pageBottom = tops[i] + pageW * pageAspects[i]
      if (pageBottom > top && first === 1 && tops[i] < top) first = i + 1
      if (tops[i] < bottom) last = i + 1
    }
    // 첫 보이는 페이지 재계산 (위 루프의 경계 케이스 보정)
    first = tops.findIndex((t, i) => t + pageW * pageAspects[i] > top) + 1 || 1
    setRange([first, last])
    setVisiblePage(first)
  }

  const rafPending = useRef(false)
  const onScroll = () => {
    if (rafPending.current) return
    rafPending.current = true
    requestAnimationFrame(() => {
      rafPending.current = false
      updateRange()
    })
  }

  // 컨테이너 폭·줌 변동 시 윈도 재계산
  useEffect(() => {
    updateRange()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageW, pageAspects])

  // 재진입·재풀이 스크롤 타깃 (F-10, 시안2 resolve)
  const consumedTarget = useRef(0)
  useEffect(() => {
    if (!scrollTarget || scrollTarget.seq === consumedTarget.current) return
    const el = containerRef.current
    if (!el || !tops.length) return
    consumedTarget.current = scrollTarget.seq
    const pageTop = tops[scrollTarget.page - 1] ?? 0
    const k = pageW / 760
    const y = pageTop + (scrollTarget.y ? scrollTarget.y * k - 40 : -8)
    el.scrollTo({ top: Math.max(0, y), behavior: scrollTarget.y ? 'smooth' : 'auto' })
  }, [scrollTarget, tops, pageW])

  // 윈도 내 페이지 잉크 로드
  const loadPage = useInkStore((s) => s.loadPage)
  useEffect(() => {
    for (let p = range[0] - 1; p <= range[1] + 1; p++) {
      if (p >= 1 && p <= pageAspects.length) void loadPage(p)
    }
  }, [range, pageAspects.length, loadPage])

  // ---------- 손가락 스크롤·핀치 (수동) ----------
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()]
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch' || !touches.current.has(e.pointerId)) return
    const prev = touches.current.get(e.pointerId)!
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (touches.current.size === 2 && pinchStart.current) {
      const [a, b] = [...touches.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      setGestureScale(
        Math.max(
          MIN_ZOOM / pinchStart.current.zoom,
          Math.min(MAX_ZOOM / pinchStart.current.zoom, dist / pinchStart.current.dist),
        ),
      )
      // 두 손가락 팬 — 손가락 필기 중에도 스크롤할 수 있게 (centroid 이동의 절반씩 기여)
      containerRef.current?.scrollBy(0, (prev.y - e.clientY) / 2)
    } else if (touches.current.size === 1) {
      if (touchScrollBlocked()) return              // 팜 리젝션 (F-04)
      containerRef.current?.scrollBy(0, prev.y - e.clientY)
    }
  }

  const onPointerEnd = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return
    touches.current.delete(e.pointerId)
    if (touches.current.size < 2 && pinchStart.current) {
      // 제스처 종료 — 줌 확정 후 확대 배율로 다시 렌더 (§5 뭉개짐 방지)
      const committed = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, pinchStart.current.zoom * gestureScale),
      )
      pinchStart.current = null
      setGestureScale(1)
      setZoom(committed)
    }
  }

  const pdf = doc ? getCachedPdf(doc.id) : undefined
  if (!doc || !pdf) return null

  return (
    <div
      ref={containerRef}
      className="puri-scroll flex-1 overflow-y-auto bg-[var(--ink-50)]"
      style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
      onScroll={onScroll}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <div
        className="relative mx-auto"
        style={{
          width: pageW,
          height: totalH,
          transform: gestureScale !== 1 ? `scale(${gestureScale})` : undefined,
          transformOrigin: 'top center',
        }}
      >
        {pageAspects.map((aspect, i) => {
          const page = i + 1
          const h = pageW * aspect
          const inWindow = page >= range[0] - 1 && page <= range[1] + 1
          return (
            <div
              key={page}
              className="absolute left-0 border border-[var(--border-subtle)] bg-[var(--paper)] shadow-[var(--shadow-sm)]"
              style={{ top: tops[i], width: pageW, height: h }}
            >
              {inWindow && (
                <>
                  <PdfCanvas pdf={pdf} page={page} width={pageW} />
                  <InkCanvas
                    page={page}
                    regions={regionsByPage[page] ?? []}
                    width={pageW}
                    height={h}
                  />
                  <TextLayer page={page} width={pageW} />
                  <GradeOverlay regions={regionsByPage[page] ?? []} width={pageW} height={h} />
                  {showZoneDebug && (
                    <ZoneDebug regions={regionsByPage[page] ?? []} width={pageW} height={h} />
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
