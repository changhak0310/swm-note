# 아키텍처 베이스라인 — 새 앱용

## 0. 메타데이터

| 항목 | 값 |
|---|---|
| 버전 | v1.0 |
| 작성일 | 2026-08-04 |
| 원본 | 푸리(Puri) — `docs/ARCHITECTURE.md` v0.2 · 루트 `README.md` · 실제 코드 |
| 성격 | **새 리포로 복사해 가는 골격 명세.** 도메인이 빠진 자리는 `[정할 것]`으로 비워 뒀다 |
| 짝 문서 | [`DESIGN-BASE.md`](./DESIGN-BASE.md) — 디자인 시스템·토큰·컴포넌트 규약 |

### 이 문서가 하는 일

푸리에서 **도메인을 걷어내고 남는 것**만 적었다. 새 앱은 기능도 방향성도 다르지만 셸(Capacitor)·
빌드(Vite)·패키지 경계·저장 전략·문서 체계는 그대로 쓴다. 그 "그대로 쓰는 것"의 목록이 여기다.

이 문서를 새 리포의 `docs/ARCHITECTURE.md` 자리에 놓고, `[정할 것]` 자리를 채우면서 고쳐 나간다.
푸리 문서를 참조로 남기지 말고 **복사해서 새 리포 안에서 자립시킨다** — 두 리포를 오가며 읽어야
하는 문서는 아무도 안 읽는다.

### 표기

- `<scope>` — 새 브랜드의 npm 스코프. 푸리의 `@puri/*` 자리 (예: `@foo/ui`, `@foo/mobile`)
- `<repo>` — 새 리포 이름. 푸리의 `swm-note` 자리
- `[정할 것]` — 새 앱이 결정해야 하는 빈 칸. 지어낸 값을 채우지 않는다

---

## 1. 가져가는 것 / 두고 오는 것

**가져간다 — 도메인과 무관한 골격**

| | 어디에 | 절 |
|---|---|---|
| worktree 배치·운용 규약 | 리포 밖 디렉터리 구조 | §2 |
| Turborepo + pnpm 모노레포 골격 | 루트 3개 파일 | §3 |
| 기술 스택과 그 선정 이유 | `package.json` | §4 |
| **두 개의 경계** — `packages/ui` ↔ `apps/*`, `src/lib` 순수성 | 아키텍처 규칙의 전부 | §5 |
| 앱 파일 구조 | `apps/<app>/src/` | §6 |
| 스타일 배선 (Tailwind v4 + `@theme` + `@source`) | `styles/` | §7 |
| Capacitor iOS·Android 셸 | `capacitor.config.ts`, `ios/`, `android/` | §8 |
| 저장 전략 — Filesystem / IndexedDB / 디바운스 + flush | `lib/db.ts`, 스토어 | §9 |
| 테스트 규약 — vitest node 환경, `.real` 게이팅 | `src/lib/__tests__/` | §11 |
| 문서 체계 · spec-kit 워크플로 · `.claude` 에이전트 2종 | `docs/`, `.specify/`, `.claude/` | §12 |

**두고 온다 — 푸리의 도메인**

| | 이유 |
|---|---|
| PDF 파이프라인 (`pdf.js`, `psp/`, `scan/`, `tesseract.js`) | 문제집 PDF를 다루는 앱에만 필요 |
| 데이터 모델 (`Document` `Region` `Stroke` `Attempt` `AnswerKey`) | 전부 채점 도메인 |
| 좌표계 `MAX_W = 760` · 스트로크 귀속 · 객관식 기하 판정 | 필기·채점이 있을 때만 (§10에 포인터) |
| 헌법 원칙의 **내용** (로컬 저장·AI는 의견만·오프라인 채점 보장) | 형식(§12.4)만 가져가고 내용은 새로 쓴다 |
| 채점 스케일 O/△/X · 오답 원인 5태그 | `DESIGN-BASE.md` §4 참조 — 색값도 이름도 두고 온다 |

**애매한 것 — 필요하면 그때 가져간다**

필기 캔버스, 프록시 경유 AI 호출, 페이지 윈도잉. §10에 원본 포인터만 남겼다.

---

## 2. 리포와 worktree

