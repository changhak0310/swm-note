'use client'

// 푸리 DS — CauseTag. 오답 원인 5태그, 1축. 각 태그가 고유 색을 갖고 칩으로만 쓰인다.
// 자가진단(선택형)과 AI 대조(정적) 양쪽에 쓴다.
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

export type CauseKey = 'concept' | 'calc' | 'condition' | 'approach' | 'time'
export type CauseInput = CauseKey | '개념' | '계산' | '조건' | '접근' | '시간'

export const CAUSES: Record<CauseKey, { label: string; hash: string; desc: string }> = {
  concept: { label: '개념', hash: '#개념', desc: '개념/공식을 몰라서' },
  calc: { label: '계산', hash: '#계산', desc: '알았는데 계산 실수' },
  condition: { label: '조건', hash: '#조건', desc: '문제 조건을 놓침' },
  approach: { label: '접근', hash: '#접근', desc: '어떻게 시작할지 몰라서' },
  time: { label: '시간', hash: '#시간', desc: '시간이 없어서/오래 걸려서' },
}

const alias: Record<string, CauseKey> = {
  개념: 'concept',
  계산: 'calc',
  조건: 'condition',
  접근: 'approach',
  시간: 'time',
}

const tagVariants = cva(
  'inline-flex items-center gap-[5px] rounded-pill border-[1.5px] font-semibold ' +
    'whitespace-nowrap tracking-[var(--track-normal)] ' +
    'transition-[background,opacity] duration-[var(--dur-fast)] ease-out',
  {
    variants: {
      cause: {
        concept: 'text-tag-concept',
        calc: 'text-tag-calc',
        condition: 'text-tag-condition',
        approach: 'text-tag-approach',
        time: 'text-tag-time',
      },
      size: {
        sm: 'px-2.5 py-[3px] text-caption leading-none',
        md: 'px-3 py-[5px] text-sm leading-none',
      },
      /** 선택 가능한 미선택 칩은 아웃라인, 선택되었거나 정적인 칩은 틴트 채움 */
      filled: { true: 'border-transparent', false: 'bg-transparent' },
      clickable: { true: 'cursor-pointer', false: 'cursor-default' },
    },
    compoundVariants: [
      { cause: 'concept', filled: true, class: 'bg-tag-concept-bg' },
      { cause: 'calc', filled: true, class: 'bg-tag-calc-bg' },
      { cause: 'condition', filled: true, class: 'bg-tag-condition-bg' },
      { cause: 'approach', filled: true, class: 'bg-tag-approach-bg' },
      { cause: 'time', filled: true, class: 'bg-tag-time-bg' },
      { cause: 'concept', filled: false, class: 'border-tag-concept opacity-85' },
      { cause: 'calc', filled: false, class: 'border-tag-calc opacity-85' },
      { cause: 'condition', filled: false, class: 'border-tag-condition opacity-85' },
      { cause: 'approach', filled: false, class: 'border-tag-approach opacity-85' },
      { cause: 'time', filled: false, class: 'border-tag-time opacity-85' },
    ],
    defaultVariants: { size: 'md', filled: true, clickable: false },
  },
)

export type CauseTagProps = Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> &
  Pick<VariantProps<typeof tagVariants>, 'size'> & {
    cause?: CauseInput
    selected?: boolean
    /** 자가진단처럼 고를 수 있는 칩으로 만든다 */
    interactive?: boolean
  }

export { tagVariants }

export function CauseTag({
  cause = 'calc',
  selected = false,
  size,
  interactive = false,
  onClick,
  className,
  ...rest
}: CauseTagProps) {
  const key: CauseKey = cause in CAUSES ? (cause as CauseKey) : (alias[cause] ?? 'calc')
  const c = CAUSES[key]
  const clickable = interactive || !!onClick
  const filled = selected || !clickable

  return (
    <span
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      aria-pressed={clickable ? selected : undefined}
      title={c.desc}
      className={cn(tagVariants({ cause: key, size, filled, clickable }), className)}
      {...rest}
    >
      <span className="opacity-55 font-medium">#</span>
      {c.label}
    </span>
  )
}
