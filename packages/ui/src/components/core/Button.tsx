'use client'

// 푸리 DS — Button. primary는 화면당 하나만.
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  // 높이가 36/44/52라도 탭 타깃은 44px 아래로 내려가지 않는다 (README §VISUAL FOUNDATIONS)
  // `leading-none`은 반드시 size의 text-* **뒤에** 온다 — Tailwind v4의 text-*는 행간까지
  // 같이 정해서, 앞에 두면 cn()이 뒤의 text-*로 덮으며 지워버린다 (행간이 1 → 24px가 된다).
  // 포커스는 3px 초록 글로우다 — 브라우저 기본 파란 아웃라인을 쓰지 않는다 (README §VISUAL FOUNDATIONS).
  // focus-visible이라 마우스 클릭에는 안 뜨고 키보드 이동에만 뜬다.
  // 글자 버튼은 알약, 아이콘 버튼(IconButton·Toggle)은 사각 — 둘을 모양으로 갈라
  // "읽고 누르는 것"과 "도구"를 구분한다. Chip·CauseTag도 알약이지만 크기·틴트가 달라 섞이지 않는다.
  'inline-flex items-center justify-center gap-2 min-h-[var(--tap-min)] font-sans font-semibold ' +
    'tracking-[var(--track-normal)] rounded-pill border select-none cursor-pointer ' +
    'transition-[background,transform,box-shadow] duration-[var(--dur-fast)] ease-out ' +
    'outline-none focus-visible:shadow-focus ' +
    'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      // 경계를 만드는 수단은 하나다 — 보더를 쓰면 그림자를 얹지 않는다 (README §5 Remove unnecessary styles).
      variant: {
        primary: 'bg-brand text-invert border-transparent shadow-xs hover:bg-brand-hover active:bg-brand-press',
        secondary: 'bg-paper text-strong border-border hover:bg-surface-hover active:bg-ink-150',
        ghost: 'bg-transparent text-default border-transparent hover:bg-surface-hover active:bg-ink-150',
        // 캔버스 위에 떠서 눈에 띄어야 하는 액션(플로팅 알약 등). 초록을 쓰면 "정답/진행"
        // 신호와 섞이므로 잉크색을 쓴다 — 색은 진단이라는 원칙(README §색)을 지키기 위한 변형이다.
        inverse: 'bg-strong text-invert border-transparent shadow-xs hover:bg-ink-950 active:bg-ink-950',
        danger:
          'bg-destructive text-invert border-transparent shadow-xs hover:bg-destructive-hover active:bg-destructive-press',
      },
      size: {
        sm: 'h-9 px-3.5 text-sm leading-none',
        md: 'h-11 px-5 text-body leading-none',
        lg: 'h-13 px-6.5 text-body-lg leading-none',
      },
      block: {
        true: 'flex w-full',
        false: 'inline-flex w-auto',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
)

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /** 라벨 앞 아이콘 */
    icon?: ReactNode
    /** 라벨 뒤 아이콘 */
    iconRight?: ReactNode
    /** 버튼 대신 자식 엘리먼트에 스타일을 입힌다 (링크를 버튼처럼 보이게 할 때) */
    asChild?: boolean
  }

export function Button({
  children,
  variant,
  size,
  block,
  icon = null,
  iconRight = null,
  asChild = false,
  className,
  ...rest
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp className={cn(buttonVariants({ variant, size, block }), className)} {...rest}>
      {icon && <span className="inline-flex flex-none">{icon}</span>}
      {children != null && <span>{children}</span>}
      {iconRight && <span className="inline-flex flex-none">{iconRight}</span>}
    </Comp>
  )
}

export { buttonVariants }
