# 푸리 1차 MVP — 아키텍처 명세서

## 0. 메타데이터

| 항목 | 값 |
|---|---|
| 버전 | v0.1 |
| 작성일 | 2026-07-24 |
| 관련 문서 | `푸리_1차MVP_시스템명세서.md`, `SEGMENTATION.md` |
| 문서 성격 | AI 코딩 도구에 프롬프트로 투입 가능한 수준의 구현 지침 |

이 문서는 **무엇을 쓰고 어떻게 구현하는가**를 정의한다. 기능 정의는 시스템 명세서에 있다.

---

## 1. 시스템 구성

```
┌─────────────────────────────────────────────┐
│  Android 기기                                │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │  Capacitor WebView (Chromium)         │  │
│  │                                       │  │
│  │   React + TypeScript                  │  │
│  │   ├─ PDF 렌더링   (pdf.js)            │  │
│  │   ├─ 필기 캔버스  (PointerEvent)      │  │
│  │   ├─ 구역 분할    (순수 TS)           │  │
│  │   └─ 채점 판정    (순수 TS, 기하)     │  │
│  └───────────────┬───────────────────────┘  │
│                  │ Capacitor Bridge          │
│  ┌───────────────┴───────────────────────┐  │
│  │  Filesystem (PDF)  ·  App (생명주기)  │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  IndexedDB (스트로크·회차·정답·분할결과)      │
└─────────────────────────────────────────────┘

외부 통신 없음. 서버 없음. API 키 없음.
```

**아키텍처상 가장 중요한 성질은 외부 의존이 0이라는 것이다.** AI 호출, 프록시 서버, 인증, 네트워크 재시도, 오프라인 큐가 모두 존재하지 않는다. 실패 지점이 파일 시스템과 IndexedDB 두 곳뿐이다.

---

## 2. 기술 스택

### 2.1 핵심

| 영역 | 선택 | 선정 이유 |
|---|---|---|
| 앱 셸 | Capacitor (Android) | 기존 푸리 아키텍처 결정 유지. 웹 코드를 그대로 앱으로 감싼다 |
| UI | React + TypeScript | 기존 스택 |
| 번들러 | **Vite** | 아래 2.2 참조 |
| 스타일 | Tailwind CSS | 기존 스택 |
| 상태 | Zustand | Redux는 이 규모에 과하고, Context는 필기 중 리렌더가 잦아 부적합 |
| 로컬 DB | IndexedDB (`idb` 래퍼) | 스트로크는 용량이 커서 `localStorage` 불가 |
| 파일 | `@capacitor/filesystem` | PDF 원본 저장 |
| 생명주기 | `@capacitor/app` | 백그라운드 진입 시 저장 flush |

### 2.2 Next.js를 쓰지 않는 이유

평소 스택은 Next.js지만 이 프로젝트에는 맞지 않는다. Next.js는 서버 렌더링과 라우팅 서버를 전제로 설계되어 있고, Capacitor는 정적 번들을 웹뷰에 밀어 넣는 방식이다. `next export`로 우회할 수 있으나 App Router의 상당 기능이 죽고 설정이 늘어난다. 이 앱은 서버가 없고 화면이 3개이므로 SSR·파일 기반 라우팅의 이득이 전혀 없다.

**Vite + React + `react-router` (또는 상태 기반 화면 전환)** 로 간다. Capacitor 공식 템플릿도 Vite 기반이다.

### 2.3 라이브러리

| 패키지 | 용도 | 비고 |
|---|---|---|
| `@capacitor/core`, `@capacitor/android` | 앱 셸 | |
| `@capacitor/filesystem` | PDF 원본 저장·읽기 | |
| `@capacitor/app` | `appStateChange`로 백그라운드 감지 | |
| `pdfjs-dist` | PDF 렌더링, 텍스트 레이어 추출 | 이미 사용 중 |
| `idb` | IndexedDB 프로미스 래퍼 | 원본 API는 콜백 기반이라 다루기 번거롭다 |
| `zustand` | 상태 관리 | |
| `perfect-freehand` | 스트로크 보간 | **조건부** — 아래 6.3 참조 |
| `tailwindcss` | 스타일 | |
| `vite` | 빌드 | |
| `vitest` | 단위 테스트 | 분할·귀속·채점 순수 함수 대상 |

