'use client'

// 푸리 DS — Chip. 상태·필터 토큰. 오답 원인 태그는 CauseTag를 쓴다.
import { cva, type VariantProps } from 'class-variance-authority'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

const chipVariants = cva(
  'inline-flex items-center gap-1.5 rounded-pill border font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-ink-100 text-default border-border',
        brand: 'bg-brand-tint text-brand-ink border-transparent',
        muted: 'bg-transparent text-muted-foreground border-border',
      },
      size: {
        sm: 'px-2.5 py-[3px] text-caption leading-none',
        md: 'px-3 py-[5px] text-sm leading-none',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
)

export type ChipProps = Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> &
  VariantProps<typeof chipVariants> & {
    children?: ReactNode
    icon?: ReactNode
    /** 주면 오른쪽에 × 버튼이 생긴다 */
    onRemove?: () => void
  }

export function Chip({ children, tone, size, icon = null, onRemove, className, ...rest }: ChipProps) {
  return (
    <span className={cn(chipVariants({ tone, size }), className)} {...rest}>
      {icon && <span className="inline-flex flex-none">{icon}</span>}
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="remove"
          className="inline-flex p-0 border-0 bg-transparent text-inherit opacity-60 cursor-pointer hover:opacity-100"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </span>
  )
}

export { chipVariants }
