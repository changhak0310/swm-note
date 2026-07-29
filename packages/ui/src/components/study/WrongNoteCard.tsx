'use client'

// 푸리 DS — WrongNoteCard. 자동 오답노트 카드.
// 문제만 보여준다 — 필기는 "필기 보기"를 누르기 전까지 마스크 뒤에 숨긴다
// (기억에 의존한 재풀이 방지). 자가진단 vs AI 대조를 함께 기록하고 어긋남을 표시한다.
import { useState, type CSSProperties, type ReactNode } from 'react'
import { GradeBadge, type GradeInput } from '../grading/GradeBadge'
import { CauseTag, type CauseInput } from '../grading/CauseTag'
import { ReviewChecks } from './ReviewChecks'

const I = ({ s = 16, children }: { s?: number; children: ReactNode }) => (
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
const Eye = () => (
  <I>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </I>
)
const Copy = () => (
  <I>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </I>
)

export type WrongNoteCardProps = {
  number: number | string
  grade?: GradeInput
  concept?: string
  seconds?: number
  selfCause?: CauseInput
  aiCause?: CauseInput
  /** 쌍둥이 문제 버튼 — #시간/#계산/#접근/#조건 전용, #개념에는 쓰지 않는다 */
  twin?: boolean
  reviewCount?: number
  graduated?: boolean
  problemSlot?: ReactNode
  revealed?: boolean
  onReveal?: () => void
  onTwin?: () => void
  style?: CSSProperties
}

export function WrongNoteCard({
  number,
  grade = 'X',
  concept,
  seconds,
  selfCause,
  aiCause,
  twin = false,
  reviewCount = 0,
  graduated = false,
  problemSlot,
  revealed: revealedProp,
  onReveal,
  onTwin,
  style,
}: WrongNoteCardProps) {
  const [revealedState, setRevealedState] = useState(false)
  const revealed = revealedProp ?? revealedState
  const mismatch = selfCause && aiCause && selfCause !== aiCause
  const fmt = (s: number) => `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초`

  const reveal = () => {
    setRevealedState(true)
    onReveal?.()
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 320,
        background: 'var(--surface-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 10px' }}>
        <GradeBadge grade={grade} filled />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 'var(--text-h3)', fontWeight: 600, color: 'var(--text-strong)' }}>
            {number}번
          </span>
          {concept && (
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--text-muted)' }}>{concept}</span>
          )}
        </div>
        {seconds != null && (
          <span
            style={{
              fontFamily: 'var(--font-numeric)',
              fontVariantNumeric: 'tabular-nums',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-muted)',
            }}
          >
            {fmt(seconds)}
          </span>
        )}
      </div>

      <div
        style={{
          position: 'relative',
          margin: '0 16px',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div
          style={{
            minHeight: 96,
            background: 'var(--surface-sunken)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-faint)',
            padding: 18,
          }}
        >
          {problemSlot ?? '문제 이미지'}
        </div>
        {!revealed && (
          <button
            onClick={reveal}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              background: 'var(--surface-mask)',
              color: 'var(--text-muted)',
              border: 'none',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              cursor: 'pointer',
              backgroundImage:
                'repeating-linear-gradient(135deg, transparent, transparent 9px, rgba(0,0,0,0.025) 9px, rgba(0,0,0,0.025) 18px)',
            }}
          >
            <Eye /> 필기 보기
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--text-faint)', width: 42 }}>
            내 진단
          </span>
          {selfCause ? (
            <CauseTag cause={selfCause} size="sm" />
          ) : (
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--text-faint)' }}>—</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--text-caption)', color: 'var(--text-faint)', width: 42 }}>
            AI 대조
          </span>
          {aiCause ? (
            <CauseTag cause={aiCause} size="sm" />
          ) : (
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--text-faint)' }}>—</span>
          )}
          {mismatch && (
            <span style={{ fontSize: 'var(--text-caption)', color: 'var(--grade-tri)', fontWeight: 500 }}>
              · 어긋남
            </span>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '12px 16px',
          borderTop: '1px solid var(--border-subtle)',
          background: 'var(--ink-50)',
        }}
      >
        <ReviewChecks count={reviewCount} graduated={graduated} size="sm" />
        {twin && (
          <button
            onClick={onTwin}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 12px',
              background: 'var(--paper)',
              color: 'var(--text-default)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
            }}
          >
            <Copy /> 쌍둥이 문제
          </button>
        )}
      </div>
    </div>
  )
}