버전은 설치 시점의 안정 버전을 쓰되, `pdfjs-dist`는 워커 버전과 본체 버전이 반드시 일치해야 한다.

**사용하지 않는 것** — AI SDK, HTTP 클라이언트, 인증 라이브러리, OCR 엔진, CAS 라이브러리, PDF 생성 라이브러리(`pdf-lib`, `jsPDF`). 1차 범위에 해당 기능이 없다.

---

## 3. 저장소 구조

기존 모노레포(Turborepo + pnpm)의 `apps/student-mobile`을 그대로 사용한다.

```
apps/student-mobile/
├── android/                     Capacitor 네이티브 프로젝트
├── src/
│   ├── lib/
│   │   ├── pdf.ts               PDF 로드·렌더 (기존)
│   │   ├── segment.ts           구역 분할 (기존, choices 추가)
│   │   ├── attribution.ts       스트로크 귀속 판정          [신규]
│   │   ├── grading.ts           객관식 기하 판정            [신규]
│   │   ├── answerKey.ts         정답지·정답표 파싱          [신규]
│   │   ├── geometry.ts          좌표·박스·고리 판정 유틸    [신규]
│   │   └── db.ts                IndexedDB 접근              [신규]
│   ├── components/
│   │   ├── DocumentList.tsx     F-01
│   │   ├── PdfCanvas.tsx        PDF 렌더 레이어
│   │   ├── InkCanvas.tsx        필기 레이어                 [신규]
│   │   ├── GradeOverlay.tsx     ○ / ／ + 회차 칩            [신규]
│   │   ├── AnswerKeySheet.tsx   F-06                        [신규]
│   │   └── ZoneDebug.tsx        구역 색 오버레이 (기존)
│   ├── stores/
│   │   ├── documentStore.ts
│   │   └── inkStore.ts
│   └── types.ts
└── capacitor.config.ts
```

`src/lib` 아래는 **DOM과 React에 의존하지 않는 순수 함수**로 유지한다. 분할·귀속·채점은 전부 좌표 연산이므로 노드 환경에서 테스트할 수 있어야 한다. 이 경계가 유일한 아키텍처 규칙이다.

---

## 4. 데이터 모델

```ts
type Box = { x: number; y: number; w: number; h: number }

// ---------- 문서 ----------

type Document = {
  id: string
  name: string
  problemPdfPath: string          // Filesystem 경로
  answerPdfPath?: string
  pageCount: number
  thumbnail: string               // dataURL, 1페이지 렌더
  createdAt: number
  lastOpenedAt: number
  lastPage: number                // 재진입 시 복원
  gradable: boolean               // 텍스트 레이어 유무
}

// ---------- 구역 ----------

type Region = {
  id: string
  docId: string
  page: number
  bounds: Box                     // 문제 전체 경계
  numBox?: Box
  numLabel?: string               // 인식된 문제 번호
  stemBox?: Box
  ansBox?: Box
  choices: { label: 1|2|3|4|5; box: Box }[]   // [신규] 비어 있으면 주관식
  ansSynth: boolean
  ptsBox?: Box
  figBox?: Box
  workBox?: Box
  answerType: 'choice' | 'integer' | 'expression'   // 1차는 choice만 채점
}

type SegmentCache = {
  docId: string
  page: number
  regions: Region[]
  segmentVersion: number          // 알고리즘 버전. 불일치 시 재계산
}

// ---------- 필기 ----------

type Point = { x: number; y: number; p: number; t: number }

type Stroke = {
  id: string
  regionId: string | null         // null = orphan
  attemptNo: number
  points: Point[]
}

type PageInk = {                  // 저장 단위는 페이지
  docId: string
  page: number
  strokes: Stroke[]
}

// ---------- 정답 · 채점 ----------

type AnswerSource = 'answerPdf' | 'inlineKey' | 'manual'

type AnswerEntry = {
  regionId: string
  value: string                   // 객관식은 '1'~'5'
  source: AnswerSource            // 문항 단위. 문서 단위가 아니다
}

type AnswerKey = {
  docId: string
  entries: AnswerEntry[]
}

type Attempt = {
  docId: string
  regionId: string
  no: number                      // 1부터
  detected: string | null         // 판정된 학생 답
  result: 'unattempted' | 'nokey' | 'correct' | 'incorrect'
  gradedAt: number
}

type RetryList = {                // 채점 시점에 freeze
  docId: string
  gradedAt: number
  regionIds: string[]
}
```

