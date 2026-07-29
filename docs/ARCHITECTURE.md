# 푸리 1차 MVP — 아키텍처 명세서

## 0. 메타데이터

| 항목 | 값 |
|---|---|
| 버전 | v0.2 |
| 작성일 | 2026-07-24 (v0.2 개편 2026-07-29) |
| 문서 성격 | **전 기능 공통 계약.** 기능 작업 시 항상 첨부한다 |

### 이 문서에 무엇이 들어가는가

판별 기준은 하나다 — **"기능을 하나 더 만들 때 이걸 읽어야 하나?"**

- 좌표계(§5), 데이터 모델(§4) → 모든 기능이 읽어야 함 → **여기**
- 객관식 판정 규칙 → 채점 기능만 읽음 → **SDD 또는 `research/`**

그래서 v0.2에서 셋으로 갈랐다.

| 문서 | 성격 | 바뀌는 빈도 |
|---|---|---|
| `ARCHITECTURE.md` (이 문서) | 모든 기능이 공유하는 계약 | 거의 안 바뀜 |
| `ROADMAP.md` | 2차 이월·구현 순서 = 계획 | 자주 |
| `research/객관식_인식.md` | 객관식 인식·판정 규칙 + 실측 근거 | 자주 |

### 관련 문서

- `ROADMAP.md` — 구 §11 2차 이월, §12 구현 순서
- `research/객관식_인식.md` — 객관식 인식·마킹 판정 규칙의 **유일한 출처**
- `docs/screens/INDEX.md` — 전체 화면 플로우
- `docs/design-system/README.md` — 디자인 시스템

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

기존 모노레포(Turborepo + pnpm)를 쓴다. 디자인 시스템은 `packages/ui`(`@puri/ui`), 앱은 `apps/student-mobile`이다.

