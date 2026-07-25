# 푸리 (Puri) Design System

> **Working name — needs your confirmation.** The product spec had no brand name, so I derived
> "푸리" from **문제풀이** (problem-solving → 풀이 → Puri). An **original logo** was designed for it
> (a 2.5D observation ring around a solid core — see ICONOGRAPHY); it is not derived from any provided source.
> Rename the project and this file once you have a real brand.

A design system for a **math problem-solving AI grading & diagnosis learning app** aimed at Korean
high-schoolers (5등급대, tablet/pen users) who want to raise their grades. It layers **automatic
grading, cumulative time-measurement, and AI diagnosis** on top of a GoodNotes/Flexcil-style
handwriting + wrong-answer-note workflow.

The three principles that shape every design decision:

1. **MVP is narrow.**
2. **Intervention is minimal.** The app observes and offers; it rarely interrupts.
3. **What can be verified is settled by tools (CAS), and AI only explains on top of that.**

And the guiding UX truth: **the app must be believed.** A single wrong grade destroys trust faster
than many correct ones earn it. The visual language is therefore calm, plain, and high-trust — a
_tool_, not a hype product.

## Sources

- **Product spec** (Korean): the "수학 문제풀이 AI 채점·진단 학습 시스템 — 통합 설계" document supplied in the
  brief. This is the single source of truth for structure, flows, and vocabulary.
- **Figma reference (NOT used):** `https://www.figma.com/design/PAA0JKidFMVK44KRRWB1zL/SnowUI?node-id=12780-78431`
  — the SnowUI kit was linked as a visual reference, but I had **no access** to the Figma file in
  this environment. **This system is not SnowUI-derived.** The visual direction below was authored
  from the spec. If you want SnowUI fidelity, re-attach the Figma via the Import menu and I'll rework
  the foundations against it.

---

## CONTENT FUNDAMENTALS

The product talks to a stressed teenager who is behind and easily discouraged. Copy is **quiet,
concrete, and non-judgemental** — it never scolds, never over-celebrates.

- **Language:** Korean-first UI. English appears only as system labels where natural (e.g. tag
  hashes, "MVP"). Numbers/time use Arabic numerals.
- **Address:** Speak _to_ the student as **너/네** sparingly, mostly avoid pronouns — prefer neutral,
  action-first phrasing. The AI, when it appears, is a **quiet second opinion**, never an authority:
  "너는 계산 실수라 했는데, 사실 개념에서 갈렸어" — it contrasts, it doesn't lecture.
- **Casing & punctuation:** Sentence-case Korean. Terse. Buttons are verbs or nouns:
  "채점하기", "필기 보기", "쌍둥이 문제", "재풀이". No trailing periods on labels/buttons.
- **The O / △ / X vocabulary is emotional, not binary.** △ ("맞았지만 아쉬움") exists specifically to
  stop the most dangerous 5등급 habit — "맞았으니 넘어가". Copy around △ is gentle-but-honest:
  "방향은 맞았어. 계산에서 한 줄 어긋났고." 
- **Diagnosis comes AFTER self-diagnosis.** Never let AI copy pre-empt the student. UI order and
  wording always: student tags first → then "AI 대조" reveals.
- **Tone words:** 담담하다 (calm), 정확하다 (accurate/trustworthy), 최소 개입 (minimal). Avoid: 
  exclamation marks, "축하합니다!", gamified confetti language, guilt ("또 틀렸네").
- **Emoji:** none. This is a tool. Status is carried by the O/△/X badge system and tag chips, not
  emoji.
- **Numbers as relative signals.** Time is never framed as precise ("4분 12초가 정확!") but as
  comparison ("이 유형 평균보다 오래 걸렸어"). Counts in the weakness hub are framed as "몰린 곳",
  not scores.

