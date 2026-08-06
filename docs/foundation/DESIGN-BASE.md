# 디자인 시스템 베이스라인 — 새 앱용

## 0. 메타데이터

| 항목 | 값 |
|---|---|
| 버전 | v1.0 |
| 작성일 | 2026-08-04 |
| 원본 | 푸리(Puri) — `docs/design-system/README.md` · `packages/ui/src/styles/**` · `.claude/agents/*.md` |
| 성격 | **새 리포로 복사해 가는 기반 시스템.** 도메인 어휘는 걷어냈고 그 자리는 `[정할 것]` |
| 짝 문서 | [`ARCHITECTURE-BASE.md`](./ARCHITECTURE-BASE.md) — 리포 구조·스택·배선 |

### 결정 사항

**기반 팔레트만 가져간다.** green/ink 램프, 시맨틱 별칭, 타이포, 간격·반경·그림자·모션,
컴포넌트 코드 규약은 값까지 그대로 승계한다. 푸리의 도메인 어휘(채점 스케일 O/△/X,
오답 원인 5태그)는 **색값도 이름도 두고 온다** — 새 앱은 자기 도메인 스케일을 §4의 빈 칸에서 설계한다.

이 문서를 새 리포의 `docs/design-system/README.md` 자리에 놓는다.

---

## 1. 가져가는 것 / 두고 오는 것

| | 가져간다 | 두고 온다 |
|---|---|---|
| 색 | green 램프 · ink 램프 · paper/canvas · 시맨틱 별칭 (§2·§3) | 채점 스케일 3색 · 원인 태그 5색 |
| 타이포 | 패밀리·스케일·굵기·자간·`.num` 전부 (§5) | — |
| 간격/형태 | 4px 그리드 · 반경 · 그림자 · 모션 · `--tap-min` (§6) | — |
| 코드 | CVA + `cn()` · `'use client'` · 배럴 · 갤러리 · shadcn 다리 (§8) | — |
| 원칙 | 색은 진단이다 · 색만으로 구분 금지 · 대비 기준 (§4·§7) | — |
| 톤 | 이모지·느낌표·과한 축하 금지 · 문장 케이스 (§10) | "5등급 고등학생에게 말하는 방식" |
| 브랜드 | 로고 규격·워드마크 클래스 (§12) | 푸리 로고 자체(관측 링 + 코어) |
| 화면 | 상태 4종 규약 (§14) | — |

**두고 오는 것에도 배울 구조는 남아 있다.** 채점 스케일은 색값이 아니라 *"상태 하나에
`색 + 배경틴트 + 링` 3종 세트"* 라는 구조가 자산이고, 원인 태그는 *"분류 축 하나에 5색,
칩에서만 사용"* 이라는 제약이 자산이다. §4가 그 구조만 뽑아 놓은 절이다.

---

## 2. 기반 팔레트

`tokens/colors.css` — 아래 블록은 **값 그대로** 복사한다.

```css
:root {
  /* ============ BASE PALETTE ============ */

  /* Warm growth green — 브랜드 액센트 */
  --green-50:  #F0FAF3;
  --green-100: #DCF3E4;
  --green-200: #B6E6C6;
  --green-300: #84D3A2;
  --green-400: #4FBB7C;
  --green-500: #26A65E;   /* primary */
  --green-600: #1E8E4F;   /* hover */
  --green-700: #176E3E;   /* press / 틴트 위 글자 */
  --green-800: #12522F;

  /* 따뜻하게 기운 중립색 — 아주 살짝 초록/종이. 절대 푸른 회색이 아니다 */
  --ink-950: #14170F;
  --ink-900: #1B1F16;
  --ink-800: #2C312A;
  --ink-700: #444A40;
  --ink-600: #5D6357;
  --ink-500: #787E71;
  --ink-400: #9AA091;
  --ink-300: #C0C5B8;
  --ink-200: #DFE3D9;
  --ink-150: #EAEDE4;
  --ink-100: #F2F4EE;
  --ink-50:  #F8F9F5;
  --paper:   #FFFFFF;
  --canvas:  #F6F7F2;   /* 앱 배경 */
}
```

**중립색이 따뜻하게 기울어 있는 것이 이 시스템의 성격이다.** 순수 회색이나 푸른 회색으로 바꾸면
초록 액센트가 뜨고 "차가운 대시보드"가 된다. 브랜드 색을 바꿀 거면 중립 램프의 색 기울기도
같이 옮긴다 — 둘은 짝이다.

**배경색은 최대 2개.** `--canvas`(앱) · `--paper`(카드). 세 번째 배경색을 만들지 않는다.

---

## 3. 시맨틱 별칭

