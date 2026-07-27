// 숫자 OCR — 스캔 페이지에서 "번호의 값"을 읽는다.
//
// scan/detect.ts는 설계상 값 없이 자리만 찾는다. 이 모듈은 그 자리 크롭 한 칸씩만
// tesseract에 넘겨 값을 채운다 — 페이지 전체 OCR이 아니다. 크롭 한 칸이 수십 px라
// 한글 모델도, 페이지당 수 초짜리 인식도 필요 없다.
//
// 전처리는 순수 함수(DOM 비의존)이고 tesseract.js는 Node(테스트)와 브라우저(앱)를
// 같이 지원한다 — pdfText.ts와 같은 이유로, 테스트가 앱과 같은 코드 경로를 돈다.
import type { Box } from '../../types'
import { MAX_W } from '../geometry'
import type { Raster } from './components'
import type { Worker as TesseractWorker, WorkerOptions } from 'tesseract.js'

/** 래스터 픽셀 좌표의 크롭 범위 (경계 포함 — Comp의 x0·x1과 같은 규약) */
export type PxRect = { x0: number; y0: number; x1: number; y1: number }

export type OcrRead = {
  /** 읽은 숫자열. 숫자 아닌 글자는 걸러냈다 — 빈 문자열이면 못 읽은 것 */
  digits: string
  /** tesseract 평균 신뢰도 0~100 */
  confidence: number
}

/** 앱 좌표(MAX_W 기준) 박스 → 래스터 픽셀 크롭 범위 */
export function pxRect(raster: Raster, box: Box, pad = 2): PxRect {
  const k = raster.width / MAX_W
  return {
    x0: Math.max(0, Math.floor(box.x * k) - pad),
    y0: Math.max(0, Math.floor(box.y * k) - pad),
    x1: Math.min(raster.width - 1, Math.ceil((box.x + box.w) * k) + pad),
    y1: Math.min(raster.height - 1, Math.ceil((box.y + box.h) * k) + pad),
  }
}

/** 통째로 읽은 결과를 그대로 믿을 신뢰도. 이 밑이면 자릿수가 맞아도 한 자씩 검산한다 */
const LINE_TRUST = 80

/**
 * 문제 번호(여러 자리, 색 글자일 수 있다)를 읽는다.
 *
 * 먼저 한 줄로 읽고, 픽셀로 센 자릿수와 대조한다. 읽은 자릿수가 모자라거나 자신이
 * 없으면 칸을 하나씩 잘라 다시 읽는다 — 굵은 서체에서 tesseract가 두 자리 수를
 * 흘리거나 낮은 신뢰도로 내놓기 때문이다(실측 베이직쎈: "11"→"1", "07"→신뢰도 55).
 * 칸이 읽은 자릿수보다 적으면(획이 붙어 한 칸으로 보이는 경우) 줄 결과를 그대로 쓴다.
 */
export async function readNumber(raster: Raster, rect: PxRect): Promise<OcrRead | null> {
  const line = await recognizeCrop(raster, rect, 'number')
  if (!line) return null

  const cells = digitCells(raster, rect)
  const enough = line.digits.length === cells.length && line.confidence >= LINE_TRUST
  if (enough || cells.length < 2 || cells.length < line.digits.length) return line

  let digits = ''
  let worst = 100
  for (const cell of cells) {
    const read = await recognizeCrop(raster, cell, 'digit')
    if (!read?.digits) return line               // 한 칸이라도 못 읽으면 줄 결과로 돌아간다
    digits += read.digits[0]
    worst = Math.min(worst, read.confidence)
  }
  // 자릿수를 더 채웠거나 더 자신 있을 때만 갈아탄다
  if (digits.length > line.digits.length || worst > line.confidence) {
    return { digits, confidence: worst }
  }
  return line
}

/** 선지 마커 링 안의 숫자 한 자를 읽는다 */
export async function readMarkerDigit(raster: Raster, rect: PxRect): Promise<OcrRead | null> {
  return recognizeCrop(raster, rect, 'marker')
}

/** 이보다 자신 없는 마커 읽기는 교정에 쓰지 않는다 — 실측 오독은 전부 0~22, 정독은 90+ */
const MARKER_RELABEL_CONF = 75

