// PDF 렌더 레이어 — 캔버스 3겹 중 최하단 (§6.1)
import { useEffect, useRef } from 'react'
import { renderPage, type PDFDocumentProxy } from '../lib/pdf'

type Props = {
  pdf: PDFDocumentProxy
  page: number
  width: number                      // CSS px
  onHeight?: (cssHeight: number) => void
}

export function PdfCanvas({ pdf, page, width, onHeight }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    const canvas = ref.current
    if (!canvas) return
    void renderPage(pdf, page, canvas, width).then(({ cssHeight }) => {
      if (!cancelled) onHeight?.(cssHeight)
    })
    return () => {
      cancelled = true
    }
  }, [pdf, page, width, onHeight])

  return <canvas ref={ref} className="block bg-white" />
}
