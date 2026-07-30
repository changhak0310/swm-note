// 실시간 선지 판정 — 채점 버튼을 누르기 전에 "무엇을 골랐나"를 낸다 (MarkOverlay)
//
// 채점(grading.ts)과 같은 기하 규칙 — 닫힌 고리 / 열린 마크 — 을 쓰되 두 가지가 다르다.
//   - 정답지를 보지 않는다. 맞고 틀림이 아니라 "무엇을 골랐나"만 낸다.
//   - 스트로크에 저장된 regionId를 믿지 않는다. 에디터는 펜이 닿는 순간
//     그 페이지 분석을 시작하므로, 첫 획이 그려질 때는 아직 구역이 없다
//     (regionId = null). 그래서 판정할 때마다 다시 귀속시킨다.
import type { ChoiceLabel, Region, Stroke } from '../types'
import { attribute } from './attribution'
import { detectChoice } from './grading'

/** regionId → 학생이 체크한 선지 번호 */
export type LiveMarks = Record<string, ChoiceLabel>

export function detectMarks(regions: Region[], strokes: Stroke[]): LiveMarks {
  const marks: LiveMarks = {}
  if (regions.length === 0 || strokes.length === 0) return marks

  const byRegion = new Map<string, Stroke[]>()
  for (const s of strokes) {
    if (s.tool === 'hi') continue                    // 형광펜은 답 마크가 아니다
    const id = ownerOf(s, regions)
    if (!id) continue
    const arr = byRegion.get(id)
    if (arr) arr.push(s)
    else byRegion.set(id, [s])
  }

  for (const r of regions) {
    if (r.answerType !== 'choice' || r.choices.length === 0) continue
    // 여러 획이 잡히면 detectChoice가 마지막 획을 고른다 — 고쳐 그으면 새 답이 이긴다
    const label = detectChoice(r, byRegion.get(r.id) ?? [])
    if (label !== null) marks[r.id] = label as ChoiceLabel
  }
  return marks
}

/**
 * 이 획은 어느 문항의 답 표시인가.
 *
 * bounds 귀속(attribution.ts)만으로 가르지 않는다. 선지에 친 동그라미는 문항
 * 경계를 넘기 쉽고, 그러면 아래 문항으로 귀속돼 양쪽 다 마크를 잃는다.
 * 선지 판정이 실제로 성립하는 문항을 먼저 찾고, 둘 이상이면 그때 bounds로 가른다.
 */
function ownerOf(stroke: Stroke, regions: Region[]): string | null {
  const hits = regions.filter((r) => r.choices.length > 0 && detectChoice(r, [stroke]) !== null)
  if (hits.length === 0) return null                 // 답 표시가 아닌 획 — 풀이 필기
  if (hits.length === 1) return hits[0].id
  const attributed = attribute(stroke, regions)
  return hits.find((r) => r.id === attributed)?.id ?? hits[0].id
}
