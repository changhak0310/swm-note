'use client'

// 푸리 DS — Timer. 누적 시간 측정: mono 판독부 + 일시정지 + ±30초 스텝.
// 시간은 상대 신호다 — 정밀 조정을 강요하지 않는다. slow는 △ 시간 신호.
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

const I = ({ s = 18, children }: { s?: number; children: ReactNode }) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
)

const Pause = () => (
  <I>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </I>
)
const Play = () => (
  <I>
    <path d="M7 5v14l12-7z" />
  </I>
)
const Up = () => (
  <I s={16}>
    <path d="m6 15 6-6 6 6" />
  </I>
)
const Down = () => (
  <I s={16}>
    <path d="m6 9 6 6 6-6" />
  </I>
)

function fmt(sec: number): string {
  const m = Math.floor(Math.max(0, sec) / 60)
  const s = Math.max(0, sec) % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const STEP_BTN =
  'inline-flex items-center justify-center w-[30px] h-[22px] p-0 rounded-sm cursor-pointer ' +
  'bg-surface-sunken border border-border-subtle text-default hover:bg-surface-hover'

export type TimerProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> & {
  label?: string
  seconds?: number
  onChange?: (seconds: number) => void
  running?: boolean
  onToggleRun?: (running: boolean) => void
  /** "평균보다 오래" 신호 — 테두리와 숫자가 앰버로 바뀐다 */
  slow?: boolean
  step?: number
}

export function Timer({
  label = '이 문제',
  seconds = 0,
  onChange,
  running = false,
  onToggleRun,
  slow = false,
  step = 30,
  className,
  ...rest
}: TimerProps) {
  const bump = (delta: number) => onChange?.(Math.max(0, seconds + delta))

  return (
    <div
      className={cn(
        'inline-flex items-center gap-3.5 py-2.5 pl-4 pr-3 bg-paper rounded-lg shadow-sm border',
        slow ? 'border-grade-tri-ring' : 'border-border',
        className,
      )}
      {...rest}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-caption text-muted-foreground tracking-[var(--track-wide)]">{label}</span>
        <div className="flex items-baseline gap-2">
          <span className={cn('num text-[26px] font-semibold leading-none', slow ? 'text-grade-tri' : 'text-strong')}>
            {fmt(seconds)}
          </span>
          {slow && <span className="text-caption font-medium text-grade-tri">평균보다 오래</span>}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <button type="button" onClick={() => bump(step)} aria-label={`+${step}초`} className={STEP_BTN}>
          <Up />
        </button>
        <button type="button" onClick={() => bump(-step)} aria-label={`-${step}초`} className={STEP_BTN}>
          <Down />
        </button>
      </div>

      <button
        type="button"
        onClick={() => onToggleRun?.(!running)}
        aria-label={running ? '일시정지' : '재개'}
        title={running ? '일시정지' : '재개'}
        className={cn(
          'inline-flex items-center justify-center size-11 flex-none rounded-md border border-transparent cursor-pointer',
          'transition-[background] duration-[var(--dur-fast)] ease-out',
          running ? 'bg-brand-tint text-brand-ink' : 'bg-brand text-invert hover:bg-brand-hover',
        )}
      >
        {running ? <Pause /> : <Play />}
      </button>
    </div>
  )
}
