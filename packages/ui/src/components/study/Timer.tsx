'use client'

// 푸리 DS — Timer. 누적 시간 측정: mono 판독부 + 일시정지 + ±30초 스텝.
// 시간은 상대 신호다 — 정밀 조정을 강요하지 않는다. slow는 △ 시간 신호.
import type { CSSProperties, ReactNode } from 'react'

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

const stepBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 22,
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  background: 'var(--surface-sunken)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-default)',
  padding: 0,
}

export type TimerProps = {
  label?: string
  seconds?: number
  onChange?: (seconds: number) => void
  running?: boolean
  onToggleRun?: (running: boolean) => void
  slow?: boolean
  step?: number
  style?: CSSProperties
}

export function Timer({
  label = '이 문제',
  seconds = 0,
  onChange,
  running = false,
  onToggleRun,
  slow = false,
  step = 30,
  style,
}: TimerProps) {
  const bump = (delta: number) => onChange?.(Math.max(0, seconds + delta))

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 12px 10px 16px',
        background: 'var(--paper)',
        border: `1px solid ${slow ? 'var(--grade-tri-ring)' : 'var(--border-default)'}`,
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        ...style,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span
          style={{
            fontSize: 'var(--text-caption)',
            color: 'var(--text-muted)',
            letterSpacing: 'var(--track-wide)',
          }}
        >
          {label}
        </span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span
            style={{
              fontFamily: 'var(--font-numeric)',
              fontVariantNumeric: 'tabular-nums',
              fontSize: 26,
              fontWeight: 600,
              lineHeight: 1,
              color: slow ? 'var(--grade-tri)' : 'var(--text-strong)',
            }}
          >
            {fmt(seconds)}
          </span>
          {slow && (
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--grade-tri)', fontWeight: 500 }}>
              평균보다 오래
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button onClick={() => bump(step)} aria-label={`+${step}초`} style={stepBtn}>
          <Up />
        </button>
        <button onClick={() => bump(-step)} aria-label={`-${step}초`} style={stepBtn}>
          <Down />
        </button>
      </div>

      <button
        onClick={() => onToggleRun?.(!running)}
        aria-label={running ? '일시정지' : '재개'}
        title={running ? '일시정지' : '재개'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 44,
          height: 44,
          minWidth: 44,
          borderRadius: 'var(--radius-md)',
          border: '1px solid transparent',
          cursor: 'pointer',
          background: running ? 'var(--brand-tint)' : 'var(--brand)',
          color: running ? 'var(--text-brand)' : 'var(--text-invert)',
          transition: 'background var(--dur-fast) var(--ease-out)',
        }}
      >
        {running ? <Pause /> : <Play />}
      </button>
    </div>
  )
}