### 2.1 배치

푸리는 리포 하나를 우산 디렉터리(`<repo>-P`) 아래 두고, 본체 체크아웃과 worktree들을 형제로 놓는다.

```
~/Project/<repo>-P/
├── <repo>/                        본체 — main 체크아웃. .git 실체가 여기 있다
└── worktree/
    ├── <repo>-<slug-a>            feat/<slug-a>
    └── <repo>-<slug-b>            feat/<slug-b>
```

새 앱도 같은 배치를 쓴다.

```sh
mkdir -p ~/Project/<repo>-P
cd ~/Project/<repo>-P
git clone <url> <repo>          # 또는: mkdir <repo> && cd <repo> && git init
cd <repo>
git worktree add ../worktree/<repo>-<slug> -b feat/<slug>
cd ../worktree/<repo>-<slug>
pnpm install                    # worktree마다 따로 돈다
```

### 2.2 왜 브랜치 전환이 아니라 worktree인가

세 가지 다 실제로 겪는 일이다.

1. **`node_modules`·`dist`·`.turbo`가 브랜치마다 다르다.** 의존성이 갈린 브랜치를 오가면 매번
   재설치·재빌드가 붙는다. worktree는 각자 갖는다 — pnpm은 콘텐츠 주소 스토어라 디스크는 거의 안 는다.
2. **네이티브 프로젝트가 브랜치 전환에 취약하다.** `android/app/build`, `android/.gradle`,
   `local.properties`, iOS의 `Pods/`·`DerivedData`는 gitignore 대상이라 전환해도 안 지워진다.
   이전 브랜치의 빌드 산물이 남아 "내 코드는 맞는데 앱이 옛날 것"이 된다.
3. **에이전트를 브랜치별로 병렬로 돌린다.** 한 작업트리에서 두 세션이 파일을 건드리면 서로의
   변경을 덮는다. worktree는 파일 시스템 수준에서 갈라진다.

### 2.3 `.gitignore` — 그대로 승계 + iOS 추가

```gitignore
node_modules/
dist/
.turbo/
*.local

# Capacitor — Android
apps/<app>/android/app/build/
apps/<app>/android/.gradle/
apps/<app>/android/local.properties

# Capacitor — iOS   ← 푸리에 없던 항목. §8.3
apps/<app>/ios/App/Pods/
apps/<app>/ios/App/build/
apps/<app>/ios/App/App/public/
apps/<app>/ios/DerivedData/

# Spec Kit — 네트워크 캐시 (재생성된다)
.specify/*/.cache/

.DS_Store
```

`ios/App/App/public/`은 `cap sync`가 웹 번들을 복사해 넣는 자리다. 커밋하면 `dist/`를 두 번
버전 관리하는 셈이 된다.

---

## 3. 모노레포 골격

루트에 파일 셋. 스코프 이름만 바꾸면 그대로 쓴다.

**`package.json`**

```json
{
  "name": "<repo>",
  "private": true,
  "packageManager": "pnpm@11.16.0",
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck"
  },
  "devDependencies": { "turbo": "^2.5.4" }
}
```

