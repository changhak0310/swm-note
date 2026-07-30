// 세로 연속 스크롤 셸 (§6.1, F-04) — 페이지 레이아웃·윈도잉·손가락 스크롤·핀치 확대.
// 페이지 위에 무엇을 올릴지는 renderPage가 정한다 — 에디터(PageStack)와 dev 화면들이
// 이 셸을 공유한다.
//
// 펜=필기, 손=스크롤·확대. 모드 전환 UI는 없다.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { touchScrollBlocked } from '../lib/penState'

const PAGE_GAP = 24
const MIN_ZOOM = 0.6
const MAX_ZOOM = 2.2

export type ScrollTarget = { page: number; y?: number; seq: number }

type Props = {
  /** 페이지별 h/w 비율. 길이가 곧 페이지 수다 */
  pageAspects: number[]
  renderPage: (page: number, size: { width: number; height: number }) => ReactNode
  /** 보이는 첫 페이지가 바뀔 때 */
  onVisiblePage?: (page: number) => void
  /** 렌더 윈도(보이는 범위 ±1)가 바뀔 때 — 잉크 선로드용. 1-based, 양끝 포함 */
  onWindow?: (first: number, last: number) => void
  scrollTarget?: ScrollTarget | null
}

export function PageScroller({
  pageAspects,
  renderPage,
  onVisiblePage,
  onWindow,
  scrollTarget,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerW, setContainerW] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [gestureScale, setGestureScale] = useState(1)
  const [range, setRange] = useState<[number, number]>([1, 2])

  // 콜백은 매 렌더 새로 오므로 ref로 받는다 — 윈도 계산 effect가 콜백 때문에 다시 돌지 않게
  const cb = useRef({ onVisiblePage, onWindow })
  cb.current = { onVisiblePage, onWindow }

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
    let last = 1
    for (let i = 0; i < tops.length; i++) {
      if (tops[i] < bottom) last = i + 1
    }
    const first = tops.findIndex((t, i) => t + pageW * pageAspects[i] > top) + 1 || 1
    // 같은 윈도면 참조를 유지한다 — 스크롤 프레임마다 리렌더·선로드가 돌지 않게
    setRange((prev) => (prev[0] === first && prev[1] === last ? prev : [first, last]))
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

  useEffect(() => {
    cb.current.onVisiblePage?.(range[0])
    cb.current.onWindow?.(Math.max(1, range[0] - 1), Math.min(pageAspects.length, range[1] + 1))
  }, [range, pageAspects.length])

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
              {inWindow && renderPage(page, { width: pageW, height: h })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
