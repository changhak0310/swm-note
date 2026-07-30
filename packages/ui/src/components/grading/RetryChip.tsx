'use client'

// 푸리 DS — RetryChip. 틀린 문항을 다시 풀러 들어가는 칩.
// 3회 연속 정답이면 졸업 — 그때만 초록으로 바뀐다. 그 전에는 X의 연한 붉은 톤을 유지해
// "아직 남아 있다"를 조용히 알린다(README §색: 색은 진단이다).
import { cn } from '../../lib/utils'

const Refresh = () => (
  <svg
    width="17"
    height="17"
    viewBox="0 0 24 24"
    fill="none"
    stroke="var(--text-brand)"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
)

export type RetryChipProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** 문항 표시 — "12번" */
  label: string
  /** 몇 쪽에 있는지. 없으면 생략한다 */
  page?: number
  /** 연속 정답 횟수 */
  consec?: number
  /** 졸업 기준 (기본 3회) */
  total?: number
  graduated?: boolean
}

export function RetryChip({
  label,
  page,
  consec = 0,
  total = 3,
  graduated = false,
  className,
  ...rest
}: RetryChipProps) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-2 px-4 py-[11px] rounded-md border cursor-pointer',
        'transition-[background] duration-[var(--dur-fast)] ease-out',
        graduated
          ? 'border-[var(--green-300)] bg-[var(--green-100)]'
          : 'border-grade-x-ring bg-grade-x-bg',
        className,
      )}
      {...rest}
    >
      <span className="text-body font-bold text-strong">{label}</span>
      {page != null && <span className="text-sm text-muted-foreground">p{page}</span>}
      <span
        className={cn('num text-caption font-semibold', graduated ? 'text-brand-ink' : 'text-muted-foreground')}
      >
        {graduated ? '졸업' : `${consec}/${total}`}
      </span>
      <Refresh />
    </button>
  )
}
