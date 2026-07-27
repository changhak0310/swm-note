// 페이지 번호 수열 맞추기 — OCR 낱개 결과를 "번호는 순서대로 1씩 는다"로 검산한다.
//
// 크롭 하나만 보고 읽으면 굵은 서체·흐린 인쇄에서 흔들린다. 실측 베이직쎈 p49:
// 06개 중 "07"은 신뢰도 55, "09"는 30으로 나와 버려졌고 "11"은 "1"로 읽혔다.
// 그런데 그 여섯은 07·08·09·10·11·12로 나란하다 — 확신하는 번호 몇 개만 있으면
// 나머지는 자리로 정해진다. 판단은 픽셀이 아니라 수열이 한다.
//
// 순수 함수다. 앱(liveStore)과 실측 테스트가 같은 코드를 쓴다.

export type NumberRead = { digits: string; confidence: number } | null

export type Numbering = {
  /** 자리별 최종 번호 표기. 정하지 못한 자리는 null */
  labels: (string | null)[]
  /** 수열이 메운 자리 수 (OCR이 못 읽었거나 자신 없던 것) — 진단용 */
  filled: number
}

/** 이만큼 자신 있는 읽기만 수열의 기준점이 된다 */
const ANCHOR_CONF = 80
/** 기준점이 이보다 적으면 수열을 세우지 않는다 */
const MIN_ANCHORS = 3
/** 기준점이 못 되는 읽기를 그대로 쓸 최소 신뢰도 */
const KEEP_CONF = 60
/** 번호는 네 자리를 넘지 않는다 (실측 최대 "1182") */
const MAX_LEN = 4

/**
 * @param reads 읽는 순서(문항 순서)대로의 OCR 결과
 */
export function reconcileNumbering(reads: NumberRead[]): Numbering {
  const raw = (): Numbering => ({
    labels: reads.map((r) => (r && r.digits && r.digits.length <= MAX_LEN && r.confidence >= KEEP_CONF ? r.digits : null)),
    filled: 0,
  })
  if (reads.length < MIN_ANCHORS) return raw()

  // 기준점 — 자신 있는 읽기. 값에서 자리를 빼면 수열이 맞는 것끼리 같은 수가 나온다
  const anchors: { at: number; value: number; len: number }[] = []
  for (let i = 0; i < reads.length; i++) {
    const r = reads[i]
    if (!r || !r.digits || r.digits.length > MAX_LEN || r.confidence < ANCHOR_CONF) continue
    anchors.push({ at: i, value: Number(r.digits), len: r.digits.length })
  }
  if (anchors.length < MIN_ANCHORS) return raw()

  const offsets = new Map<number, typeof anchors>()
  for (const a of anchors) {
    const k = a.value - a.at
    const arr = offsets.get(k)
    if (arr) arr.push(a)
    else offsets.set(k, [a])
  }
  let best: typeof anchors = []
  for (const arr of offsets.values()) if (arr.length > best.length) best = arr
  // 과반이 한 수열에 들어야 믿는다. 번호가 이어지지 않는 쪽(단원이 바뀌는 등)은 여기서 빠진다
  if (best.length < MIN_ANCHORS || best.length * 2 < anchors.length) return raw()

  const offset = best[0].value - best[0].at
  const width = mode(best.map((a) => a.len))
  const out: (string | null)[] = []
  let filled = 0
  for (let i = 0; i < reads.length; i++) {
    const expected = offset + i
    const r = reads[i]
    const confident =
      !!r && r.digits.length > 0 && r.digits.length <= MAX_LEN && r.confidence >= ANCHOR_CONF
    if (confident && Number(r!.digits) !== expected) {
      // 자신 있는데 수열과 다르다 — 지어내지 않고 읽은 값을 쓴다
      out.push(r!.digits)
      continue
    }
    if (expected < 0) {
      out.push(null)
      continue
    }
    const label = String(expected).padStart(width, '0')
    if (!confident) filled++
    out.push(label)
  }
  return { labels: out, filled }
}

function mode(values: number[]): number {
  const count = new Map<number, number>()
  let best = values[0] ?? 0
  let bestN = 0
  for (const v of values) {
    const n = (count.get(v) ?? 0) + 1
    count.set(v, n)
    if (n > bestN) {
      bestN = n
      best = v
    }
  }
  return best
}
