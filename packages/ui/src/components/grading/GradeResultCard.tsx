'use client'

// 푸리 DS — GradeResultCard. 문제 1개의 채점 결과 요약("3번 · △ · #계산 · 시간") 카드 행.
// 상태는 GradeBadge가 나른다 — 카드 프레임은 중립(컬러 좌측 보더·틴트 금지). onClick이 있으면 카드 전체가 버튼이 된다.
import { useState, type CSSProperties } from 'react'
import { GradeBadge, type GradeInput } from './GradeBadge'
import { CauseTag, type CauseInput } from './CauseTag'

export type GradeResultCardProps = {
  /** 문제 번호 — "3" → "3번" */
  number: number | string
  grade?: GradeInput
  /** 단원·개념 이름. 번호 아래 보조 표기 */
  concept?: string
  /** 확정된 원인 태그(자가진단 이후). 없으면 아무것도 표시하지 않는다 — 진단을 앞지르지 않는다 */
  causes?: CauseInput[]
  /** 소요 시간(초). 관찰 지표라 시각적 주인공이 되지 않는다 */
  seconds?: number
  /** 있으면 카드 전체가 눌리는 버튼이 된다(결과 상세로 이동) */
  onClick?: () => void
  disabled?: boolean
  style?: CSSProperties
}

const fmt = (s: number) => `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초`

export function GradeResultCard({
  number,
  grade = 'O',
  concept,
  causes,
  seconds,
  onClick,
  disabled = false,
  style,
}: GradeResultCardProps) {
  const [hover, setHover] = useState(false)
  const [active, setActive] = useState(false)
  const [focus, setFocus] = useState(false)
  const clickable = !!onClick && !disabled

  const frame: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    width: '100%',
    minHeight: 'var(--tap-min)',
    padding: 'var(--space-3) var(--space-4)',
    background: 'var(--surface-card)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg)',
    boxShadow:
      clickable && focus
        ? 'var(--shadow-sm), var(--shadow-focus)'
        : clickable && hover
          ? 'var(--shadow-md)'
          : 'var(--shadow-sm)',
    textAlign: 'left',
    fontFamily: 'var(--font-sans)',
    letterSpacing: 'var(--track-normal)',
    color: 'var(--text-default)',
    cursor: onClick ? (disabled ? 'not-allowed' : 'pointer') : 'default',
    opacity: disabled ? 0.45 : 1,
    transform: clickable && active ? 'translateY(1px)' : 'none',
    transition: 'box-shadow var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)',
    outline: 'none',
    ...style,
  }

  const content = (
    <>
      <GradeBadge grade={grade} filled />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 'var(--text-body)', fontWeight: 600, color: 'var(--text-strong)' }}>
          {number}번
        </span>
        {concept && (
          <span
            style={{
              fontSize: 'var(--text-caption)',
              lineHeight: 'var(--lh-caption)',
              color: 'var(--ink-600)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {concept}
          </span>
        )}
      </span>
      {causes && causes.length > 0 && (
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 'var(--space-1)',
            flexWrap: 'wrap',
          }}
        >
          {causes.map((c) => (
            <CauseTag key={String(c)} cause={c} size="sm" />
          ))}
        </span>
      )}
      {seconds != null && (
        <span
          style={{
            fontFamily: 'var(--font-numeric)',
            fontVariantNumeric: 'tabular-nums',
            fontSize: 'var(--text-sm)',
            lineHeight: 1,
            color: 'var(--ink-600)',
            textAlign: 'right',
            whiteSpace: 'nowrap',
            flex: 'none',
          }}
        >
          {fmt(seconds)}
        </span>
      )}
    </>
  )

  if (!onClick) return <div style={frame}>{content}</div>

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={frame}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false)
        setActive(false)
      }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
    >
      {content}
    </button>
  )
}
