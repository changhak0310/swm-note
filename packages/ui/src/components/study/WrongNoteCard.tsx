'use client'

// 푸리 DS — WrongNoteCard. 자동 오답노트 카드.
// 문제만 보여준다 — 필기는 "필기 보기"를 누르기 전까지 마스크 뒤에 숨긴다
// (기억에 의존한 재풀이 방지). 자가진단 vs AI 대조를 함께 기록하고 어긋남을 표시한다.
import { useState, type ReactNode } from 'react'
import { cn } from '../../lib/utils'
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

export type WrongNoteCardProps = React.HTMLAttributes<HTMLDivElement> & {
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
}

const ROW_LABEL = 'text-caption text-faint w-[42px]'

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
  className,
  ...rest
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
      className={cn(
        'flex flex-col w-80 bg-card border border-border-subtle rounded-lg shadow-sm overflow-hidden',
        className,
      )}
      {...rest}
    >
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2.5">
        <GradeBadge grade={grade} filled />
        <div className="flex flex-col gap-px flex-1 min-w-0">
          <span className="text-h3 font-semibold text-strong">{number}번</span>
          {concept && <span className="text-caption text-muted-foreground">{concept}</span>}
        </div>
        {seconds != null && <span className="num text-sm text-muted-foreground">{fmt(seconds)}</span>}
      </div>

      <div className="relative mx-4 rounded-md overflow-hidden border border-border-subtle">
        <div className="min-h-24 p-[18px] grid place-items-center bg-surface-sunken text-sm text-faint">
          {problemSlot ?? '문제 이미지'}
        </div>
        {!revealed && (
          <button
            type="button"
            onClick={reveal}
            // 사선 해칭 — 마스크가 "가려져 있다"는 걸 색만이 아니라 무늬로도 말한다
            className="absolute inset-0 flex items-center justify-center gap-[7px] border-none cursor-pointer
                       bg-surface-mask text-muted-foreground font-sans text-sm font-medium
                       bg-[repeating-linear-gradient(135deg,transparent,transparent_9px,rgba(0,0,0,0.025)_9px,rgba(0,0,0,0.025)_18px)]"
          >
            <Eye /> 필기 보기
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={ROW_LABEL}>내 진단</span>
          {selfCause ? <CauseTag cause={selfCause} size="sm" /> : <span className="text-caption text-faint">—</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={ROW_LABEL}>AI 대조</span>
          {aiCause ? <CauseTag cause={aiCause} size="sm" /> : <span className="text-caption text-faint">—</span>}
          {mismatch && <span className="text-caption font-medium text-grade-tri">· 어긋남</span>}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2.5 px-4 py-3 border-t border-border-subtle bg-ink-50">
        <ReviewChecks count={reviewCount} graduated={graduated} size="sm" />
        {twin && (
          <button
            type="button"
            onClick={onTwin}
            className="inline-flex items-center gap-1.5 px-3 py-[7px] rounded-md cursor-pointer
                       bg-paper text-default border border-border font-sans text-sm font-medium
                       hover:bg-surface-hover"
          >
            <Copy /> 쌍둥이 문제
          </button>
        )}
      </div>
    </div>
  )
}
