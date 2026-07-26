// PSP — 문제집 분할 파이프라인 (PRD v0.1) 데이터 모델 §3
//
// 좌표계는 하나뿐이다: 정규화 [0,1], 페이지 좌상단 원점.
// PDF 원본(좌하단 원점) → 이 좌표계 변환은 adapter.ts 한 곳에서만 일어난다 (§2, 준비도 #2).

/** [x0, y0, x1, y1] — 정규화 좌표. 페이지 기준 또는 문제 bbox 기준(Region) */
export type BBox = [number, number, number, number]

export type SourceType = 'TEXT_LAYER' | 'SCANNED'
export type JobStatus = 'QUEUED' | 'RUNNING' | 'NEEDS_REVIEW' | 'DONE' | 'FAILED'
export type Stage = 'PROBE' | 'LAYOUT' | 'ANCHOR' | 'SLICE' | 'REGION' | 'RENDER' | 'VERIFY'

export type RegionKind =
  | 'STEM'
  | 'FIGURE'
  | 'CHOICES'
  | 'CHOICE_ITEM'
  | 'WORK_AREA'

export type ProblemType = 'MULTIPLE_CHOICE' | 'SHORT_ANSWER' | 'DESCRIPTIVE' | 'UNKNOWN'

// ---------- 플래그 (§6.1) ----------

export type Flag =
  | 'FLAG_NUMBER_GAP'
  | 'FLAG_CHOICES_MISSING'
  | 'FLAG_HITBOX_COLLISION'
  | 'FLAG_SPANS_BOUNDARY'
  | 'FLAG_BBOX_OVERLAP'
  | 'FLAG_LOW_COVERAGE'
  | 'FLAG_COLUMN_AMBIGUOUS'
  | 'FLAG_ASPECT_ANOMALY'
  | 'FLAG_TOO_SMALL'
  | 'FLAG_NUMBER_DISORDER'
  | 'FLAG_CHOICE_LAYOUT_MIXED'   // 부록 A — 가로/세로 혼재. 무조건 검수

/** §6.2 신뢰도 가중치. confidence = 1.0 − Σ(가중치), 하한 0 */
export const FLAG_WEIGHT: Record<Flag, number> = {
  FLAG_NUMBER_GAP: 0.4,
  FLAG_CHOICES_MISSING: 0.35,
  FLAG_HITBOX_COLLISION: 0.3,
  FLAG_SPANS_BOUNDARY: 0.3,
  FLAG_BBOX_OVERLAP: 0.25,
  FLAG_LOW_COVERAGE: 0.2,
  FLAG_COLUMN_AMBIGUOUS: 0.2,
  FLAG_ASPECT_ANOMALY: 0.15,
  FLAG_TOO_SMALL: 0.15,
  FLAG_NUMBER_DISORDER: 0.1,
  // PRD 미기재 — 부록 A "배치 자동 판정 실패 시 무조건 검수로"를 수치화한 값.
  // SPANS_BOUNDARY와 같은 성격(자동 처리하되 항상 검수)이라 동일 가중치를 준다.
  FLAG_CHOICE_LAYOUT_MIXED: 0.3,
}

// ---------- 에러 (§7) ----------

export type ErrorCode =
  | 'ERR_FILE_UNREADABLE'
  | 'ERR_ENCRYPTED'
  | 'ERR_UNSUPPORTED_SOURCE'
  | 'ERR_NO_ANCHOR'
  | 'ERR_PAGE_LIMIT'
  | 'ERR_RENDER_FAILED'
  | 'ERR_STORAGE_FULL'
  | 'ERR_TIMEOUT'

/** 재시도 가능 여부를 코드 레벨에서 구분한다 (준비도 #10) */
export const RETRYABLE: Record<ErrorCode, number> = {
  ERR_FILE_UNREADABLE: 0,
  ERR_ENCRYPTED: 0,
  ERR_UNSUPPORTED_SOURCE: 0,
  ERR_NO_ANCHOR: 0,
  ERR_PAGE_LIMIT: 0,
  ERR_RENDER_FAILED: 3,
  ERR_STORAGE_FULL: 3,
  ERR_TIMEOUT: 1,
}

export const ERROR_MESSAGE: Record<ErrorCode, string> = {
  ERR_FILE_UNREADABLE: '파일을 열 수 없습니다. 다른 파일을 올려주세요.',
  ERR_ENCRYPTED: '암호가 설정된 파일입니다. 암호를 해제한 뒤 올려주세요.',
  ERR_UNSUPPORTED_SOURCE: '현재는 텍스트가 포함된 PDF만 지원합니다.',
  ERR_NO_ANCHOR: '문제 번호를 찾지 못했습니다. 직접 나누기로 진행할까요?',
  ERR_PAGE_LIMIT: '한 번에 200페이지까지 처리할 수 있습니다.',
  ERR_RENDER_FAILED: '',
  ERR_STORAGE_FULL: '저장 공간이 부족합니다.',
  ERR_TIMEOUT: '처리가 지연되고 있습니다.',
}

