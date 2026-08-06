# Phase 1 Data Model: AI 기반 PDF 문항 분석

**Date**: 2026-07-31 · **Plan**: [plan.md](./plan.md)

## 핵심 설계: 새 모델을 만들지 않는다

브라운필드 조사에서 나온 결론이다. **`SegmentCache`가 이미 "페이지 하나의 문항 구조"** 이고,
`documentStore`가 그것을 버전으로 캐시 판정한다.

```
documentStore.ts:499   if (seg?.segmentVersion === ANALYSIS_VERSION) { …캐시 적중… }
documentStore.ts:904   await db.putSegments({ docId, page, regions, segmentVersion: ANALYSIS_VERSION })
documentStore.ts:1105  await db.putSegments({ docId, page, regions: patched, segmentVersion: ANALYSIS_VERSION })
```

그래서 **AI를 `SegmentCache`의 새 생산자로 끼운다.** 하류(채점·오버레이·재귀속)는 자기가
읽는 `Region[]`이 누구 손에서 나왔는지 알 필요가 없고, 알아서도 안 된다.

이 선택의 값어치:
- `Region` 타입을 **바꾸지 않는다** → `grading.ts`·`MarkOverlay`·`GradeOverlay`가 무영향
- `ANALYSIS_VERSION`을 올리면 기존 캐시가 자동 무효화되어 **재분석 경로가 이미 존재한다**
- FR-002(페이지 단위 저장)·R3(중복 방지)가 기존 캐시 판정으로 그대로 충족된다

---

## 재사용하는 기존 엔티티 (변경 없음)

`apps/student-mobile/src/types.ts`에 이미 정의돼 있다. **여기서 다시 정의하지 않는다**
(헌법 원칙 IV).

| 타입 | 역할 | 이번 기능에서 |
|---|---|---|
| `Region` | 문항 하나의 구조 — `bounds`·`numBox`·`numLabel`·`choices[]`·`answerType` | AI 응답을 이 형태로 변환해 채운다 |
| `SegmentCache` | `{docId, page, regions, segmentVersion}` | **AI 분석 결과의 저장 형태** |
| `AnswerEntry` | `{regionId, value, source}` | 정답지 분석 결과. `source: 'answerPdf'` |
| `Box` · `ChoiceLabel` | 좌표·선지 라벨 | 그대로 |

### `Region` 필드 중 AI가 채우는 것

| 필드 | AI가 채우나 | 비고 |
|---|---|---|
| `bounds` | ✅ | 문항 전체 경계 |
| `numBox` · `numLabel` | ✅ | **번호 값**을 읽는다 — 스캔 경로가 못 하던 것(US-02) |
| `numSynth` | ❌ | 항상 `false`. 번호를 실제로 읽으므로 합성이 아니다 |
| `choices[]` | ✅ | `label`(1~5) + `box` |
| `answerType` | ✅ | `choice` / `integer` / `expression` |
| `ansSynth` | ❌ | 항상 `false` |
| `stemBox` · `ansBox` · `ptsBox` · `figBox` · `workBox` | ❌ | 이번 범위 밖. 채점에 쓰이지 않는다 |

---

## 신규 엔티티

### `PageAnalysis` — 분석 이력·신뢰도 (Region과 분리)

`Region`을 오염시키지 않으려고 **별도 스토어**에 둔다. 채점은 이 레코드를 읽지 않는다 —
화면 표시와 재시도 판단에만 쓴다.

| 필드 | 타입 | 의미 |
|---|---|---|
| `docId` | `string` | |
| `kind` | `'workbook' \| 'answerkey'` | FR-011 |
| `page` | `number` | 0-based |
| `status` | `'pending' \| 'ok' \| 'failed'` | `pending` = 대기(E1·E2·E3), `failed` = E4·E5·E6 |
| `failureCode` | `'schema' \| 'refusal' \| 'render' \| null` | E4 / E5 / E6 대응 |
| `confidences` | `Record<string, number>` | `regionId` → 0~1. **범위 검증은 프록시가 한다**(스키마로 못 박음 — research D-4) |
| `model` | `string` | 응답의 `model` 값. 모델이 바뀌면 재현이 달라지므로 기록한다 |
| `analyzedAt` | `number` | |
| `sentBytes` | `number` | 전송량. 비용 실측(D-10)의 입력이다 |