**`pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

푸리는 여기에 `allowBuilds`로 postinstall 스크립트를 통제한다(`esbuild: true`, `tesseract.js: false`).
새 앱도 pnpm이 빌드 스크립트 승인을 물어 오면 **패키지마다 왜 필요한지 확인하고 한 줄 주석과 함께
적는다.** 무심코 전부 허용하면 그게 공급망 구멍이다.

**`turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "outputs": ["dist/**"] },
    "dev": { "cache": false, "persistent": true },
    "test": {},
    "typecheck": {}
  }
}
```

`test`·`typecheck`에 `outputs`가 없는 것은 의도다 — 산출물이 없고 성공 여부만 캐시하면 된다.

---

## 4. 기술 스택

### 4.1 핵심

| 영역 | 선택 | 선정 이유 |
|---|---|---|
| 앱 셸 | **Capacitor** (iOS + Android) | 웹 코드를 그대로 앱으로 감싼다. 화면 코드가 플랫폼마다 갈리지 않는다 |
| UI | React + TypeScript | |
| 번들러 | **Vite** | §4.3 |
| 스타일 | **Tailwind CSS v4** | 디자인 시스템이 `@theme`로 토큰을 내보내므로 선택이 아니라 전제 (§7) |
| 상태 | **Zustand** | Redux는 이 규모에 과하고, Context는 리렌더 범위를 못 좁힌다 |
| 로컬 DB | **IndexedDB** (`idb` 래퍼) | `localStorage`는 5MB·동기·문자열뿐 |
| 파일 | `@capacitor/filesystem` | 큰 바이너리는 DB가 아니라 파일시스템 (§9) |
| 생명주기 | `@capacitor/app` | 백그라운드 진입 시 저장 flush |
| 테스트 | **vitest** | Vite와 설정을 공유한다 |

### 4.2 버전 (푸리 2026-08 실측 — 새 리포는 설치 시점 안정 버전)

| | |
|---|---|
| pnpm 11.16 · turbo 2.5 | React 19.1 · react-dom 19.1 |
| Vite 6.3 · vitest 3.2 | TypeScript 5.8 (`strict: true`) |
| Tailwind 4.1 (`@tailwindcss/vite`) | Capacitor 7.4 |
| zustand 5.0 · idb 8.0 | react-router-dom 7.18 |

`tsconfig.json`은 앱과 패키지가 같은 내용을 쓴다 — `target: ES2022`, `moduleResolution: bundler`,
`jsx: react-jsx`, `strict`, `isolatedModules`, `noEmit`. `include`만 다르다.

### 4.3 Next.js를 쓰지 않는 이유

**Capacitor 셸을 쓴다면 그대로 유효하다.** Next.js는 서버 렌더링과 라우팅 서버를 전제로 설계돼
있고, Capacitor는 정적 번들을 웹뷰에 밀어 넣는다. `next export`로 우회할 수 있으나 App Router의
상당 기능이 죽고 설정만 는다. 렌더링 서버가 없고 화면 수가 적으면 SSR·파일 기반 라우팅의 이득이 없다.

**Vite + React + `react-router`** 로 간다. Capacitor 공식 템플릿도 Vite 기반이다.

> 새 앱이 **웹 우선**이고 네이티브가 부차적이라면 이 결정은 다시 판단할 자리다. 그때도
> `packages/ui`는 그대로 쓸 수 있다 — `next.config.js`에 `transpilePackages: ["<scope>/ui"]`
> 한 줄만 붙이면 되고, 컴포넌트에 `'use client'` 배너가 이미 있어 RSC에서도 바로 돈다.

---

## 5. 두 개의 경계 — 아키텍처 규칙은 이것뿐

푸리의 아키텍처 규칙은 둘밖에 없다. 이게 전부라는 점이 중요하다.

### 5.1 컴포넌트는 공유하고, 화면은 공유하지 않는다

| | `packages/ui` | `apps/*` |
|---|---|---|
| 소유 | 토큰·브랜드 에셋·재사용 컴포넌트 | 화면 조합, 라우팅, 상태, 앱 전용 조각 |
| 의존 방향 | 앱을 **모른다** | `<scope>/ui`를 import 한다 |
| 스타일 | Tailwind + CVA (shadcn/ui 규약) | 같음 |
| 전역 CSS | 토큰·폰트·프리미티브만 | 그 앱의 결정(스크롤·선택 방지 등)은 앱의 `index.css` |

iOS·Android·웹 셋은 **Capacitor가 같은 `dist/`를 감쌀 뿐이라 앱 하나**다. 경계가 필요한 이유는
플랫폼이 아니라 **화면이 다른 앱이 또 생길 때**다.

### 5.2 `src/lib`은 DOM과 React를 모른다

`apps/<app>/src/lib/` 아래는 **순수 함수**로 유지한다. 판정·계산·파싱 로직은 전부 여기 있고,
노드 환경에서 테스트할 수 있어야 한다(§11).

- 렌더링·스토어에 판정 규칙을 섞지 않는다
- 반대로 `lib`이 `document`·`window`·React 훅을 참조하면 그건 경계 위반이다
- 브라우저 API가 꼭 필요하면 인자로 주입받는다 (푸리는 캔버스를 그렇게 넘긴다)

이 경계가 있으면 **"이 값이 왜 이렇게 나왔나"를 UI를 띄우지 않고 답할 수 있다.** 그게 유일한 목적이다.

---

## 6. 파일 구조

```
packages/ui/                     <scope>/ui — 디자인 시스템 (빌드 없는 소스 패키지)
├── src/styles/
│   ├── index.css                전역 진입점 (@import 목록만. 소비자는 이 파일 하나만 쓴다)
│   ├── theme.css                shadcn 시맨틱 ↔ 브랜드 토큰 다리
│   ├── base.css                 .ds-card · .ds-wordmark
│   └── tokens/                  colors · typography · spacing
├── src/components/{core,<domain-a>,<domain-b>}/
├── src/lib/utils.ts             cn() — extendTailwindMerge 설정 포함
├── src/assets/                  logo.svg · logo-white.svg
├── src/index.ts                 배럴
├── components.json              shadcn CLI 설정
└── playground/                  컴포넌트 갤러리 (앱 없이 실행)

apps/<app>/
├── ios/                         Capacitor 네이티브 (cap add ios — gitignore 일부)
├── android/                     Capacitor 네이티브 (cap add android)
├── src/
│   ├── lib/                     DOM·React 비의존 순수 함수 — §5.2
│   │   ├── db.ts                IndexedDB 접근
│   │   └── [정할 것]            도메인 로직
│   ├── components/              화면과 앱 전용 조각
│   ├── routes/
│   │   ├── index.tsx            라우트 정의
│   │   ├── paths.ts             경로 문자열의 유일한 출처
│   │   └── dev.ts               dev 전용 라우트 (프로덕션 번들에서 빠진다)
│   ├── stores/                  Zustand
│   ├── index.css                Tailwind + DS + 이 앱만의 전역 규칙
│   ├── types.ts
│   └── main.tsx
├── vite.config.ts
├── tsconfig.json
└── capacitor.config.ts
```

**`routes/paths.ts`는 규약이다.** 경로 문자열을 컴포넌트에 직접 쓰지 않는다 — 흩어지면 라우트를
못 바꾼다. dev 전용 라우트는 별도 파일로 갈라 프로덕션 번들에서 통째로 빠지게 한다.

`components/` 안에 도메인 폴더를 더 파는 것은 파일이 20개를 넘을 때 한다. 그전에는 평면이 낫다.

---

## 7. 스타일 배선 — Tailwind v4

**소비하는 앱은 Tailwind를 반드시 쓴다.** 디자인 시스템이 클래스명과 `@theme` 토큰을 내보내므로
선택이 아니라 전제다. 앱의 `src/index.css`는 두 줄로 시작한다:

```css
@import "tailwindcss";        /* ← 반드시 먼저 */
@import "<scope>/ui/styles.css";
```

**순서가 중요하다.** 토큰이 `@theme` 블록에 들어 있어서, Tailwind 없이 로드하면 **그 블록이 통째로
무시되고 토큰이 전부 사라진다.** 증상은 "색이 다 검정/기본값"이라 원인을 찾기 어렵다.

패키지 소스 스캔은 `packages/ui/src/styles/index.css`가 자기 경로 기준으로 선언한다:

```css
@source "../components";
```

이게 없으면 앱 빌드에서 패키지 컴포넌트의 클래스가 통째로 누락된다. **소비 앱이 배선할 것은 없다.**

Vite 플러그인은 앱과 패키지 양쪽에 붙인다:

```ts
plugins: [react(), tailwindcss()]
```

토큰 값·유틸리티 이름·`cn()` 설정은 [`DESIGN-BASE.md`](./DESIGN-BASE.md)가 유일한 출처다.
여기서는 배선만 다룬다.

---

## 8. iOS · Android — Capacitor

### 8.1 셸의 성격

Capacitor는 `dist/`를 네이티브 웹뷰(Android=Chromium, iOS=WKWebView)에 담고 브리지로 네이티브
API를 연결한다. **화면 코드는 플랫폼마다 갈리지 않는다.** 갈리는 것은 셋뿐이다 —
플러그인 동작 차이, 안전 영역, 제스처.

```ts
// apps/<app>/capacitor.config.ts
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.<brand>.<app>',
  appName: '[정할 것]',
  webDir: 'dist',
}