export class PspError extends Error {
  constructor(readonly code: ErrorCode) {
    super(ERROR_MESSAGE[code] || code)
    this.name = 'PspError'
  }
}

// ---------- 입력 모델 ----------
// PDF 리더(pdf.js / PyMuPDF / 테스트 픽스처)를 갈아끼울 수 있도록
// 파이프라인은 아래 순수 데이터만 받는다. DOM·pdf.js 의존이 없다.

export type Span = {
  text: string
  bbox: BBox
  /** 페이지 높이 대비 정규화 폰트 크기. A-3 판정용 */
  fontSize: number
  bold: boolean
}

export type PageInput = {
  index: number            // 0-based
  width: number            // pt — 종횡비 계산용
  height: number           // pt
  spans: Span[]
  /** PDF 임베디드 이미지 객체 bbox (§5.3-2) */
  images?: BBox[]
  /** 벡터 드로잉 bbox (§5.3-2) */
  drawings?: BBox[]
}

// ---------- 산출 모델 (§3.1) ----------

export type Region = {
  id: string
  kind: RegionKind
  /** ★ 문제 bbox 기준 상대 정규화 좌표 (§3.1). 페이지 좌표는 toPageBBox()로 환산 */
  bbox: BBox
  /** CHOICE_ITEM 판정용 확장 박스 (RULE-HITBOX). 상대 좌표 */
  hitbox?: BBox
  ordinal: number | null
  confidence: number
}

export type Problem = {
  id: string
  jobId: string
  pageIndex: number
  columnIndex: 0 | 1
  number: string
  numberInt: number | null
  bbox: BBox
  /** 번호 앵커 span의 bbox (페이지 좌표) — 검수 UI 번호 편집·오버레이 라벨 위치 */
  numberBBox: BBox
  /** 컬럼·페이지 넘김 시의 두 번째 조각 (§5.2). PRD 스키마 확장 — 아래 주석 참조 */
  continuation?: { pageIndex: number; columnIndex: 0 | 1; bbox: BBox }
  cropUri: string
  ocrText: string | null
  problemType: ProblemType
  regions: Region[]
  confidence: number
  flags: Flag[]
  reviewedAt: string | null
}

export type SegmentationJob = {
  id: string
  sourceUri: string
  sourceType: SourceType
  pageRange: [number, number]
  status: JobStatus
  stage: Stage
  retryCount: number
  errorCode?: ErrorCode
  createdAt: string
  updatedAt: string
}

// ---------- BBox 유틸 ----------

export const bboxW = (b: BBox) => b[2] - b[0]
export const bboxH = (b: BBox) => b[3] - b[1]
export const bboxArea = (b: BBox) => Math.max(0, bboxW(b)) * Math.max(0, bboxH(b))

/** 겹침 "면적" — 변끼리 맞닿은 것(면적 0)은 겹침이 아니다 (INV-2) */
export function intersectArea(a: BBox, b: BBox): number {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0])
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1])
  return w > 0 && h > 0 ? w * h : 0
}

export function unionBBox(boxes: BBox[]): BBox {
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ]
}

export function iou(a: BBox, b: BBox): number {
  const inter = intersectArea(a, b)
  const union = bboxArea(a) + bboxArea(b) - inter
  return union > 0 ? inter / union : 0
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export function clampBBox(b: BBox): BBox {
  return [clamp01(b[0]), clamp01(b[1]), clamp01(b[2]), clamp01(b[3])]
}

/** Region의 상대 좌표 → 페이지 좌표 */
export function toPageBBox(region: BBox, problem: BBox): BBox {
  const w = bboxW(problem)
  const h = bboxH(problem)
  return [
    problem[0] + region[0] * w,
    problem[1] + region[1] * h,
    problem[0] + region[2] * w,
    problem[1] + region[3] * h,
  ]
}

/** 페이지 좌표 → 문제 bbox 기준 상대 좌표 */
export function toRelBBox(page: BBox, problem: BBox): BBox {
  const w = bboxW(problem) || 1
  const h = bboxH(problem) || 1
  return [
    (page[0] - problem[0]) / w,
    (page[1] - problem[1]) / h,
    (page[2] - problem[0]) / w,
    (page[3] - problem[1]) / h,
  ]
}