```
packages/ui/                     @puri/ui — 디자인 시스템
├── src/styles/
│   ├── index.css                전역 진입점 (@import 목록만. 소비자는 이 파일 하나만 쓴다)
│   ├── base.css                 .ds-card · .ds-wordmark
│   └── tokens/                  colors · typography · spacing
├── src/components/{core,grading,study}/
├── src/assets/                  logo.svg · logo-white.svg
├── src/index.ts                 배럴
└── playground/                  컴포넌트 갤러리 (앱 없이 실행)

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

`src/lib` 아래는 **DOM과 React에 의존하지 않는 순수 함수**로 유지한다. 분할·귀속·채점은 전부 좌표 연산이므로 노드 환경에서 테스트할 수 있어야 한다.

### 3.1 UI 경계 — 컴포넌트는 공유하고, 화면은 공유하지 않는다

앱은 안드로이드·iOS·웹 셋을 대상으로 하지만 **Capacitor가 같은 `dist/`를 감쌀 뿐이라 여기까지는 앱 하나**다. 그와 별개로 **화면이 다른 웹 앱**이 예정되어 있고, 그래서 디자인 시스템이 앱 밖에 있다.

| | `packages/ui` | `apps/*` |
|---|---|---|
| 소유 | 토큰·브랜드 에셋·재사용 컴포넌트 | 화면 조합, 라우팅, 상태, 앱 전용 조각 |
| 의존 방향 | 앱을 **모른다** | `@puri/ui`를 import 한다 |
| 스타일 | 인라인 `CSSProperties` + `var(--token)`. **Tailwind 금지** | 앱이 원하는 도구를 쓴다 (현재 Tailwind v4) |

- **Tailwind가 패키지에 들어가면 안 되는 이유**: 디자인 시스템이 특정 앱의 스타일 도구에 묶이면, 그 도구를 안 쓰는 앱은 컴포넌트를 못 쓴다. 현재 12개 컴포넌트는 `className`을 하나도 쓰지 않는다.
- **토큰은 `var()`로만 참조한다.** 값이 없으면 컴포넌트에 하드코딩하지 말고 `packages/ui/src/styles/tokens/*.css`에 먼저 추가한다.
- **전 컴포넌트에 `'use client'` 배너**를 둔다. 지금은 무의미하지만 웹을 Next.js(RSC)로 갈 때 전수 수정을 막는다.
- 앱 전역 스타일(스크롤·선택 방지 같은 **그 앱의** 결정)은 `packages/ui`가 아니라 앱의 `index.css`에 둔다.

이 두 경계(§3의 `src/lib` 순수성, §3.1의 UI 방향성)가 아키텍처 규칙의 전부다.

> **이 절의 트리는 신규 파일 기준이라 일부 이름이 현행과 다르다** — `DocumentList.tsx`는 `NoteList.tsx`, `AnswerKeySheet.tsx`는 `AnswerKeyScreen.tsx`이고 `routes/`가 빠져 있다. 화면 목록의 현행 출처는 `docs/screens/INDEX.md`다.

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

여기 남는 것은 **여러 기능이 공유하는 것뿐**이다. 채점 전용 규칙은 `research/객관식_인식.md`로 옮겼다.

### 7.1 스트로크 귀속 (`attribution.ts`)

필기·채점·오답노트가 전부 쓴다. 그래서 계약이다.

```ts
const PAD = 8
const MIN_COVERAGE = 0.3

function attribute(stroke: Stroke, regions: Region[]): string | null {
  const scored = regions.map(r => ({
    id: r.id,
    coverage: ratioInside(stroke.points, expand(r.bounds, PAD)),
  }))

  const best = scored.reduce((a, b) => (b.coverage > a.coverage ? b : a))

  if (best.coverage >= MIN_COVERAGE) return best.id
  return null                      // orphan
}
```

- 스트로크를 절대 분할하지 않는다
- 기준은 `Region.bounds` 전체이며 `workBox`가 아니다
- orphan은 화면에 표시되지만 채점 대상에서 빠진다
- 중심점 방식을 쓰지 않는다. 분수 막대나 긴 대각선 획에서 중심이 엉뚱한 곳에 찍힌다

> **`STRONG = 0.6`은 제거됐다 (2026-07-29).**
> 원래 `STRONG`·`WEAK` 두 분기가 있었으나 **둘 다 같은 값을 반환**해서 `STRONG`은 아무 일도
> 하지 않았다. 두 분기를 합쳐 `MIN_COVERAGE = 0.3` 하나로 정리했고 **동작은 바뀌지 않았다.**
> 강/약을 나눌 의도가 있었다면 구현되지 않은 것이다 — 되살리려면 "약한 귀속을 어떻게 다르게
> 다룰지"부터 정해야 한다.

### 7.2 객관식 판정 (`grading.ts`) → `research/객관식_인식.md §4.4`

**여기 있던 명세를 지웠다. 규칙은 `research/객관식_인식.md` §4.4 「마킹 읽기」가 유일한 출처다.**

지우는 게 맞았던 이유 — 같은 함수를 설명하는 명세가 둘이었고, **둘의 내용이 달랐다.** §4.4가 상위집합이고 실측 근거(§11.11)까지 달려 있는 반면, 여기 있던 스케치는 아래를 전부 빠뜨리고 있었다.

| 실제 코드 (`grading.ts`) | 구 §7.2 | `research §4.4` |
|---|---|---|
| `MIN_OVERLAP = 0.25` | 없음 (임계 없이 "최대") | **25% 이상** ✓ |
| 형광펜(`tool: 'hi'`) 제외 | 없음 | ✓ |
| 겹침 동점 → 마크 중심 거리 | 없음 | ✓ |
| 판정점 = 선지 기호 **와** 박스 중심 | "중심"만 | ✓ |
| `choicePad = min(4, 짧은 변 × 0.25)` | 없음 | ✓ |
| 마지막 스트로크 우선 | ✓ | ✓ |

**두 벌을 유지하면 반드시 오래된 쪽을 읽는 사람이 나온다.** 실제로 이 문서가 "AI 코딩 도구에 투입 가능한 지침"이라고 적혀 있었으므로, 그대로 뒀으면 AI가 25%를 모른 채 구현했을 것이다.

`isClosedLoop`(고리 판정, `gap < 경로길이 × 0.2`)은 `lib/geometry.ts`로 옮겨져 두 경로가 공유한다.

**지우개가 스트로크 단위여야 이 알고리즘이 성립한다.** 픽셀 지우개면 지운 자국이 배열에 남아 후보가 오염된다. ← 이건 계약이라 여기 남긴다.

> **미문서화 규칙 (2026-07-29 발견).** `grading.ts`의 `buildRetryList` / `consecutiveCorrect` —
> **"한 번 틀린 문항은 3연속 정답까지 다시풀기 목록에 남는다"** 는 규칙이 어느 문서에도 없다.
> 코드 주석에 `시안2 ReviewChecks`라고만 적혀 있다. 시안에서 나온 결정이 문서를 거치지 않고
> 코드로 직행한 사례다. **PRD/SDD를 세울 때 첫 번째로 회수해야 할 규칙.**

### 7.3 정답지 파싱 (`answerKey.ts`)

> **위치 임시.** 채점 기능만 읽는 내용이라 판별 기준상 SDD 소관이다. 해당 PRD/SDD가 생기면
> 통째로 옮기고 여기엔 포인터만 남긴다. 지금은 갈 곳이 없어서 남겨둔다.

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

### 7.4 선지 개별 분리 (`segment.ts`) → `research/객관식_인식.md §4.2.4`

**여기 있던 초안을 지웠다.** 이 문서가 쓰인 시점(2026-07-24)엔 "이렇게 고치자"는 제안이었고, 그 뒤 실제로 구현되면서 규칙이 `research/객관식_인식.md` §4.2.4 「선지 박스 (RULE-HITBOX)」로 정착했다. 배치 판정(가로/세로/혼합), 세로 범위(`rowPitch`), 이웃 행 침범 처리까지 거기가 훨씬 정확하다.

**구현 전 제안을 구현 후에도 남겨두면, 읽는 사람은 그게 현행 규칙인 줄 안다.**

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
