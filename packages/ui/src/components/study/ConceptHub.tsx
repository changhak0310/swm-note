'use client'

// 푸리 DS — ConceptHub. 약점개념 허브: 단원별 그룹, 틀린 횟수 내림차순,
// 허브 전체 최다 약점 하나를 최다로 강조. 점수가 아니라 "몰린 곳"을 보여준다.
import type { CSSProperties } from 'react'

export type HubConcept = { name: string; count: number }
export type HubUnit = { name: string; concepts: HubConcept[] }

export type ConceptHubProps = {
  title?: string
  units?: HubUnit[]
  maxDots?: number
  style?: CSSProperties
}

export function ConceptHub({ title = '약점개념 허브', units = [], maxDots = 8, style }: ConceptHubProps) {
  let top: HubConcept | null = null
  for (const u of units) {
    for (const c of u.concepts) {
      if (!top || c.count > top.count) top = c
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        width: 360,
        background: 'var(--surface-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: 20,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: 'var(--text-h3)', fontWeight: 600, color: 'var(--text-strong)' }}>
          {title}
        </span>
        <span style={{ fontSize: 'var(--text-caption)', color: 'var(--text-faint)' }}>카운트 높은 순</span>
      </div>

      {units.map((u) => (
        <div key={u.name} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span
            style={{
              fontSize: 'var(--text-caption)',
              fontWeight: 600,
              letterSpacing: 'var(--track-wide)',
              color: 'var(--text-muted)',
            }}
          >
            {u.name}
          </span>
          {[...u.concepts]
            .sort((a, b) => b.count - a.count)
            .map((c) => {
              const isTop = top !== null && c === top
              return (
                <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 'var(--text-body)',
                      color: isTop ? 'var(--text-strong)' : 'var(--text-default)',
                      fontWeight: isTop ? 600 : 400,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {c.name}
                  </span>
                  <span style={{ display: 'inline-flex', gap: 3, flex: 'none' }}>
                    {Array.from({ length: Math.min(maxDots, c.count) }).map((_, i) => (
                      <span
                        key={i}
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 'var(--radius-pill)',
                          background: isTop ? 'var(--grade-x)' : 'var(--brand)',
                        }}
                      />
                    ))}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-numeric)',
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: 'var(--text-sm)',
                      color: 'var(--text-muted)',
                      width: 30,
                      textAlign: 'right',
                      flex: 'none',
                    }}
                  >
                    {c.count}회
                  </span>
                  {isTop && (
                    <span
                      style={{
                        fontSize: 'var(--text-caption)',
                        fontWeight: 600,
                        color: 'var(--grade-x)',
                        background: 'var(--grade-x-bg)',
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-pill)',
                        flex: 'none',
                      }}
                    >
                      최다
                    </span>
                  )}
                </div>
              )
            })}
        </div>
      ))}
    </div>
  )
}
