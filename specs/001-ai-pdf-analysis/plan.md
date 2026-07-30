# Implementation Plan: AI 기반 PDF 문항 분석

**Branch**: `feat/auto-scoring` | **Date**: 2026-07-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-ai-pdf-analysis/spec.md`

## Summary

문제집·정답지 PDF의 **페이지를 이미지로 렌더해 프록시 서버를 거쳐 AI에 보내고**, 문항 번호 값·문항 영역·선지 위치·정답을 구조화 JSON으로 받아 기기에 저장한다. 채점은 그 저장분을 읽어 **기존 결정론적 기하 판정**(`lib/grading.ts`, 상한 100.00%)이 단독으로 수행한다 — AI는 판정에 참여하지 않는다.

기존 `lib/psp/`·`lib/scan/`·`lib/answerKey.ts`(합계 4,971줄)는 **삭제하지 않고 호출만 하지 않는다**(FR-009·FR-011).

## Technical Context

**Language/Version**: TypeScript 5.8 / React 19

**Primary Dependencies**: Vite 6, Capacitor 7 (Android), zustand 5, react-router-dom 7, idb 8, pdfjs-dist 5, Tailwind CSS 4
— **추가**: 프록시 서버(신규 컴포넌트, `@anthropic-ai/sdk`). 클라이언트는 `fetch`로 프록시만 호출한다

**Storage**: IndexedDB (`idb`) — 기기 로컬. 분석 결과는 **페이지 단위** 레코드

**Testing**: vitest 3

**Target Platform**: Android 태블릿 + 스타일러스 펜

**Project Type**: pnpm + turbo 모노레포 — `apps/student-mobile`, `packages/ui`, **신규 `apps/proxy`**

**Performance Goals**: 페이지당 분석 지연 목표 ⚠️ 미결정 (실측 전, 헌법 원칙 III)

**Constraints**: 학생 데이터의 영속 저장소는 기기뿐. AI 기능은 네트워크 필수이되 **이미 분석된 문항의 채점은 오프라인 완전 동작**. API 키는 프록시에만 존재 (`ARCHITECTURE.md` §1, 헌법 원칙 I)

**Scale/Scope**: `apps/student-mobile/src/lib/ai/`(신규) · `stores/documentStore.ts` · `apps/proxy/`(신규). 판정 기하와 잉크 파이프라인은 건드리지 않는다

## Constitution Check

*GATE: Phase 0 전에 통과해야 한다. Phase 1 설계 후 재확인.*

기준: `.specify/memory/constitution.md` **v3.0.0**

| 원칙 | 판정 | 근거 |
|---|---|---|
| **I. 로컬 저장 · AI 기능은 네트워크 필수** | ✅ | 저장은 IndexedDB 전용(R10). AI 호출은 프록시 경유, 키는 클라이언트에 없음. 미분석 페이지는 실패가 아닌 **대기**(E1). 네트워크 없어도 필기·풀이 가능(R11) |
| **II. 신뢰가 먼저 — 판정은 도구가, 해석은 AI가** | ✅ | AI 출력은 문항 구조뿐. O/X 판정은 `lib/grading.ts` 단독(R6). 확신도는 의견으로 표시하고 자동 차단선으로 쓰지 않음(R7) |
| **III. 숫자에는 출처가 있다** | ✅ | 사용한 값에 전부 출처 기재(R2·R3). 컷오프·비용·재시도 횟수는 지어내지 않고 ⚠️ 미결정 |
| **IV. 규칙의 출처는 하나** | ✅ | 좌표계는 `ARCHITECTURE.md` §5 참조, 마킹 판정은 `research/객관식_인식.md` §4.4 참조. 여기 옮겨 적지 않음 |
| **데이터와 프라이버시** | ❌ **위반** | FR-006이 동의 거부 시 앱 사용을 차단한다. **아래 Complexity Tracking에 정당화 기록** |
| **개발 워크플로** | ✅ | 판정 로직은 `lib/` 순수 함수 + vitest. AI 계층은 포트 분리. 스키마 검증 후 사용(R5) |

**게이트 결과: 조건부 통과** — 위반 1건이 Complexity Tracking에 기록되어 있고, 출시 전 게이트 G-1로 관리된다.

### Phase 1 설계 후 재평가 (2026-07-31)

**새 위반 없음.** 설계가 오히려 두 원칙을 코드 구조로 강제하게 됐다.

- **원칙 II가 스키마로 강제된다** — `contracts/page-analysis.schema.json`에 정답/오답에 해당하는
  필드를 **두지 않았다.** AI는 판정을 만들 수단 자체가 없다. 규율이 문서가 아니라 타입에 있다
- **원칙 IV가 재사용으로 강제된다** — `SegmentCache`를 새 모델로 대체하지 않고 AI를 그 **생산자**로
  끼웠다(`data-model.md`). `Region` 타입이 안 바뀌므로 좌표계·판정 규칙의 출처가 갈라질 여지가 없다
- **원칙 I 검증이 절차로 들어갔다** — `quickstart.md` V-0이 번들에 키·직접 호출이 없음을 먼저 확인하고,
  실패 시 나머지 검증을 중단한다

## 입력

| 이름 | 타입 | 의미 | 출처 |
|---|---|---|---|
| `docId` | `string` | 문서 식별자 | `ARCHITECTURE.md` §4 |
| `kind` | `'workbook' \| 'answerkey'` | 문제집인가 정답지인가 | FR-011 |
| `pageIndex` | `number` | 0-based 페이지 번호 | `pdfjs-dist` |
| `pageImage` | `Blob` (PNG) | 렌더된 페이지. 문제집은 잉크 합성본 | R2 |
| `strokes` | `Stroke[]` | 해당 페이지의 잉크. **전송하지 않고** 합성에만 쓴다 | `types.ts` |
| `consent` | `ConsentRecord` | 전송 동의 기록 | FR-006 |

**전송되지 않는 것**: 원본 PDF 파일, 학생 식별 정보, 채점 이력, 스트로크 좌표 배열 (FR-010).

## 판정 규칙

- **R1 분석 대상 선정** — 정답지는 등록 시 전 페이지. 문제집은 **해당 페이지에 스트로크가 처음 커밋된 시점**에 그 페이지 1장. 스트로크가 없는 페이지는 분석하지 않는다
  <!-- 근거: spec.md Assumptions (분석 시점) -->
- **R2 렌더 규격** — 페이지를 PNG로 래스터화한다. **긴 변 2576px 상한.** 문제집은 PDF 래스터 위에 잉크 레이어를 합성한 1장으로 만든다
  <!-- 근거: 2576px = Anthropic 고해상도 비전 상한 (그 이상은 서버가 축소하므로 보낼 이유가 없다). 이보다 낮출지는 비용 실측 후 — Unresolved 참조 -->
- **R3 중복 방지** — `(docId, kind, pageIndex)` 로 저장된 분석 결과가 있으면 재전송하지 않는다. 필기를 고쳐도 재분석하지 않는다
  <!-- 근거: spec.md Assumptions (한 페이지 1회 전송), Out of Scope (필기 수정 시 재분석) -->
- **R4 요청 구성** — 프록시에 `{kind, pageImage}` 만 보낸다. 모델·프롬프트·스키마는 **프록시가 소유**한다. 클라이언트가 프롬프트를 만들지 않는다
  <!-- 근거: 헌법 원칙 I(키는 프록시에만) + 프롬프트를 클라이언트에 두면 번들에서 읽혀 우회 가능 -->
- **R5 응답 채택** — 구조화 출력(JSON 스키마)을 통과한 응답만 채택한다. 스키마 위반은 **분석 실패**로 처리하고 부분 채택하지 않는다
  <!-- 근거: FR-007, 헌법 「개발 워크플로」 -->
- **R6 판정 분리** — AI 응답에 정답/오답에 해당하는 필드가 있더라도 **무시한다.** 스키마에 그런 필드를 두지 않는다. O/X는 `detectChoice`·`gradeRegion`이 단독으로 낸다
  <!-- 근거: FR-013, 헌법 원칙 II -->
- **R7 확신도 취급** — 문항별 `confidence`(0~1)를 저장하고 화면에 드러낸다. **자동 차단선으로 쓰지 않는다** — 컷오프가 미결정이기 때문이다(Unresolved)
  <!-- 근거: FR-004, 헌법 원칙 III -->
- **R8 좌표 변환** — AI가 반환한 픽셀 좌표를 `ARCHITECTURE.md` §5 정규화 좌표계로 변환한 뒤 저장한다. 변환식은 §5를 따르며 여기 옮겨 적지 않는다
  <!-- 근거: 헌법 원칙 IV -->
- **R9 정답 매칭** — 정답지 분석 결과와 문제집 분석 결과를 **문항 번호 값**으로 결합한다. 짝이 없으면 `nokey`(기존 상태값)로 남긴다
  <!-- 근거: 기존 `gradeRegion`의 nokey 경로. 새 상태를 만들지 않는다 -->
- **R10 저장 단위** — 분석 결과는 페이지 하나당 레코드 하나. 문서 단위로 묶지 않는다
  <!-- 근거: FR-002 -->
- **R11 오프라인 동작** — 네트워크 부재는 필기·풀이·문서 열람·**이미 분석된 문항의 채점**을 막지 않는다. 미분석 문항만 대기 상태로 남는다
  <!-- 근거: FR-003, 헌법 원칙 I -->
- **R12 재시도** — ⚠️ 미결정. 페이지당 비용 상한이 정해져야 횟수·간격을 정할 수 있다(Unresolved)

## 에러 처리

**E 번호는 재사용하지 않는다.**

| ID | 상황 | 동작 | 사용자에게 보이는 것 |
|---|---|---|---|
| E1 | 네트워크 없음 | 요청을 큐에 넣고 **대기**. 연결 시 재개 | "연결되면 분석합니다" — **에러 아님** |
| E2 | 프록시 5xx / 타임아웃 | R12 정책대로 재시도 후 대기 | "분석이 지연되고 있습니다" |
| E3 | 429 rate limit | 백오프 후 대기. `retry-after` 존중 | E2와 동일 문구 |
| E4 | 응답 스키마 검증 실패 | 해당 **페이지만** 분석 실패로 표시. 다른 페이지에 영향 없음 | "이 페이지는 분석하지 못했습니다 · 직접 입력" |
| E5 | 모델이 요청을 거부 (`stop_reason: "refusal"`) | 분석 실패. 자동 재시도하지 않는다 — 재시도해도 같은 결과다 | E4와 같은 화면, 다른 문구 |
| E6 | 페이지 렌더 실패 (손상된 PDF) | 해당 페이지만 실패 | "이 페이지를 읽을 수 없습니다" |
| E7 | 문항 0개 검출 | 정상 저장. 표지·해설 페이지일 수 있다 | 표시 없음 — **에러 아님** |
| E8 | 정답지에 없는 문항 번호 | 기존 `nokey` 경로로 처리 | 기존 미채점 표시 — **에러 아님** |
| E9 | 전송 동의 거부 | 앱 사용 불가 (FR-006) | 동의 화면에서 진행 차단 — **에러 아님, 정책** |

## 포트

AI 계층은 포트 뒤에 분리한다(헌법 「개발 워크플로」). 포트가 실패하거나 비활성일 때의 동작이 앱의 기본 경로다.

```
PageAnalysisPort.analyze(req: AnalyzeRequest): Promise<AnalyzeResult>
  // 프록시 호출. 네트워크 부재 시 reject하지 않고 'pending'을 돌려준다