**Sample strings** (use these as voice reference):
- 채점 결과: "3번 · △ · 계산" / "2번 · X · 개념"
- 자가진단 prompt: "각 문제에 오답 원인을 먼저 골라줘"
- AI 대조 mismatch: "네 진단: #계산 · 실제: #개념 — 여기가 오늘 가장 값진 지점"
- 복습: "필기 숨김 · 다시 풀어보기"
- 졸업: "3회 연속 정답 · 아카이브로 이동"
- 주간 점검: "이번 주는 #계산이 압도적 — 실력이 아니라 검산 루틴의 문제야"

---

## VISUAL FOUNDATIONS

**Overall vibe:** a calm, paper-like study surface. Warm off-white canvas, generous whitespace,
soft low shadows, restrained color. Color is used _diagnostically_ — it means something (O/△/X,
cause tags) rather than decorating.

- **Color:** Warm **growth green** (`--brand` `#26A65E`) is the single brand accent — "correct /
  progress". Neutrals are warm-tinted (a hair of green/paper, never blue-gray). Two background
  colors max: `--canvas` `#F6F7F2` (app) and `--paper` white (cards). The **grading scale** is a
  first-class color system: O=green, △=warm amber `#C98212`, X=warm red `#D64545`, each with a
  soft bg tint and a ring color. The **five cause tags** each own a hue (개념 violet, 계산 blue,
  조건 amber, 접근 teal, 시간 rose) used only as chips, never as large fills.
- **Typography:** **Pretendard** for all UI (KR+EN; confirmed source noonnu.cc/font_page/694,
  per-weight woff2 100–900). **JetBrains Mono** with tabular
  figures for every numeric readout — timers, durations, counts — so digits never jitter. Type
  scale is tablet-generous (body 15px, problem text 17px/28px). Tracking is slightly negative
  (KR reads tighter): headings `-0.02em`, body `-0.01em`.
- **Spacing:** 4px base grid (`--space-1..16`). Comfortable, not dense — this is a reading/writing
  surface, so cards breathe (20–24px padding).
- **Backgrounds:** flat warm off-white. **No** gradients, no photographic hero imagery, no
  patterns/textures. The "canvas" metaphor is literal paper. The only textured surface is the
  **masked-handwriting placeholder** (`--surface-mask`, a flat light gray block that hides ink
  until "필기 보기" is pressed).
- **Corner radii:** soft and consistent — inputs/buttons `10px`, cards `14px`, large panels `20px`;
  chips and grade badges are full pills (`999px`).
- **Cards:** white surface, `14px` radius, `1px` `--border-subtle`, `--shadow-sm`. They do **not**
  use a colored left-border accent (an AI-slop trope we avoid). Status lives in the badge, not the
  card frame.
- **Shadows:** warm, low, diffuse (based on `rgba(27,31,22,…)`), never harsh black. `--shadow-sm`
  for cards, `--shadow-md` for raised/hover, `--shadow-lg` for sheets/popovers. Focus is a 3px
  green glow (`--shadow-focus`), never a hard blue outline.
- **Borders:** hairline `1px` `--border-subtle/-default`; `1.5px` for emphasis. Dividers are
  `--border-subtle`.
- **Animation:** subtle and functional. Fades and small translate/scale (`--dur-base` 200ms,
  `--ease-out`). No bounces, no confetti. The timer's start uses a gentle fade-in on the readout.
  Reveal interactions (필기 보기, AI 대조) use a short crossfade.
- **Hover states:** buttons darken one step (`--brand` → `--brand-hover`); ghost/neutral surfaces
  go to `--surface-hover`. **Press states:** darker again (`--brand-press`) + a 1px translate-down
  / `scale(0.98)` on primary actions. Touch targets never below `--tap-min` 44px.
- **Transparency & blur:** used only for scrims/sheets over content (a low `rgba` ink scrim +
  optional light backdrop-blur on modal overlays). Not decorative.
- **Layout rules:** tablet-first. A fixed left rail (`--sidebar-w` 264px) for navigation; content
  in a centered reading column. Fixed timer/pause control docks near the active problem.
