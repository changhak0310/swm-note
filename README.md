# 푸리 (Puri)

Android 태블릿에서 문제집 PDF에 펜 필기하고, 객관식을 기하 판정으로 자동 채점하는 로컬 전용 앱.
**서버 없음 · 외부 통신 없음 · AI 호출 없음.** 상세 설계는 [`docs/푸리_1차MVP_아키텍처명세서.md`](docs/푸리_1차MVP_아키텍처명세서.md) 참조.

## 구조

Turborepo + pnpm 모노레포. 앱은 `apps/student-mobile` 하나다.

```
apps/student-mobile/
├── src/lib/          DOM·React 비의존 순수 함수 — 유일한 아키텍처 경계
│   ├── geometry.ts     좌표계(MAX_W=760)·박스·고리 판정
│   ├── segment.ts      구역 분할 + 선지 분리 (기존 알고리즘 이식 지점)
│   ├── attribution.ts  스트로크 → 문제 구역 귀속
│   ├── grading.ts      객관식 기하 판정 (닫힌 고리 / 열린 마크)
│   ├── answerKey.ts    정답지 텍스트 파싱 (OCR 없음)
│   ├── pdf.ts          pdf.js 로드·렌더·텍스트 추출
│   └── db.ts           IndexedDB 6개 스토어 + 1초 디바운스 저장
├── src/design/       푸리 디자인 시스템 (docs/design-system/README.md의 구현)
│   ├── tokens/         colors·typography·spacing CSS 토큰
│   ├── core/           Button · IconButton · Input · Checkbox · Chip
│   ├── grading/        GradeBadge (O/△/X) · CauseTag (원인 5태그)
│   └── study/          Timer · ReviewChecks · WrongNoteCard · ConceptHub
├── src/stores/       Zustand (documentStore, inkStore)
├── src/components/   PdfCanvas / InkCanvas / GradeOverlay 3겹 레이어 외
└── capacitor.config.ts
```

## 디자인 시스템

가이드는 [`docs/design-system/README.md`](docs/design-system/README.md) — 톤은 "담담한 도구",
색은 장식이 아니라 진단(O 그린 / △ 앰버 / X 레드, 원인 태그 5색), 이모지·그라데이션·색 보더 액센트 금지.
폰트는 오프라인 앱 특성상 CDN 대신 npm 번들(Pretendard Variable, JetBrains Mono)로 교체했다.
`pnpm dev` 후 문서 목록의 **디자인 시스템** 버튼(dev 전용)에서 전 컴포넌트 갤러리를 볼 수 있다.

## 개발

```sh
pnpm install
pnpm dev          # 웹 브라우저에서 개발 (마우스 필기 허용)
pnpm test         # src/lib 순수 함수 단위 테스트 (vitest)
pnpm typecheck
```

웹 dev 모드 제약: PDF 원본은 네이티브에서만 Filesystem에 저장된다. 브라우저에서는
메모리 캐시라서 **새로고침하면 문서를 다시 가져와야 한다.**

## Android

```sh
pnpm build
cd apps/student-mobile
npx cap add android    # 최초 1회 — android/ 생성
npx cap sync
npx cap open android
```

## 화면 (시안2 — 삼성노트 스타일)

- **노트 목록** — 사이드바 + 노트 그리드 + FAB 업로드. 길게 누르기로 이름 변경/삭제,
  문항 수·마지막 채점 결과·상대 시간 표시 (F-01·F-02)
- **에디터** — 좌측 펜 툴바(펜 3색·형광펜·스트로크 지우개·실행취소·✦ AI 채점),
  세로 연속 스크롤 + 보이는 페이지 ±1 윈도잉 + 핀치 줌, 손그림 O·사선 채점 마크,
  문제별 회차 칩, 채점 요약·재풀이 바텀시트 (F-04·F-07·F-08·F-09)
- **정답 입력** — 진행률, 자동 스크롤, 주관식 행 → 5지선다 전환, 정답지 PDF·문제지
  정답표 파싱 (F-05·F-06)

## 다음 작업

1. **실기기 필기 스파이크** — `pressure`·`getCoalescedEvents`·지연 실측 (아키텍처 §6.4).
   설계를 뒤집을 수 있는 유일한 미지수다.
2. `src/lib/segment.ts`의 `segmentPage()`에 기존 분할 알고리즘 이식
   (현재 스텁 — 여기가 채워져야 분할·채점 파이프라인이 실데이터로 동작한다)
3. 오채점 복구 UI (시스템 명세 미결정 1번 — 팀 논의 대기)
