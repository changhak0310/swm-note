// 라벨 팩 — 사람이 확인한 골든셋을 런타임에 그대로 쓴다 (§11.2 계층 A).
//
// 검출이 못 미치는 곳을 사람의 라벨로 메운다. 다만 **잘못 앉은 라벨은 검출 실패보다 나쁘다** —
// 검출 실패는 박스가 없어 눈에 보이지만, 잘못된 라벨은 자신 있게 조용히 전부 틀린다.
// 그래서 이 모듈의 절반은 "쓸 것인가"를 정하는 데 쓴다.
//
//   ① 신원   내용 해시가 같은가 (L0). 다르면 아예 쓰지 않는다 — §11.3
//   ② 범위   그 **쪽**이 라벨돼 있는가. 계층은 책이 아니라 쪽 단위다 — §11.2
//   ③ 검증   라벨된 자리에 실제로 인쇄물이 있는가 — §11.4
//
// ★ 애매하면 안 쓴다. 셋 중 하나라도 걸리면 그 쪽은 검출로 떨어뜨린다.
import type { Box, Region } from '../types'
import type { PDFDocumentProxy } from './pdf'
import { MAX_W } from './geometry'
import { masks, type Raster } from './scan/components'
import { alignPages, fingerprint, type Alignment } from './fingerprint'
import type { GoldenSet } from './psp/golden'

/** IndexedDB에 담기는 형태 — 키는 내용 해시다. 파일명이 아니다 */
export type LabelPack = {
  /** `sha256:` + 앞 16자리. GoldenLabeler·코퍼스 하네스와 같은 규약 */
  sourceHash: string
  golden: GoldenSet
  importedAt: number
}

// ---------- ② 범위 ----------

/** 이 쪽이 라벨돼 있는가. 확인 완료 표시가 있어야 한다 (구역 0개도 "문항 없음"이라는 정답이다) */
export function packCovers(golden: GoldenSet, page: number): boolean {
  return golden.reviewedPages.includes(page)
}

/**
 * 라벨 → 앱 Region. 좌표계가 이미 같아(MAX_W 정규화) 변환이 없다.
 *
 * id는 팩 안에서 유일해야 하고 **다시 열어도 같아야 한다** — 필기 귀속과 판정이 그 위에 얹힌다.
 * 그래서 id에는 쪽 오프셋을 넣지 않는다(팩 안의 상자 id를 그대로 쓴다).
 *
 * @param packPage 팩 안의 쪽 번호
 * @param docPage  이 문서에서의 쪽 번호. 표지가 잘린 사본이면 둘이 다르다
 */
export function packRegions(
  golden: GoldenSet,
  packPage: number,
  docId: string,
  docPage = packPage,
): Region[] {
  return golden.boxes
    .filter((b) => b.page === packPage)
    .map((b) => ({
      id: `${docId}:pack:${b.id}`,
      docId,
      page: docPage,
      bounds: b.bbox,
      numLabel: b.number || undefined,
      choices: b.choices,
      ansSynth: false,
      // kind를 적었으면 그것을 따르고, 없으면 선지 수로 본다 (v1 라벨 호환)
      answerType: (b.kind ? b.kind === 'choice' : b.choices.length >= 2) ? 'choice' : 'integer',
    }))
}

// ---------- ③ 검증 ----------

/**
 * 표본으로 볼 선지 수. 쪽마다 이만큼만 확인한다 — 목적이 "좌표가 맞게 앉았나"이지
 * "검출이 잘되나"가 아니라서 몇 개면 충분하다.
 */
const SAMPLE = 6
/** 마커 칸에 잉크가 이 비율 이상이면 인쇄물이 있는 것으로 본다 */
const INK_MIN = 0.02
/** 표본 중 이 비율은 잉크가 있어야 팩을 쓴다 */
const PASS_RATIO = 0.6

