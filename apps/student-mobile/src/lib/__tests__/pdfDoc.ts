// 실측 테스트가 PDF를 여는 한 가지 방법.
//
// ★ 앱(lib/pdf.ts loadPdf)과 **같은 옵션으로 열어야 한다.** CMap을 안 넘기면 미리
//   정의된 CMap을 쓰는 CID 한글 폰트가 글리프를 못 찾아 한글만 빈칸으로 그려진다
//   (실측 "수학의 신 문제.pdf" 2쪽 — 수식·숫자는 나오고 한글 본문만 사라진다).
//
//   그 상태로 래스터를 뜨면 검출기가 보는 페이지에 본문이 거의 없다. 글자 높이 중앙값
//   (estimateUnit), 낱말 분포로 정하는 단 경계(findColumns), "번호 아래 발문이 있어야
//   한다"(BODY_GAP)가 전부 어긋난다 — 즉 알고리즘을 재는 게 아니라 렌더 결함을 재게 된다.
//   코퍼스 baseline을 그렇게 뜨면 숫자가 통째로 무의미해진다.
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const PDFJS_ROOT = dirname(require.resolve('pdfjs-dist/package.json'))

/** lib/pdf.ts의 loadPdf와 같은 부속 자원. Node에서는 파일 경로로 넘긴다 */
export const PDF_ASSET_OPTIONS = {
  cMapUrl: join(PDFJS_ROOT, 'cmaps') + '/',
  cMapPacked: true,
  standardFontDataUrl: join(PDFJS_ROOT, 'standard_fonts') + '/',
}

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

/** 앱과 같은 옵션으로 PDF를 연다 */
export function openPdf(pdfjs: PdfjsModule, bytes: Uint8Array) {
  return pdfjs.getDocument({ data: bytes, ...PDF_ASSET_OPTIONS }).promise
}
