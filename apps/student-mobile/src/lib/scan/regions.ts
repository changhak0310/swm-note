// 스캔 검출 결과 → 앱 Region.
//
// PSP 파이프라인에 태우지 않는다. 파이프라인의 규칙 상당수가 "텍스트가 있다"를 전제로
// 하기 때문이다 — 특히 C-3(선지는 문항 텍스트 범위의 하단 60%)은 발문이 두 줄뿐인
// 스캔 문항에서 첫 선지 행을 통째로 날린다(실측 p45: 객관식 3문항 → 0문항).
//
// 대신 여기서는 이미 확보한 것을 그대로 쓴다: 마커는 문항별로 묶여 순서까지 정해져
// 있고, 번호는 단 좌단에 정렬돼 있다. 남은 일은 좌표계 변환과 선지 띠 계산뿐이다.
// 겹침 0 보장은 PSP의 RULE-HITBOX(computeHitboxes)를 그대로 빌려 쓴다.
import type { Box, ChoiceLabel, Region } from '../../types'
import { MAX_W } from '../geometry'
import { computeHitboxes } from '../psp/regions'
import type { BBox } from '../psp/types'
import type { Comp } from './components'
import type { Column, ScanLayout } from './detect'

/** 선지 띠를 마커 왼쪽으로 이 만큼 당긴다 (마커 크기 배수) */
const LEAD = 0.35
/** 가로 배치 행의 위아래 여유 (마커 크기 배수) */
const ROW_PAD = 0.55
/** 문항 상단 여유 — 번호 위 (마커 크기 배수) */
const TOP_PAD = 0.4
/** 같은 행의 번호로 볼 세로 오차 (마커 크기 배수) */
const ROW_TOL = 0.8

export type ScanRegionResult = {
  regions: Region[]
  /** 번호를 못 찾아 마커 위치로 대신한 문항 수 — 진단용 */
  synthesizedHeadings: number
  /**
   * regionId → 선지 마커 링의 래스터 픽셀 bbox (라벨 순).
   * 선지 라벨 OCR 교정(documentStore)이 링 크롭을 자르는 데 쓴다 — 선지 hitbox는
   * 답 텍스트까지 품는 띠라 OCR 입력으로는 못 쓴다.
   */
  markerRects: Record<string, { x0: number; y0: number; x1: number; y1: number }[]>
}

/**
 * @param layout  detectScan 결과 (좌표는 래스터 픽셀)
 * @param size    래스터 크기
 */
export function scanRegions(
  layout: ScanLayout,
  size: { width: number; height: number },
  docId: string,
  page: number,
): ScanRegionResult {
  const { scale, columns } = layout
  const k = MAX_W / size.width          // 앱 좌표는 폭 기준 정규화 — x·y 같은 배율 (§5)
  const toBox = (c: { x0: number; y0: number; x1: number; y1: number }): Box => ({
    x: c.x0 * k,
    y: c.y0 * k,
    w: (c.x1 - c.x0 + 1) * k,
    h: (c.y1 - c.y0 + 1) * k,
  })

  const groups = groupsOf(layout)
  const regions: Region[] = []
  const markerRects: ScanRegionResult['markerRects'] = {}
  let synthesized = 0
  let seq = 0

  for (const col of columns) {
    const inCol = (x: number) => x >= col.x0 && x < col.x1

    const heads = layout.headings.filter((hd) => inCol((hd.x0 + hd.x1) / 2))
    const colGroups = groups.filter((g) => inCol((g.x0 + g.x1) / 2))

    // 번호를 행으로 묶는다. 보통은 한 행에 하나지만, 기본 문제 쪽은 한 행에 둘이다
    // (짧은 주관식이 2×2 격자로 들어간다). 두 경우를 같은 규칙으로 처리한다
    const rows: Comp[][] = []
    for (const hd of [...heads].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
      const row = rows[rows.length - 1]
      if (row && hd.y0 - row[0].y0 < scale * ROW_TOL) row.push(hd)
      else rows.push([hd])
    }

    type Slot = { head: Comp | null; box: { x0: number; y0: number; x1: number; y1: number } }
    const slots: Slot[] = []
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri].sort((a, b) => a.x0 - b.x0)
      const top = Math.max(0, Math.min(...row.map((hd) => hd.y0)) - scale * TOP_PAD)
      const bottom =
        ri + 1 < rows.length
          ? Math.min(...rows[ri + 1].map((hd) => hd.y0)) - scale * TOP_PAD
          : size.height
      for (let i = 0; i < row.length; i++) {
        // 행에 번호가 여럿이면 다음 번호 직전까지가 그 문항의 폭이다
        const x0 = i === 0 ? col.x0 : row[i].x0 - scale * TOP_PAD
        const x1 = i + 1 < row.length ? row[i + 1].x0 - scale * TOP_PAD : col.x1
        slots.push({ head: row[i], box: { x0, y0: top, x1: x1 - 1, y1: bottom - 1 } })
      }
    }

    // 선지 뭉치를 그것을 품은 칸에 붙인다. 번호를 못 찾았거나(색을 안 쓰는 문제집)
    // 한 칸에 뭉치가 둘이면 뭉치 자체를 문항으로 세운다 — 선지 판정만은 잃지 않는다.
    // 배지는 그때 ① 위에 붙는다
    const groupOf = new Map<Slot, Group>()
    for (const g of colGroups) {
      const cx = (g.x0 + g.x1) / 2
      const owner = slots.find(
        (s) => !groupOf.has(s) && cx >= s.box.x0 && cx <= s.box.x1 && g.y0 >= s.box.y0 && g.y0 <= s.box.y1,
      )
      if (owner) groupOf.set(owner, g)
      else {
        const slot: Slot = {
          head: null,
          box: { x0: col.x0, y0: g.y0 - scale * TOP_PAD, x1: col.x1 - 1, y1: g.y1 + scale },
        }
        slots.push(slot)
        groupOf.set(slot, g)
        synthesized++
      }
    }

    for (const slot of slots) {
      const group = groupOf.get(slot)
      const choices = group ? choiceBoxes(group, { x0: slot.box.x0, x1: slot.box.x1 + 1 }, scale, k) : []
      seq++
      const id = `${docId}:p${page}:s${seq}`
      if (group) {
        markerRects[id] = group.items.map((m) => ({ x0: m.x0, y0: m.y0, x1: m.x1, y1: m.y1 }))
      }
      regions.push({
        // 번호를 읽지 못하므로 위치 순번으로 id를 만든다. 같은 쪽을 다시 분석해도
        // 같은 id가 나와야 필기 귀속과 판정이 유지된다
        id,
        docId,
        page,
        bounds: toBox(slot.box),
        numBox: slot.head ? toBox(slot.head) : group ? toBox(group.items[0]) : undefined,
        numSynth: slot.head ? undefined : true,
        stemBox: undefined,
        ansBox: choices.length ? unionBox(choices.map((c) => c.box)) : undefined,
        choices,
        ansSynth: choices.length === 0,
        answerType: choices.length >= 2 ? 'choice' : 'integer',
      })
    }
  }

  return { regions, synthesizedHeadings: synthesized, markerRects }
}

