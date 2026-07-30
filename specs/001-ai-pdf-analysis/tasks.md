# Tasks: AI 기반 PDF 문항 분석

**Input**: Design documents from `/specs/001-ai-pdf-analysis/`

**Prerequisites**: plan.md · spec.md · research.md · data-model.md · contracts/

**Tests**: **필수다.** 헌법 「개발 워크플로」가 *"판정 로직은 `apps/student-mobile/src/lib/` 아래 순수 함수로 먼저 작성하고 `vitest`로 덮어야 한다(MUST)"* 라고 규정한다. 순수 함수 태스크마다 테스트 태스크가 붙는다.

**Organization**: 사용자 스토리 단위로 묶어 각각 독립 구현·검증이 가능하게 했다.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 병렬 가능 (다른 파일, 미완료 의존 없음)
- **[Story]**: US1 / US2 / US3
- 파일 경로를 반드시 포함한다

## Path Conventions

pnpm + turbo 모노레포. 앱은 `apps/student-mobile/`, 신규 프록시는 `apps/proxy/` (plan.md Project Structure).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 프록시 워크스페이스 신설과 키 관리 — AI 기능의 선행 조건이다

- [ ] T001 `apps/proxy/package.json` 생성 (`@puri/proxy`) 하고 `pnpm-workspace.yaml`·`turbo.json`에 워크스페이스 등록
- [ ] T002 [P] `apps/proxy/`에 `@anthropic-ai/sdk` 설치. **`apps/student-mobile`에는 설치하지 않는다** — 클라이언트는 프록시와만 통신한다 (헌법 원칙 I)
- [ ] T003 [P] `apps/proxy/.env.example`에 `ANTHROPIC_API_KEY` 자리 추가하고, 루트 `.gitignore`에 `apps/proxy/.env`가 걸리는지 확인
- [ ] T004 [P] `apps/proxy/tsconfig.json`·lint 설정을 기존 워크스페이스 규약에 맞춰 추가

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 모든 스토리가 딛고 서는 인프라 — 프록시, 포트, 렌더, 좌표 변환, 저장소

**⚠️ CRITICAL**: 이 단계가 끝나기 전에는 어떤 사용자 스토리도 시작할 수 없다

### 화면 문서 (E 번호 배치 — 구현 전 선행)

- [ ] T005 [P] `docs/screens/S-110-transfer-consent.md` 신설 — 전송 항목 열거, 4상태, `(SDD-001 E9)` 배치
- [ ] T006 [P] `docs/screens/S-111-analysis-progress.md` 신설 — 4상태, `(SDD-001 E2)` `(SDD-001 E3)` `(SDD-001 E6)` 배치
- [ ] T007 [P] `docs/screens/INDEX.md`에 S-110·S-111 행 추가 (진입·이탈·관련 기능 열 채움)
- [ ] T008 기존 S-102·S-104 화면 문서에 `(SDD-001 E1)` `(SDD-001 E4)` `(SDD-001 E5)` `(SDD-001 E8)` 배치 후 `sh docs/check-errors.sh` 통과 확인

### 저장소 · 포트

- [ ] T009 `apps/student-mobile/src/types.ts`에 `PageAnalysis`·`ConsentRecord`·`ConsentItem` 타입 추가 (data-model.md). **`Region`은 건드리지 않는다**
- [ ] T010 `apps/student-mobile/src/lib/db.ts`에 `pageAnalysis`(키 `[docId, kind, page]`)·`consent` 스토어 추가 + 버전 마이그레이션
- [ ] T011 [P] `apps/student-mobile/src/lib/ai/ports.ts`에 `PageAnalysisPort`·`AnalysisStorePort`·`PageRenderPort`·`ConsentPort` 타입 정의 (plan.md 포트 절)

### 프록시 (API 키의 유일한 거처)

