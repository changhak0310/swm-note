// 필기 중 선지 판정 오버레이 — 채점 버튼을 누르기 전에 "무엇을 골랐나"를 띄운다.
//
// 채점 결과(GradeOverlay의 O·사선)와 다른 것은 시점과 근거다. 여기서는 정답지를 보지
// 않는다 — 획이 바뀔 때마다 다시 세서 학생이 고른 번호만 보여준다. 정답과 맞는지는
// 채점이 답한다.
//
// 그래서 **채점된 회차에서는 물러난다.** 채점 마크(HandMark)도 배지도 numBox 자리를
// 쓰므로 둘이 겹치고, 그 자리의 답은 이미 O·사선이 말하고 있다. 다시풀기로 새 회차를
// 열면(아직 채점 전) 배지가 돌아온다.
import { useEffect, useMemo } from 'react'
import type { Attempt, Region } from '../types'
import { MAX_W } from '../lib/geometry'
import { detectMarks } from '../lib/liveDetect'
import { IDLE_ANALYSIS, useDocumentStore } from '../stores/documentStore'
import { useInkStore } from '../stores/inkStore'

const CIRCLED = ['①', '②', '③', '④', '⑤']

type Props = {
  page: number
  regions: Region[]
  width: number
  height: number
}

/**
 * 마크는 필기에서 파생된 값이라 저장하지 않는다 — 획이 바뀔 때마다 다시 센다.
 * 스트로크 수·문항 수 모두 페이지 단위라 매번 다시 세도 부담이 없다.
 */
export function MarkOverlay({ page, regions, width, height }: Props) {
  const strokes = useInkStore((s) => s.strokesByPage[page])
  const viewRounds = useInkStore((s) => s.viewRounds)
  const attemptsAll = useDocumentStore((s) => s.attemptsAll)
  const reportMarks = useDocumentStore((s) => s.reportMarks)
  const crops = useDocumentStore((s) => s.numCrops)

  const marks = useMemo(() => detectMarks(regions, strokes ?? []), [regions, strokes])

  // 상단 바 요약용 사본 — 화면의 진실은 위 useMemo다
  useEffect(() => {
    reportMarks(page, marks)
  }, [page, marks, reportMarks])

  const normH = height / (width / MAX_W)

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={width}
      height={height}
      viewBox={`0 0 ${MAX_W} ${normH}`}
    >
      {regions.map((r) => {
        const picked = marks[r.id]
        if (!picked || isGraded(attemptsAll[r.id], viewRounds[r.id])) return null
        const chosen = r.choices.find((c) => c.label === picked)
        return (
          <g key={r.id}>
            {/* 펜이 닿은 선지 */}
            {chosen && (
              <rect
                x={chosen.box.x}
                y={chosen.box.y}
                width={chosen.box.w}
                height={chosen.box.h}
                rx={4}
                fill="var(--brand)"
                opacity={0.12}
                stroke="var(--brand)"
                strokeWidth={1.2}
              />
            )}

            {/* 번호로 인식한 자리 — 배지가 어디서 왔는지 보이게 */}
            {r.numBox && (
              <rect
                x={r.numBox.x - 2}
                y={r.numBox.y - 2}
                width={r.numBox.w + 4}
                height={r.numBox.h + 4}
                rx={3}
                fill="none"
                stroke="var(--brand)"
                strokeWidth={1}
                strokeDasharray="3 2"
                opacity={0.75}
              />
            )}

            {/* 문제 번호 위에 "몇 번 문제인지 + 고른 번호" */}
            <PickBadge region={r} label={picked} crop={crops[r.id]} />
          </g>
        )
      })}
    </svg>
  )
}

/**
 * 지금 화면에 채점 마크가 떠 있는 문항인가 — 그러면 배지는 그리지 않는다.
 * 어느 회차가 보이는지는 GradeOverlay와 같은 규칙을 쓴다 (회차 칩으로 고른 회차,
 * 없으면 마지막 채점 회차).
 */
function isGraded(attempts: Attempt[] | undefined, viewRound: number | undefined): boolean {
  if (!attempts?.length) return false
  const graded = attempts.filter((a) => a.result === 'correct' || a.result === 'incorrect')
  if (!graded.length) return false
  const maxNo = graded.reduce((m, a) => Math.max(m, a.no), 0)
  return graded.some((a) => a.no === (viewRound ?? maxNo))
}

const BADGE_H = 21
const BADGE_PAD = 8
const BADGE_FS = 12.5
const CROP_H = 13                   // 번호 그림 높이 (스캔본)

/**
 * "12번 · 내 답 ③" 배지.
 *
 * 무엇을 문제 번호로 인식했는지가 답만큼 중요하다 — 번호를 잘못 잡으면 답도 엉뚱한
 * 문항에 붙기 때문이다. 텍스트 PDF는 읽은 번호를 글자로, 스캔본은 숫자 OCR이 읽은
 * 값(numLabel)을 글자로 — OCR 전이거나 못 읽었으면 그 자리를 잘라낸 그림을 그대로
 * 보여준다. 둘 다 없으면 답만 띄운다.
 */
