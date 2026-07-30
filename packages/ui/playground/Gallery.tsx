// 디자인 시스템 갤러리 — 토큰·컴포넌트 12종을 실물로 확인한다.
// 앱 없이 단독으로 뜬다: pnpm --filter @puri/ui dev
import { useState, type ReactNode } from 'react'
import {
  Button,
  IconButton,
  Input,
  Checkbox,
  Chip,
  NavItem,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
  GradeBadge,
  GradeResultCard,
  RetryChip,
  Toggle,
  CauseTag,
  CAUSES,
  Timer,
  ReviewChecks,
  WrongNoteCard,
  ConceptHub,
  type CauseKey,
} from '../src'
import logo from '../src/assets/logo.svg'
import logoWhite from '../src/assets/logo-white.svg'

const PenGlyph = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19l7-7 3 3-7 7-3-3z" />
    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18z" />
    <path d="M2 2l7.586 7.586" />
    <circle cx="11" cy="11" r="2" />
  </svg>
)

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ds-card p-6">
      <h2 className="mb-4 text-h3 font-semibold text-strong">{title}</h2>
      <div className="flex flex-wrap items-center gap-4">{children}</div>
    </section>
  )
}

export function Gallery() {
  const [checked, setChecked] = useState(true)
  const [cause, setCause] = useState<CauseKey>('calc')
  const [seconds, setSeconds] = useState(312)
  const [running, setRunning] = useState(false)
  const [rounds, setRounds] = useState(2)

  return (
    <div className="min-h-dvh p-6 bg-background">
      <header className="mb-6 flex items-center gap-3">
        <img src={logo} alt="" className="size-8" />
        <h1 className="ds-wordmark text-h2">푸리 디자인 시스템</h1>
      </header>

      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <Section title="브랜드 — 관찰 고리">
          <img src={logo} alt="푸리 로고" className="size-16" />
          <div className="grid size-16 place-items-center rounded-md bg-brand">
            <img src={logoWhite} alt="푸리 로고 (화이트)" className="size-12" />
          </div>
          <span className="ds-wordmark text-display">푸리</span>
        </Section>

        <Section title="Button">
          <Button>채점하기</Button>
          <Button variant="secondary">필기 보기</Button>
          <Button variant="ghost">건너뛰기</Button>
          <Button variant="danger">삭제</Button>
          <Button variant="inverse">채점 결과</Button>
          <Button disabled>비활성</Button>
          <Button size="sm" variant="secondary">
            sm
          </Button>
          <Button size="lg">lg</Button>
        </Section>

        <Section title="Toggle — 도구 팔레트(tint) · 선지 고르기(solid)">
          <Toggle label="펜" pressed>
            <PenGlyph />
          </Toggle>
          <Toggle label="형광펜">
            <PenGlyph />
          </Toggle>
          <Toggle label="지우개" disabled>
            <PenGlyph />
          </Toggle>
          {['①', '②', '③', '④', '⑤'].map((g, i) => (
            <Toggle key={g} variant="solid" shape="circle" label={`${i + 1}번 선지`} pressed={i === 2} className="text-body">
              {g}
            </Toggle>
          ))}
        </Section>

        <Section title="NavItem — 좌측 레일 한 줄">
          <div className="flex w-64 flex-col gap-0.5 rounded-lg bg-surface-sunken p-3">
            <NavItem icon={<PenGlyph />} label="모든 노트" active trailing={<span className="num text-faint">12</span>} />
            <NavItem icon={<PenGlyph />} label="휴지통" muted />
            <NavItem icon={<PenGlyph />} label="폴더" muted disabled />
          </div>
        </Section>

        <Section title="RetryChip — 틀린 문제 다시풀기">
          <RetryChip label="3번" page={2} consec={1} />
          <RetryChip label="12번" page={5} consec={2} />
          <RetryChip label="7번" page={3} consec={3} graduated />
        </Section>

        <Section title="IconButton · Chip">
          <IconButton label="일시정지" variant="outline">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          </IconButton>
          <IconButton label="재생" variant="solid">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
              <path d="M7 5v14l12-7z" />
            </svg>
          </IconButton>
          <Chip>수학Ⅰ</Chip>
          <Chip tone="brand">선택됨</Chip>
          <Chip tone="muted" onRemove={() => {}}>
            필터
          </Chip>
        </Section>

        <Section title="Dialog — Escape·포커스 트랩·스크롤 잠금은 Radix가 맡는다">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">확인 다이얼로그 열기</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>노트를 삭제할까?</DialogTitle>
              <DialogDescription>휴지통으로 이동돼. 휴지통에서 언제든 복원할 수 있어.</DialogDescription>
              <DialogFooter>
                <Button variant="ghost">취소</Button>
                <Button variant="danger">삭제</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Section>

        <Section title="Input · Checkbox">
          <Input label="이름" placeholder="홍길동" hint="실명을 입력해줘" />
          <Input label="이메일" error="형식이 올바르지 않아" defaultValue="bad@" />
          <Checkbox checked={checked} onChange={setChecked} label="검산했어" />
        </Section>

        <Section title="GradeBadge — O / △ / X">
          <GradeBadge grade="O" />
          <GradeBadge grade="triangle" />
          <GradeBadge grade="X" />
          <GradeBadge grade="O" filled />
          <GradeBadge grade="triangle" filled />
          <GradeBadge grade="X" filled />
          <GradeBadge grade="X" size="lg" filled />
          <GradeBadge grade="O" size="sm" />
        </Section>

        <Section title="CauseTag — 원인 5태그 (선택형)">
          {(Object.keys(CAUSES) as CauseKey[]).map((k) => (
            <CauseTag key={k} cause={k} interactive selected={cause === k} onClick={() => setCause(k)} />
          ))}
          <span className="text-sm text-muted-foreground">
            정적: <CauseTag cause="concept" size="sm" />
          </span>
        </Section>

        <Section title="Timer · ReviewChecks">
          <Timer
            label="3번"
            seconds={seconds}
            onChange={setSeconds}
            running={running}
            onToggleRun={setRunning}
          />
          <Timer label="7번" seconds={412} slow />
          <ReviewChecks count={rounds} onToggle={(r) => setRounds(r === rounds ? r - 1 : r)} />
          <ReviewChecks count={3} graduated />
        </Section>

        <Section title="GradeResultCard — 채점 결과 요약">
          <GradeResultCard number={3} grade="O" concept="지수·로그 · 로그 진수조건" seconds={184} />
          <GradeResultCard
            number={7}
            grade="triangle"
            concept="지수·로그 · 로그 부등호 방향"
            causes={['calc']}
            seconds={312}
            onClick={() => {}}
          />
          <GradeResultCard
            number={12}
            grade="X"
            concept="삼각함수 · 주기 구하기"
            causes={['concept', 'condition']}
            seconds={478}
            onClick={() => {}}
          />
          <GradeResultCard number={15} grade="X" onClick={() => {}} disabled />
        </Section>

        <Section title="WrongNoteCard · ConceptHub">
          <WrongNoteCard
            number={3}
            grade="triangle"
            concept="지수·로그 · 로그 부등호 방향"
            seconds={312}
            selfCause="calc"
            aiCause="concept"
            twin
            reviewCount={1}
          />
          <ConceptHub
            title="약점개념 허브 — 수학Ⅰ"
            units={[
              {
                name: '지수·로그',
                concepts: [
                  { name: '로그 부등호 방향', count: 6 },
                  { name: '로그 진수조건', count: 3 },
                ],
              },
              { name: '삼각함수', concepts: [{ name: '주기 구하기', count: 4 }] },
            ]}
          />
        </Section>
      </div>
    </div>
  )
}