- [ ] T012 `apps/proxy/src/server.ts`에 `POST /analyze`(multipart: `kind`, `page`)와 `GET /health` 라우트 구현
- [ ] T013 `apps/proxy/src/prompt.ts`에 시스템 프롬프트와 JSON 스키마를 둔다. `specs/001-ai-pdf-analysis/contracts/page-analysis.schema.json`을 그대로 반영하고 **정답/오답 필드를 만들지 않는다** (FR-013 / 헌법 원칙 II)
- [ ] T014 `apps/proxy/src/anthropic.ts`에 호출부 구현 — `model: "claude-opus-5"`, `output_config.format`(json_schema), `max_tokens: 16000`, `thinking` 미지정(adaptive 기본). 시스템 프롬프트 마지막 블록에 `cache_control: {type:"ephemeral"}`, 이미지 블록은 그 **뒤**에 (research D-5)
- [ ] T015 `apps/proxy/src/anthropic.ts`에 `fallbacks: "default"` + 베타 헤더 `server-side-fallback-2026-07-01` 추가 (research D-7)
- [ ] T016 `apps/proxy/src/validate.ts`에 스키마로 표현 못 하는 범위 검증 구현 — `confidence` ∈ [0,1], `label` ∈ {1..5}, `box`가 이미지 경계 안, `numLabel`이 정수 문자열. 위반 시 `{status:"failed", failureCode:"schema"}` (data-model.md 검증 규칙)
- [ ] T017 [P] `apps/proxy/src/validate.test.ts`에 범위 검증 단위 테스트 — 경계값·초과값·타입 불일치
- [ ] T018 `apps/proxy/src/server.ts`에 `stop_reason === "refusal"` 분기 추가 → `{status:"failed", failureCode:"refusal"}`. **응답 `content`를 읽기 전에 검사한다**
- [ ] T019 `apps/proxy/src/server.ts`에 에러 매핑 — 상류 429는 `Retry-After` 보존해 429, 상류 장애·타임아웃은 502/504, 이미지 초과는 413 (contracts/proxy-api.md)
- [ ] T020 `apps/proxy/src/server.ts`에 **학생 데이터 영속 저장 금지**를 코드로 보장 — 요청 이미지·응답을 디스크·로그에 남기지 않는다 (헌법 「데이터와 프라이버시」)

### 클라이언트 순수 함수 (테스트 선행 — 헌법 MUST)

- [ ] T021 [P] `apps/student-mobile/src/lib/ai/coords.test.ts`에 픽셀→정규화 변환 테스트 작성 — **먼저 작성하고 실패를 확인한다**
- [ ] T022 [P] `apps/student-mobile/src/lib/ai/coords.ts`에 변환 구현. 변환식은 `docs/ARCHITECTURE.md` §5를 참조하며 **여기 옮겨 적지 않는다** (헌법 원칙 IV)
- [ ] T023 [P] `apps/student-mobile/src/lib/ai/queue.test.ts`에 오프라인 대기 큐 테스트 작성 — 큐잉·중복 방지·연결 시 재개
- [ ] T024 [P] `apps/student-mobile/src/lib/ai/queue.ts`에 대기 큐 구현 (E1)
- [ ] T025 `apps/student-mobile/src/lib/ai/pageRender.ts`에 페이지 래스터화 구현 — `pdfjs-dist`로 렌더, **긴 변 2576px 상한**(R2). `withInk`면 잉크 레이어 합성
- [ ] T026 `apps/student-mobile/src/lib/ai/analysisClient.ts`에 프록시 호출 구현 — `fetch` multipart 전송, 응답·에러를 E1~E6으로 매핑

**Checkpoint**: 프록시가 뜨고 `curl -F kind=answerkey -F page=@sample.png localhost:8787/analyze`가 스키마 통과 JSON을 돌려준다

---

## Phase 3: User Story 1 - 낯선 조판의 문제집도 채점된다 (Priority: P1) 🎯 MVP

**Goal**: 동의 → 정답지 분석 → 문제집 페이지 분석(필기 트리거) → 기존 기하 판정으로 채점

**Independent Test**: 기존 경로가 실패하는 문제집(수학의 신)을 올려 필기 후 채점하면 O/X가 나온다. 비행기 모드에서도 이미 분석된 문항은 채점된다

### Tests for User Story 1

- [ ] T027 [P] [US1] `apps/student-mobile/src/lib/ai/__tests__/aiToSegment.test.ts`에 AI 응답 → `SegmentCache` 변환 테스트 — `Region` 필드 매핑, `numSynth`·`ansSynth`가 `false`인지
- [ ] T028 [P] [US1] `apps/student-mobile/src/lib/ai/__tests__/answerMatch.test.ts`에 `numLabel` 결합 테스트 (R9) — 짝 없으면 `nokey`

### Implementation for User Story 1

