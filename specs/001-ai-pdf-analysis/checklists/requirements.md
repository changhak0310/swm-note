# Specification Quality Checklist: AI 기반 PDF 문항 분석

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-30
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [ ] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

**15/16 통과.** 미통과 1건은 의도적이다.

- **Written for non-technical stakeholders** — `문제` 절이 파일 경로(`lib/scan/detect.ts`),
  줄 수, 10단 게이트 생존율 같은 기술적 증거에 기대고 있다. 이 저장소는 브라운필드라
  "이미 됨 / 안 됨"을 코드로 갈라야 범위가 정해진다(`spec-template` 오버라이드의 브라운필드
  규율). 각 근거 뒤에 학생 관점 서술을 붙여 완화했다 — *"학생 입장에서 이것은 '어떤 문제집은
  채점이 아예 안 된다'로 나타난다."* **의도적 미준수로 남긴다.**

**수정 이력**

| 회차 | 미통과 | 조치 |
|---|---|---|
| 1차 | FR-006(전송 동의)에 수용 시나리오 없음 | US-01에 시나리오 3 추가 |
| 1차 | 미해결 마커 3건 (FR-009·010·011) | 사용자 응답으로 해소 (아래) |
| 1차 | 안쪽 경계 미확정 (기존 파이프라인 처분) | FR-009 확정으로 해소 |
| 2차 | 자가 검토 행이 마커 문자열을 자기참조해 오탐 유발 | "미해결 마커 0건"으로 표현 변경 |
| 3차 | 목표가 "학습·MVP·개발 속도"로 명확해지며 FR-009 방향 전환 | 로컬 1차 → **AI 단독**. 기존 파이프라인은 삭제하지 않고 미호출. 「헌법 충돌」 절 신설 |

**해소된 미해결 3건 (2026-07-30)**

| 항목 | 결정 | 파급 |
|---|---|---|
| FR-009 관계 | **AI 단독** (3차에서 로컬 1차 → AI 단독으로 전환) | 개발 속도 우선. `lib/psp/`·`lib/scan/` 4,866줄은 삭제하지 않고 미호출. **헌법 원칙 I과 충돌** → 「헌법 충돌」 절 참조 |
| FR-010 전송 범위 | **페이지 단위** — 정답지는 페이지 전체, 문제집은 **필기가 입력된 페이지** 전체 | 학생 필기가 외부로 나간다 → FR-012(동의 화면 명시) 신설. 분석 시점이 "등록 시 1회"에서 "필기 발생 시"로 바뀌어 Assumptions 교체 |
| FR-011 대상 | **문제집·정답지 둘 다** | 범위 최대. 정확도 우선 방침 반영 |

**주의 1.** 페이지당 비용 상한과 (나중에 도입할) 로컬→AI 전환 임계값은 **의도적으로 비워
두었다.** `lib/psp/verify.ts`가 이미 신뢰도 점수를 내므로 골든 5권에서 분포를 측정한 뒤
정한다 — 지금 숫자를 박으면 헌법 원칙 III(숫자에는 출처가 있다) 위반이다.

**주의 2 — 해소됨 (2026-07-30).** FR-009(AI 단독)가 헌법 원칙 I과 충돌했으나, 헌법을 사실에
맞게 고치는 A안을 택해 **v3.0.0**으로 개정했다. 원칙 I이 「로컬 저장 · AI 기능은 네트워크
필수」로 바뀌면서 `Constitution Check` 게이트를 막던 사유가 사라졌다. 스펙의 「헌법 정합」 절에
규칙↔FR 대응표로 기록돼 있다.
