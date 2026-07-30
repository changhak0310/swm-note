// 앱 코드에 Node 전역이 섞이지 않았는지 본다.
//
// 실제로 앱을 통째로 멈춘 적이 있다. 진단용으로 넣어 둔 `if (process.env.PURI_TRACE)`
// 한 줄이 scan/detect.ts에 남았는데, 브라우저에는 process가 없어 detectScan이 첫 줄에서
// ReferenceError로 죽었다 — 에디터의 모든 쪽이 "분석 실패"로 떴다.
// 테스트는 Node에서 도니 process가 멀쩡해 아무도 못 잡았고, vite build도 잡지 못한다
// (번들에 그대로 실려 나갈 뿐이다). 그래서 소스를 직접 훑는다.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** 브라우저에 없는 전역 — 앱 코드에서 쓰면 그 경로 전체가 죽는다 */
const NODE_ONLY = /\b(process|Buffer|__dirname|__filename|require)\s*[.(]/

const SRC = join(process.cwd(), 'src')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    // 테스트는 Node에서만 도니 제외한다
    if (name === '__tests__') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (/\.(ts|tsx)$/.test(name)) out.push(path)
  }
  return out
}

describe('앱 코드', () => {
  it('Node 전용 전역을 쓰지 않는다', () => {
    const bad: string[] = []
    for (const path of walk(SRC)) {
      const lines = readFileSync(path, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (NODE_ONLY.test(line)) bad.push(`${path.slice(SRC.length + 1)}:${i + 1} ${line.trim()}`)
      })
    }
    expect(bad).toEqual([])
  })
})