- [ ] T029 [P] [US1] `apps/student-mobile/src/lib/ai/consent.ts`에 `ConsentPort` 구현 — 동의 항목 읽기·기록, 버전 불일치 시 재동의
- [ ] T030 [US1] `apps/student-mobile/src/components/ConsentScreen.tsx`(S-110) 구현 — `ConsentItem` 목록을 그대로 열거하고 **"문제집 페이지 이미지 — 학생 필기 포함"** 을 명시 (FR-012). 거부 시 앱 진입 차단 (FR-006, E9)
- [ ] T031 [US1] `apps/student-mobile/src/lib/ai/aiToSegment.ts`에 AI 응답 → `Region[]` 변환 구현 (T022 좌표 변환 사용)
- [ ] T032 [US1] `apps/student-mobile/src/lib/segment.ts`의 `ANALYSIS_VERSION`을 올린다 — 기존 캐시가 무효화되어 AI 경로로 재분석된다 (data-model.md)
- [ ] T033 [US1] `apps/student-mobile/src/stores/documentStore.ts`의 분석 경로를 AI로 전환 — `db.putSegments({docId, page, regions, segmentVersion: ANALYSIS_VERSION})` 유지. **`lib/psp/`·`lib/scan/` 호출 제거**(삭제 아님, FR-009)
- [ ] T034 [US1] `apps/student-mobile/src/stores/documentStore.ts`에 정답지 등록 시 전 페이지 분석 흐름 추가 → `AnswerEntry{source:'answerPdf'}` 저장 (R1, FR-011). **`lib/answerKey.ts` 호출 제거**
- [ ] T035 [US1] `apps/student-mobile/src/stores/inkStore.ts`에 **페이지 첫 스트로크 커밋 시** 분석 트리거 추가 (R1). 이미 분석된 페이지는 재전송하지 않는다 (R3)
- [ ] T036 [US1] `apps/student-mobile/src/lib/ai/analysisStore.ts`에 `AnalysisStorePort` 구현 — `PageAnalysis` 읽기/쓰기, `status` 전이 (data-model.md 상태 전이)
- [ ] T037 [US1] `apps/student-mobile/src/components/AnalysisProgress.tsx`(S-111) 구현 — 페이지별 진행, 4상태
- [ ] T038 [US1] `apps/student-mobile/src/components/PageScroller.tsx`에 오프라인 대기 배지 추가 (E1) — "연결되면 분석합니다". **필기는 계속 가능해야 한다** (R11)
- [ ] T039 [US1] `apps/student-mobile/src/lib/ai/queue.ts`를 온라인 복귀 이벤트에 연결 — 대기분 자동 재개 (E1)

**Checkpoint**: quickstart V-1 ~ V-5 통과. **여기까지가 MVP다**

---

## Phase 4: User Story 2 - 스캔한 문제집도 정답 대조가 된다 (Priority: P2)

**Goal**: 스캔 이미지 PDF에서도 문항 번호 **값**이 읽혀 정답지와 짝지어진다

**Independent Test**: 스캔 PDF 1권을 올려 필기 후 채점하면 정답 대조가 된다 (기존 재현율 0% → 목표 99%)

> **이 스토리의 구현이 얇은 것은 설계 덕이다.** AI 경로는 페이지를 이미지로 렌더해 보내므로
> 텍스트 레이어 유무가 사라진다 — 스캔본과 텍스트 PDF가 **같은 코드 경로**를 탄다.
> 남는 일은 스캔 특유의 입력을 확인하고 매칭을 배선하는 것뿐이다.

### Tests for User Story 2

- [ ] T040 [P] [US2] `apps/student-mobile/src/lib/ai/__tests__/pageRender.scan.test.ts`에 텍스트 레이어 없는 PDF 렌더 테스트 — 이미지가 나오고 긴 변이 2576px 이하인지

### Implementation for User Story 2

- [ ] T041 [US2] `apps/student-mobile/src/lib/ai/pageRender.ts`가 텍스트 레이어 없는 페이지도 동일하게 렌더하는지 확인하고, 필요 시 스캔 전용 분기 제거
- [ ] T042 [US2] `apps/student-mobile/src/lib/ai/answerMatch.ts`에 `numLabel` 기반 정답 결합 구현 (R9) — 짝 없으면 기존 `nokey` 경로로 (E8)
- [ ] T043 [US2] `apps/student-mobile/src/stores/documentStore.ts`에서 채점 시 `answerMatch`를 거치도록 배선
- [ ] T044 [US2] 골든 데이터셋의 스캔 PDF 1권으로 재현율 측정 — 결과를 `specs/001-ai-pdf-analysis/quickstart.md` V-7 표에 기록

