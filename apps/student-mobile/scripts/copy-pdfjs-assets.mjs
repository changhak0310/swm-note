// pdf.js가 런타임에 내려받는 자료를 public으로 복사한다.
//
// cmaps          — CID 방식으로 한글을 담은 PDF를 읽으려면 필요하다. 없으면 글자가
//                  추출도 렌더도 안 되는데, pdf.js는 경고만 남기고 조용히 넘어간다.
// standard_fonts — 폰트를 내장하지 않은 PDF의 기본 글꼴.
//
// node_modules에서 직접 import 할 수 없다 — 디렉터리 통째로는 번들러가 다루지 못하고,
// 빌드 산출물에도 남아야 한다. dev·build 전에 한 번 돌린다 (package.json의 predev/prebuild).
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const pdfjs = dirname(require.resolve('pdfjs-dist/package.json'))
const out = join(here, '..', 'public', 'pdfjs')

mkdirSync(out, { recursive: true })
for (const name of ['cmaps', 'standard_fonts']) {
  const from = join(pdfjs, name)
  if (!existsSync(from)) {
    console.warn(`[pdfjs-assets] ${name} 없음 — 건너뜀 (${from})`)
    continue
  }
  cpSync(from, join(out, name), { recursive: true })
  console.log(`[pdfjs-assets] ${name} → public/pdfjs/${name}`)
}
