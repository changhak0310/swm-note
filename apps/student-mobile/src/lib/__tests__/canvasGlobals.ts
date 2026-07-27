// Node에서 pdf.js 캔버스 렌더러를 쓰기 위한 전역 채우기.
//
// ★ 반드시 pdf.js보다 먼저 평가돼야 한다. pdf.js는 모듈 평가 시점에 Path2D를 잡아 두는데,
//   테스트가 `../psp`를 불러오면 그 안의 adapter가 pdf.js를 정적 import 하므로, 테스트 본문에서
//   전역을 세워 봐야 이미 늦다(실측: 렌더가 "Value is none of these types `String`, `Path`"로 죽는다).
//   그래서 이 파일을 **가장 먼저** import 한다 — ESM은 정적 import를 소스 순서대로 평가한다.
import { DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas'

const g = globalThis as Record<string, unknown>
g.Path2D ??= Path2D
g.DOMMatrix ??= DOMMatrix
g.ImageData ??= ImageData