### IndexedDB 스토어

| 스토어 | 키 | 인덱스 |
|---|---|---|
| `documents` | `id` | `lastOpenedAt` |
| `segments` | `[docId, page]` | `docId` |
| `ink` | `[docId, page]` | `docId` |
| `answerKeys` | `docId` | — |
| `attempts` | `[docId, regionId, no]` | `docId` |
| `retryLists` | `docId` | — |

**스트로크는 페이지 단위로 묶어 저장한다.** 획 하나당 레코드를 만들면 수천 개가 되어 조회가 번거로워진다. 페이지 단위 묶음이면 획 추가 시 페이지 전체를 다시 쓰게 되지만, 페이지당 수백 획이라도 수십 KB 수준이라 1초 디바운스와 함께라면 문제없다.

---

## 5. 좌표계

**모든 좌표는 `MAX_W = 760` 기준 정규화 좌표로 저장한다.** 기존 `segment.ts`가 이미 쓰는 좌표계이며, 스트로크도 같은 계로 통일한다.

```
화면 좌표 → 정규화 좌표 :  (clientX - rect.left) / scale * (MAX_W / rect.width)
정규화 좌표 → 화면 좌표 :  역변환
```

이 규칙이 다음을 한꺼번에 해결한다.

- 핀치 확대·축소는 **뷰 변환일 뿐**이며 저장되는 좌표를 바꾸지 않는다
- 기기 해상도·DPR과 무관하게 같은 데이터가 나온다
- 분할 결과(Region)와 스트로크가 같은 계에 있으므로 귀속 판정이 좌표 변환 없이 성립한다

**렌더링은 별개다.** 캔버스 백킹 스토어는 `devicePixelRatio`를 곱해 잡고, 확대 시에는 확대 배율만큼 다시 렌더해야 획이 뭉개지지 않는다.

---

## 6. 필기 파이프라인

### 6.1 캔버스 레이어 구조

페이지마다 세 겹으로 쌓는다.

```
GradeOverlay   ○ / ／ , 회차 칩          (DOM 또는 SVG)
InkCanvas      필기                      (canvas ×2, 아래 6.2)
PdfCanvas      PDF 렌더                  (canvas)
```

**20페이지를 전부 렌더하지 않는다.** 보이는 페이지 ±1만 렌더하고 나머지는 해제한다. 전체를 렌더하면 메모리가 터진다.

### 6.2 필기 캔버스는 둘로 나눈다

| 캔버스 | 내용 | 갱신 |
|---|---|---|
| 확정 레이어 | 이미 그린 스트로크 전부 | `pointerup` 시 1회 |
| 활성 레이어 | 지금 그리는 중인 스트로크 하나 | `pointermove`마다 |

한 장에 다 그리면 획이 늘어날수록 매 프레임 전체를 다시 그리게 되어 5000획에서 프레임이 무너진다.

### 6.3 이벤트 처리

```ts
element.style.touchAction = 'none'

onPointerDown(e) {
  if (e.pointerType !== 'pen' && !DEV_MOUSE_INK) return   // 손가락은 스크롤로
  element.setPointerCapture(e.pointerId)
  startStroke(e)
}

onPointerMove(e) {
  if (e.buttons === 0) return
  const pts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]
  for (const p of pts) addPoint(p)      // 중간 좌표 손실 방지
  drawActiveLayer()
}

onPointerUp(e) {
  const regionId = attribute(stroke, regionsOfPage)   // 여기서 1회만 계산
  commitStroke({ ...stroke, regionId })
  scheduleSave()                                       // 1초 디바운스
}
```

`perfect-freehand`는 `getCoalescedEvents`가 없거나 샘플링이 성긴 기기에서만 투입한다. 좌표가 촘촘히 들어오면 단순 보간으로 충분하고, 라이브러리를 넣으면 스트로크 표현이 아웃라인 폴리곤으로 바뀌어 귀속 판정 코드가 복잡해진다.

### 6.4 실기기 전제 (미검증)

아래는 **가정값**이며 스파이크 후 실측으로 대체한다.

