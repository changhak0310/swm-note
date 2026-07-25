// 푸리 DS — Checkbox. 회독 체크 □1□2□3의 기반이기도 하다.
import type { CSSProperties } from 'react'

type Size = 'sm' | 'md' | 'lg'

export type CheckboxProps = {
  checked?: boolean
  onChange?: (checked: boolean, event: React.ChangeEvent<HTMLInputElement>) => void
  label?: string
  size?: Size
  disabled?: boolean
  style?: CSSProperties
}

export function Checkbox({
  checked = false,
  onChange,
  label,
  size = 'md',
  disabled = false,
  style,
}: CheckboxProps) {
  const d = size === 'sm' ? 20 : size === 'lg' ? 28 : 24

  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        userSelect: 'none',
        ...style,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked, e)}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
      />
      <span
        style={{
          width: d,
          height: d,
          flex: 'none',
          borderRadius: 'var(--radius-sm)',
          display: 'grid',
          placeItems: 'center',
          background: checked ? 'var(--brand)' : 'var(--paper)',
          border: `1.5px solid ${checked ? 'var(--brand)' : 'var(--border-strong)'}`,
          transition:
            'background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out)',
          color: 'var(--text-invert)',
        }}
      >
        {checked && (
          <svg
            width={d * 0.6}
            height={d * 0.6}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </span>
      {label && (
        <span style={{ fontSize: 'var(--text-body)', color: 'var(--text-default)' }}>{label}</span>
      )}
    </label>
  )
}
