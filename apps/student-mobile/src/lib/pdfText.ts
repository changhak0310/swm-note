// 페이지 텍스트 추출 — pdf.js 워커 배선과 분리된 순수 경로 (§7.3)
//
// pdf.ts는 이 모듈을 감싸 워커를 붙인다. 분리해 둔 이유는 Node(테스트·벤치마크)에서
// 워커 없이 같은 추출 코드를 그대로 돌리기 위해서다 — 비교 대상이 코드 경로까지 같아야 한다.
import { MAX_W } from './geometry'
import { isRotatedQuarter, toViewportPoint, type ViewportLike } from './pdfCoords'
import type { Box } from '../types'

export type TextToken = { str: string; box: Box }
export type TextLine = { text: string; tokens: TextToken[] }

type PageLike = {
  getViewport(o: { scale: number }): ViewportLike
  getTextContent(): Promise<{ items: unknown[] }>
}

/**
 * 페이지 텍스트를 정규화 좌표(MAX_W 기준)의 토큰으로 뽑고, 같은 줄 글자를 이어 붙인다.
 * PDF는 글자를 조각내서 주므로("[3점]" → "[","3","점","]") 줄 단위 결합이 전제다.
 */
export async function extractLines(page: PageLike): Promise<TextLine[]> {
  const base = page.getViewport({ scale: 1 })
  const f = MAX_W / base.width
  const content = await page.getTextContent()

  const swap = isRotatedQuarter(base)
  const tokens: TextToken[] = []
  for (const raw of content.items) {
    const item = raw as { str?: string; height: number; width: number; transform: number[] }
    if (typeof item.str !== 'string' || item.str.trim() === '') continue
    // ★ 좌표 변환은 뷰포트 행렬이 한다 — CropBox 원점이 0이 아닌 PDF가 있다 (pdfCoords.ts)
    const [vx, vy] = toViewportPoint(base, item.transform[4], item.transform[5])
    const w = (swap ? item.height : item.width) * f
    const h = (swap ? item.width : item.height) * f
    tokens.push({
      str: item.str,
      // vy는 글자의 밑선이다 — 위끝으로 올린다
      box: { x: vx * f, y: vy * f - h, w, h },
    })
  }

  // 세로 중심이 가까운 토큰끼리 줄로 묶는다
  const sorted = tokens.sort((a, b) => a.box.y + a.box.h / 2 - (b.box.y + b.box.h / 2))
  const lines: TextLine[] = []
  let current: TextToken[] = []
  for (const t of sorted) {
    const prev = current[current.length - 1]
    const sameLine =
      prev &&
      Math.abs(t.box.y + t.box.h / 2 - (prev.box.y + prev.box.h / 2)) <
        Math.max(t.box.h, prev.box.h) * 0.6
    if (sameLine) current.push(t)
    else {
      if (current.length) pushLine(lines, current)
      current = [t]
    }
  }
  if (current.length) pushLine(lines, current)
  return lines
}

function pushLine(lines: TextLine[], tokens: TextToken[]) {
  tokens.sort((a, b) => a.box.x - b.box.x)
  lines.push({ text: tokens.map((t) => t.str).join(''), tokens })
}