export default config
```

`appId`는 스토어 등록 후 바꿀 수 없다. 처음에 정한다.

### 8.2 명령

```sh
pnpm build
cd apps/<app>
npx cap add android      # 최초 1회
npx cap add ios          # 최초 1회 — macOS + Xcode 필요
npx cap sync             # 웹 번들 + 플러그인 반영. 빌드할 때마다
npx cap open android     # Android Studio
npx cap open ios         # Xcode
```

`cap sync`는 `dist/`를 복사할 뿐이라 **`pnpm build`를 먼저 돌리지 않으면 이전 번들이 그대로 들어간다.**
"고쳤는데 앱이 안 바뀐다"의 90%가 이것이다.

### 8.3 iOS — 푸리에서 검증된 적 없다

푸리는 `capacitor.config.ts`에 안드로이드만 있고 `ios/` 디렉터리가 없다. **아래는 새 리포가 처음
밟는 자리이므로 가정으로 다루고, 첫 실기기 빌드에서 확인한 뒤 이 절을 실측으로 갱신한다.**

| 확인할 것 | 왜 |
|---|---|
| **안전 영역** | 노치·홈 인디케이터. `viewport-fit=cover` + `env(safe-area-inset-*)`를 레이아웃에 반영해야 한다 |
| **바운스 스크롤** | WKWebView는 끝에서 튕긴다. `overscroll-behavior: none`이 Android만큼 안 먹는 경우가 있다 |
| **가장자리 스와이프 뒤로가기** | 캔버스·드래그 UI가 있으면 충돌한다. 끄거나 영역을 피해야 한다 |
| **키보드 리사이즈** | iOS는 웹뷰를 밀어 올린다. 고정 하단 바가 있으면 여기서 깨진다 |
| **Filesystem `Directory`** | Android와 물리 경로 의미가 다르다. 백업 대상 여부도 다르다 |
| **서명·프로비저닝** | 실기기 빌드에 Apple Developer 계정이 필요하다. CI를 붙일 거면 초기에 정한다 |
| **폰트 번들 용량** | Pretendard Variable + JetBrains Mono가 번들에 들어간다 (§DESIGN §5) |

`npx cap add ios`는 macOS에서만 된다. 팀에 Windows가 있으면 그 사실을 문서에 적는다.

### 8.4 웹 dev 모드의 제약

`pnpm dev`는 브라우저에서 돈다 — Capacitor 플러그인이 없다. 푸리는 이 때문에
**"PDF 원본이 네이티브에서만 Filesystem에 저장되고, 브라우저에서는 메모리 캐시라 새로고침하면
사라진다"** 는 차이를 안고 개발한다.

새 앱도 같은 구멍이 생긴다. **네이티브 API를 쓰는 지점마다 웹 폴백을 명시적으로 정하고 문서에
적는다.** 안 적으면 "내 컴퓨터에선 되는데"의 원인이 된다.

---

## 9. 저장 전략

### 9.1 무엇을 어디에

| 대상 | 위치 | 이유 |
|---|---|---|
| 큰 바이너리 (파일 원본, 미디어) | Filesystem `<dir>/{id}.<ext>` | IndexedDB에 Blob으로 넣으면 용량·성능이 무너진다 |
| 구조화 데이터 | IndexedDB | |
| 썸네일·작은 dataURL | IndexedDB 레코드 안 | 별도 파일로 만들 값이 아니다 |
| 사용자 설정 | IndexedDB (또는 `localStorage`) | 양이 작고 동기 접근이 편하면 후자도 된다 |

### 9.2 스토어 정의

```ts
// lib/db.ts — 스토어 목록과 키·인덱스는 여기 한 곳에만 적는다
| 스토어 | 키 | 인덱스 |
|---|---|---|
| [정할 것] | | |
```

**레코드를 너무 잘게 쪼개지 않는다.** 푸리는 필기 획을 하나씩 저장하면 페이지당 수천 레코드가
되어 조회가 무너지므로 **페이지 단위로 묶어** 저장한다. 묶으면 일부 변경에도 전체를 다시 쓰지만,
수십 KB 수준이면 디바운스와 함께 문제없다. 새 앱도 **"조회 단위 = 저장 단위"** 로 잡는다.

### 9.3 저장 시점 — 디바운스 + 생명주기 flush

```ts
// 변경 시: 1초 디바운스
scheduleSave()