/**
 * 마커 OCR 결과 → 선지 라벨 열. 교정할 수 없으면 null.
 *
 * 검출이 마커 하나를 놓치면 순서 기반 라벨이 통째로 밀린다 — 인쇄된 ③에 치면 ②로
 * 보고된다. 링 안의 숫자를 읽어 라벨을 인쇄값에 맞춘다. 다만 OCR을 순서보다 더 믿는
 * 것이므로 문턱이 높다: 전부 읽혔고, 전부 자신 있고, 1~5 안에서 강증가일 때만 쓴다.
 * (오독은 이 셋 중 하나를 거의 반드시 깬다 — 실측 오독 4건 전부 신뢰도 0~22)
 */
export function labelsFromMarkerReads(reads: (OcrRead | null)[]): number[] | null {
  const labels: number[] = []
  for (const r of reads) {
    if (!r || r.digits.length !== 1 || r.confidence < MARKER_RELABEL_CONF) return null
    const v = Number(r.digits)
    if (v < 1 || v > 5) return null
    if (labels.length && v <= labels[labels.length - 1]) return null
    labels.push(v)
  }
  return labels.length ? labels : null
}

// ============================================================ 전처리
//
// tesseract에 맞춘 손질 셋. ① 유채색 글자를 어둡게(luma−chroma) — 문제 번호는 색이고
// 색은 밝아 회색조만으로는 대비가 모자라다. ② 글자 높이를 ~56px로 키운다 — 원본은
// 번호 25px·마커 속 숫자 14px라 LSTM이 그냥은 못 읽는다. ③ 흰 여백을 두른다.

/** 크롭의 성격 — 전처리와 PSM이 갈린다. digit은 번호에서 잘라낸 한 자리 칸 */
type CropKind = 'number' | 'marker' | 'digit'

const TARGET_H = 56                 // 업스케일 목표 높이 (크롭 기준)
const DIGIT_TARGET_H = 96           // 한 글자 크롭은 더 크게
const MAX_UPSCALE = 8
const MARGIN = 12                   // 흰 여백 (업스케일 후 px)
const DIGIT_MARGIN = 28
/** 마커 크롭에서 지울 테두리 띠 (한 변 대비). 링을 지우고 속 숫자만 남긴다 */
const RING_BAND = 0.17

type Gray = { w: number; h: number; g: Uint8ClampedArray }

/** tesseract에 넘길 크롭을 전처리해 BMP data URL로. 크롭이 성립하지 않으면 null */
export function prepareCrop(
  raster: Raster,
  rect: PxRect,
  kind: CropKind,
): string | null {
  const img = grayCrop(raster, rect)
  if (!img || img.w < 4 || img.h < 4) return null
  if (kind === 'marker') eraseRing(img)
  stretch(img)
  // 한 글자만 든 크롭은 더 크게 키우고 여백도 넓게 준다 — tesseract는 글자 하나를
  // 줄 단위보다 까다롭게 본다(실측: 56px에서 '0'을 통째로 놓치던 칸이 96px에서 읽힌다)
  const targetH = kind === 'digit' ? DIGIT_TARGET_H : TARGET_H
  const margin = kind === 'digit' ? DIGIT_MARGIN : MARGIN
  const scaled = resize(img, Math.min(MAX_UPSCALE, Math.max(1, targetH / img.h)))
  return `data:image/bmp;base64,${toBase64(toBmp(withMargin(scaled, margin)))}`
}

/**
 * 번호 크롭 안의 숫자 칸 — 열 투영의 골로 나눈다.
 *
 * 자릿수를 픽셀로 미리 알아 두면 OCR을 스스로 검산할 수 있다. tesseract는 굵은
 * 서체의 두 자리 수를 통째로 넘기면 곧잘 흘린다 — 실측 베이직쎈 p49에서 "11"을 "1"로
 * 읽었다. 읽은 자릿수가 칸 수에 못 미치면 한 자씩 다시 읽는다(readNumber).
 */
function digitCells(raster: Raster, rect: PxRect): PxRect[] {
  const img = grayCrop(raster, rect)
  if (!img || img.w < 4 || img.h < 4) return []
  stretch(img)

  const cols = new Uint32Array(img.w)
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) if (img.g[y * img.w + x] < 128) cols[x]++
  }
  const filled = [...cols].filter((v) => v > 0)
  if (!filled.length) return []
  const cut = Math.max(1, median(filled) * 0.35)
  const minW = Math.max(2, img.h * 0.15)

  const out: PxRect[] = []
  let start = -1
  const flush = (end: number) => {
    if (start >= 0 && end - start >= minW) {
      let y0 = img.h
      let y1 = -1
      for (let y = 0; y < img.h; y++) {
        for (let x = start; x < end; x++) {
          if (img.g[y * img.w + x] < 128) {
            if (y < y0) y0 = y
            if (y > y1) y1 = y
            break
          }
        }
      }
      if (y1 >= y0) {
        out.push({
          x0: rect.x0 + start,
          x1: rect.x0 + end - 1,
          y0: rect.y0 + y0,
          y1: rect.y0 + y1,
        })
      }
    }
    start = -1
  }
  for (let x = 0; x < img.w; x++) {
    if (cols[x] >= cut) {
      if (start < 0) start = x
    } else flush(x)
  }
  flush(img.w)
  return out
}

