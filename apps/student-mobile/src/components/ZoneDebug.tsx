// 구역 색 오버레이 — 분할 결과 검증용 개발 도구
import type { Region } from '../types'
import { MAX_W } from '../lib/geometry'

// 디자인 시스템의 원인 태그 5색 + 브랜드 그린을 구역 구분색으로 재사용한다
const COLORS = ['#D63A3A', '#2F7DD1', '#D9741A', '#B8930A', '#1F9D57', '#26A65E']

type Props = {
  regions: Region[]
  width: number
  height: number
}

export function ZoneDebug({ regions, width, height }: Props) {
  const normH = height / (width / MAX_W)

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={width}
      height={height}
      viewBox={`0 0 ${MAX_W} ${normH}`}
    >
      {regions.map((r, i) => {
        const color = COLORS[i % COLORS.length]
        return (
          <g key={r.id}>
            <rect
              x={r.bounds.x}
              y={r.bounds.y}
              width={r.bounds.w}
              height={r.bounds.h}
              fill={color}
              opacity={0.12}
              stroke={color}
            />
            {r.choices.map((c) => (
              <rect
                key={c.label}
                x={c.box.x}
                y={c.box.y}
                width={c.box.w}
                height={c.box.h}
                fill="none"
                stroke={color}
                strokeDasharray="4 3"
              />
            ))}
            <text x={r.bounds.x + 4} y={r.bounds.y + 14} fill={color} fontSize={12}>
              {r.numLabel ?? r.id.slice(0, 4)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
