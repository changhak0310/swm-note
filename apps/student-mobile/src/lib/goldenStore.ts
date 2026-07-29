// 골든 초안 보관 (localStorage) — dev 라벨링용.
//
// ★ **라벨은 한 파일에 여러 벌 있어야 한다.** IAA(§11.10 ②)는 "같은 쪽을 두 사람이 독립으로
//   라벨했을 때 얼마나 일치하는가"를 재는데, 초안이 파일명당 하나뿐이면 두 번째 라벨이
//   첫 번째를 덮어써서 **애초에 잴 데이터를 만들 수가 없다.**
//   그래서 키에 '차수'를 넣는다: `puri.golden.{파일명}#{차수}`.
//
// 차수 이름은 자유지만 A·B를 기본으로 둔다. B는 A를 보지 않고 라벨해야 IAA가 뜻을 가진다.
import { parseGolden, type GoldenSet } from './psp/golden'

const PREFIX = 'puri.golden.'
export const DEFAULT_PASS = 'A'

export type DraftRef = {
  key: string
  /** 원본 파일명 */
  source: string
  /** 차수 (A·B…) */
  pass: string
  pages: number
  boxes: number
  updatedAt: string
  sourceHash?: string
}

export function draftKey(source: string, pass: string): string {
  return `${PREFIX}${source}#${pass}`
}

/**
 * 저장된 초안 목록.
 *
 * 차수가 없는 옛 키(`puri.golden.{파일명}`)도 읽는다 — 차수를 넣기 전에 만든 라벨이
 * 사라지면 안 된다. 그런 것은 기본 차수(A)로 본다.
 */
export function listDrafts(): DraftRef[] {
  const out: DraftRef[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith(PREFIX)) continue
    const raw = localStorage.getItem(key)
    if (!raw) continue
    try {
      const g = parseGolden(raw)
      const rest = key.slice(PREFIX.length)
      const at = rest.lastIndexOf('#')
      out.push({
        key,
        source: at >= 0 ? rest.slice(0, at) : rest,
        pass: at >= 0 ? rest.slice(at + 1) : DEFAULT_PASS,
        pages: g.reviewedPages.length,
        boxes: g.boxes.length,
        updatedAt: g.updatedAt,
        sourceHash: g.sourceHash,
      })
    } catch {
      // 망가진 항목은 목록에서 조용히 뺀다 — 여기서 던지면 화면 전체가 죽는다
    }
  }
  return out.sort((a, b) => a.source.localeCompare(b.source) || a.pass.localeCompare(b.pass))
}

export function loadDraft(key: string): GoldenSet | null {
  const raw = localStorage.getItem(key)
  if (!raw) return null
  try {
    return parseGolden(raw)
  } catch {
    return null
  }
}

export function saveDraft(key: string, golden: GoldenSet) {
  localStorage.setItem(key, JSON.stringify(golden))
}

export function deleteDraft(key: string) {
  localStorage.removeItem(key)
}