**키**: `[docId, kind, page]` — R3(중복 방지)이 이 키의 존재 여부로 성립한다.

### `ConsentRecord` — 전송 동의

| 필드 | 타입 | 의미 |
|---|---|---|
| `items` | `ConsentItem[]` | 동의한 전송 항목. **열거가 MUST**(헌법 「데이터와 프라이버시」) |
| `grantedAt` | `number` | |
| `version` | `number` | 전송 항목이 늘면 올린다 → 재동의 |

```ts
type ConsentItem =
  | 'answerkey-page'        // 정답지 페이지 이미지
  | 'workbook-page-with-ink' // 문제집 페이지 이미지 — 학생 필기 포함 (FR-012)
```

**`'workbook-page-with-ink'`의 이름이 곧 고지다.** 필기가 함께 나간다는 사실을 흐리지 않기
위해 타입 수준에서 못 박는다. 동의 화면은 이 목록을 그대로 읽어 보여준다.

---

## 상태 전이

문항 하나가 채점 결과를 갖기까지.

```
                 ┌──────────────────────────────────────────┐
                 │  분석 없음                                │
                 └───────────────┬──────────────────────────┘
        정답지 등록 / 페이지에 첫 필기 (R1)
                                 ▼
    ┌────────────────┐  네트워크 없음·일시 장애   ┌──────────────┐
    │  pending       │◄──────────(E1·E2·E3)──────►│  재시도 대기  │
    └───────┬────────┘                            └──────────────┘
            │ 스키마 통과 (R5)         │ 스키마 위반 / 거부 / 렌더 실패
            ▼                          ▼
    ┌────────────────┐          ┌──────────────┐
    │  ok            │          │  failed      │ (E4·E5·E6)
    │  → SegmentCache│          │  → 직접 입력  │
    └───────┬────────┘          └──────────────┘
            │
            ▼  기존 채점 경로 — 여기서부터 AI는 관여하지 않는다 (R6)
    detectChoice → gradeRegion → Attempt{correct|incorrect|unattempted|nokey}
```

**두 상태를 섞지 않는다**(spec.md Key Entities):

| 상태 | 이 모델에서 | 어떻게 풀리나 |
|---|---|---|
| **대기** | `PageAnalysis.status === 'pending'` | 네트워크 연결 시 저절로 |
| **미판정** | `Attempt.result === 'unattempted' \| 'nokey'` (기존 값) | 학생의 확인·수정 |

`nokey`는 R9(정답 매칭 실패)의 착지점이기도 하다 — **새 상태를 만들지 않았다.**

---

## 저장소 (IndexedDB)

`lib/db.ts`에 스토어 둘을 추가한다. 기존 `segments` 스토어는 그대로 쓴다.

| 스토어 | 키 | 신규 |
|---|---|---|
| `segments` | `[docId, page]` | 기존 — AI 결과도 여기 들어간다 |
| `pageAnalysis` | `[docId, kind, page]` | ✅ |
| `consent` | 단일 레코드 | ✅ |

**학생 데이터는 이 셋과 기존 스토어를 벗어나지 않는다**(헌법 원칙 I).

---

## 검증 규칙

스키마로 못 박을 수 없어 **프록시가 코드로 검증**하는 것들(research D-4):

| 규칙 | 위반 시 |
|---|---|
| `confidence` ∈ [0, 1] | R5 — 분석 실패(E4) |
| `choices[].label` ∈ {1,2,3,4,5} | 〃 |
| `box` 좌표가 이미지 경계 안 | 〃 |
| `numLabel`이 정수 문자열 | 〃 |
| 한 페이지 문항 수 ≤ 상한 | ⚠️ 상한 미결정 — "한 페이지에 200개"류 이상치 방어(spec Edge Case). 실측 전엔 검증하지 않는다 |

마지막 항목은 **의도적으로 비워 둔다.** 조판별 최대 문항 수를 재본 적이 없어 지금 숫자를
넣으면 헌법 원칙 III 위반이다.