**Checkpoint**: US1·US2 모두 독립적으로 동작한다

---

## Phase 5: User Story 3 - 분석이 틀리면 학생이 안다 (Priority: P3)

**Goal**: 확신도가 드러나고, 잘못 잡힌 구조를 학생이 고칠 수 있고, 실패 페이지는 직접 입력으로 우회된다

**Independent Test**: 확신도 낮은 문항이 오답으로 단정되지 않고, 학생이 문항 영역을 고치면 이후 채점에 반영된다

### Tests for User Story 3

- [ ] T045 [P] [US3] `apps/student-mobile/src/lib/ai/__tests__/confidence.test.ts`에 확신도 저장·조회 테스트. **자동 차단선으로 쓰지 않는지** 검증한다 (R7 — 컷오프 미결정)

### Implementation for User Story 3

- [ ] T046 [P] [US3] `apps/student-mobile/src/lib/ai/analysisStore.ts`에 `confidences` 저장 추가 (data-model.md)
- [ ] T047 [US3] `apps/student-mobile/src/components/GradeOverlay.tsx`에 확신도 표시 추가 — **의견으로 표시하고 판정을 바꾸지 않는다** (헌법 원칙 II)
- [ ] T048 [US3] `apps/student-mobile/src/components/RegionEditor.tsx` 구현 — 문항 번호·영역·선지 수정. `documentStore.ts:1105`의 기존 patch 경로(`putSegments({regions: patched})`)를 재사용한다
- [ ] T049 [US3] `apps/student-mobile/src/components/AnswerKeyScreen.tsx`에 분석 실패 페이지의 직접 입력 진입점 추가 (E4·E5)
- [ ] T050 [US3] `apps/student-mobile/src/components/GradeOverlay.tsx`에 「대기」와 「미판정」을 **다른 표시로** 구분 — 대기는 저절로 풀리고 미판정은 학생 확인이 필요하다 (data-model.md 상태 전이)

**Checkpoint**: 세 스토리 모두 독립적으로 동작한다

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T051 [P] `apps/student-mobile/package.json`에 번들 검사 스크립트 추가 — `dist/`에 `sk-ant`·`api.anthropic.com`이 없는지 (quickstart V-0). **CI에서 실패하면 배포 중단**
- [ ] T052 [P] `docs/ARCHITECTURE.md` §2.3의 "사용하지 않는 것" 목록을 실제 의존성과 다시 대조 (프록시 신설 반영)
- [ ] T053 골든 5권으로 `specs/001-ai-pdf-analysis/quickstart.md` V-7 실행 — SC-001·SC-002·SC-003·**SC-004(오채점 0건)** 측정 후 같은 파일의 V-7 표에 결과 기록
- [ ] T054 `specs/001-ai-pdf-analysis/quickstart.md` V-8 측정 실행 — `messages.countTokens`로 해상도별·effort별 토큰과 캐시 적중률을 재고 같은 파일 V-8 표에 기록. **`tiktoken` 류를 쓰지 않는다**
- [ ] T055 T054 결과로 `specs/001-ai-pdf-analysis/plan.md`의 Unresolved 갱신 — 렌더 해상도·effort·페이지당 비용 상한 확정, 그다음 **R12(재시도 정책)** 확정
- [ ] T056 T054의 확신도↔오류 상관 측정으로 저신뢰 컷오프를 확정하고 `specs/001-ai-pdf-analysis/plan.md`의 R7·Unresolved 갱신. **상관이 낮으면 `spec.md` FR-004를 결정론적 검사(번호 수열)로 갈아탄다**
- [ ] T057 필기 전/후 같은 페이지 재현율 A/B 측정 후 `specs/001-ai-pdf-analysis/plan.md` Unresolved에 기록 — 나쁘면 `spec.md` FR-012 재검토 사유로 남긴다
- [ ] T058 `sh docs/check-errors.sh` 최종 통과 확인
- [ ] T059 `specs/001-ai-pdf-analysis/quickstart.md` 전체 절차 실행 및 완료 조건 체크

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 의존 없음
- **Foundational (Phase 2)**: Setup 완료 후 — **모든 스토리를 막는다**
- **User Stories (Phase 3~5)**: Foundational 완료 후. 우선순위 순(P1 → P2 → P3) 또는 인원이 있으면 병렬
- **Polish (Phase 6)**: 원하는 스토리가 끝난 뒤