export type PlacementCheck = {
  sampled: number
  inked: number
  ok: boolean
  /**
   * 실제로 본 칸과 그 결과.
   *
   * 숫자만 내면 "6개 중 2개"가 어느 칸인지 알 수 없어 사람이 확인할 수가 없다.
   * 점검 화면이 이것을 페이지 위에 그대로 겹쳐 그린다 — 검증이 약한 검사이므로,
   * 최종 확인은 눈이 한다.
   */
  samples: { box: Box; inked: boolean }[]
}

/**
 * 라벨이 이 페이지에 맞게 앉았는가.
 *
 * ★ 검출기를 다시 돌리지 않는다. 그러면 "검출이 되는 쪽에서만 팩을 쓴다"가 되어 팩의 뜻이
 *   사라진다. 대신 훨씬 약하고 값싼 것만 본다 — **라벨이 가리키는 선지 기호 자리에 잉크가
 *   있는가.** 좌표계가 밀렸거나 다른 책의 라벨이면 그 칸들이 비어 있다.
 *
 * 인쇄된 링은 자기 상자의 10~25%를 채운다. 문턱을 2%로 낮게 둔 이유는 여기서 가리려는 것이
 * "링이냐"가 아니라 "종이냐"이기 때문이다.
 */
export function verifyPlacement(raster: Raster, regions: Region[], sample = SAMPLE): PlacementCheck {
  const boxes = markerSquares(regions, sample)
  // 잴 것이 없으면 막지 않는다
  if (!boxes.length) return { sampled: 0, inked: 0, ok: true, samples: [] }

  const { ink } = masks(raster)
  const k = raster.width / MAX_W
  const samples = boxes.map((box) => ({
    box,
    inked: inkRatio(ink, raster.width, raster.height, box, k) >= INK_MIN,
  }))
  const inked = samples.filter((s) => s.inked).length
  return { sampled: boxes.length, inked, ok: inked >= boxes.length * PASS_RATIO, samples }
}

/** 선지 기호 자리 — 박스 왼쪽의 정사각 영역 (grading.ts의 sym과 같은 규약) */
function markerSquares(regions: Region[], sample: number): Box[] {
  const all: Box[] = []
  for (const r of regions) {
    for (const c of r.choices) {
      const side = Math.min(c.box.w, c.box.h)
      if (side <= 0) continue
      all.push({ x: c.box.x, y: c.box.y, w: side, h: c.box.h })
    }
  }
  if (all.length <= sample) return all
  // 고루 흩어 뽑는다 — 앞쪽만 보면 한 문항의 어긋남에 판정이 끌려간다
  const step = all.length / sample
  return Array.from({ length: sample }, (_, i) => all[Math.floor(i * step)])
}

function inkRatio(
  ink: Uint8Array,
  w: number,
  h: number,
  box: Box,
  k: number,
): number {
  const x0 = Math.max(0, Math.floor(box.x * k))
  const y0 = Math.max(0, Math.floor(box.y * k))
  const x1 = Math.min(w - 1, Math.ceil((box.x + box.w) * k))
  const y1 = Math.min(h - 1, Math.ceil((box.y + box.h) * k))
  if (x1 <= x0 || y1 <= y0) return 0
  let n = 0
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) if (ink[y * w + x]) n++
  }
  return n / ((x1 - x0 + 1) * (y1 - y0 + 1))
}

// ---------- 종합 ----------

// ---------- ① 신원 ----------

export type PackMatch = {
  pack: LabelPack
  /** 팩의 p쪽 ↔ 이 문서의 (p + offset)쪽. 해시가 같으면 언제나 0 */
  offset: number
  via: 'hash' | 'fingerprint'
  alignment?: Alignment
}

