// 채점 결과 오버레이 (F-08·F-09) — 시안2의 손그림 O·사선 + 회차 칩
// numBox 위에 그린다. 새로 잡을 좌표가 없다.
import type { Attempt, Region } from '../types'
import { MAX_W } from '../lib/geometry'
import { useInkStore } from '../stores/inkStore'
import { useDocumentStore } from '../stores/documentStore'

type Props = {
  regions: Region[]
  width: number
  height: number
}

export function GradeOverlay({ regions, width, height }: Props) {
  const attemptsAll = useDocumentStore((s) => s.attemptsAll)
  const resolvingRegionId = useDocumentStore((s) => s.resolvingRegionId)
  const rounds = useInkStore((s) => s.rounds)
  const viewRounds = useInkStore((s) => s.viewRounds)
  const revealRegionId = useInkStore((s) => s.revealRegionId)
  const setViewRound = useInkStore((s) => s.setViewRound)

  const normH = height / (width / MAX_W)

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={width}
      height={height}
      viewBox={`0 0 ${MAX_W} ${normH}`}
    >
      {regions.map((r) => {
        const history = (attemptsAll[r.id] ?? []).filter(
          (a) => a.result === 'correct' || a.result === 'incorrect',
        )
        const maxNo = history.reduce((m, a) => Math.max(m, a.no), 0)
        const shownNo = viewRounds[r.id] ?? maxNo
        const att = history.find((a) => a.no === shownNo)
        const resolving = resolvingRegionId === r.id
        const currentRound = rounds[r.id] ?? 1

        return (
          <g key={r.id}>
            {att && <HandMark region={r} attempt={att} />}

            {/* 회차 칩 — 2회차 이상인 문제에만 (F-09). 탭하면 회차 전환 */}
            {maxNo >= 2 && (
              <g
                className="pointer-events-auto cursor-pointer"
                onClick={() => {
                  const next = shownNo > 1 ? shownNo - 1 : maxNo
                  setViewRound(r.id, next === maxNo ? null : next)
                }}
              >
                <rect
                  x={r.bounds.x + r.bounds.w - 64}
                  y={r.bounds.y + 2}
                  width={60}
                  height={22}
                  rx={11}
                  fill="var(--brand-tint)"
                />
                <text
                  x={r.bounds.x + r.bounds.w - 34}
                  y={r.bounds.y + 17}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight={600}
                  fill="var(--text-brand)"
                  fontFamily="var(--font-numeric)"
                >
                  {shownNo}차 {att ? (att.result === 'correct' ? '○' : '✗') : '·'}
                </text>
              </g>
            )}

            {/* 재풀이 중 표시 (시안2) — 좌측 그린 바 + 지난 풀이 숨김 라벨 */}
            {resolving && (
              <>
                <rect
                  x={r.bounds.x - 14}
                  y={r.bounds.y}
                  width={4}
                  height={r.bounds.h}
                  rx={2}
                  fill="var(--brand)"
                />
                {revealRegionId !== r.id && maxNo >= 1 && currentRound > maxNo && (
                  <g>
                    <rect
                      x={r.bounds.x}
                      y={r.bounds.y + r.bounds.h - 24}
                      width={92}
                      height={20}
                      rx={10}
                      fill="var(--surface-mask)"
                    />
                    <text
                      x={r.bounds.x + 46}
                      y={r.bounds.y + r.bounds.h - 10}
                      textAnchor="middle"
                      fontSize={11}
                      fill="var(--text-muted)"
                    >
                      지난 풀이 숨김
                    </text>
                  </g>
                )}
              </>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** 시안2의 손그림 채점 마크 — 56 viewBox 패스를 numBox에 맞춰 스케일한다 */
function HandMark({ region, attempt }: { region: Region; attempt: Attempt }) {
  const box = region.numBox ?? { x: region.bounds.x, y: region.bounds.y, w: 24, h: 24 }
  const size = Math.min(Math.max(Math.max(box.w, box.h) * 2.4, 34), 64)
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const s = size / 56

  return (
    <g
      transform={`translate(${cx - size / 2}, ${cy - size / 2}) scale(${s})`}
      fill="none"
      opacity={0.9}
    >
      {attempt.result === 'correct' ? (
        <path
          d="M31 9C18 7 9 18 11 30c2 12 19 19 31 12 11-6 9-25-3-33-6-4-15-4-21 2"
          stroke="var(--grade-o)"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ strokeDasharray: 220, strokeDashoffset: 0, animation: 'puriInk .55s .1s var(--ease-out)' }}
        />
      ) : (
        <path
          d="M15 44C24 34 33 22 43 11"
          stroke="var(--grade-x)"
          strokeWidth={4.6}
          strokeLinecap="round"
          style={{ strokeDasharray: 220, strokeDashoffset: 0, animation: 'puriInk .4s .1s var(--ease-out)' }}
        />
      )}
    </g>
  )
}