function median(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[s.length >> 1]
}

/**
 * 회색조 크롭. 값은 luma − chroma — 검정 글자는 luma가 낮아서, 색 글자는 chroma가
 * 커서 어두워지고 종이는 둘 다 아니라 밝게 남는다. 문턱을 하나 정해 가르는 것보다
 * 연속값을 그대로 두는 쪽이 낫다 — 이진화는 tesseract가 알아서 한다.
 */
function grayCrop(raster: Raster, rect: PxRect): Gray | null {
  const x0 = Math.max(0, rect.x0)
  const y0 = Math.max(0, rect.y0)
  const x1 = Math.min(raster.width - 1, rect.x1)
  const y1 = Math.min(raster.height - 1, rect.y1)
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  if (w <= 0 || h <= 0) return null

  const g = new Uint8ClampedArray(w * h)
  const d = raster.rgba
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = ((y0 + y) * raster.width + (x0 + x)) * 4
      const R = d[o]
      const G = d[o + 1]
      const B = d[o + 2]
      const luma = R * 0.299 + G * 0.587 + B * 0.114
      const chroma = Math.max(R, G, B) - Math.min(R, G, B)
      g[y * w + x] = luma - chroma
    }
  }
  return { w, h, g }
}

/** 마커 bbox는 링에 딱 붙는다 — 테두리 띠를 종이색으로 지우면 속 숫자만 남는다 */
function eraseRing(img: Gray) {
  const band = Math.max(2, Math.round(Math.min(img.w, img.h) * RING_BAND))
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (x < band || y < band || x >= img.w - band || y >= img.h - band) {
        img.g[y * img.w + x] = 255
      }
    }
  }
}

/** 대비 정규화 — 어두운 끝(글자)을 0으로, 밝은 무리(종이)를 255로 편다 */
function stretch(img: Gray) {
  const hist = new Uint32Array(256)
  for (const v of img.g) hist[v]++
  const n = img.g.length
  const percentile = (p: number) => {
    let seen = 0
    for (let v = 0; v < 256; v++) {
      seen += hist[v]
      if (seen >= n * p) return v
    }
    return 255
  }
  const lo = percentile(0.01)
  const hi = percentile(0.9)         // 종이가 다수라 90분위는 반드시 종이다
  if (hi - lo < 24) return           // 글자가 없는 밋밋한 크롭 — 펴 봐야 잡음만 커진다
  const k = 255 / (hi - lo)
  for (let i = 0; i < n; i++) img.g[i] = (img.g[i] - lo) * k
}

/** 쌍선형 확대 */
function resize(img: Gray, s: number): Gray {
  if (s === 1) return img
  const w = Math.round(img.w * s)
  const h = Math.round(img.h * s)
  const g = new Uint8ClampedArray(w * h)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.h - 1, y / s)
    const y0 = Math.floor(sy)
    const y1 = Math.min(img.h - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.w - 1, x / s)
      const x0 = Math.floor(sx)
      const x1 = Math.min(img.w - 1, x0 + 1)
      const fx = sx - x0
      const top = img.g[y0 * img.w + x0] * (1 - fx) + img.g[y0 * img.w + x1] * fx
      const bottom = img.g[y1 * img.w + x0] * (1 - fx) + img.g[y1 * img.w + x1] * fx
      g[y * w + x] = top * (1 - fy) + bottom * fy
    }
  }
  return { w, h, g }
}

function withMargin(img: Gray, margin = MARGIN): Gray {
  const w = img.w + margin * 2
  const h = img.h + margin * 2
  const g = new Uint8ClampedArray(w * h).fill(255)
  for (let y = 0; y < img.h; y++) g.set(img.g.subarray(y * img.w, (y + 1) * img.w), (y + margin) * w + margin)
  return { w, h, g }
}