```json
{
  "_status": "ASSUMED — 미측정",
  "penSeen": true,
  "touchDuringPen": 0,
  "pressure": { "min": 0.08, "max": 0.94, "distinct": 87 },
  "coalesced": { "supported": true, "max": 6, "avg": 2.8 },
  "scrolledWhileDrawing": false,
  "latencyMedianMs": 34,
  "sampleHz": 118,
  "zoomAccuracy": "pass"
}
```

| 가정 | 걸린 결정 | 틀렸을 때 |
|---|---|---|
| `pressure` 가변 | 필압 기반 굵기 | 균일 굵기로 교체. **네이티브 캡처 재검토** |
| `coalesced` 지원 | 보간 없이 직결 | `perfect-freehand` 투입 |
| 지연 34ms | 웹뷰로 진행 | 60ms 초과 시 네이티브 캡처 |
| `zoomAccuracy` pass | 5장 좌표계 유지 | 코드 문제. 설계 불변 |

**설계가 뒤집히는 것은 `pressure` 하나뿐이다.**

---

## 7. 핵심 알고리즘

### 7.1 스트로크 귀속 (`attribution.ts`)

```ts
const PAD = 8
const STRONG = 0.6
const WEAK = 0.3

function attribute(stroke: Stroke, regions: Region[]): string | null {
  const scored = regions.map(r => ({
    id: r.id,
    coverage: ratioInside(stroke.points, expand(r.bounds, PAD)),
  }))

  const best = scored.reduce((a, b) => (b.coverage > a.coverage ? b : a))

  if (best.coverage >= STRONG) return best.id
  if (best.coverage >= WEAK) return best.id
  return null                      // orphan
}
```

- 스트로크를 절대 분할하지 않는다
- 기준은 `Region.bounds` 전체이며 `workBox`가 아니다
- orphan은 화면에 표시되지만 채점 대상에서 빠진다
- 중심점 방식을 쓰지 않는다. 분수 막대나 긴 대각선 획에서 중심이 엉뚱한 곳에 찍힌다

### 7.2 객관식 판정 (`grading.ts`)

```ts
function detectChoice(region: Region, strokes: Stroke[]): number | null {
  const candidates: { label: number; at: number }[] = []

  for (const s of strokes) {
    const label = isClosedLoop(s.points)
      ? choiceInsideLoop(s.points, region.choices)     // 고리 내부에 중심이 들어오는 선지
      : choiceByOverlap(s.points, region.choices)      // 겹치는 점 비율 최대
    if (label) candidates.push({ label, at: lastTime(s) })
  }

  if (!candidates.length) return null
  return candidates.sort((a, b) => b.at - a.at)[0].label   // 마지막 스트로크 우선
}

function isClosedLoop(pts: Point[]): boolean {
  const gap = dist(pts[0], pts[pts.length - 1])
  return gap < pathLength(pts) * 0.2
}
```

동그라미·빗금·체크·밑줄이 모두 이 한 규칙으로 처리된다. AI도 모델 파일도 필요 없다.

**지우개가 스트로크 단위여야 이 알고리즘이 성립한다.** 픽셀 지우개면 지운 자국이 배열에 남아 후보가 오염된다.

### 7.3 정답지 파싱 (`answerKey.ts`)

OCR을 쓰지 않는다. `pdf.js`의 `getTextContent()`로 텍스트를 뽑아 정규식으로 판정한다.

```ts
const PATTERNS = [
  /(\d{1,2})\s*[.)]?\s*([①②③④⑤])/g,      // 12. ③
  /(\d{1,2})\s*[.)]?\s*([1-5])(?!\d)/g,     // 12) 3
]
```

주의점 두 가지.

**PDF는 글자를 조각내서 준다.** `[3점]`이 `[`,`3`,`점`,`]`로 나뉘는 것과 같은 문제다. 기존 `ptsBox` 처리와 동일하게 **같은 줄 글자를 이어 붙인 뒤** 매치하고, 매치된 글자 범위를 좌표로 역매핑한다.

**해설 문장은 파싱하지 않는다.** `따라서 답은 ③이다` 형태는 1차 범위 밖이며 직접 입력으로 넘긴다.

### 7.4 선지 개별 분리 (`segment.ts` 수정)

현재 코드는 `①~⑩` 토큰을 개별로 찾은 뒤 하나의 `ansBox`로 합친다. **합치기 전 단계를 버리지 말고 `choices[]`로 보존한다.**

