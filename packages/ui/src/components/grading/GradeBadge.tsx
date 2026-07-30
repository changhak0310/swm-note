'use client'

// 푸리 DS — GradeBadge. O/△/X는 아이콘이 아니라 브랜드 프리미티브(링 + 마크)다.
// O = 완전히 맞음, △ = 맞았지만 아쉬움, X = 해설·원인 필요.
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

export type Grade = 'O' | 'triangle' | 'X'
export type GradeInput = Grade | 'o' | '△' | 'tri' | 'partial' | 'x'

const marks: Record<Grade, { mark: string; label: string }> = {
  O: { mark: 'O', label: '완전히 맞음' },
  triangle: { mark: '△', label: '맞았지만 아쉬움' },
  X: { mark: 'X', label: '해설·원인 필요' },
}

const alias: Record<string, Grade> = { o: 'O', '△': 'triangle', tri: 'triangle', partial: 'triangle', x: 'X' }

const badgeVariants = cva('inline-grid place-items-center flex-none rounded-pill font-sans font-bold tracking-normal', {
  variants: {
    grade: {
      O: 'text-grade-o border-grade-o-ring',
      triangle: 'text-grade-tri border-grade-tri-ring',
      X: 'text-grade-x border-grade-x-ring',
    },
    size: {
      sm: 'size-7 text-[15px] leading-none border-2',
      md: 'size-10 text-[22px] leading-none border-[2.5px]',
      lg: 'size-14 text-[30px] leading-none border-[3px]',
    },
    filled: { true: '', false: 'bg-transparent' },
  },
  compoundVariants: [
    { grade: 'O', filled: true, class: 'bg-grade-o-bg' },
    { grade: 'triangle', filled: true, class: 'bg-grade-tri-bg' },
    { grade: 'X', filled: true, class: 'bg-grade-x-bg' },
    // △는 시각 중심이 위라 지름의 4%만큼 내린다
    { grade: 'triangle', size: 'sm', class: 'pt-[1.12px]' },
    { grade: 'triangle', size: 'md', class: 'pt-[1.6px]' },
    { grade: 'triangle', size: 'lg', class: 'pt-[2.24px]' },
  ],
  defaultVariants: { size: 'md', filled: false },
})

export type GradeBadgeProps = Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> &
  Omit<VariantProps<typeof badgeVariants>, 'grade'> & {
    grade?: GradeInput
  }

export { badgeVariants }

export function GradeBadge({ grade = 'O', size, filled, className, ...rest }: GradeBadgeProps) {
  const key: Grade = grade in marks ? (grade as Grade) : (alias[grade] ?? 'O')
  const g = marks[key]

  return (
    <span
      role="img"
      aria-label={`채점 ${g.mark} — ${g.label}`}
      title={g.label}
      className={cn(badgeVariants({ grade: key, size, filled }), className)}
      {...rest}
    >
      {g.mark}
    </span>
  )
}
