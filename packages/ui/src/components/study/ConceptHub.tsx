'use client'

// 푸리 DS — ConceptHub. 약점개념 허브: 단원별 그룹, 틀린 횟수 내림차순,
// 허브 전체 최다 약점 하나를 최다로 강조. 점수가 아니라 "몰린 곳"을 보여준다.
import { cn } from '../../lib/utils'

export type HubConcept = { name: string; count: number }
export type HubUnit = { name: string; concepts: HubConcept[] }

export type ConceptHubProps = React.HTMLAttributes<HTMLDivElement> & {
  title?: string
  units?: HubUnit[]
  /** 점으로 표시하는 최대 개수 — 넘으면 숫자만 늘어난다 */
  maxDots?: number
}

export function ConceptHub({
  title = '약점개념 허브',
  units = [],
  maxDots = 8,
  className,
  ...rest
}: ConceptHubProps) {
  let top: HubConcept | null = null
  for (const u of units) {
    for (const c of u.concepts) {
      if (!top || c.count > top.count) top = c
    }
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-[18px] w-90 p-5 bg-card border border-border-subtle rounded-lg shadow-sm',
        className,
      )}
      {...rest}
    >
      <div className="flex items-baseline justify-between gap-2.5">
        <span className="text-h3 font-semibold text-strong">{title}</span>
        <span className="text-caption text-faint">카운트 높은 순</span>
      </div>

      {units.map((u) => (
        <div key={u.name} className="flex flex-col gap-2.5">
          <span className="text-caption font-semibold tracking-[var(--track-wide)] text-muted-foreground">
            {u.name}
          </span>
          {[...u.concepts]
            .sort((a, b) => b.count - a.count)
            .map((c) => {
              const isTop = top !== null && c === top
              return (
                <div key={c.name} className="flex items-center gap-3">
                  <span
                    className={cn(
                      'flex-1 min-w-0 text-body whitespace-nowrap overflow-hidden text-ellipsis',
                      isTop ? 'text-strong font-semibold' : 'text-default',
                    )}
                  >
                    {c.name}
                  </span>
                  <span className="inline-flex gap-[3px] flex-none">
                    {Array.from({ length: Math.min(maxDots, c.count) }).map((_, i) => (
                      <span
                        key={i}
                        className={cn('size-1.5 rounded-pill', isTop ? 'bg-grade-x' : 'bg-brand')}
                      />
                    ))}
                  </span>
                  <span className="num text-sm text-muted-foreground w-[30px] text-right flex-none">
                    {c.count}회
                  </span>
                  {isTop && (
                    <span className="px-2 py-0.5 rounded-pill text-caption font-semibold text-grade-x bg-grade-x-bg flex-none">
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