AnalysisStorePort.get(docId: string, kind: PageKind, pageIndex: number): Promise<PageAnalysis | null>
AnalysisStorePort.put(a: PageAnalysis): Promise<void>
AnalysisStorePort.listByDoc(docId: string): Promise<PageAnalysis[]>

PageRenderPort.render(docId: string, pageIndex: number, withInk: boolean): Promise<Blob>

ConsentPort.read(): Promise<ConsentRecord | null>
ConsentPort.grant(items: ConsentItem[]): Promise<ConsentRecord>
```

## 화면

화면 ID는 100번대, 기능은 0번대다 — 화면과 기능은 다대다다.

### 상태

| 화면 | 정상 | 로딩 | 빈 상태 | 에러 |
|---|---|---|---|---|
| **S-110 전송 동의** | 전송 항목 목록 + [동의] [거부] | 해당 없음 (로컬 렌더) | 해당 없음 | 거부 시 진행 차단 (SDD-001 E9) |
| **S-111 분석 진행** | 페이지별 진행 표시 | 분석 중 페이지 수 | 분석할 페이지 없음 (전부 캐시됨) | 지연/실패 (SDD-001 E2·E3), 렌더 실패 (SDD-001 E6) |
| **S-102 풀이**(기존) | 필기 정상 | 해당 없음 | 해당 없음 | 오프라인 대기 배지 (SDD-001 E1) |
| **S-104 결과**(기존) | O/X + 확신도 | 채점 중 | 채점 대상 0개 | 분석 실패 문항 (SDD-001 E4·E5), 정답 없음 (SDD-001 E8) |

**`해당 없음`도 정보다** — 확인했고 필요 없다는 뜻이다.

### 에러 배치 검증

E1~E9가 전부 위 표에 배치돼 있다. E7은 사용자에게 보이지 않는 것이 정답이므로 `에러 처리` 표에 "표시 없음"으로 명시했다.

```sh
sh docs/check-errors.sh
```

> ⚠️ 화면 문서(`docs/screens/S-1xx-*.md`)가 아직 없어 이 검사는 **현재 실패한다.** S-110·S-111 신설과 S-102·S-104 갱신이 구현 전 선행 작업이다 — `tasks.md`에서 다룬다.

## Unresolved *(미결정)*

- ⚠️ **저신뢰 컷오프.** 확신도 몇 이하를 "미판정"으로 볼지. **알아야 할 것**: 골든 5권에서 확신도 ↔ 실제 오류의 상관. 그전까지 R7대로 표시만 한다
- ⚠️ **페이지당 비용·지연 상한.** **알아야 할 것**: 시제품으로 1권을 돌린 실측치. 이것이 정해져야 R12(재시도)도 정해진다
- ⚠️ **렌더 해상도.** R2는 상한 2576px를 쓰지만 그게 최적이라는 근거는 없다. **알아야 할 것**: 해상도별 검출 정확도 ↔ 토큰 비용 곡선
- ⚠️ **필기 합성이 검출을 얼마나 방해하는가.** **알아야 할 것**: 같은 페이지의 필기 전/후 비교 측정. 나쁘면 FR-012 재검토 사유가 된다
- ⚠️ **프록시 배포 형태.** 서버리스 함수인지 상시 서버인지. **알아야 할 것**: 위 비용·지연 실측과 예상 동시 사용자 수

## Project Structure

### Documentation (this feature)

```text
specs/001-ai-pdf-analysis/
├── spec.md
├── plan.md              # 이 파일
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
│   ├── proxy-api.md
│   └── page-analysis.schema.json
└── checklists/requirements.md
```

### Source Code (repository root)

```text
apps/student-mobile/src/
├── lib/
│   ├── ai/                 # 신규 — 포트 구현
│   │   ├── ports.ts          # 위 포트 타입
│   │   ├── analysisClient.ts # 프록시 호출 (fetch)
│   │   ├── pageRender.ts     # PDF 래스터 + 잉크 합성
│   │   ├── coords.ts         # 픽셀 → 정규화 (ARCHITECTURE §5)
│   │   └── queue.ts          # 오프라인 대기 큐
│   ├── grading.ts          # 손대지 않는다
│   ├── psp/ · scan/ · answerKey.ts   # 남기되 호출하지 않는다
│   └── db.ts               # 스토어 추가
├── stores/documentStore.ts # 분석 결과 조회 경로로 전환
└── components/             # S-110 · S-111 신설

