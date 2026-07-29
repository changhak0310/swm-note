'use client'

// 푸리 DS — Input. 라벨·힌트·에러·선행 아이콘. 초록 포커스 글로우.
import { useId, useState, type ReactNode } from 'react'

type Size = 'sm' | 'md' | 'lg'

export type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  label?: string
  hint?: string
  error?: string
  icon?: ReactNode
  size?: Size
  containerStyle?: React.CSSProperties
}

export function Input({
  label,
  hint,
  error,
  icon = null,
  size = 'md',
  containerStyle,
  id,
  ...rest
}: InputProps) {
  const [focus, setFocus] = useState(false)
  const autoId = useId()
  const rid = id ?? autoId
  const h = size === 'lg' ? 52 : size === 'sm' ? 38 : 44
  const borderColor = error
    ? 'var(--danger)'
    : focus
      ? 'var(--border-focus)'
      : 'var(--border-default)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...containerStyle }}>
      {label && (
        <label
          htmlFor={rid}
          style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-default)' }}
        >
          {label}
        </label>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: h,
          padding: '0 14px',
          background: 'var(--paper)',
          border: `1px solid ${borderColor}`,
          borderRadius: 'var(--radius-md)',
          boxShadow: focus ? 'var(--shadow-focus)' : 'none',
          transition:
            'border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)',
        }}
      >
        {icon && (
          <span style={{ display: 'inline-flex', color: 'var(--text-faint)', flex: 'none' }}>
            {icon}
          </span>
        )}
        <input
          id={rid}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-body)',
            color: 'var(--text-strong)',
            letterSpacing: 'var(--track-normal)',
          }}
          {...rest}
        />
      </div>
      {(hint || error) && (
        <span
          style={{
            fontSize: 'var(--text-caption)',
            color: error ? 'var(--danger)' : 'var(--text-muted)',
          }}
        >
          {error || hint}
        </span>
      )}
    </div>
  )
}