```css
:root {
  --brand:            var(--green-500);
  --brand-hover:      var(--green-600);
  --brand-press:      var(--green-700);
  --brand-tint:       var(--green-100);
  --brand-tint-soft:  var(--green-50);

  --text-strong:  var(--ink-900);
  --text-default: var(--ink-800);
  --text-muted:   var(--ink-500);
  --text-faint:   var(--ink-400);
  --text-invert:  var(--paper);
  --text-brand:   var(--green-700);

  --surface-page:    var(--canvas);
  --surface-card:    var(--paper);
  --surface-sunken:  var(--ink-50);
  --surface-hover:   var(--ink-100);

  --border-subtle:  var(--ink-150);
  --border-default: var(--ink-200);
  --border-strong:  var(--ink-300);
  --border-focus:   var(--green-500);
}
```

> **이름 함정 — `--text-body`를 만들지 않는다.** 타이포 토큰의 `--text-body`(글자 **크기**)와
> 충돌한다. 그래서 본문 **색**은 `--text-default`다. `theme.css`에도 `--color-body`를 만들지
> 않는다 — `text-body` 유틸리티가 크기 쪽에 이미 있다.

### 3.1 ★ 상태색 3개는 새로 정의해야 한다

푸리에서 아래 셋은 **채점 스케일을 참조한다.** 채점 스케일을 두고 오면 **끊어진다.**

```css
/* 푸리 원본 — 그대로 복사하면 정의되지 않은 변수를 가리킨다 */
--danger:  var(--grade-x);      /* ← 끊어짐 */
--warning: var(--grade-tri);    /* ← 끊어짐 */
--success: var(--grade-o);      /* ← 끊어짐 */
```

새 앱은 셋을 **독립 값으로** 정의한다. 푸리가 쓰던 실제 색을 그대로 써도 되고(따뜻한 빨강·앰버·초록이
중립 램프와 잘 맞는다), 새로 골라도 된다. 어느 쪽이든 §7의 대비를 다시 잰다.

```css
--danger:       #D64545;   /* 예시 — 푸리의 X 색. 파괴적 동작 */
--danger-hover: #C23A3A;
--danger-press: #A93131;
--warning:      #C98212;   /* 예시 */
--success:      #1E8E4F;   /* 예시 */
```

`--danger-hover/-press`는 푸리가 별도로 만든 값이다 — **"삭제 버튼"과 "채점의 X"는 다른 의미이므로
도메인 스케일을 늘리지 않고 여기서 만들었다.** 그 판단은 새 앱에서도 유효하다.

`theme.css`의 shadcn 매핑도 같이 본다 — `--destructive*`가 `--danger*`를 가리키고 있다.

---

## 4. 도메인 스케일은 빈 칸

푸리는 두 종류의 도메인 색 어휘를 갖고 있었다. **새 앱은 자기 것을 설계한다.**
값을 베끼지 말고 **구조와 제약**을 가져간다.

### 4.1 상태 스케일 — "3종 세트" 구조

푸리의 채점 결과는 상태 하나에 색을 셋 준다.

```
<state>       진한 색 — 글자·마크
<state>-bg    옅은 배경 틴트
<state>-ring  중간 색 — 테두리/링
```

이 구조가 있으면 배지·칩·카드 어디에 써도 대비가 무너지지 않는다. 단계 수는 도메인이 정한다
(푸리는 3단계였다. 2단계일 수도, 4단계일 수도 있다).

```css
/* [정할 것] — 새 앱의 상태 스케일 */
--<state-a>:      ;  --<state-a>-bg:  ;  --<state-a>-ring:  ;
--<state-b>:      ;  --<state-b>-bg:  ;  --<state-b>-ring:  ;
```

### 4.2 분류 태그 — "한 축, 5색 내외, 칩에서만"

푸리의 원인 태그는 **하나의 분류 축**에 5개 값을 두고 각자 색과 배경 틴트를 갖는다.

```
--tag-<key>       진한 색 — 글자
--tag-<key>-bg    옅은 배경
```

제약 셋이 중요하다.

- **한 축이다.** 두 축(예: 난이도 + 유형)을 같은 색 어휘로 표현하면 읽는 사람이 못 가른다
- **5개 안팎.** 색으로 구분 가능한 한계다. 그보다 많으면 색 말고 다른 수단을 쓴다
- **칩에서만 쓴다.** 큰 면적을 채우지 않는다

```css
/* [정할 것] — 새 앱의 분류 태그. 없으면 만들지 않는다 */
```

### 4.3 색을 쓰는 규칙 (그대로 승계)

**이 시스템에서 색은 진단이다 — 장식이 아니라 의미를 나른다.**