// ---------- 선지 띠 ----------

type Group = { items: ScanLayout['markers']; x0: number; x1: number; y0: number; y1: number }

function groupsOf(layout: ScanLayout): Group[] {
  const byId = new Map<number, ScanLayout['markers']>()
  for (const m of layout.markers) {
    const arr = byId.get(m.group)
    if (arr) arr.push(m)
    else byId.set(m.group, [m])
  }
  return [...byId.values()]
    .map((items) => ({
      items: items.sort((a, b) => a.ordinal - b.ordinal),
      x0: Math.min(...items.map((m) => m.x0)),
      x1: Math.max(...items.map((m) => m.x1)),
      y0: Math.min(...items.map((m) => m.y0)),
      y1: Math.max(...items.map((m) => m.y1)),
    }))
    .sort((a, b) => a.y0 - b.y0)
}

/**
 * 마커 위치에서 선지 판정 박스를 만든다.
 *
 * 규칙은 텍스트 경로(psp/regions.ts §5.3)와 같다: 가로로 이웃한 선지끼리는 다음 마커
 * 직전까지, 줄의 마지막 선지는 단 우단까지. 답 텍스트("⑤ 9")를 품어야 동그라미가 잡힌다.
 */
function choiceBoxes(group: Group, col: Column, scale: number, k: number): Region['choices'] {
  const rows: ScanLayout['markers'][] = []
  for (const m of [...group.items].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    const row = rows[rows.length - 1]
    if (row && m.y0 < Math.max(...row.map((r) => r.y1))) row.push(m)
    else rows.push([m])
  }

  const lead = scale * LEAD
  const raw: { label: ChoiceLabel; box: BBox }[] = []
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri].sort((a, b) => a.x0 - b.x0)
    const rowTop = Math.min(...row.map((m) => m.y0))
    const rowBottom = Math.max(...row.map((m) => m.y1))

    let y0 = rowTop - scale * ROW_PAD
    let y1 = rowBottom + scale * ROW_PAD
    // 여유가 이웃 행을 침범하면 행 사이 중점까지 — 3+2 배치에서 겹침을 막는다
    const prev = rows[ri - 1]
    const next = rows[ri + 1]
    if (prev) y0 = Math.max(y0, (Math.max(...prev.map((m) => m.y1)) + rowTop) / 2)
    if (next) y1 = Math.min(y1, (rowBottom + Math.min(...next.map((m) => m.y0))) / 2)

    for (let i = 0; i < row.length; i++) {
      const x0 = row[i].x0 - lead
      const x1 = row[i + 1] ? row[i + 1].x0 - lead : col.x1
      raw.push({ label: row[i].ordinal as ChoiceLabel, box: [x0, y0, x1, y1] })
    }
  }

  // 겹침 0 보장 — 텍스트 경로와 같은 규칙 (RULE-HITBOX)
  const { boxes } = computeHitboxes(raw.map((r) => r.box))
  return raw
    .map((r, i) => ({
      label: r.label,
      box: {
        x: boxes[i][0] * k,
        y: boxes[i][1] * k,
        w: (boxes[i][2] - boxes[i][0]) * k,
        h: (boxes[i][3] - boxes[i][1]) * k,
      },
    }))
    .sort((a, b) => a.label - b.label)
}

function unionBox(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return {
    x,
    y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
  }
}