```
각 선지 상자의 우측 경계 = 다음 선지 기호의 x 직전
마지막 선지의 우측 경계 = 기존 ansBox 우측 경계
```

이 규칙 하나로 한 줄 5개 / 2줄 3+2 / 한 줄에 하나씩이 모두 처리된다. 깨진 PDF 경로(`isChoiceLikeLine`)는 이미 균등 간격 덩어리로 판정하므로 분리가 더 쉽다.

---

## 8. 저장 전략

| 대상 | 위치 | 시점 |
|---|---|---|
| PDF 원본 | Filesystem `documents/{docId}.pdf` | 업로드 시 1회 |
| 썸네일 | `documents` 레코드에 dataURL | 업로드 시 1회 |
| 스트로크 | IndexedDB `ink` | `pointerup` + 1초 디바운스 |
| 분할 결과 | IndexedDB `segments` | 업로드 시 1회, 버전 불일치 시 재계산 |
| 정답 | IndexedDB `answerKeys` | 입력 즉시 |
| 채점 결과 | IndexedDB `attempts` | 채점 시 |

```ts
App.addListener('appStateChange', ({ isActive }) => {
  if (!isActive) flushPendingSaves()      // 디바운스 대기분 즉시 저장
})
```

PDF를 IndexedDB에 Blob으로 넣지 않는다. 용량이 커서 Filesystem이 맞다.

---

## 9. 성능 예산

| 항목 | 기준 | 대응 |
|---|---|---|
| PDF 로드 | 20페이지 3초 | 페이지 지연 렌더 |
| 구역 분할 | 페이지당 200ms | 업로드 시 1회 후 캐시 |
| 필기 프레임 | 5000획에서 60fps | 확정/활성 레이어 분리 |
| 메모리 | 보이는 페이지 ±1만 유지 | 나머지 캔버스 해제 |
| 채점 | 20문항 1초 | 순수 기하 연산 |
| 저장 | 페이지당 수십 KB | 페이지 단위 묶음 + 디바운스 |

---

## 10. 테스트 대상

`src/lib` 아래 순수 함수만 단위 테스트한다. UI 테스트는 1차에서 하지 않는다.

| 모듈 | 검증 |
|---|---|
| `attribution.ts` | 경계 걸침, 완전 포함, orphan, 여러 Region 경합 |
| `grading.ts` | 닫힌 고리, 열린 마크, 두 선지 마크, 마크 없음 |
| `answerKey.ts` | 조각난 글자, 두 자리 문항, 원문자/숫자 혼용 |
| `segment.ts` | `choices` 분리 — 한 줄 5개, 2줄 3+2, 한 줄에 하나씩 |

---

## 11. 2차 이월

| 항목 | 사유 |
|---|---|
| 네이티브 펜 캡처 (Kotlin 플러그인) | 웹뷰 `PointerEvent`로 충분한지 스파이크 후 판단 |
| 주관식 인식 | 로컬 정수 분류기 또는 상용 SDK |
| 회차 겹쳐보기 | 1차는 전환만 |
| 필기 도구 확장 | 색상·형광펜·도형 |
| 오답노트 PDF 내보내기 | `pdf-lib` + `@capacitor/share` |
| iOS | Capacitor 구조상 추가 비용은 크지 않다 |
| 서버·동기화 | 배포 시 AI를 붙인다면 프록시 서버가 먼저 필요하다 |

---

## 12. 구현 순서 제안

1일차에 스파이크를 먼저 돌린다. 여기서 `pressure`가 실패하면 이후 순서가 바뀐다.

| 순서 | 작업 | 근거 |
|---|---|---|
| 1 | 실기기 필기 스파이크 | 유일하게 설계를 뒤집을 수 있는 미지수 |
| 2 | `segment.ts`에 `choices[]` 추가 + 테스트 | 채점의 전제. 순수 함수라 기기 없이 가능 |
| 3 | PDF 렌더 + 필기 캔버스 + 귀속 | 가장 큰 덩어리 |
| 4 | 저장·재진입 | 여기까지가 "도구"로서 성립하는 최소 |
| 5 | 정답 파싱 + 정답 입력 화면 | |
| 6 | 채점 + 결과 표시 | |
| 7 | 다시 풀기 + 회차 레이어 | |
| 8 | 문서 목록 | 마지막이어도 된다. 개발 중에는 단일 문서로 진행 가능 |
