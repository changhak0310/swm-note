// 디자인 시스템 갤러리 — dev 전용. 토큰·컴포넌트 12종을 실물로 확인한다.
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { paths } from '../routes/paths'
import {
  Button,
  IconButton,
  Input,
  Checkbox,
  Chip,
  GradeBadge,
  GradeResultCard,
  CauseTag,
  CAUSES,
  Timer,
  ReviewChecks,
  WrongNoteCard,
  ConceptHub,
  type CauseKey,
} from '../design'
import logo from '../assets/logo.svg'
import logoWhite from '../assets/logo-white.svg'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ds-card p-[var(--space-6)]">
      <h2 className="mb-[var(--space-4)] text-[length:var(--text-h3)] font-semibold text-[color:var(--text-strong)]">
        {title}
      </h2>
      <div className="flex flex-wrap items-center gap-[var(--space-4)]">{children}</div>
    </section>
  )
}

export function DesignGallery() {
  const navigate = useNavigate()
  const closeGallery = () => void navigate(paths.list)
  const [checked, setChecked] = useState(true)
  const [cause, setCause] = useState<CauseKey>('calc')
  const [seconds, setSeconds] = useState(312)
  const [running, setRunning] = useState(false)
  const [rounds, setRounds] = useState(2)

  return (
    <div className="min-h-dvh p-[var(--space-6)]">
      <header className="mb-[var(--space-6)] flex items-center gap-[var(--space-3)]">
        <img src={logo} alt="" className="h-8 w-8" />
        <h1 className="ds-wordmark text-[length:var(--text-h2)]">푸리 디자인 시스템</h1>
        <Button variant="ghost" size="sm" style={{ marginLeft: 'auto' }} onClick={closeGallery}>
          ← 목록으로
        </Button>
      </header>

      <div className="mx-auto flex max-w-4xl flex-col gap-[var(--space-5)]">
        <Section title="브랜드 — 관찰 고리">
          <img src={logo} alt="푸리 로고" className="h-16 w-16" />
          <div
            className="grid h-16 w-16 place-items-center rounded-[var(--radius-md)]"
            style={{ background: 'var(--brand)' }}
          >
            <img src={logoWhite} alt="푸리 로고 (화이트)" className="h-12 w-12" />
          </div>
          <span className="ds-wordmark text-[length:var(--text-display)]">푸리</span>
        </Section>

        <Section title="Button">
          <Button>채점하기</Button>
          <Button variant="secondary">필기 보기</Button>
          <Button variant="ghost">건너뛰기</Button>
          <Button variant="danger">삭제</Button>
          <Button disabled>비활성</Button>
          <Button size="sm" variant="secondary">
            sm
          </Button>
          <Button size="lg">lg</Button>
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
          <span className="text-[length:var(--text-sm)] text-[color:var(--text-muted)]">
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
