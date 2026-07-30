'use client'

// 푸리 DS — Checkbox. 회독 체크 □1□2□3의 기반이기도 하다.
// Radix 위에 올렸다 — 스페이스바 토글·aria-checked·라벨 연결을 직접 안 짜도 된다.
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const boxVariants = cva(
  'grid place-items-center flex-none rounded-sm border-[1.5px] text-invert cursor-pointer ' +
    'transition-[background,border-color] duration-[var(--dur-fast)] ease-out ' +
    'bg-paper border-border-strong ' +
    'data-[state=checked]:bg-brand data-[state=checked]:border-brand ' +
    'focus-visible:outline-none focus-visible:shadow-focus ' +
    'disabled:cursor-not-allowed',
  {
    variants: {
      size: { sm: 'size-5', md: 'size-6', lg: 'size-7' },
    },
    defaultVariants: { size: 'md' },
  },
)

export type CheckboxProps = Omit<
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>,
  // onChange는 button의 ChangeEventHandler라 우리 (checked: boolean) => void와 충돌한다
  'onCheckedChange' | 'checked' | 'onChange'
> &
  VariantProps<typeof boxVariants> & {
    checked?: boolean
    onChange?: (checked: boolean) => void
    label?: string
  }

export function Checkbox({
  checked = false,
  onChange,
  label,
  size,
  disabled = false,
  className,
  ...rest
}: CheckboxProps) {
  return (
    <label
      className={cn(
        'inline-flex items-center gap-2.5 select-none',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
    >
      <CheckboxPrimitive.Root
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange?.(v === true)}
        className={boxVariants({ size })}
        {...rest}
      >
        <CheckboxPrimitive.Indicator className="grid place-items-center">
          <svg
            className="size-[60%]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label && <span className="text-body text-default">{label}</span>}
    </label>
  )
}
