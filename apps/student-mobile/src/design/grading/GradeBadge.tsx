// 푸리 DS — GradeBadge. O/△/X는 아이콘이 아니라 브랜드 프리미티브(링 + 마크)다.
// O = 완전히 맞음, △ = 맞았지만 아쉬움, X = 해설·원인 필요.
import type { CSSProperties } from 'react'

export type Grade = 'O' | 'triangle' | 'X'
export type GradeInput = Grade | 'o' | '△' | 'tri' | 'partial' | 'x'
type Size = 'sm' | 'md' | 'lg'

const grades: Record<Grade, { mark: string; color: string; bg: string; ring: string; label: string }> = {
  O: {
    mark: 'O',
    color: 'var(--grade-o)',
    bg: 'var(--grade-o-bg)',
    ring: 'var(--grade-o-ring)',
    label: '완전히 맞음',
  },
  triangle: {
    mark: '△',
    color: 'var(--grade-tri)',
    bg: 'var(--grade-tri-bg)',
    ring: 'var(--grade-tri-ring)',
    label: '맞았지만 아쉬움',
  },
  X: {
    mark: 'X',
    color: 'var(--grade-x)',
    bg: 'var(--grade-x-bg)',
    ring: 'var(--grade-x-ring)',
    label: '해설·원인 필요',
  },
}

const alias: Record<string, Grade> = { o: 'O', '△': 'triangle', tri: 'triangle', partial: 'triangle', x: 'X' }

const dims: Record<Size, { d: number; fs: number; bw: number }> = {
  sm: { d: 28, fs: 15, bw: 2 },
  md: { d: 40, fs: 22, bw: 2.5 },
  lg: { d: 56, fs: 30, bw: 3 },
}

export type GradeBadgeProps = {
  grade?: GradeInput
  size?: Size
  filled?: boolean
  style?: CSSProperties
}

export function GradeBadge({ grade = 'O', size = 'md', filled = false, style }: GradeBadgeProps) {
  const key: Grade = grade in grades ? (grade as Grade) : (alias[grade] ?? 'O')
  const g = grades[key]
  const s = dims[size]

  return (
    <span
      role="img"
      aria-label={`채점 ${g.mark} — ${g.label}`}
      title={g.label}
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        flex: 'none',
        width: s.d,
        height: s.d,
        borderRadius: 'var(--radius-pill)',
        background: filled ? g.bg : 'transparent',
        border: `${s.bw}px solid ${g.ring}`,
        color: g.color,
        fontFamily: 'var(--font-sans)',
        fontWeight: 700,
        fontSize: s.fs,
        lineHeight: 1,
        letterSpacing: 0,
        // △는 시각 중심이 위라 살짝 내린다
        paddingTop: key === 'triangle' ? s.d * 0.04 : 0,
        ...style,
      }}
    >
      {g.mark}
    </span>
  )
}