### User Story Dependencies

- **US1 (P1)**: Foundational만 의존. 다른 스토리에 의존하지 않는다
- **US2 (P2)**: Foundational 의존. US1의 채점 배선(T033)이 있으면 검증이 쉽지만, T042·T043만으로 독립 검증 가능
- **US3 (P3)**: Foundational 의존. 고칠 대상이 있어야 의미가 있으므로 실무상 US1 뒤가 자연스럽다

### 선행 조건 (코드 밖)

- **프록시 배포처가 필요하다.** T012~T020은 로컬에서 되지만 실기기 검증에는 도달 가능한 호스트가 필요하다 (plan Unresolved: 배포 형태 미결정)
- **골든 데이터셋 5권**이 T044·T053·T054에 필요하다 (`research/객관식_인식.md` §11)

### Within Each User Story

- 테스트를 먼저 쓰고 **실패를 확인한 뒤** 구현한다 (헌법 「개발 워크플로」)
- 순수 함수 → 스토어 → 컴포넌트 순
- 스토리를 끝내고 다음 우선순위로 넘어간다

### Parallel Opportunities

- Setup의 T002·T003·T004
- Foundational 화면 문서 T005·T006·T007 (T008은 이들에 의존)
- Foundational 순수 함수 T021~T024 (서로 다른 파일)
- 프록시(T012~T020)와 클라이언트 순수 함수(T021~T026)는 **다른 앱이라 완전 병렬**
- Foundational 완료 후 US1·US2·US3를 인원별로 병렬 진행 가능

---

## Parallel Example: Foundational

```bash
# 화면 문서 3개 동시에
Task: "docs/screens/S-110-transfer-consent.md 신설"
Task: "docs/screens/S-111-analysis-progress.md 신설"
Task: "docs/screens/INDEX.md에 S-110·S-111 행 추가"

# 프록시와 클라이언트를 다른 사람이 동시에
Task: "apps/proxy/src/server.ts 라우트 구현"
Task: "apps/student-mobile/src/lib/ai/coords.test.ts 테스트 작성"
Task: "apps/student-mobile/src/lib/ai/queue.test.ts 테스트 작성"
```

## Parallel Example: User Story 1

```bash
# 테스트 먼저, 둘 다 병렬
Task: "lib/ai/__tests__/aiToSegment.test.ts 작성"
Task: "lib/ai/__tests__/answerMatch.test.ts 작성"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup
2. Phase 2 Foundational — **여기가 가장 크다.** 프록시 전체와 클라이언트 순수 함수가 들어간다
3. Phase 3 User Story 1
4. **멈추고 검증**: quickstart V-0 ~ V-5
5. V-0(번들에 키 없음)이 실패하면 **다른 검증을 진행하지 않는다** — 헌법 원칙 I 위반이다

### Incremental Delivery

1. Setup + Foundational → 기반 완성
2. US1 → 독립 검증 → **MVP**
3. US2 → 독립 검증 → 스캔본 지원
4. US3 → 독립 검증 → 신뢰·수정 경로
5. Polish → 미결정 해소 및 측정

### 잘라도 되는 것

일정이 밀리면 아래에서부터 자른다 — 스펙의 우선순위(P3 → P2)를 그대로 따른다.

- **US3 전체** — 학생 수정 경로가 없어도 채점은 성립한다. 대신 오채점 위험이 오른다
- **US2** — 텍스트 레이어 PDF만으로도 제품이 성립한다 (spec.md US-02 "Why this priority")

**US1과 Foundational은 자를 수 없다.** 프록시가 없으면 기능 자체가 없다.

---

## Notes

- `[P]` = 다른 파일, 의존 없음
- 태스크 하나 또는 논리적 묶음마다 커밋한다
- **T032(`ANALYSIS_VERSION` 올리기)는 되돌리기 어려운 전환점이다** — 기존 로컬 캐시가 전부 무효화되고 AI 경로로 재분석된다. US1의 다른 배선이 준비된 뒤에 올린다
- `lib/psp/`·`lib/scan/`·`lib/answerKey.ts`는 **삭제하지 않는다.** 호출만 끊는다 (FR-009·FR-011)
- 출시 전 게이트 **G-1**(동의 거부 시 앱 차단)과 **G-2**(프록시 부재)는 이 태스크 목록의 범위가 아니다. 출시 전에 별도로 다룬다
