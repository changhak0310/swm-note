'use client'

// 푸리 DS — NavItem. 좌측 레일(--sidebar-w)의 내비게이션 한 줄.
// 아이콘 + 라벨 + 뒤쪽 배지(개수·"새 기능") 구조.
//
// div에 onClick을 다는 대신 button으로 두는 이유: 그러면 Tab으로 닿지 않고
// Enter/Space도 안 먹으며 스크린리더가 그냥 텍스트로 읽는다. 현재 화면을 알리는 것도
// 색·굵기만으로는 부족해서 `aria-current`를 함께 준다.
import { cva, type VariantProps } from 'class-variance-authority'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

const navItemVariants = cva(
  'flex w-full items-center gap-3 px-3 py-2 min-h-[var(--tap-min)] rounded-md text-left text-body ' +
    'transition-[background,box-shadow] duration-[var(--dur-fast)] ease-out ' +
    'outline-none focus-visible:shadow-focus ' +
    'disabled:pointer-events-none',
  {
    variants: {
      active: {
        true: 'bg-ink-150 font-semibold text-default',
        false: 'bg-transparent font-medium text-default hover:bg-surface-hover cursor-pointer',
      },
      /** 내용이 비었을 때처럼 존재감을 낮출 때 (빈 휴지통 등) */
      muted: { true: 'text-faint', false: '' },
    },
    defaultVariants: { active: false, muted: false },
  },
)

export type NavItemProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof navItemVariants> & {
    icon?: ReactNode
    label: string
    /** 라벨 뒤에 붙는 개수·배지 */
    trailing?: ReactNode
  }

export function NavItem({ icon, label, trailing, active, muted, className, ...rest }: NavItemProps) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      className={cn(navItemVariants({ active, muted }), className)}
      {...rest}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {trailing}
    </button>
  )
}

export { navItemVariants }
