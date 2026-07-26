// 에디터 페이지 스택 (F-04) — 스크롤 셸(PageScroller) 위에 3겹 레이어를 얹는다.
import { getCachedPdf, useDocumentStore } from '../stores/documentStore'
import { useInkStore } from '../stores/inkStore'
import { PageScroller } from './PageScroller'
import { PdfCanvas } from './PdfCanvas'
import { InkCanvas } from './InkCanvas'
import { TextLayer } from './TextLayer'
import { GradeOverlay } from './GradeOverlay'
import { ZoneDebug } from './ZoneDebug'

export function PageStack() {
  const doc = useDocumentStore((s) => s.doc)
  const pageAspects = useDocumentStore((s) => s.pageAspects)
  const regionsByPage = useDocumentStore((s) => s.regionsByPage)
  const scrollTarget = useDocumentStore((s) => s.scrollTarget)
  const showZoneDebug = useDocumentStore((s) => s.showZoneDebug)
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
        <>
          <PdfCanvas pdf={pdf} page={page} width={width} />
          <InkCanvas
            page={page}
            regions={regionsByPage[page] ?? []}
            width={width}
            height={height}
          />
          <TextLayer page={page} width={width} />
          <GradeOverlay regions={regionsByPage[page] ?? []} width={width} height={height} />
          {showZoneDebug && (
            <ZoneDebug regions={regionsByPage[page] ?? []} width={width} height={height} />
          )}
        </>
      )}
    />
  )
}
