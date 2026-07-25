// 데이터 모델 — 아키텍처 명세서 §4
// 모든 좌표는 MAX_W = 760 기준 정규화 좌표 (§5)

export type Box = { x: number; y: number; w: number; h: number }

// ---------- 문서 ----------

export type Document = {
  id: string
  name: string
  problemPdfPath: string          // Filesystem 경로
  answerPdfPath?: string
  pageCount: number
  regionCount?: number            // 분할된 문항 총수 (F-01 표시용, 업로드 시 계산)
  thumbnail: string               // dataURL, 1페이지 렌더
  createdAt: number
  lastOpenedAt: number
  lastPage: number                // 재진입 시 복원
  gradable: boolean               // 텍스트 레이어 유무
  deletedAt?: number              // 휴지통 (soft delete). 없으면 정상 노트
}

// ---------- 구역 ----------

export type ChoiceLabel = 1 | 2 | 3 | 4 | 5

export type Region = {
  id: string
  docId: string
  page: number
  bounds: Box                     // 문제 전체 경계
  numBox?: Box
  numLabel?: string               // 인식된 문제 번호
  stemBox?: Box
  ansBox?: Box
  choices: { label: ChoiceLabel; box: Box }[]   // 비어 있으면 주관식
  ansSynth: boolean
  ptsBox?: Box
  figBox?: Box
  workBox?: Box
  answerType: 'choice' | 'integer' | 'expression'   // 1차는 choice만 채점
}

export type SegmentCache = {
  docId: string
  page: number
  regions: Region[]
  segmentVersion: number          // 알고리즘 버전. 불일치 시 재계산
}

// ---------- 필기 ----------

export type Point = { x: number; y: number; p: number; t: number }

export type StrokeTool = 'pen' | 'hi'   // hi = 형광펜. 채점 판정에서 제외된다

export type Stroke = {
  id: string
  regionId: string | null         // null = orphan
  attemptNo: number
  tool?: StrokeTool               // 기본 pen
  color?: string                  // 기본 잉크색 (시안2 blue)
  points: Point[]
}

// 키보드 텍스트 박스 — 좌표·폭은 정규화 좌표
export type TextItem = {
  id: string
  x: number
  y: number
  w: number
  text: string
}

export type PageInk = {                  // 저장 단위는 페이지
  docId: string
  page: number
  strokes: Stroke[]
  texts?: TextItem[]
}

// ---------- 정답 · 채점 ----------

export type AnswerSource = 'answerPdf' | 'inlineKey' | 'manual'

export type AnswerEntry = {
  regionId: string
  value: string                   // 객관식은 '1'~'5'
  source: AnswerSource            // 문항 단위. 문서 단위가 아니다
}

export type AnswerKey = {
  docId: string
  entries: AnswerEntry[]
}

export type AttemptResult = 'unattempted' | 'nokey' | 'correct' | 'incorrect'

export type Attempt = {
  docId: string
  regionId: string
  no: number                      // 1부터
  detected: string | null         // 판정된 학생 답
  result: AttemptResult
  gradedAt: number
}

export type RetryList = {                // 채점 시점 갱신 — 오답 이력 누적 관리
  docId: string
  gradedAt: number
  regionIds: string[]                    // 미졸업 오답 이력 (3연속 정답 전)
  graduated?: string[]                   // 이번 채점으로 갓 졸업한 문항 — 한 번 표시 후 다음 채점에서 제거
}

// 문제별 현재 회차 (F-09 — 회차는 전역 카운터가 아니라 문제별이다)
export type AttemptState = {
  docId: string
  byRegion: Record<string, number>       // regionId → 현재 회차 (기본 1)
}
