# Contract: 프록시 API

**Date**: 2026-07-31 · **Plan**: [../plan.md](../plan.md)

앱과 프록시 서버 사이의 유일한 계약이다. 앱은 Anthropic API를 직접 호출하지 않는다
(헌법 원칙 I — API 키는 프록시에만 존재).

---

## `POST /analyze`

페이지 이미지 1장을 분석해 문항 구조를 돌려준다.

### Request

`multipart/form-data`

| 파트 | 타입 | 필수 | 의미 |
|---|---|---|---|
| `kind` | `"workbook" \| "answerkey"` | ✅ | 분석 대상 종류 |
| `page` | PNG 이미지 | ✅ | 렌더된 페이지 1장. 긴 변 ≤ 2576px (R2) |

**이것이 전송 항목의 전부다.** `docId`, 페이지 번호, 학생 식별자, 채점 이력, 스트로크
좌표는 보내지 않는다(FR-010). 페이지 번호조차 보내지 않는 이유는 **프롬프트 캐싱**이다 —
가변 값이 접두사에 끼면 캐시가 무효화된다(research D-5).

`workbook`의 `page`에는 **학생 필기가 합성돼 있다**(FR-012). 동의 화면이 이 사실을
고지한 뒤에만 전송된다.

### Response `200`

```json
{
  "status": "ok",
  "model": "claude-opus-5",
  "imageSize": { "w": 1988, "h": 2576 },
  "regions": [
    {
      "numLabel": "12",
      "numBox":  { "x": 120, "y": 340, "w": 46,  "h": 44 },
      "bounds":  { "x": 110, "y": 330, "w": 900, "h": 420 },
      "answerType": "choice",
      "choices": [
        { "label": 1, "box": { "x": 140, "y": 620, "w": 150, "h": 40 } },
        { "label": 2, "box": { "x": 300, "y": 620, "w": 150, "h": 40 } }
      ],
      "confidence": 0.93
    }
  ],
  "answers": [
    { "numLabel": "12", "value": "3", "confidence": 0.98 }
  ]
}
```

| 필드 | 언제 |
|---|---|
| `regions` | `kind: "workbook"` 일 때. `answerkey`면 빈 배열 |
| `answers` | `kind: "answerkey"` 일 때. `workbook`이면 빈 배열 |
| `imageSize` | 항상. 클라이언트가 픽셀 → 정규화 변환에 쓴다 (R8) |

**좌표는 전송한 이미지의 픽셀 좌표다.** 정규화(`MAX_W=760`)는 클라이언트가 하며, 변환식의
출처는 `ARCHITECTURE.md` §5 하나다(헌법 원칙 IV).

**`regions[]`에 정답/오답에 해당하는 필드는 없다.** 스키마 수준에서 존재하지 않는다 —
R6·FR-013이 여기서 물리적으로 강제된다.

### Response `200` — 분석 실패

HTTP 상태는 200이되 `status`로 구분한다. 실패도 정상적인 결과이기 때문이다.

```json
{ "status": "failed", "failureCode": "schema" }
{ "status": "failed", "failureCode": "refusal" }
```

| `failureCode` | 원인 | 클라이언트 동작 |
|---|---|---|
| `schema` | 모델 응답이 스키마·범위 검증 실패 (R5, data-model 검증 규칙) | **E4** — 페이지 단위 격리, 재시도 안 함 |
| `refusal` | `stop_reason: "refusal"` — 폴백까지 거부 (research D-7) | **E5** — 재시도해도 같으므로 재시도 안 함 |

### Error responses

| 코드 | 의미 | 클라이언트 동작 |
|---|---|---|
| `429` | 상류 rate limit. `Retry-After` 헤더 전달 | **E3** — 백오프 후 대기 |
| `502` / `504` | 상류 장애·타임아웃 | **E2** — R12 정책대로 재시도 후 대기 |
| `413` | 이미지가 크기 상한 초과 | **E6** 계열 — 렌더 규격 위반. 재시도 무의미 |
| `400` | `kind` 누락·잘못된 값 | 버그. 로그 남기고 실패 처리 |

**네트워크 도달 실패**(오프라인)는 HTTP 응답이 아니라 `fetch` 거부로 나타난다 → **E1**,
큐에 넣고 대기.

---

## 프록시가 지는 책임

| 책임 | 근거 |
|---|---|
| API 키 보관 — 클라이언트에 절대 노출 금지 | 헌법 원칙 I |
| 프롬프트·JSON 스키마 소유 | research D-9 — 클라이언트에 두면 우회로 R6가 무력화된다 |
| 스키마로 표현 못 하는 범위 검증(`confidence` 0~1 등) | research D-4 |
| `stop_reason: "refusal"` 처리 + `fallbacks: "default"` 지정 | research D-7 |
| 프롬프트 캐시 브레이크포인트 배치 | research D-5 |
| **학생 데이터 영속 저장 금지** — 중계만 한다 | 헌법 「데이터와 프라이버시」 |

## 프록시가 하지 않는 것

- 채점. O/X는 클라이언트의 `lib/grading.ts`가 단독으로 낸다 (R6)
- 정답과 학생 답의 대조
- 페이지 이미지·응답의 로깅·보관
- 재시도 — 재시도 정책은 클라이언트 소관이다(R12, 미결정)
