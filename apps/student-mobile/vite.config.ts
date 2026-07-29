import { cpSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * pdf.js의 CMap·표준 폰트를 public/pdfjs로 복사한다.
 *
 * ★ 이게 없으면 **한글이 통째로 안 보이는 PDF가 있다.** 미리 정의된 CMap을 쓰는 CID 폰트
 *   (한국어 문제집의 UniKS-UCS2-H·Adobe-Korea1 계열)는 pdf.js가 .bcmap 파일을 받아야
 *   글리프를 찾는다. 못 받으면 그 폰트로 찍힌 글자만 빈칸이 된다 — 수식·숫자·라틴은
 *   임베드된 폰트라 멀쩡히 나오고 한글만 사라져서, 언뜻 "PDF가 깨졌다"로 보인다
 *   (실측 "수학의 신 문제.pdf" 2쪽).
 *
 * node_modules에서 가져오므로 리포에는 넣지 않는다(.gitignore).
 */
function pdfjsAssets(): Plugin {
  const require = createRequire(import.meta.url)
  return {
    name: 'puri:pdfjs-assets',
    buildStart() {
      const root = dirname(require.resolve('pdfjs-dist/package.json'))
      for (const dir of ['cmaps', 'standard_fonts']) {
        cpSync(join(root, dir), join('public/pdfjs', dir), { recursive: true })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), pdfjsAssets()],
  // pdf 워커 래퍼(pdfWorker.ts)가 본체를 동적 import — iife는 코드 스플리팅 불가
  worker: { format: 'es' },
  test: {
    // src/lib은 DOM 비의존 순수 함수 — node 환경에서 돌린다
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