- **Imagery color vibe:** the only "imagery" is student handwriting (captured pen strokes) and
  problem images — shown as-is, neutral, no filters. Problem cards show **the problem only** (never
  the answer/handwriting) until explicitly revealed.

---

## ICONOGRAPHY

- **Logo (original, created for 푸리 — not from any provided source).** A **2.5D observation ring** — a
  pale, translucent tilted ring (observation / orbit) wrapping a **solid green core** (the focus /
  learner). The ring passes behind the core at the top and in front at the bottom, so it reads as a
  ring *threaded around* the core in depth — the intent to *observe every action to reduce mistakes*
  (사람의 모든 행동을 파악해 실수를 줄인다). The depth comes only from occlusion + a light-front / dark-back
  tone split — **no soft radial gradient** (a nod to the "AI butthole-era" critique in
  [this article](https://news.hada.io/topic?id=31566): the trope is avoided; depth is honest 2.5D,
  not a glowing orb). Files: `assets/logo.svg` (pale-green ring + green core, for light/dark surfaces),
  `assets/logo-white.svg` (white ring + core, for brand-green/photographic/dark surfaces), both a
  square ≈64×64 viewBox. Minimum clear space = 25% of mark height. Pair with the wordmark **"푸리"** in
  Pretendard Bold, tracking `-0.03em`. See the Logo card under Brand. The wordmark alone remains a
  valid fallback where the mark can't be used.
- **Icon set: [Lucide](https://lucide.dev)** via CDN. **SUBSTITUTION — flagged:** the spec provided
  no icon assets, and no Figma access. Lucide's calm 1.5px stroke, rounded line style matches the
  "quiet tool" direction better than filled/duotone sets. If your Figma uses a different set,
  swap the CDN and restyle.
  - Load: `<script src="https://unpkg.com/lucide@latest"></script>` then `lucide.createIcons()`,
    or use the SVG per-icon CDN. Stroke width `1.75`, `currentColor`.
  - Typical icons in use: `timer`, `pause`, `play`, `chevron-up`/`chevron-down` (±30s),
    `check`, `minus` (△), `x`, `eye`/`eye-off` (필기 보기/숨김), `copy` (쌍둥이 문제),
    `refresh-cw` (재풀이), `network`/`git-branch` (약점개념 허브), `calendar-check` (주간 점검).
- **The O / △ / X grade marks are NOT icons** — they are typographic/geometric badges rendered by
  the `GradeBadge` component (a ring + the mark). Treat them as brand primitives.
- **Emoji:** never used.
- **Unicode as icons:** the △ mark uses the geometric ▲/△ family inside the badge; otherwise avoid
  unicode-as-icon.

---

## INDEX (manifest)

Root:
- `styles.css` — global entry (import this).
- `tokens/` — `colors.css`, `typography.css`, `spacing.css`, `fonts.css`.
- `readme.md` — this file. `SKILL.md` — Agent-Skill wrapper.
- `thumbnail.html` — project tile.
- `assets/` — `logo.svg` (pale-green observation ring + core), `logo-white.svg` (white version for brand/dark surfaces).

Foundations (Design System tab): specimen cards live in `guidelines/` — colors, grading scale,
cause-tag palette, type, spacing, radius/shadow.

Components (`components/`):
- `core/` — Button, IconButton, Input, Checkbox, Chip
- `grading/` — GradeBadge (O/△/X), CauseTag (#개념/#계산/#조건/#접근/#시간)
- `study/` — Timer, ReviewChecks (회독 □1□2□3), WrongNoteCard, ConceptHub (weakness graph view)

UI kit (`ui_kits/tablet-app/`): interactive tablet-app recreation — grading, self-diagnosis,
AI 대조, wrong-note card, weakness hub, weekly check.

> **Intentional additions:** no external component inventory was available (no Figma/codebase
> access), so the component set was authored from the spec's own UI vocabulary (grading badges,
> cause tags, timer, review checks, wrong-note card, weakness hub) plus a minimal core form/button
> set needed to compose the screens. Every component maps to a named artifact in the spec.
