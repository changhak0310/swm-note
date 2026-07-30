'use client'

// 푸리 DS — Input. 라벨·힌트·에러·선행 아이콘. 초록 포커스 글로우.
import { useId, type ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

// 포커스 링은 input이 아니라 감싼 박스에 걸린다 — 아이콘까지 한 덩어리로 보이게 하려고.
const fieldVariants = cva(
  'flex items-center gap-2 px-3.5 bg-paper border rounded-md ' +
    'transition-[border-color,box-shadow] duration-[var(--dur-fast)] ease-out ' +
    'focus-within:border-ring focus-within:shadow-focus',
  {
    variants: {
      size: { sm: 'h-9.5', md: 'h-11', lg: 'h-13' },
      invalid: { true: 'border-destructive focus-within:border-destructive', false: 'border-border' },
    },
    defaultVariants: { size: 'md', invalid: false },
  },
)

export type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> &
  Omit<VariantProps<typeof fieldVariants>, 'invalid'> & {
    label?: string
    hint?: string
    /** 주면 테두리가 빨개지고 hint 대신 이게 보인다 */
    error?: string
    icon?: ReactNode
    /** 라벨·필드·힌트를 감싸는 바깥 div의 클래스 */
    containerClassName?: string
  }

export function Input({
  label,
  hint,
  error,
  icon = null,
  size,
  containerClassName,
  className,
  id,
  ...rest
}: InputProps) {
  const autoId = useId()
  const rid = id ?? autoId
  const describedBy = hint || error ? `${rid}-desc` : undefined

  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      {label && (
        <label htmlFor={rid} className="text-sm font-medium text-default">
          {label}
        </label>
      )}
      <div className={fieldVariants({ size, invalid: !!error })}>
        {icon && <span className="inline-flex flex-none text-faint">{icon}</span>}
        <input
          id={rid}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={cn(
            'flex-1 min-w-0 border-none outline-none bg-transparent',
            'font-sans text-body text-strong tracking-[var(--track-normal)]',
            className,
          )}
          {...rest}
        />
      </div>
      {(hint || error) && (
        <span id={describedBy} className={cn('text-caption', error ? 'text-destructive' : 'text-muted-foreground')}>
          {error || hint}
        </span>
      )}
    </div>
  )
}
