'use client'

// 푸리 DS — GradeResultCard. 문제 1개의 채점 결과 요약("3번 · △ · #계산 · 시간") 카드 행.
// 상태는 GradeBadge가 나른다 — 카드 프레임은 중립(컬러 좌측 보더·틴트 금지). onClick이 있으면 카드 전체가 버튼이 된다.
import { cn } from '../../lib/utils'
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
  className?: string
}

const fmt = (s: number) => `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초`

const FRAME =
  'flex items-center gap-3 w-full min-h-[var(--tap-min)] px-4 py-3 bg-card border border-border-subtle ' +
  'rounded-lg shadow-sm text-left font-sans tracking-[var(--track-normal)] text-default outline-none ' +
  'transition-[box-shadow,transform] duration-[var(--dur-fast)] ease-out'

// 누를 수 있을 때만 반응한다 — 정적 카드가 들썩이면 누를 수 있는 줄 안다
const INTERACTIVE =
  'cursor-pointer hover:shadow-md focus-visible:shadow-[var(--shadow-sm),var(--shadow-focus)] active:translate-y-px ' +
  'disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-sm disabled:translate-y-0'

export function GradeResultCard({
  number,
  grade = 'O',
  concept,
  causes,
  seconds,
  onClick,
  disabled = false,
  className,
}: GradeResultCardProps) {
  const content = (
    <>
      <GradeBadge grade={grade} filled />
      <span className="flex flex-col gap-px flex-1 min-w-0">
        <span className="text-body font-semibold text-strong">{number}번</span>
        {concept && (
          <span className="text-caption text-ink-600 overflow-hidden text-ellipsis whitespace-nowrap">
            {concept}
          </span>
        )}
      </span>
      {causes && causes.length > 0 && (
        <span className="flex items-center justify-end gap-1 flex-wrap">
          {causes.map((c) => (
            <CauseTag key={String(c)} cause={c} size="sm" />
          ))}
        </span>
      )}
      {seconds != null && (
        <span className="num text-sm leading-none text-ink-600 text-right whitespace-nowrap flex-none">
          {fmt(seconds)}
        </span>
      )}
    </>
  )

  if (!onClick) return <div className={cn(FRAME, className)}>{content}</div>

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cn(FRAME, INTERACTIVE, className)}>
      {content}
    </button>
  )
}
