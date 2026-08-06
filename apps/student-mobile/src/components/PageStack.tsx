// 에디터 페이지 스택 (F-04) — 스크롤 셸(PageScroller) 위에 레이어를 얹는다.
import { getCachedPdf, useDocumentStore } from '../stores/documentStore'
import { useInkStore } from '../stores/inkStore'
import { PageScroller } from './PageScroller'
import { PdfCanvas } from './PdfCanvas'
import { InkCanvas } from './InkCanvas'
import { TextLayer } from './TextLayer'
import { AnalysisChip, MarkOverlay } from './MarkOverlay'
import { ZoneDebug } from './ZoneDebug'

export function PageStack() {
  const doc = useDocumentStore((s) => s.doc)
  const pageAspects = useDocumentStore((s) => s.pageAspects)
  const scrollTarget = useDocumentStore((s) => s.scrollTarget)
  const setVisiblePage = useDocumentStore((s) => s.setVisiblePage)
  const loadPage = useInkStore((s) => s.loadPage)

  const pdf = doc ? getCachedPdf(doc.id) : undefined
  if (!doc || !pdf) return null

  return (
    <PageScroller
      pageAspects={pageAspects}
      scrollTarget={scrollTarget}
      onVisiblePage={setVisiblePage}
      onWindow={(first, last) => {
        for (let p = first; p <= last; p++) void loadPage(p)
      }}
      renderPage={(page, { width, height }) => (
        <PageLayers page={page} width={width} height={height} pdf={pdf} />
      )}
    />
  )
}

/**
 * 한 장의 레이어들.
 *
 * 구역을 쪽 단위로 구독하는 이유 — 분석은 펜이 닿은 쪽만 갱신하므로, 스택 전체가
 * regionsByPage를 보면 한 쪽 분석에 보이는 모든 쪽이 다시 그려진다.
 */
function PageLayers({
  page,
  width,
  height,
  pdf,
}: {
  page: number
  width: number
  height: number
  pdf: NonNullable<ReturnType<typeof getCachedPdf>>
}) {
  const regions = useDocumentStore((s) => s.regionsByPage[page]) ?? EMPTY
  const showZoneDebug = useDocumentStore((s) => s.showZoneDebug)
  const analyzePage = useDocumentStore((s) => s.analyzePage)

  return (
    <>
      <PdfCanvas pdf={pdf} page={page} width={width} />
      <InkCanvas
        page={page}
        regions={regions}
        width={width}
        height={height}
        // ★ 펜 접촉이 분석 신호다. 같은 쪽에 몇 번을 대도 한 번만 돈다
        onInkStart={() => void analyzePage(page)}
      />
      <TextLayer page={page} width={width} />
      <MarkOverlay page={page} regions={regions} width={width} height={height} />
      {/* 채점 마크(O·사선) 레이어는 뺐다 — GradeOverlay 컴포넌트는 그대로 남아 있다 */}
      {showZoneDebug && <ZoneDebug regions={regions} width={width} height={height} />}
      <AnalysisChip page={page} />
    </>
  )
}

/** 새 배열을 매번 만들면 구독이 항상 바뀐 것으로 보인다 */
const EMPTY: never[] = []
