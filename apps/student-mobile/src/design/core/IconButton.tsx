// 푸리 DS — IconButton. 아이콘 전용 정사각 버튼. label은 필수(접근성).
import { useState, type CSSProperties } from 'react'

type Size = 'sm' | 'md' | 'lg'
type Variant = 'ghost' | 'solid' | 'outline'

const sizes: Record<Size, number> = { sm: 36, md: 44, lg: 52 }

export type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  size?: Size
  variant?: Variant
}

export function IconButton({
  children,
  label,
  size = 'md',
  variant = 'ghost',
  disabled = false,
  style,
  ...rest
}: IconButtonProps) {
  const [hover, setHover] = useState(false)
  const [active, setActive] = useState(false)
  const d = sizes[size]

  const bg =
    variant === 'solid'
      ? active
        ? 'var(--brand-press)'
        : hover
          ? 'var(--brand-hover)'
          : 'var(--brand)'
      : active
        ? 'var(--ink-150)'
        : hover
          ? 'var(--surface-hover)'
          : 'transparent'

  const composed: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: d,
    height: d,
    minWidth: d,
    minHeight: d,
    borderRadius: 'var(--radius-md)',
    background: bg,
    color: variant === 'solid' ? 'var(--text-invert)' : 'var(--text-default)',
    border: variant === 'outline' ? '1px solid var(--border-default)' : '1px solid transparent',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    transition: 'background var(--dur-fast) var(--ease-out)',
    padding: 0,
    ...style,
  }

  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false)
        setActive(false)
      }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      style={composed}
      {...rest}
    >
      {children}
    </button>
  )
}