// 백그라운드 진입 시: 대기분 즉시 저장
App.addListener('appStateChange', ({ isActive }) => {
  if (!isActive) flushPendingSaves()
})
```

**flush가 없으면 앱을 내리는 순간 마지막 1초가 사라진다.** 디바운스를 쓰는 모든 곳에 짝으로 붙인다.

### 9.4 캐시에는 버전을 박는다

계산 결과를 저장하는 스토어에는 **그 계산 로직의 버전 번호**를 같이 넣는다.

```ts
type <X>Cache = {
  ...
  <x>Version: number      // 알고리즘 버전. 불일치하면 캐시를 버리고 다시 계산한다
}
```

로직을 고쳤는데 옛 캐시를 그대로 읽으면 **바뀐 규칙이 일부 데이터에만 적용된 상태**가 되고,
그건 버그로 재현되지 않는다. 푸리는 구역 id가 바뀌면 채점 이력이 엉뚱한 문항에 붙는 사고를
이 필드 하나로 막는다.

---

## 10. 선택 모듈 — 필요할 때만 가져간다

새 앱이 아래 기능을 갖게 되면, 밑바닥부터 설계하지 말고 푸리의 해당 절을 읽고 시작한다.
**복사해 올 때는 이 문서에 흡수시키고 원본 참조를 지운다** (§12.2 — 규칙의 출처는 하나).

| 기능 | 푸리 원본 | 핵심만 |
|---|---|---|
| 필기·펜 입력 | `docs/ARCHITECTURE.md` §5·§6 | 정규화 좌표계 하나로 통일 · 확정/활성 캔버스 2겹 · `touchAction:none` + `setPointerCapture` + `getCoalescedEvents` |
| 긴 문서 스크롤 | 같은 문서 §6.1 | 보이는 페이지 ±1만 렌더하고 나머지 해제 |
| PDF | `lib/pdf.ts`, `vite.config.ts`의 `pdfjsAssets` | CMap을 안 실으면 **한글만 사라진 PDF**가 나온다 |
| AI 호출 | `.specify/memory/constitution.md` 원칙 I·개발 워크플로 | **프록시 경유 필수(API 키 클라이언트 금지)** · 포트 뒤 분리 · 응답은 신뢰할 수 없는 입력이므로 스키마 검증 후 사용 · 실패 경로가 앱의 기본 동작 |

AI를 쓸 거면 **프록시 경유와 스키마 검증 두 가지는 도메인과 무관하게 그대로 가져간다.**
나머지(무엇을 보내는가, 동의를 어떻게 받는가)는 새 앱의 헌법이 정한다.

---

## 11. 테스트

### 11.1 대상은 `src/lib` 순수 함수

```ts
// vite.config.ts
test: {
  environment: 'node',          // src/lib은 DOM 비의존 — §5.2
  include: ['src/**/*.test.ts'],
}
```

UI 테스트는 하지 않는다(초기 범위). **UI를 안 덮는 대신 판정 로직을 전부 덮는다** — 그 교환이
성립하려면 §5.2 경계가 지켜져야 한다.

### 11.2 실제 입력이 필요한 테스트는 환경변수로 연다

저작물이거나 큰 입력 파일은 리포에 넣지 않는다. 푸리 패턴:

```sh
<APP>_BENCH_INPUT=~/Downloads/실제파일.pdf npx vitest run bench.real
```

- 파일명은 `*.real.test.ts` — 일반 테스트와 갈라 놓는다
- 환경변수가 없으면 **실패가 아니라 스킵**한다. CI에서 빨간불이 뜨면 아무도 안 본다
- 같은 검증의 합성 입력 버전을 `*.test.ts`로 따로 둬서 **파일 없이도 도는 것**을 남긴다

### 11.3 정답셋(골든셋)

인식·추출처럼 "정확도"가 지표인 기능은 **사람이 확인한 정답이 있어야 옳고 그름을 말할 수 있다.**
그전까지 잴 수 있는 것은 "두 구현이 얼마나 다른가"뿐이다. 정확도 목표를 명세에 적을 거면
골든셋 만들기를 그 목표와 **같은 작업으로 묶는다.** 나중에 만들기로 하면 안 만든다.

---

## 12. 문서 체계

### 12.1 문서 3분할

판별 기준은 하나 — **"기능을 하나 더 만들 때 이걸 읽어야 하나?"**

| 문서 | 성격 | 바뀌는 빈도 |
|---|---|---|
| `docs/ARCHITECTURE.md` | 모든 기능이 공유하는 계약 (이 문서) | 거의 안 바뀜 |
| `docs/ROADMAP.md` | 이월·구현 순서 = 계획 | 자주 |
| `docs/research/*.md` | 특정 기능의 규칙 + 실측 근거 | 자주 |

데이터 모델·좌표계·저장 계약 → 모든 기능이 읽음 → **ARCHITECTURE**.
특정 판정 규칙 → 그 기능만 읽음 → **research 또는 SDD**.

### 12.2 규칙의 출처는 하나

**같은 규칙을 두 문서에 적지 않는다.** 이미 있는 규칙은 옮겨 적지 말고 절 번호로 참조한다.

푸리는 이걸 어겼다가 대가를 치렀다 — 같은 함수를 설명하는 명세가 둘이었고 내용이 달랐다.
오래된 쪽에는 임계값과 예외 처리가 통째로 빠져 있었다. **두 벌을 유지하면 반드시 오래된 쪽을
읽는 사람이 나온다.** 문서와 코드가 어긋나면 **코드가 사실이고 고쳐야 할 것은 문서다.**

### 12.3 화면 인벤토리

`docs/screens/INDEX.md` 하나에 전체 플로우를 압축해 둔다. **기능 작업을 AI에 넘길 때 항상
첨부한다** — 20줄이라 매번 넣어도 부담이 없고, 기능 단위 명세만 주면 화면 간 연결을 모른 채
작업하게 되는 구멍을 이게 메운다.

- 화면은 **100번대**(`S-101`), 기능은 **0번대**(`PRD-002`) — 자릿수를 일부러 다르게 쓴다. 다대다이기 때문
- 표에 `진입 / 이탈 / 관련 기능`을 적고, `관련 기능`이 둘 이상인 화면을 **충돌 위험 지점**으로 표시한다
- 화면별 상세는 `S-1xx-*.md`. 여기에 **보여줄 것 · 상태 4종 · 진입/이탈**이 들어간다

### 12.4 헌법과 spec-kit

`.specify/memory/constitution.md`에 **원칙 3~5개**를 두고, 기능은
`/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement` 순으로 진행한다.
`spec.md`는 **왜·무엇**만, `plan.md`는 **어떻게**만 담는다.

내용은 새 앱의 것으로 다시 쓰되, **형식 셋은 그대로 가져간다.**

1. **원칙마다 `근거`와 `위반 판정`을 적는다.** "위반이 아닌 경우"까지 적어야 실제로 판정에 쓸 수 있다
2. **버전과 Sync Impact Report.** 개정 시 무엇이 왜 바뀌었고 어느 문서가 낡았는지 상단에 남긴다
3. **숫자에는 출처가 있다.** 임계값·시간·횟수는 실측이나 사람의 결정에서만 나온다. 못 정하면
   값을 비우고 `[NEEDS CLARIFICATION: ...]`와 **무엇을 알아야 정할 수 있는지**를 함께 남긴다

이 세 번째가 푸리에서 가장 값을 한 규칙이다. 지어낸 숫자가 코드에 박히면 나중에 "이 값 왜 이래?"에
아무도 답을 못 한다.

### 12.5 에러 배치 검사

`plan.md`에 정의한 에러 `E1`~`EN`은 **하나도 빠짐없이 어느 화면이 보여줄지 정한다.**
`docs/check-errors.sh`가 SDD의 `E번호`가 화면 문서에 나오는지 훑는다.

```sh
sh docs/check-errors.sh    # 리포 루트에서
```

잡는 것 — 에러를 추가하고 화면에 반영을 안 한 경우. 못 잡는 것 — 엉뚱한 화면에 적은 경우(사람이 본다).
사용자에게 안 보여도 되는 에러는 **그 사실을 명시한다.** 조용히 넘어가지 않는다.

### 12.6 `.claude/agents` 2종

푸리는 에이전트 둘로 UI 작업의 경계를 강제한다. **새 리포에도 복사한다** — 도메인 문장만 바꾸면 된다.

| | `ui-component-designer` | `screen-composer` |
|---|---|---|
| 단위 | 컴포넌트 하나 | 화면 전체 |
| 산출물 | `packages/ui/src/components/**` | 앱의 `src/components/{Screen}.tsx` + 라우트 배선 |
| 강제하는 것 | 토큰 준수·16원칙·대비·배럴·갤러리 등록 | 상태 4종·기존 컴포넌트 조합·`paths.ts` 경유 |
| 하지 않는 것 | 화면 조합 | **새 컴포넌트를 화면 파일에 인라인으로 만들기** |

두 에이전트 다 **"코드를 쓰기 전에 읽을 파일 목록"** 을 갖는다. 그게 이 장치의 핵심이다 —
요약이나 기억으로 토큰을 쓰면 반드시 값이 어긋난다. 목록의 내용은 `DESIGN-BASE.md` §9에 있다.

---

## 13. 부트스트랩 체크리스트

순서대로. 각 단계에 확인 방법이 붙어 있다.

```
1. worktree 배치           → verify: git worktree list에 본체 + feat 브랜치
2. 모노레포 골격 3파일      → verify: pnpm install 통과
3. packages/ui 이식        → verify: pnpm --filter <scope>/ui dev 로 갤러리가 뜬다
   (styles/ 전부 + lib/utils.ts + core 컴포넌트. 도메인 컴포넌트는 두고 온다)
4. 토큰 도메인 정리         → verify: DESIGN-BASE.md §4 체크리스트 (특히 --danger/--warning/--success)
5. apps/<app> 스캐폴딩     → verify: pnpm dev 로 빈 화면이 뜨고 브랜드 폰트·배경색이 보인다
6. Capacitor android       → verify: 실기기에서 그 빈 화면이 뜬다
7. Capacitor ios           → verify: 실기기에서 뜬다 + §8.3 표 7항목 확인·문서 갱신
8. 헌법 + 문서 뼈대         → verify: /speckit-specify 가 첫 기능에서 돈다
9. .claude/agents 2종      → verify: 컴포넌트 하나를 실제로 만들어 본다
```

3번과 4번 사이에 앱을 만들지 않는다. **토큰이 정리되기 전에 화면을 짜면 그 화면이 낡은 토큰의
마지막 사용처로 남아 지우지 못한다.**

---

## 14. 새 앱이 정해야 하는 빈 칸

여기를 채우면 이 문서가 새 앱의 `ARCHITECTURE.md`가 된다.

| # | 정할 것 | 이 문서 어디에 영향 |
|---|---|---|
| 1 | 앱이 무엇을 하는가 (한 문단) | 문서 머리 · 헌법 |
| 2 | `<scope>` · `<repo>` · `appId` · `appName` | §2·§3·§8.1 — 나중에 바꾸기 어렵다 |
| 3 | 데이터 모델 | §9.2 스토어 표 |
| 4 | 무엇이 큰 바이너리인가 (Filesystem 대상) | §9.1 |
| 5 | 네이티브 API를 쓰는 지점과 그 웹 폴백 | §8.4 |
| 6 | 오프라인 계약 — 무엇이 네트워크 없이 되고 무엇이 안 되나 | 헌법 · §10 |
| 7 | 성능 예산 — 항목과 기준 (실측 전까지 비워 둔다) | 새 §으로 추가 |
| 8 | 도메인 컴포넌트 그룹 이름 (`core/` 옆에 무엇이 오나) | §6 · DESIGN §4 |
| 9 | 화면 목록 S-1xx | §12.3 |

7번은 **비워 두는 것이 정답이다.** 실측 없이 "3초 이내" 같은 숫자를 적으면 §12.4의 3번 규칙을
어기는 것이고, 그 숫자는 나중에 아무도 근거를 못 댄다.
