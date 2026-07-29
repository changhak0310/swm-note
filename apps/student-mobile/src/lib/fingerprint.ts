// 쪽 지문 — 같은 책의 **다른 파일**에 라벨을 붙이기 위한 것 (§11.3 L1).
//
// 내용 해시(L0)는 바이트가 1개만 달라도 안 맞는다. 그런데 같은 문제집을 다시 받거나,
// 재압축되거나, 표지가 잘려 나가는 일은 흔하다. 그때도 조판은 그대로이므로 **쪽 그림**으로
// 짝을 찾는다.
//
// dHash를 쓴다 — 아주 작게 줄인 뒤 이웃 픽셀의 대소만 남기는 방식이라 밝기·대비·재압축에
// 둔감하고, 조판이 다르면 확실히 갈린다. 64비트면 한 책 200쪽을 가르기에 충분하다.
//
// ★ 이것이 만능은 아니다. 종이를 **다시 스캔**한 사본은 기울기·여백이 달라져 지문이
//   흔들릴 수 있다. 그래서 지문이 맞아도 배치 검증(§11.4)을 건너뛰지 않는다 —
//   지문은 "어느 쪽인가"만 답하고, "좌표가 맞는가"는 잉크가 답한다.
import type { Raster } from './scan/components'

/** 줄인 크기 — 가로 9로 줄여 이웃끼리 8번 비교하면 한 줄에 8비트, 8줄이면 64비트 */
const W = 9
const H = 8

/**
 * 두 지문이 이만큼까지 달라도 같은 쪽으로 본다 (64비트 중 다른 비트 수).
 *
 * 재압축·밝기 변화는 보통 0~4비트, 다른 쪽은 20비트 이상 벌어진다. 12는 그 사이에서
 * 넉넉히 안전한 쪽에 둔 값이다 — 여기서 헐거워도 배치 검증이 한 번 더 막는다.
 */
export const FP_MAX_DISTANCE = 12

/**
 * 이웃 값이 이보다 가까우면 '차이 없음'으로 본다 (0~255 회색조).
 *
 * ★ 이게 없으면 **여백에서 지문이 흔들린다.** 평평한 흰 영역은 이웃 값이 거의 같아서
 *   대소 비교가 잡음으로 정해지고, 재압축본과 원본이 그 자리에서 제멋대로 갈린다 —
 *   실측 합성 표본에서 밝기·잡음만 준 사본이 64비트 중 26비트나 달라졌다.
 *   문제집은 여백이 넓어 이 구간이 지문의 상당 부분을 차지한다.
 *
 * 줄인 칸 하나가 원본 수백 픽셀의 평균이라 잡음은 이미 크게 깎인다. 3이면 그 잔차를
 * 덮고도 진짜 획(흰 245 vs 검정 20)은 그대로 남는다.
 */
const FLAT_EPS = 3

/** 지문 — 16자리 16진수 (64비트) */
export function fingerprint(raster: Raster): string {
  const g = shrink(raster)
  let bits = ''
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      bits += g[y * W + x] - g[y * W + x + 1] > FLAT_EPS ? '1' : '0'
    }
  }
  // 64비트를 4비트씩 16진수로
  let hex = ''
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

/** 상자 평균으로 W×H 회색조로 줄인다 */
function shrink(raster: Raster): Float64Array {
  const out = new Float64Array(W * H)
  const { width, height, rgba } = raster
  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      const x0 = Math.floor((cx * width) / W)
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * width) / W))
      const y0 = Math.floor((cy * height) / H)
      const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * height) / H))
      let sum = 0
      let n = 0
      for (let y = y0; y < y1 && y < height; y++) {
        for (let x = x0; x < x1 && x < width; x++) {
          const o = (y * width + x) * 4
          // 사람 눈 가중치 — 색 번호가 회색조에서 사라지지 않게
          sum += rgba[o] * 0.299 + rgba[o + 1] * 0.587 + rgba[o + 2] * 0.114
          n++
        }
      }
      out[cy * W + cx] = n ? sum / n : 255
    }
  }
  return out
}

/** 다른 비트 수. 길이가 다르면 비교하지 않는다(∞) */
export function distance(a: string, b: string): number {
  if (a.length !== b.length) return Infinity
  let d = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) {
      d += x & 1
      x >>= 1
    }
  }
  return d
}

export type Alignment = {
  /** 팩의 p쪽 ↔ 이 문서의 (p + offset)쪽 */
  offset: number
  matched: number
  /** 견줄 수 있었던 쪽 수 */
  comparable: number
  rate: number
}

/** 짝지어진 비율이 이 아래면 같은 책으로 보지 않는다 */
const MIN_RATE = 0.6
/** 아무리 비율이 좋아도 이만큼은 맞아야 한다 — 두세 쪽 우연히 닮는 일은 있다 */
const MIN_MATCHED = 3

/**
 * 팩의 쪽 지문과 이 문서의 쪽 지문을 맞춰 **쪽 오프셋**을 찾는다.
 *
 * ★ 오프셋이 필요한 이유: 표지가 잘린 사본은 p1↔p3처럼 통째로 밀린다. 지문이 다 맞는데도
 *   쪽 번호가 달라 안 붙으면 아무 소용이 없다.
 *
 * @param packFps 팩을 만들 때의 쪽 지문 (index = 쪽−1, 없으면 null)
 * @param docFps  지금 문서의 쪽 지문
 */
export function alignPages(
  packFps: (string | null)[],
  docFps: (string | null)[],
  maxDistance = FP_MAX_DISTANCE,
): Alignment | null {
  if (!packFps.length || !docFps.length) return null

  let best: Alignment | null = null
  for (let offset = -(packFps.length - 1); offset <= docFps.length - 1; offset++) {
    let matched = 0
    let comparable = 0
    for (let i = 0; i < packFps.length; i++) {
      const a = packFps[i]
      const b = docFps[i + offset]
      if (!a || !b) continue
      comparable++
      if (distance(a, b) <= maxDistance) matched++
    }
    if (comparable < MIN_MATCHED) continue
    const rate = matched / comparable
    // 같은 비율이면 더 많이 맞은 쪽, 그것도 같으면 밀림이 적은 쪽
    if (
      !best ||
      matched > best.matched ||
      (matched === best.matched && Math.abs(offset) < Math.abs(best.offset))
    ) {
      best = { offset, matched, comparable, rate }
    }
  }

  if (!best || best.matched < MIN_MATCHED || best.rate < MIN_RATE) return null
  return best
}
