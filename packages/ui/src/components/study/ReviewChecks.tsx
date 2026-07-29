'use client'

// 푸리 DS — ReviewChecks. 회독 체크 □1□2□3.
// 3회 연속 정답이면 아카이브로 졸업, 한 번 틀리면 리셋.
import type { CSSProperties } from 'react'

type Size = 'sm' | 'md' | 'lg'

export type ReviewChecksProps = {
  count?: number
  total?: number
  size?: Size
  graduated?: boolean
  onToggle?: (round: number) => void
  style?: CSSProperties
}

export function ReviewChecks({
  count = 0,
  total = 3,
  size = 'md',
  graduated = false,
  onToggle,
  style,
}: ReviewChecksProps) {
  const d = size === 'sm' ? 24 : size === 'lg' ? 34 : 28

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, ...style }}>
      {Array.from({ length: total }).map((_, i) => {
        const done = i < count
        return (
          <button
            key={i}
            onClick={onToggle ? () => onToggle(i + 1) : undefined}
            aria-label={`${i + 1}회독${done ? ' 완료' : ''}`}
            title={`${i + 1}회독`}
            disabled={!onToggle}
            style={{
              width: d,
              height: d,
              minWidth: d,
              borderRadius: 'var(--radius-sm)',
              display: 'grid',
              placeItems: 'center',
              padding: 0,
              fontFamily: 'var(--font-numeric)',
              fontVariantNumeric: 'tabular-nums',
              fontSize: d * 0.42,
              fontWeight: 600,
              background: done ? 'var(--brand)' : 'var(--paper)',
              color: done ? 'var(--text-invert)' : 'var(--text-faint)',
              border: `1.5px solid ${done ? 'var(--brand)' : 'var(--border-strong)'}`,
              cursor: onToggle ? 'pointer' : 'default',
              transition:
                'background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)',
            }}
          >
            {done ? (
              <svg
                width={d * 0.5}
                height={d * 0.5}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : (
              i + 1
            )}
          </button>
        )
      })}
      {graduated && (
        <span
          style={{
            marginLeft: 4,
            fontSize: 'var(--text-caption)',
            fontWeight: 600,
            color: 'var(--text-brand)',
            background: 'var(--brand-tint)',
            padding: '3px 9px',
            borderRadius: 'var(--radius-pill)',
          }}
        >
          졸업 · 아카이브
        </span>
      )}
    </div>
  )
}
