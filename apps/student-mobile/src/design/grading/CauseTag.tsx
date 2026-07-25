// 푸리 DS — CauseTag. 오답 원인 5태그, 1축. 각 태그가 고유 색을 갖고 칩으로만 쓰인다.
// 자가진단(선택형)과 AI 대조(정적) 양쪽에 쓴다.
import type { CSSProperties } from 'react'

export type CauseKey = 'concept' | 'calc' | 'condition' | 'approach' | 'time'
export type CauseInput = CauseKey | '개념' | '계산' | '조건' | '접근' | '시간'
type Size = 'sm' | 'md'

export const CAUSES: Record<CauseKey, { label: string; hash: string; fg: string; bg: string; desc: string }> = {
  concept: {
    label: '개념',
    hash: '#개념',
    fg: 'var(--tag-concept)',
    bg: 'var(--tag-concept-bg)',
    desc: '개념/공식을 몰라서',
  },
  calc: {
    label: '계산',
    hash: '#계산',
    fg: 'var(--tag-calc)',
    bg: 'var(--tag-calc-bg)',
    desc: '알았는데 계산 실수',
  },
  condition: {
    label: '조건',
    hash: '#조건',
    fg: 'var(--tag-condition)',
    bg: 'var(--tag-condition-bg)',
    desc: '문제 조건을 놓침',
  },
  approach: {
    label: '접근',
    hash: '#접근',
    fg: 'var(--tag-approach)',
    bg: 'var(--tag-approach-bg)',
    desc: '어떻게 시작할지 몰라서',
  },
  time: {
    label: '시간',
    hash: '#시간',
    fg: 'var(--tag-time)',
    bg: 'var(--tag-time-bg)',
    desc: '시간이 없어서/오래 걸려서',
  },
}

const alias: Record<string, CauseKey> = {
  개념: 'concept',
  계산: 'calc',
  조건: 'condition',
  접근: 'approach',
  시간: 'time',
}

export type CauseTagProps = {
  cause?: CauseInput
  selected?: boolean
  size?: Size
  interactive?: boolean
  onClick?: () => void
  style?: CSSProperties
}

export function CauseTag({
  cause = 'calc',
  selected = false,
  size = 'md',
  interactive = false,
  onClick,
  style,
}: CauseTagProps) {
  const key: CauseKey = cause in CAUSES ? (cause as CauseKey) : (alias[cause] ?? 'calc')
  const c = CAUSES[key]
  const clickable = interactive || !!onClick
  // 선택 가능한 미선택 칩은 아웃라인, 선택/정적 칩은 틴트 채움
  const filled = selected || !clickable

  return (
    <span
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      title={c.desc}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: size === 'sm' ? '3px 10px' : '5px 12px',
        borderRadius: 'var(--radius-pill)',
        fontSize: size === 'sm' ? 'var(--text-caption)' : 'var(--text-sm)',
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        letterSpacing: 'var(--track-normal)',
        color: c.fg,
        background: filled ? c.bg : 'transparent',
        border: `1.5px solid ${filled ? 'transparent' : c.fg}`,
        opacity: clickable && !selected ? 0.85 : 1,
        cursor: clickable ? 'pointer' : 'default',
        transition:
          'background var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out)',
        ...style,
      }}
    >
      <span style={{ opacity: 0.55, fontWeight: 500 }}>#</span>
      {c.label}
    </span>
  )
}