1. `--brand`(초록)는 **인터랙티브 요소와 "긍정/진행"에만.** 배경 채우기나 강조 장식에 쓰지 않는다
2. 도메인 스케일 색은 **예약된 어휘**다. 다른 용도로 재사용하지 않는다
3. **색만으로 정보를 구분하지 않는다** — 마크·라벨·아이콘 중 하나가 반드시 더 붙는다 (§7.3)
4. 배경색은 최대 2개 (§2)
5. 캔버스 위에 떠서 눈에 띄어야 하는 액션에 초록을 쓰지 않는다 — 신호가 섞인다.
   푸리는 이 자리에 잉크색(`inverse` 변형)을 만들었다

### 4.4 토큰을 추가하는 절차 (3단계 — 하나라도 빠지면 조용히 깨진다)

```
1. tokens/colors.css 에 값 추가
2. styles/theme.css 의 @theme inline 에 --color-<name> 등록   ← 없으면 유틸리티가 안 생긴다
3. lib/utils.ts 의 extendTailwindMerge classGroups 확인        ← §8.4. 없으면 클래스가 사라진다
```

3번은 **색이 아니라 크기·반경·그림자 토큰을 추가할 때** 걸린다. §8.4를 읽는다.

### 4.5 도메인 정리 체크리스트

푸리 `packages/ui`를 복사해 온 뒤 지울 것 / 채울 것:

- [ ] `tokens/colors.css` — `GRADING SCALE` 블록 삭제, `ERROR-CAUSE TAGS` 블록 삭제
- [ ] `tokens/colors.css` — `--danger` `--warning` `--success` 독립 값으로 재정의 (§3.1)
- [ ] `styles/theme.css` — `--color-grade-*` 9줄, `--color-tag-*` 10줄 삭제
- [ ] `--surface-mask` / `--color-surface-mask` — 필기 가림용이었다. 새 앱에 "가려 둔 표면"이
      없으면 지우고, 있으면 이름을 그 용도로 바꾼다
- [ ] `src/components/grading/`, `src/components/study/` 폴더 통째로 삭제
- [ ] `src/index.ts` 배럴에서 해당 export 삭제 → `pnpm --filter <scope>/ui typecheck` 통과
- [ ] `playground/Gallery.tsx`에서 해당 섹션 삭제 → 갤러리가 뜬다
- [ ] `src/assets/logo*.svg` 교체 (§12)
- [ ] 새 도메인 스케일 정의 (§4.1·§4.2) → 대비 재측정 (§7)

---

## 5. 타이포그래피

`tokens/typography.css` — **그대로 승계.**

```css
@theme {
  --font-sans: "Pretendard Variable", "Pretendard", -apple-system, BlinkMacSystemFont,
               "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif;
  --font-mono: "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
  --font-numeric: var(--font-mono);

  /* 태블릿 기준으로 넉넉하게. `--text-X--line-height`는 Tailwind가 text-X 하나로
     크기+행간을 묶게 하는 짝 이름이다 */
  --text-display: 34px;  --text-display--line-height: 42px;
  --text-h1:      26px;  --text-h1--line-height:      34px;
  --text-h2:      21px;  --text-h2--line-height:      30px;
  --text-h3:      18px;  --text-h3--line-height:      26px;
  --text-body-lg: 17px;  --text-body-lg--line-height: 28px;
  --text-body:    15px;  --text-body--line-height:    24px;
  --text-sm:      13px;  --text-sm--line-height:      20px;   /* Tailwind 기본 14px를 덮는다 */
  --text-caption: 12px;  --text-caption--line-height: 16px;
}

:root {
  --w-regular: 400;  --w-medium: 500;  --w-semibold: 600;  --w-bold: 700;
  --track-tight: -0.02em;   /* 제목 */
  --track-normal: -0.01em;  /* 본문 — 한글은 조밀하게 읽힌다 */
  --track-wide: 0.02em;     /* 짧은 eyebrow 라벨 */
}

.num, [data-numeric] {
  font-family: var(--font-numeric);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
}
```

**규칙**

- **산세리프 하나.** Pretendard가 유일한 UI 서체다. 세 번째 서체를 추가하지 않는다
- **의도된 예외 하나** — 숫자 표시(타이머·카운트·소요시간)는 `.num`. 자릿수가 바뀔 때 흔들리지
  않게 하려는 **기능적** 선택이다
- **13px 밑으로 내려가지 않는다.** 태블릿·모바일에서 안 읽힌다
- **굵기는 두 축** — 400 / 600. 이 시스템의 "bold"는 600이다. 500은 이미 쓰는 곳(칩) 외에 늘리지
  않는다. 한 컴포넌트에 3종 이상 쓰지 않는다