function PickBadge({
  region,
  label,
  crop,
}: {
  region: {
    bounds: { x: number; y: number }
    numBox?: { x: number; y: number; w: number; h: number }
    numLabel?: string
  }
  label: number
  crop?: string
}) {
  const box = region.numBox ?? { x: region.bounds.x, y: region.bounds.y, w: 20, h: 15 }
  const answer = `내 답 ${CIRCLED[label - 1]}`

  // 번호 표기 폭 — 글자는 대략 재고, 그림은 원본 비율대로
  const numText = region.numLabel ? `${region.numLabel}번 ·` : null
  const cropW = crop && region.numBox ? (region.numBox.w / region.numBox.h) * CROP_H : 0
  const headW = numText ? textWidth(numText) + 5 : crop ? cropW + 6 : 0
  const width = BADGE_PAD * 2 + headW + textWidth(answer)

  // 번호가 페이지 맨 위에 붙어 있으면 위로 못 올린다 — 그때만 아래에 붙인다
  const above = box.y >= BADGE_H + 5
  const x = box.x - 3
  const y = above ? box.y - BADGE_H - 4 : box.y + box.h + 4
  const baseline = y + BADGE_H / 2 + BADGE_FS * 0.36

  return (
    <g style={{ animation: 'puriFade .18s var(--ease-out)' }}>
      <rect
        x={x}
        y={y}
        width={width}
        height={BADGE_H}
        rx={BADGE_H / 2}
        fill="var(--brand-tint)"
        stroke="var(--green-300)"
        strokeWidth={1}
      />
      {numText && (
        <text
          x={x + BADGE_PAD}
          y={baseline}
          fontSize={BADGE_FS}
          fontWeight={700}
          fill="var(--text-brand)"
        >
          {numText}
        </text>
      )}
      {!numText && crop && (
        <>
          <image
            href={crop}
            x={x + BADGE_PAD}
            y={y + (BADGE_H - CROP_H) / 2}
            width={cropW}
            height={CROP_H}
            preserveAspectRatio="xMidYMid meet"
          />
          <text
            x={x + BADGE_PAD + cropW + 2}
            y={baseline}
            fontSize={BADGE_FS}
            fontWeight={700}
            fill="var(--text-brand)"
          >
            ·
          </text>
        </>
      )}
      <text
        x={x + BADGE_PAD + headW}
        y={baseline}
        fontSize={BADGE_FS}
        fontWeight={600}
        fill="var(--text-brand)"
      >
        {answer}
      </text>
    </g>
  )
}

/** SVG에는 글자 폭을 미리 알 방법이 없어 어림한다 — 한글·원문자는 전각, 나머지는 반각 */
function textWidth(s: string): number {
  let w = 0
  for (const ch of s) w += ch.charCodeAt(0) > 0x2000 ? BADGE_FS * 0.98 : BADGE_FS * 0.56
  return w
}

// ============================================================ 페이지 상태 칩

/** 상태만 보여준다 — 페이지 위에 누를 것을 얹으면 그 자리에 필기를 못 한다 */
export function AnalysisChip({ page }: { page: number }) {
  const analysis = useDocumentStore((s) => s.analysis[page]) ?? IDLE_ANALYSIS
  const regionCount = useDocumentStore((s) => s.regionsByPage[page]?.length ?? 0)
  const marks = useDocumentStore((s) => s.marksByPage[page])
  const checked = marks ? Object.keys(marks).length : 0

  const tone = {
    idle: 'bg-[var(--ink-100)] text-[color:var(--text-faint)]',
    running: 'bg-[var(--ink-100)] text-[color:var(--text-muted)]',
    done: 'bg-[var(--brand-tint)] text-[color:var(--text-brand)]',
    empty: 'bg-[var(--ink-100)] text-[color:var(--text-faint)]',
    failed: 'bg-[var(--grade-x-bg)] text-[color:var(--grade-x)]',
  }[analysis.status]

  return (
    <div
      title={analysis.note}
      className={`pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${tone}`}
    >
      {analysis.status === 'running' && (
        <span
          className="h-1.5 w-1.5 rounded-full bg-[var(--brand)]"
          style={{ animation: 'puriPulse 1.2s var(--ease-out) infinite' }}
        />
      )}
      {analysis.status === 'idle' && '펜을 대면 이 쪽을 분석해'}
      {analysis.status === 'running' && '분석 중…'}
      {analysis.status === 'empty' && '문항 없음'}
      {analysis.status === 'failed' && '분석 실패'}
      {analysis.status === 'done' && (
        <>
          문항 <span className="num">{regionCount}</span> · 체크{' '}
          <span className="num">{checked}</span>
          {/* 어느 경로로 얼마나 걸렸나는 개발용 — 학생 화면에는 문항·체크만 */}
          {import.meta.env.DEV && analysis.source !== 'stored' && (
            <span className="opacity-60">
              {analysis.source === 'pack'
                ? '라벨 · '
                : analysis.source === 'scan'
                  ? '스캔 · '
                  : analysis.source === 'v1'
                    ? 'v1 · '
                    : ''}
              {Math.round(analysis.ms)}ms
            </span>
          )}
        </>
      )}
    </div>
  )
}
