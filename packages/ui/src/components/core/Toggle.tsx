'use client'

// 푸리 DS — Toggle. 켜짐/꺼짐 상태를 가진 정사각·원형 버튼.
// 도구 팔레트(펜·형광펜·지우개)와 선지 고르기(①~⑤)가 같은 것을 서로 다르게 그리고 있었다.
//
// Radix Toggle을 쓰지 않는다 — 이 컴포넌트가 필요로 하는 건 `aria-pressed` 하나뿐이고,
// 그건 button이 이미 준다. 의존성을 하나 더 들이는 값이 없다.
// (여러 개 중 하나만 고르는 라디오 성격이 필요해지면 그때 Radix ToggleGroup으로 간다.)
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const toggleVariants = cva(
  'inline-grid place-items-center flex-none p-0 cursor-pointer ' +
    'transition-[background,color,box-shadow] duration-[var(--dur-fast)] ease-out ' +
    'outline-none focus-visible:shadow-focus ' +
    'disabled:cursor-not-allowed disabled:text-faint disabled:pointer-events-none',
  {
    variants: {
      /** tint = 도구 팔레트(켜지면 연한 브랜드 배경) · solid = 선택지(켜지면 브랜드로 채움) */
      variant: { tint: '', solid: 'border-[1.5px]' },
      shape: { square: 'rounded-md', circle: 'rounded-pill' },
      size: { sm: 'size-9', md: 'size-11', lg: 'size-12' },
      pressed: { true: '', false: '' },
    },
    compoundVariants: [
      { variant: 'tint', pressed: true, class: 'bg-brand-tint text-default' },
      { variant: 'tint', pressed: false, class: 'bg-transparent text-default hover:bg-surface-hover' },
      { variant: 'solid', pressed: true, class: 'bg-brand text-invert border-brand' },
      {
        variant: 'solid',
        pressed: false,
        class: 'bg-paper text-default border-border-strong hover:bg-surface-hover',
      },
    ],
    defaultVariants: { variant: 'tint', shape: 'square', size: 'md', pressed: false },
  },
)

export type ToggleProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> &
  VariantProps<typeof toggleVariants> & {
    /** 아이콘만 있는 경우가 많아 필수다 */
    label: string
    pressed?: boolean
  }

export function Toggle({
  children,
  label,
  variant,
  shape,
  size,
  pressed = false,
  className,
  ...rest
}: ToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      className={cn(toggleVariants({ variant, shape, size, pressed }), className)}
      {...rest}
    >
      {children}
    </button>
  )
}

export { toggleVariants }