- **대문자 변환 금지**(`text-transform: uppercase`). 문장 케이스를 쓴다
- **왼쪽 정렬.** 가운데는 짧은 단독 요소(빈 상태 메시지, 버튼 라벨, 배지 안 마크)만.
  양쪽 정렬 금지. 숫자 열은 오른쪽 정렬 + tabular-nums
- **본문 행간 1.5 이상** — 스케일에 이미 반영돼 있다(15/24 = 1.6). 직접 지정할 일이 있어도
  1.5 밑으로 내리지 않는다. **예외**: 버튼·배지·칩처럼 세로 중앙 정렬되는 단일 행은 `leading-none`이 맞다

### 5.1 폰트는 패키지가 싣는다

```css
/* styles/index.css */
@import "pretendard/dist/web/variable/pretendardvariable.css";
@import "@fontsource-variable/jetbrains-mono/index.css";
```

npm 번들이라 CDN 의존이 없다 — 오프라인에서도 같게 렌더링된다. **앱이 아니라 패키지가 부르는
이유**는 폰트 부르기를 잊은 앱이 "토큰은 맞는데 글꼴만 틀린" 상태가 되기 때문이다.

번들 용량이 문제가 되면(특히 iOS 초기 로드) 서브셋을 검토한다 — 다만 그 판단은 **실측 후에**
한다. 한글 가변 폰트는 서브셋이 까다롭다.

---

## 6. 간격 · 형태 · 모션

`tokens/spacing.css` — **그대로 승계.**

```css
@theme {
  --radius-sm:   6px;
  --radius-md:   10px;   /* 입력·버튼 */
  --radius-lg:   14px;   /* 카드 */
  --radius-xl:   20px;   /* 큰 패널·시트 */
  --radius-pill: 999px;  /* 칩·배지 */

  /* 따뜻하고 낮고 퍼진 그림자. 하드 블랙 금지 */
  --shadow-xs: 0 1px 2px rgba(27, 31, 22, 0.05);
  --shadow-sm: 0 1px 3px rgba(27, 31, 22, 0.06), 0 1px 2px rgba(27, 31, 22, 0.04);
  --shadow-md: 0 4px 10px rgba(27, 31, 22, 0.06), 0 2px 4px rgba(27, 31, 22, 0.04);
  --shadow-lg: 0 12px 28px rgba(27, 31, 22, 0.10), 0 4px 10px rgba(27, 31, 22, 0.05);
  --shadow-focus: 0 0 0 3px rgba(38, 166, 94, 0.22);   /* ← 브랜드 색을 바꾸면 여기도 */

  --ease-out: cubic-bezier(0.22, 0.61, 0.36, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
}

:root {
  --space-1: 4px;   --space-2: 8px;   --space-3: 12px;  --space-4: 16px;
  --space-5: 20px;  --space-6: 24px;  --space-8: 32px;  --space-10: 40px;
  --space-12: 48px; --space-16: 64px;

  --border-w: 1px;
  --border-w-strong: 1.5px;

  --dur-fast: 120ms;  --dur-base: 200ms;  --dur-slow: 320ms;

  --tap-min: 44px;      /* 최소 터치 타깃 */
  --sidebar-w: 264px;
}
```

**토큰은 두 얼굴을 갖는다.** `--radius-lg`는 `var(--radius-lg)`로도 쓰이고 `rounded-lg`
유틸리티로도 나온다. **새 코드는 유틸리티를 쓴다.** 간격은 Tailwind 기본 스케일이 이미 4px
배수라 `p-4` = `var(--space-4)` = 16px로 같다 — `p-[var(--space-4)]`로 쓰지 않는다.

**여백 규칙**

- 관계는 **여백으로** 표현한다. 관련 요소는 붙이고(`space-1~2`), 그룹 사이는 벌린다(`space-5~8`)
- 그룹화 수단 우선순위: **여백 → 정렬 → 유사한 스타일 → 컨테이너.** 구분선은 최후 수단
- 라벨과 그 값 사이 간격 < 값과 다음 라벨 사이 간격. 항상
- 카드 내부 패딩은 `space-5~6`(20–24px)

**경계를 만드는 수단은 하나다.** 보더 + 그림자 + 배경틴트를 동시에 쓰지 않는다.
카드 = `--paper` + `rounded-lg` + `1px --border-subtle` + `shadow-sm`. 여기서 더 얹지 않는다.

**모션** — 페이드와 작은 translate/scale. `--dur-base` + `--ease-out`. 바운스·confetti 금지.
누름은 `active:scale-[0.98]`.

---

## 7. 대비

### 7.1 기반 팔레트 실측값 (그대로 승계)