/**
 * 가진 팩 중 이 문서의 것을 찾는다.
 *
 *   L0 내용 해시가 같다        → 그대로 쓴다 (오프셋 0)
 *   L1 쪽 지문이 맞아떨어진다  → 오프셋을 구해 쓴다 (재압축·표지 잘림 사본)
 *   그 외                      → 없다
 *
 * ★ L1로 붙었다고 배치 검증을 건너뛰지 않는다. 지문은 **"어느 쪽인가"**만 답한다.
 *   좌표가 맞는지는 잉크가 답해야 한다 — 다시 스캔한 사본은 같은 쪽이어도 여백이 밀린다.
 */
export function matchPack(
  packs: LabelPack[],
  docHash: string | null,
  docFingerprints: (string | null)[] | null,
): PackMatch | null {
  const exact = docHash ? packs.find((p) => p.sourceHash === docHash) : undefined
  if (exact) return { pack: exact, offset: 0, via: 'hash' }
  if (!docFingerprints?.length) return null

  let best: PackMatch | null = null
  for (const pack of packs) {
    const fps = pack.golden.pageFingerprints
    if (!fps?.length) continue
    const a = alignPages(fps, docFingerprints)
    if (!a) continue
    if (!best || a.matched > (best.alignment?.matched ?? 0)) {
      best = { pack, offset: a.offset, via: 'fingerprint', alignment: a }
    }
  }
  return best
}

// ---------- 종합 ----------

export type PackDecision =
  | { use: true; regions: Region[]; check: PlacementCheck }
  | { use: false; reason: string; check?: PlacementCheck }

/**
 * 이 쪽에 팩을 쓸 것인가. 쓰지 않기로 했으면 이유를 남긴다 — 조용히 검출로 떨어지면
 * 사용자도 우리도 팩이 안 먹었다는 것을 모른다.
 *
 * @param page 이 **문서**의 쪽 번호
 */
export function decidePack(
  match: PackMatch | null,
  page: number,
  docId: string,
  raster: Raster,
): PackDecision {
  if (!match) return { use: false, reason: '이 문서의 라벨 팩 없음' }
  const { pack, offset } = match
  // 문서 쪽 → 팩 쪽
  const packPage = page - offset
  if (!packCovers(pack.golden, packPage)) return { use: false, reason: '이 쪽은 라벨되지 않음' }

  const regions = packRegions(pack.golden, packPage, docId, page)
  // 라벨이 "이 쪽에는 문항이 없다"고 말하는 경우 — 그것도 정답이라 그대로 따른다
  if (!regions.length) {
    return { use: true, regions, check: { sampled: 0, inked: 0, ok: true, samples: [] } }
  }

  const check = verifyPlacement(raster, regions)
  if (!check.ok) {
    return {
      use: false,
      reason: `라벨 자리에 인쇄물이 없다 (${check.inked}/${check.sampled})`,
      check,
    }
  }
  return { use: true, regions, check }
}

// ---------- 지문 만들기 ----------

/**
 * 지문용 렌더 폭. 아주 작아도 된다 — 어차피 9×8로 줄여 대소만 본다.
 * 96쪽짜리를 훑어도 1~2초로 끝나야 해서 분석용 폭(1700·2800)을 쓸 수 없다.
 */
const FP_WIDTH = 64

/**
 * 문서 전 쪽의 지문을 만든다.
 *
 * 라벨을 만들 때(라벨러)와 라벨을 찾을 때(런타임) 양쪽이 이 함수를 써야 한다 —
 * 폭이 다르면 지문이 달라져 **조용히 안 붙는다.**
 */
export async function pageFingerprints(
  pdf: PDFDocumentProxy,
  render: (pdf: PDFDocumentProxy, page: number, width: number) => Promise<Raster>,
  onProgress?: (done: number, total: number) => void,
): Promise<(string | null)[]> {
  const out: (string | null)[] = []
  for (let p = 1; p <= pdf.numPages; p++) {
    try {
      out.push(fingerprint(await render(pdf, p, FP_WIDTH)))
    } catch {
      out.push(null)                       // 못 그리는 쪽은 비워 둔다 — 짝짓기에서 빠진다
    }
    onProgress?.(p, pdf.numPages)
  }
  return out
}