/** 24비트 무압축 BMP — Node·브라우저 양쪽에서 통하는 가장 단순한 컨테이너 */
function toBmp(img: Gray): Uint8Array {
  const stride = (img.w * 3 + 3) & ~3
  const size = 54 + stride * img.h
  const b = new Uint8Array(size)
  const v = new DataView(b.buffer)
  b[0] = 0x42                        // 'B'
  b[1] = 0x4d                        // 'M'
  v.setUint32(2, size, true)
  v.setUint32(10, 54, true)          // 픽셀 시작 오프셋
  v.setUint32(14, 40, true)          // DIB 헤더 크기
  v.setInt32(18, img.w, true)
  v.setInt32(22, img.h, true)        // 양수 = 아래 행부터
  v.setUint16(26, 1, true)
  v.setUint16(28, 24, true)
  for (let y = 0; y < img.h; y++) {
    let o = 54 + (img.h - 1 - y) * stride
    for (let x = 0; x < img.w; x++) {
      const c = img.g[y * img.w + x]
      b[o++] = c
      b[o++] = c
      b[o++] = c
    }
  }
  return b
}

// btoa는 브라우저와 Node(18+) 양쪽에 있다. Node 전용 Buffer를 쓰지 않는 이유는
// 이 파일이 앱 번들에 들어가기 때문이다 — 앱 코드에는 Node 전역이 없어야 한다
function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

// ============================================================ tesseract 워커
//
// 워커 하나를 지연 생성해 재사용한다 — 만들 때 wasm과 eng 모델을 내려받아 수 초가
// 걸리지만 그다음부터는 크롭당 수십 ms다. PSM(한 줄 vs 한 글자)이 호출마다 달라
// setParameters→recognize 짝이 섞이면 안 된다 — FIFO 큐로 직렬화한다.

const PSM_LINE = '7'                // PSM.SINGLE_TEXT_LINE — 번호 "0109"
const PSM_WORD = '8'                // PSM.SINGLE_WORD — 마커 속 숫자 1차
// 마커 2차 — SINGLE_WORD가 가는 "1"을 빈 결과로 내는 케이스를 SINGLE_CHAR가 읽는다.
// 반대 순서는 안 된다: SINGLE_CHAR는 "4"를 통째로 놓치거나 "2"를 "9"로 읽었다(실측)
const PSM_CHAR = '10'

let workerPromise: Promise<TesseractWorker> | null = null
let queue: Promise<unknown> = Promise.resolve()
let workerOptions: Partial<WorkerOptions> = {}

/** 워커 생성 옵션 (cachePath 등). 첫 인식 전에 불러야 한다 — 테스트용 */
export function configureOcr(options: Partial<WorkerOptions>) {
  workerOptions = options
}

async function getWorker(): Promise<TesseractWorker> {
  workerPromise ??= (async () => {
    const { createWorker } = await import('tesseract.js')
    // 숫자만 읽는다 — 사전(dawg)은 도움이 안 되고 켜 두면 낱말로 "고쳐" 읽는다
    return createWorker('eng', 1, workerOptions, {
      load_system_dawg: '0',
      load_freq_dawg: '0',
    })
  })()
  return workerPromise
}

export async function terminateOcr() {
  const p = workerPromise
  workerPromise = null
  queue = Promise.resolve()
  if (p) await (await p).terminate()
}

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

// LSTM은 whitelist를 흘리기도 한다 — 닮은꼴 글자를 되돌리고 나머지는 버린다
const LOOKALIKE: Record<string, string> = {
  O: '0', o: '0', Q: '0', D: '0',
  I: '1', l: '1', i: '1', '|': '1', ']': '1', '[': '1',
  Z: '2', z: '2',
  A: '4',
  S: '5', s: '5',
  G: '6', b: '6',
  T: '7',
  B: '8',
  g: '9', q: '9',
}

function toDigits(text: string): string {
  let out = ''
  for (const ch of text) {
    const mapped = LOOKALIKE[ch] ?? ch
    if (mapped >= '0' && mapped <= '9') out += mapped
  }
  return out
}

async function recognizeCrop(
  raster: Raster,
  rect: PxRect,
  kind: CropKind,
): Promise<OcrRead | null> {
  const url = prepareCrop(raster, rect, kind)
  if (!url) return null
  return enqueue(async () => {
    const worker = await getWorker()
    const pass = async (psm: string): Promise<OcrRead> => {
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: psm as never,
      })
      const { data } = await worker.recognize(url)
      return { digits: toDigits(data.text), confidence: data.confidence }
    }
    const first = await pass(kind === 'number' ? PSM_LINE : PSM_WORD)
    if (first.digits || kind === 'number') return first
    return pass(PSM_CHAR)
  })
}
