'use client'

// 푸리 DS — IconButton. 아이콘 전용 정사각 버튼. label은 필수(접근성).
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const iconButtonVariants = cva(
  'inline-flex items-center justify-center flex-none p-0 rounded-md border cursor-pointer ' +
    'transition-[background,box-shadow] duration-[var(--dur-fast)] ease-out ' +
    'outline-none focus-visible:shadow-focus ' +
    'disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        ghost: 'bg-transparent text-default border-transparent hover:bg-surface-hover active:bg-ink-150',
        solid: 'bg-brand text-invert border-transparent hover:bg-brand-hover active:bg-brand-press',
        outline: 'bg-transparent text-default border-border hover:bg-surface-hover active:bg-ink-150',
        // 종이 위가 아니라 카드·시트 안에 놓일 때 — 배경을 살짝 파서 경계 없이 눌리는 것을 알린다
        sunken: 'bg-surface-sunken text-default border-transparent hover:bg-ink-150 active:bg-ink-200',
      },
      size: {
        sm: 'size-9',
        md: 'size-11',
        lg: 'size-13',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
)

export type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof iconButtonVariants> & {
    /** 스크린리더·툴팁에 쓰이는 이름. 아이콘만 있는 버튼이라 필수다. */
    label: string
    asChild?: boolean
  }

export function IconButton({
  children,
  label,
  variant,
  size,
  asChild = false,
  className,
  ...rest
}: IconButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      aria-label={label}
      title={label}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...rest}
    >
      {children}
    </Comp>
  )
}

export { iconButtonVariants }
