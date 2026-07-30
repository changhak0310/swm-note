'use client'

// 푸리 DS — ReviewChecks. 회독 체크 □1□2□3.
// 3회 연속 정답이면 아카이브로 졸업, 한 번 틀리면 리셋.
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const boxVariants = cva(
  'grid place-items-center p-0 rounded-sm border-[1.5px] num font-semibold ' +
    'transition-[background,color] duration-[var(--dur-fast)] ease-out ' +
    'disabled:cursor-default not-disabled:cursor-pointer',
  {
    variants: {
      size: {
        // 글자 크기는 지름의 42%, 체크 아이콘은 50% (원본 비율 유지)
        sm: 'size-6 text-[10.08px]',
        md: 'size-7 text-[11.76px]',
        lg: 'size-[34px] text-[14.28px]',
      },
      done: {
        true: 'bg-brand text-invert border-brand',
        false: 'bg-paper text-faint border-border-strong',
      },
    },
    defaultVariants: { size: 'md', done: false },
  },
)

const CHECK_SIZE = { sm: 12, md: 14, lg: 17 } as const

export type ReviewChecksProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'onToggle'> &
  Pick<VariantProps<typeof boxVariants>, 'size'> & {
    /** 완료한 회독 수 */
    count?: number
    total?: number
    /** 졸업 pill을 붙인다 */
    graduated?: boolean
    onToggle?: (round: number) => void
  }

export function ReviewChecks({
  count = 0,
  total = 3,
  size,
  graduated = false,
  onToggle,
  className,
  ...rest
}: ReviewChecksProps) {
  const check = CHECK_SIZE[size ?? 'md']

  return (
    <div className={cn('inline-flex items-center gap-2', className)} {...rest}>
      {Array.from({ length: total }).map((_, i) => {
        const done = i < count
        return (
          <button
            key={i}
            type="button"
            onClick={onToggle ? () => onToggle(i + 1) : undefined}
            aria-label={`${i + 1}회독${done ? ' 완료' : ''}`}
            title={`${i + 1}회독`}
            disabled={!onToggle}
            className={boxVariants({ size, done })}
          >
            {done ? (
              <svg
                width={check}
                height={check}
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
        <span className="ml-1 px-[9px] py-[3px] rounded-pill text-caption font-semibold text-brand-ink bg-brand-tint">
          졸업 · 아카이브
        </span>
      )}
    </div>
  )
}
