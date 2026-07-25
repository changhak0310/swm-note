// 푸리 DS — Chip. 상태·필터 토큰. 오답 원인 태그는 CauseTag를 쓴다.
import type { CSSProperties, ReactNode } from 'react'

type Tone = 'neutral' | 'brand' | 'muted'
type Size = 'sm' | 'md'

const tones: Record<Tone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: 'var(--ink-100)', fg: 'var(--text-default)', border: 'var(--border-default)' },
  brand: { bg: 'var(--brand-tint)', fg: 'var(--text-brand)', border: 'transparent' },
  muted: { bg: 'transparent', fg: 'var(--text-muted)', border: 'var(--border-default)' },
}

export type ChipProps = {
  children?: ReactNode
  tone?: Tone
  size?: Size
  icon?: ReactNode
  onRemove?: () => void
  style?: CSSProperties
}

export function Chip({ children, tone = 'neutral', size = 'md', icon = null, onRemove, style }: ChipProps) {
  const t = tones[tone]

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: size === 'sm' ? '3px 10px' : '5px 12px',
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.border}`,
        borderRadius: 'var(--radius-pill)',
        fontSize: size === 'sm' ? 'var(--text-caption)' : 'var(--text-sm)',
        fontWeight: 500,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {icon && <span style={{ display: 'inline-flex', flex: 'none' }}>{icon}</span>}
      {children}
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label="remove"
          style={{
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            color: 'inherit',
            display: 'inline-flex',
            padding: 0,
            opacity: 0.6,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </span>
  )
}
