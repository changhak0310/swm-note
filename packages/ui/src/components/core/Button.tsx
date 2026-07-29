'use client'

// 푸리 DS — Button. primary는 화면당 하나만.
import { useState, type CSSProperties, type ReactNode } from 'react'

type Size = 'sm' | 'md' | 'lg'
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const sizes: Record<Size, { height: number; padding: string; font: string }> = {
  sm: { height: 36, padding: '0 14px', font: 'var(--text-sm)' },
  md: { height: 44, padding: '0 20px', font: 'var(--text-body)' },
  lg: { height: 52, padding: '0 26px', font: 'var(--text-body-lg)' },
}

const variants: Record<
  Variant,
  { base: CSSProperties; hover: CSSProperties; active: CSSProperties }
> = {
  primary: {
    base: {
      background: 'var(--brand)',
      color: 'var(--text-invert)',
      border: '1px solid transparent',
      boxShadow: 'var(--shadow-xs)',
    },
    hover: { background: 'var(--brand-hover)' },
    active: { background: 'var(--brand-press)' },
  },
  secondary: {
    base: {
      background: 'var(--paper)',
      color: 'var(--text-strong)',
      border: '1px solid var(--border-default)',
      boxShadow: 'var(--shadow-xs)',
    },
    hover: { background: 'var(--surface-hover)' },
    active: { background: 'var(--ink-150)' },
  },
  ghost: {
    base: {
      background: 'transparent',
      color: 'var(--text-default)',
      border: '1px solid transparent',
    },
    hover: { background: 'var(--surface-hover)' },
    active: { background: 'var(--ink-150)' },
  },
  danger: {
    base: {
      background: 'var(--danger)',
      color: 'var(--text-invert)',
      border: '1px solid transparent',
      boxShadow: 'var(--shadow-xs)',
    },
    hover: { background: '#C23A3A' },
    active: { background: '#A93131' },
  },
}

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  iconRight?: ReactNode
  block?: boolean
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon = null,
  iconRight = null,
  block = false,
  disabled = false,
  style,
  ...rest
}: ButtonProps) {
  const [hover, setHover] = useState(false)
  const [active, setActive] = useState(false)
  const s = sizes[size]
  const v = variants[variant]

  const composed: CSSProperties = {
    display: block ? 'flex' : 'inline-flex',
    width: block ? '100%' : 'auto',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: s.height,
    minHeight: 'var(--tap-min)',
    padding: s.padding,
    fontFamily: 'var(--font-sans)',
    fontSize: s.font,
    fontWeight: 600,
    letterSpacing: 'var(--track-normal)',
    lineHeight: 1,
    borderRadius: 'var(--radius-md)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    transition:
      'background var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)',
    transform: active && !disabled ? 'scale(0.98)' : 'scale(1)',
    userSelect: 'none',
    ...v.base,
    ...(hover && !disabled ? v.hover : null),
    ...(active && !disabled ? v.active : null),
    ...style,
  }

  return (
    <button
      style={composed}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false)
        setActive(false)
      }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      {...rest}
    >
      {icon && <span style={{ display: 'inline-flex', flex: 'none' }}>{icon}</span>}
      {children != null && <span>{children}</span>}
      {iconRight && <span style={{ display: 'inline-flex', flex: 'none' }}>{iconRight}</span>}
    </button>
  )
}