`--paper`(#FFFFFF) / `--canvas`(#F6F7F2) 위에서. **추측하지 말고 이 표를 쓴다.**

| 토큰 | on paper | on canvas | 용도 |
|---|---|---|---|
| `--text-strong` | 16.7:1 | 15.6:1 | ✅ 모든 텍스트 |
| `--text-default` | 13.3:1 | 12.4:1 | ✅ 모든 텍스트 (본문 기본) |
| `--ink-700` | 9.1:1 | 8.5:1 | ✅ 모든 텍스트 |
| `--text-brand` (green-700) | 6.3:1 | 5.9:1 | ✅ **틴트 위 초록 글자는 이걸 쓴다** |
| `--ink-600` | 6.2:1 | 5.8:1 | ✅ 보조 텍스트는 **muted 대신 이것** |
| `--text-muted` (ink-500) | 4.2:1 | 3.9:1 | ⚠️ 본문 4.5:1 **미달**. 18px 이상 또는 아이콘/UI 요소에만 |
| `--text-faint` (ink-400) | 2.7:1 | 2.5:1 | ❌ 정보를 나르면 안 됨. 순수 장식만 |
| `--brand` (green-500) | 3.1:1 | 2.9:1 | UI 요소 전용. **초록 글자로 쓰지 말 것** |
| `--border-*` | 1.2–1.8:1 | — | 장식적 경계만 |

**컬러 채움 위 흰 글자**

- `--brand` 위 흰 글자 = **3.14:1** → 15px 본문 크기에서 미달. 작은 라벨은 `--brand-press`(6.3:1)를
  배경으로 쓰거나 18px+/600으로 올린다
- 따뜻한 빨강(#D64545) 위 흰 글자 = 4.38:1 → 경계선. 큰 텍스트만
- 앰버(#C98212) 위 흰 글자 = 3.14:1 → **본문 금지**

**필수 경계의 3:1** — 체크 안 된 체크박스 테두리, 입력 필드 외곽선처럼 **경계가 유일한 식별
수단**인 곳은 3:1이 필요한데 `--border-strong`(ink-300)도 1.76:1로 미달이다. 이런 자리에는
`--ink-500` 이상을 쓴다.

### 7.2 새 값은 반드시 계산한다

§3.1의 상태색, §4의 도메인 스케일은 **새로 정하는 값이므로 위 표에 없다.** 지어내지 말고 잰다.

```bash
python3 -c "
def l(c):
    c=c/255
    return c/12.92 if c<=0.03928 else ((c+0.055)/1.055)**2.4
def L(h):
    h=h.lstrip('#'); return sum(w*l(int(h[i:i+2],16)) for w,i in zip((.2126,.7152,.0722),(0,2,4)))
a,b=L('#787E71'),L('#FFFFFF')
print(round((max(a,b)+.05)/(min(a,b)+.05),2))"
```

기준: 텍스트 18px 미만 **4.5:1**, 18px 이상 **3:1**, UI 요소 **3:1** (WCAG 2.1 AA).

### 7.3 색만으로 구분하지 않는다

**이 시스템에서 가장 중요한 접근성 규칙이다.**

- 상태는 **마크(문자·기호) + 형태(링·보더) + 색** 여러 겹으로 구분한다. 절대 색만 남기지 않는다
- 분류 태그는 **라벨 텍스트 + 색.** 색 점만으로 표시하지 않는다
- 에러는 붉은 테두리만으로 끝내지 않는다 — 메시지 텍스트를 함께 둔다
- 선택/활성 상태는 색 변화 + 굵기/보더/체크마크 중 하나를 더 얹는다

---

## 8. 컴포넌트 코드 규약

### 8.1 파일 형태

```tsx
'use client'

// <브랜드> DS — Button. primary는 화면당 하나만.
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const buttonVariants = cva('…공통…', {
  variants: { variant: { primary: 'bg-brand …' }, size: { md: 'h-11 px-5 text-body leading-none' } },
  defaultVariants: { variant: 'primary', size: 'md' },
})

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { /* … */ }

export function Button({ variant, size, className, ...rest }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...rest} />
}

export { buttonVariants }
```

- **첫 줄 `'use client'`**, 빈 줄, **한 줄짜리 한국어 주석**: `// <브랜드> DS — <이름>. <한 문장 규칙>.`
  지금은 무의미해도 웹을 Next.js(RSC)로 갈 때 전수 수정을 막는다
- **변형은 CVA로 선언하고 `cn()`으로 합친다.** 호출부가 덮을 수 있어야 하므로 **`cn(variants(...), className)`
  순서를 지킨다**. hover/press를 `useState`로 잡지 않는다 — CSS 변형(`hover:` `active:` `focus-visible:` `disabled:`)을 쓴다
- **named export + `export type XxxProps`.** default export 금지. CVA 객체도 내보내 화면이 재사용할 수 있게 한다
- **인라인 `style`·CSS 모듈·styled-components를 쓰지 않는다**
- 색·간격·폰트는 **토큰 유틸리티**로. 하드코딩된 hex/px 금지.
  예외는 컴포넌트 고유 기하값(배지 지름, 아이콘 stroke-width) — `size-10`이나 `text-[22px]`로 둔다
- **인터랙티브 요소는 `min-h-[var(--tap-min)]`(44px) 이상**
- **hover / press / disabled / focus 네 상태를 전부 정의한다.** 포커스는 `focus-visible:shadow-focus` —
  브라우저 기본 파란 아웃라인을 쓰지 않는다
- 아이콘 전용 버튼에 `aria-label`, 의미를 가진 비텍스트 요소에 `role`/`aria-label`

### 8.2 사이즈 스케일은 Button이 기준

`sm / md / lg` = `h-9 / h-11 / h-13` (36 / 44 / 52px). 새 컨트롤도 이 높이에 맞춘다.

> **Tailwind v4 함정** — `leading-none`은 반드시 size의 `text-*` **뒤에** 온다. v4의 `text-*`는
> 행간까지 같이 정하므로, 앞에 두면 `cn()`이 뒤의 `text-*`로 덮으며 지워 버린다.

### 8.3 없는 프리미티브는 shadcn에서 가져온다

Dialog·Sheet·Select·Tooltip·Toast를 손으로 만들지 않는다.

```sh
cd packages/ui && npx shadcn@latest add dialog
```

두 가지만 손본다:

1. **`@/` 임포트를 상대 경로로 고친다** — 소비 앱의 Vite는 이 패키지의 별칭을 모른다.
   `@/lib/utils` → `../../lib/utils`
2. **배럴(`src/index.ts`)에 export를 추가한다**

색은 안 고쳐도 된다 — `styles/theme.css`가 shadcn의 `--background` `--primary` 같은 이름을
브랜드 토큰의 별칭으로 정의해 둔다. **그 파일을 지우면 전부 중립 회색 shadcn 룩이 된다.**
매핑을 고칠 때는 **오른쪽(브랜드 토큰)만** 바꾼다. 왼쪽 이름은 shadcn의 계약이다.

`@theme inline`으로 선언돼 있어 `:root` 값만 바꿔도 즉시 반영된다 — 나중에 테마 전환을 붙일 여지다.

### 8.4 ★ `cn()`의 tailwind-merge 설정

```ts
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['display', 'h1', 'h2', 'h3', 'body-lg', 'body', 'caption'] }],
      rounded: [{ rounded: ['pill'] }],
      shadow: [{ shadow: ['focus'] }],
    },
  },
})
```

**이 설정이 없으면 클래스가 조용히 사라진다.** tailwind-merge는 기본 Tailwind 이름만 알아서
`text-body`·`text-h3`처럼 t-shirt 사이즈가 아닌 이름을 전부 **글자색**으로 분류한다. 그러면
`text-invert`(진짜 색)와 같은 그룹으로 묶여 뒤에 온 쪽만 살아남는다 — 푸리에서 실제로 primary
버튼의 `text-invert`가 지워져 초록 배경에 어두운 글자가 나왔다.

**크기·반경·그림자 토큰을 추가하면 이 목록도 같이 갱신한다.** 안 하면 증상이
"가끔 스타일이 안 먹는다"로 나타나 원인 추적이 오래 걸린다.

### 8.5 배럴과 갤러리

- 컴포넌트를 만들면 **`src/index.ts`에 export를 추가한다.** 빠뜨리면 미완성이다
- **`playground/Gallery.tsx`에 섹션을 추가한다.** 갤러리에 없으면 아무도 그게 있는지 모른다.
  나중에 몰아서 하면 절대 안 한다

```sh
pnpm --filter <scope>/ui dev        # 갤러리 — 앱 없이 뜬다
pnpm --filter <scope>/ui typecheck
```

### 8.6 컴포넌트가 사는 곳

| | 어디에 |
|---|---|
| 재사용되는 UI | `packages/ui/src/components/core/` |
| 도메인 컴포넌트 | `packages/ui/src/components/<domain>/` — `[정할 것]` |
| **그 화면에서만 쓰는 일회성 UI** | **그 앱의 `src/components/`** |

세 번째를 두 번째에 넣는 것이 디자인 시스템이 비대해지는 가장 흔한 경로다.

---

## 9. 컴포넌트를 만들기 전에 읽을 것

에이전트든 사람이든 **아래를 읽지 않고 컴포넌트를 쓰는 것은 실패다.** 요약이나 기억에
의존하지 말고 매번 실제로 읽는다. (`.claude/agents/ui-component-designer.md`의 §0-1)

| 순서 | 대상 | 왜 |
|---|---|---|
| 1 | `docs/design-system/README.md` (이 문서) | 색 철학·타이포·톤·금지 사항 |
| 2 | `packages/ui/src/styles/tokens/colors.css` | 팔레트 + 시맨틱 별칭 |
| 3 | `.../tokens/typography.css` | 패밀리·굵기·스케일·자간 |
| 4 | `.../tokens/spacing.css` | 간격·반경·보더·그림자·모션 |
| 5 | `packages/ui/src/index.ts` | **이미 있는 컴포넌트 목록** — 중복 생성 방지 |
| 6 | 유사 컴포넌트 **최소 2개** | 코드 관례를 눈으로 확인 |

**발견한 것을 어떻게 쓰는가**

- **값이 이미 있으면 그 값을 쓴다.** 반경 12px이 더 예뻐 보여도 시스템이 14px이면 14px이다
- **패턴이 이미 있으면 복사한다.** 더 나은 방법을 알아도 여기서 도입하지 않는다
- **컴포넌트가 이미 있으면 확장한다.** Chip이 있으면 새 Tag를 만들지 말고 tone을 추가한다
- **없는 값이 꼭 필요하면 토큰을 먼저 추가한다** (§4.4) — 그리고 추가했다는 사실을 **보고한다**
- **모순이나 접근성 문제를 발견하면 보고한다. 조용히 고치지 않는다**

**우선순위** — 충돌하면 위가 이긴다.

1. 이 문서의 명시적 규칙 (§11 금지 목록 등)
2. 기존 토큰과 코드 패턴 (실제 코드가 문서보다 최신일 수 있다 — 어긋나면 보고)
3. 접근성 (§7) — 기존 시스템이 위반하고 있어도 **새 코드는 위반하지 않는다**
4. 일반 UI 원칙
5. 개인 취향

---

## 10. 카피 톤

### 10.1 그대로 승계하는 규칙

- **이모지 없음.** 상태는 배지와 칩이 말한다
- **느낌표·과한 축하 금지.** "축하합니다!", confetti 언어 없음
- **사용자를 탓하지 않는다.** "잘못된 파일입니다" ✗ → "이 파일은 열 수 없어요. 다른 파일을 올려보세요" ✓
- **문장 케이스.** 버튼은 동사 또는 명사, **마침표 없음**
- **숫자는 상대 신호로.** 정밀한 수치를 자랑하지 말고 비교로 말한다
- **영어는 자연스러운 시스템 라벨에만.** UI는 한국어 우선, 숫자·시간은 아라비아 숫자

### 10.2 `[정할 것]` — 제품의 목소리

푸리는 *"스트레스 받고 뒤처진 십대에게 말하는, 담담하고 구체적이고 비판단적인 도구"* 였다.
**그 인물상은 두고 온다.** 새 앱은 세 줄을 정한다.

```
1. 누구에게 말하는가        [정할 것]
2. 어떤 태도로              [정할 것]  (푸리: 담담하다 · 정확하다 · 최소 개입)
3. 절대 하지 않는 말        [정할 것]
```

정한 뒤 **샘플 문자열 5~6개**를 이 절에 적는다. 원칙보다 실제 문장이 톤을 훨씬 잘 전달한다.

---

## 11. 금지 목록

전부 승계한다. 어길 이유가 도메인에 따라 달라지지 않는 것들이다.

| 금지 | 이유 |
|---|---|
| 이모지 | 도구다 |
| 그라데이션 · 사진 히어로 · 패턴/텍스처 배경 | 평평한 따뜻한 off-white가 이 시스템의 표면 |
| **카드 왼쪽 컬러 보더 액센트** | AI-슬롭 클리셰. 상태는 배지가 말한다 |
| confetti · 바운스 애니메이션 | |
| 순수 검정 `#000` | 가장 어두운 텍스트는 `--text-strong`(#1B1F16). 그림자도 따뜻한 rgba |
| 하드 블루 포커스 아웃라인 | `--shadow-focus` (3px 브랜드 글로우) |
| `text-transform: uppercase` | 글자 하나씩 읽게 만든다 |
| 양쪽 정렬(`justify`) | 단어 간격이 들쭉날쭉해진다 |
| 세 번째 서체 | Pretendard + 숫자용 mono가 전부 |
| 토큰 없는 색·간격 하드코딩 | `text-[15px]` 같은 arbitrary 우회 포함 |

---

## 12. 브랜드

**푸리의 로고는 가져가지 않는다.** 새 앱은 자기 마크를 만든다. 가져가는 것은 **규격**이다.

| | |
|---|---|
| 파일 | `assets/logo.svg`(밝은 면용) · `assets/logo-white.svg`(브랜드 컬러/어두운 면용) — 2종 필수 |
| 형태 | 정사각 ≈64×64 viewBox |
| 여백 | 최소 클리어 스페이스 = 마크 높이의 25% |
| 워드마크 | Pretendard Bold, tracking `-0.03em` → `.ds-wordmark` 클래스 |
| 마크 없이 | 워드마크 단독도 유효한 대체 |

**깊이 표현 규칙** — 푸리는 소프트 래디얼 그라데이션으로 빛나는 구슬(이른바 "AI 로고 클리셰")을
피하고, **가림(occlusion)과 명암 2단계**로만 2.5D 깊이를 만들었다. 새 마크도 같은 선을 지킨다.

`base.css`의 프리미티브 2개는 그대로 가져간다:

```css
.ds-card { background: var(--surface-card); border: var(--border-w) solid var(--border-subtle);
           border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); }
.ds-wordmark { font-weight: var(--w-bold); letter-spacing: -0.03em; color: var(--text-strong); }
```

**앱 전역 스타일은 `base.css`에 넣지 않는다.** 스크롤 튐 방지·텍스트 선택 방지처럼 "그 앱의
결정"인 것은 앱의 `index.css`에 둔다 — 화면이 다른 앱은 같은 선택을 하지 않는다.

---

## 13. 아이콘

**[Lucide](https://lucide.dev)** — 차분한 1.5px 스트로크의 라인 세트가 "조용한 도구" 방향과 맞는다.

- `stroke-width: 1.75`, `currentColor`
- 채움/듀오톤 세트를 섞지 않는다
- **유니코드를 아이콘으로 쓰지 않는다.** 예외는 도메인 마크로 의도한 기호(푸리의 △)뿐이고,
  그건 아이콘이 아니라 **컴포넌트로 렌더하는 브랜드 프리미티브**다
- 장식용 아이콘을 넣지 않는다 (§6 "경계를 만드는 수단은 하나")

---

## 14. 화면 규약 — 상태 4종은 협상 대상이 아니다

컴포넌트가 아니라 화면 단위 규칙이지만, 여기 적는다. `.claude/agents/screen-composer.md`가 강제한다.

| 상태 | 반드시 확인할 것 |
|---|---|
| **정상** | 데이터가 있을 때 |
| **로딩** | 기다리는 동안 **무엇이 보이는가.** 빈 화면 금지 |
| **빈 상태** | 데이터 0개. 처음 설치한 사용자가 보는 화면이다. **"고장난 줄 안다"를 막는 안내 + 다음 행동 버튼** |
| **에러** | 화면 문서의 `(SDD-00X E1)` 표기를 그대로 구현. 메시지 문구까지 문서를 따른다 |

**정상만 만들고 끝내는 것이 개발 막판을 지옥으로 만드는 원인 1위다.** 나중에 붙이려면 컴포넌트
구조를 뜯어고쳐야 한다.

화면 문서에 `해당 없음`이라고 적힌 상태는 만들지 않는다. **단, 아예 안 적혀 있으면 그건
"없다"가 아니라 "안 정했다"다.** 그때는 만들지 말고 물어본다.

**로딩·빈 상태 카피 원칙 셋**

- **무슨 일이 일어나는지 말한다** — "로딩 중" ✗ → "채점하는 중이에요" ✓ (동사로)
- **다음 행동을 준다** — 빈 상태에는 반드시 버튼 하나
- **사용자 탓을 하지 않는다** (§10.1)

---

## 15. 정리 — 새 앱이 정해야 하는 빈 칸

| # | 정할 것 | 절 |
|---|---|---|
| 1 | `--danger` `--warning` `--success` 독립 값 | §3.1 |
| 2 | 도메인 상태 스케일 (몇 단계, 무슨 색, 3종 세트) | §4.1 |
| 3 | 분류 태그를 쓸 것인가, 쓴다면 축 하나에 몇 개 | §4.2 |
| 4 | 도메인 컴포넌트 그룹 이름 (`core/` 옆에 무엇이 오나) | §8.6 |
| 5 | 제품의 목소리 3줄 + 샘플 문자열 | §10.2 |
| 6 | 로고 2종 · 워드마크 | §12 |
| 7 | 브랜드 액센트를 초록에서 바꿀 것인가 | §2 — 바꾸면 중립 램프 기울기와 `--shadow-focus`도 같이 |

**7번을 건드릴 거면 §2부터 §7까지가 전부 재측정 대상이다.** 초록을 유지하는 쪽이 기본값이고,
그게 "디자인 시스템과 토큰은 그대로"의 실제 의미다.
