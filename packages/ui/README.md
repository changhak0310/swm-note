# @puri/ui — 푸리 디자인 시스템

토큰 · 브랜드 에셋 · 공용 React 컴포넌트. 원전은 `docs/design-system/README.md`(색 철학·카피 톤·금지 사항)이고, 이 파일은 **어떻게 쓰는가**만 적는다.

## 쓰는 법

```css
/* 앱의 전역 CSS — 순서가 중요하다 */
@import "tailwindcss";        /* ← 반드시 먼저 */
@import "@puri/ui/styles.css";
```

```tsx
import { Button, GradeBadge, CauseTag } from '@puri/ui'
```

**Tailwind는 선택이 아니라 전제다.** 토큰이 `@theme` 블록에 들어 있어서, Tailwind 없이 `styles.css`만 링크하면 그 블록이 통째로 무시되고 **토큰이 전부 사라진다.** 패키지 소스 스캔(`@source`)은 `styles/index.css`가 자기 경로 기준으로 선언하므로 앱이 따로 배선할 것은 없다.

- **빌드 없는 소스 패키지** — `src/`를 그대로 export한다. Vite/Capacitor 앱은 그대로 동작하고, Next.js 앱은 `next.config.js`에 `transpilePackages: ["@puri/ui"]` 한 줄이 필요하다.
- 모든 컴포넌트에 `'use client'` 배너가 있어 Next.js App Router(RSC)에서 바로 쓸 수 있다.
- **폰트는 패키지가 싣는다** — Pretendard Variable · JetBrains Mono Variable을 npm에서 번들한다. CDN 의존이 없어 오프라인에서도 같게 렌더링된다.

## Exports

| 경로 | 내용 |
|---|---|
| `@puri/ui` | 컴포넌트 + 타입 |
| `@puri/ui/styles.css` | 전역 진입점 (폰트 + 토큰 + 테마 + base) |
| `@puri/ui/tokens/*.css` | colors / typography / spacing 개별 토큰 |
| `@puri/ui/assets/*` | `logo.svg`(기본), `logo-white.svg`(어두운 배경용) |

## 컴포넌트

| 그룹 | 컴포넌트 |
|---|---|
| core | `Button` `IconButton` `Input` `Checkbox` `Chip` |
| grading | `GradeBadge`(O/△/X) · `CauseTag`+`CAUSES`(원인 5태그) · `GradeResultCard` |
| study | `Timer` · `ReviewChecks` · `WrongNoteCard` · `ConceptHub` |

## 스타일 규약 — Tailwind + shadcn/ui

변형은 **CVA**로 선언하고 `cn()`으로 합친다. hover/press는 CSS 변형(`hover:` `active:` `focus-visible:`)으로 쓴다.

```tsx
const buttonVariants = cva('…공통…', { variants: { variant: { primary: 'bg-brand …' } } })
<Comp className={cn(buttonVariants({ variant, size }), className)} />
```

**토큰은 두 얼굴을 갖는다.** `--radius-lg`는 `var(--radius-lg)`로도, `rounded-lg` 유틸리티로도 쓴다. 간격은 Tailwind 기본 스케일이 이미 4px 배수라 `p-4` = `var(--space-4)` = 16px로 같다 — `p-[var(--space-4)]`로 쓰지 않는다.

### shadcn 컴포넌트 추가

```sh
cd packages/ui && npx shadcn@latest add dialog
```

두 가지만 손보면 된다:

1. **`@/` 임포트를 상대 경로로 고친다.** 소비하는 앱의 Vite는 이 패키지의 `@/` 별칭을 모른다. `@/lib/utils` → `../../lib/utils`.
2. **배럴(`src/index.ts`)에 export를 추가한다.**

색은 안 고쳐도 된다 — `styles/theme.css`가 shadcn의 `--background` `--primary` 같은 이름을 푸리 토큰의 별칭으로 정의해둔다. **그 파일을 지우면 전부 중립 회색이 된다.**

## 개발

```sh
pnpm --filter @puri/ui dev        # 갤러리 (앱 없이 뜬다)
pnpm --filter @puri/ui typecheck
```

컴포넌트를 추가하면 `playground/Gallery.tsx`에 섹션을 넣는다. 갤러리에 없으면 아무도 그게 있는지 모른다.

## 지켜야 할 규칙 (design-system README 요약)

- 색은 진단이다 — O=green, △=amber, X=red, 원인 5색은 칩에서만. 큰 면적 채색 금지.
- 이모지·느낌표·과한 축하 금지. 카피는 담담하고 구체적으로.
- 그라데이션·사진·패턴 배경 금지. 따뜻한 off-white 캔버스 + 종이색 카드.
- 카드에 색 좌측 보더 액센트 금지 — 상태는 배지가 말한다.
- 숫자(타이머·카운트)는 `num` 클래스 (mono + tabular-nums).
- 인터랙티브 요소는 `var(--tap-min)`(44px) 이상.