apps/proxy/                 # 신규 — API 키의 유일한 거처
├── src/handler.ts            # POST /analyze
├── src/prompt.ts             # 프롬프트·스키마 (클라이언트에 두지 않는다)
└── src/anthropic.ts          # @anthropic-ai/sdk
```

**Structure Decision**: 판정·잉크·PDF 렌더 기존 경로는 건드리지 않는다. 신규는 `lib/ai/`와 `apps/proxy/` 두 곳뿐이고, `documentStore`가 분석 결과를 읽는 지점만 바뀐다.

## Complexity Tracking

> **Constitution Check 위반을 정당화해야 할 때만 채운다**

| 위반 | 왜 필요한가 | 더 단순한 대안을 버린 이유 |
|---|---|---|
| **헌법 「데이터와 프라이버시」** — *"동의를 거부해도 앱을 계속 쓸 수 있어야 한다(MUST)"* 를 FR-006이 어긴다. 동의 거부 시 앱 진입을 차단한다 | 1차 MVP의 목표가 **학습과 개발 속도**다. 거부자 전용 경로를 만들려면 기존 로컬 파이프라인(4,971줄)을 되살려 배선해야 하고, 그것이 이번 범위에서 잘라낸 바로 그 작업이다 | **대안 A(자동 채점만 비활성)** — 헌법을 지키고 개발량도 거의 0이었다(`AnswerKeyScreen.tsx` 수동 입력이 이미 있다). 사용자가 두 선택지의 차이와 미성년자 강제 동의 위험을 확인한 뒤 명시적으로 차단을 택했다. **헌법 조항은 낮추지 않았다** — 출시 전 게이트 **G-1**로 남겨 재검토를 강제한다 |
| **신규 런타임 의존성** — 프록시 서버(`apps/proxy`, `@anthropic-ai/sdk`) | 헌법 원칙 I이 API 키의 클라이언트 포함을 금지한다. 프록시 없이는 AI 기능 자체가 불가능하다 | 대안이 없다. 키를 클라이언트에 넣는 것은 원칙 I 정면 위반이고, 번들에서 추출 가능하다 |

## 자가 검토

| # | 항목 | 결과 | 코멘트 |
|---|---|---|---|
| 1 | 규칙이 결정론적인가 | ⚠️ | R1~R11은 결정론적. **AI 호출 자체는 비결정적**이므로 R5(스키마 검증)·R6(판정 분리)·R7(확신도 비차단)으로 비결정성을 채점 경로에서 격리했다 |
| 2 | **이미 있는 규칙을 복사하지 않았는가** | ✅ | 좌표계 → `ARCHITECTURE §5` 참조(R8), 마킹 판정 → `research §4.4` 참조. 옮겨 적지 않음 |
| 3 | **숫자를 지어내지 않았는가** | ✅ | 2576px만 확정(출처: Anthropic 고해상도 상한). 컷오프·비용·재시도·해상도 최적값은 전부 ⚠️ 미결정 |
| 4 | 예외 케이스가 있는가 | ✅ | 문항 0개(E7), 번호 불일치(E8), 렌더 실패(E6), 필기 수정 재분석 안 함(R3) |
| 5 | 에러 아닌 것을 구분했는가 | ✅ | E1·E7·E8·E9 네 건을 "에러 아님"으로 명시 |
| 6 | E 번호가 연속인가 | ✅ | E1~E9, 재사용·건너뜀 없음 |
| 7 | 모든 E가 화면에 배치됐는가 | ⚠️ | 표에는 전부 배치했으나 **화면 문서가 없어 `check-errors.sh`는 지금 실패한다.** 구현 전 선행 작업으로 명시 |
| 8 | 화면 4상태가 다 채워졌는가 | ✅ | 4개 화면 × 4상태, `해당 없음`도 명시 |
| 9 | 입력 타입이 명확한가 | ✅ | 표로 타입·의미·출처. 전송 제외 항목까지 명시 |
| 10 | 포트가 정의됐는가 | ✅ | 5개 포트 시그니처 |
| 11 | 레이아웃·색이 안 들어갔는가 | ✅ | 화면은 "무엇이 보이는가"까지만 |
| 12 | spec.md 성공 기준과 모순 없는가 | ✅ | SC-005(비행기 모드 채점) ↔ R11·E1로 성립. SC-004(오채점 0건) ↔ R6·R7 |
| 13 | 미결정이 표시됐는가 | ✅ | 5건, 각각 "무엇을 알아야 정할 수 있는지" 포함 |
| 14 | spec.md의 Open Questions를 다 처리했는가 | ✅ | 9건 중 5건을 Unresolved로 이관, 4건(대조 도입 시점·폴백 도입 시점·동의 거부 경험·신뢰도 표시)은 이번 범위 밖으로 확정 |
| 15 | 외부 통신 0 제약을 지켰는가 | — | **폐기된 제약이다.** 헌법 v3.0.0 기준으로는 원칙 I(로컬 저장 · AI는 네트워크 필수)을 지켰다 — Constitution Check 참조 |
