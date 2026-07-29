// 분할 알고리즘 A/B 비교 — dev 전용.
// 같은 PDF를 기존 segmentPage와 PSP 파이프라인에 각각 넣고 결과를 나란히 그린다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { paths } from '../routes/paths'
import { Button, Checkbox } from '../design'
import { MAX_W } from '../lib/geometry'
import { getPageLines, loadPdf, renderPage, type PDFDocumentProxy } from '../lib/pdf'
import { segmentPage } from '../lib/segment'
import { runPipeline, type PipelineResult, type Problem } from '../lib/psp'
import { contentExtents, documentInput, toAppRegions } from '../lib/psp/adapter'
import { diff, measure, type Divergence, type PageExtent, type SegmentMetrics } from '../lib/psp/compare'
import { parseGolden, scoreAgainstGolden, type GoldenScore, type GoldenSet } from '../lib/psp/golden'
import { DEFAULT_PASS, draftKey, loadDraft } from '../lib/goldenStore'
import type { Box, Region as AppRegion } from '../types'

type Side = { regions: AppRegion[]; metrics: SegmentMetrics }

type Run = {
  pdf: PDFDocumentProxy
  pageCount: number
  old: Side
  psp: Side
  pspResult: PipelineResult | null
  divergence: Divergence
  fileName: string
  error?: string
}

const now = () => performance.now()

export function SegmentCompare() {
  const navigate = useNavigate()
  const close = () => void navigate(paths.list)
  const [run, setRun] = useState<Run | null>(null)
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)
  const [showHitbox, setShowHitbox] = useState(true)
  const [withFigures, setWithFigures] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [golden, setGolden] = useState<GoldenSet | null>(null)

  const execute = useCallback(
    async (buf: ArrayBuffer, fileName: string) => {
      setBusy(true)
      setMessage(null)
      try {
        const pdf = await loadPdf(buf)

        // ---------- 기존 알고리즘 ----------
        let t = now()
        const linesByPage = new Map<number, Awaited<ReturnType<typeof getPageLines>>>()
        for (let p = 1; p <= pdf.numPages; p++) linesByPage.set(p, await getPageLines(pdf, p))
        const oldExtract = now() - t

        t = now()
        const oldRegions: AppRegion[] = []
        for (let p = 1; p <= pdf.numPages; p++) {
          oldRegions.push(...segmentPage('cmp', p, linesByPage.get(p)!))
        }
        const oldSegment = now() - t

        // ---------- PSP ----------
        t = now()
        const pages = await documentInput(pdf, withFigures)
        const pspExtract = now() - t

        let pspRegions: AppRegion[] = []
        let pspResult: PipelineResult | null = null
        let pspSegment = 0
        let error: string | undefined
        try {
          t = now()
          pspResult = runPipeline(pages, { jobId: 'cmp' })
          pspSegment = now() - t
          pspRegions = toAppRegions(pspResult, 'cmp')
        } catch (e) {
          error = e instanceof Error ? e.message : String(e)
        }

        // 커버리지 분모는 PRD §4.2의 본문 영역 — 양쪽에 같은 잣대를 쓴다.
        // 페이지 텍스트 전체 범위로 재면 머리말·꼬리말을 제대로 걷어내는 쪽이 손해를 본다.
        const extents: PageExtent[] = pspResult
          ? contentExtents(pspResult)
          : pageTextExtents(linesByPage, pdf.numPages)

        setRun({
          pdf,
          pageCount: pdf.numPages,
          fileName,
          old: {
            regions: oldRegions,
            metrics: measure(oldRegions, extents, {
              extractMs: oldExtract,
              segmentMs: oldSegment,
            }),
          },
          psp: {
            regions: pspRegions,
            metrics: measure(pspRegions, extents, {
              extractMs: pspExtract,
              segmentMs: pspSegment,
            }),
          },
          pspResult,
          divergence: diff(oldRegions, pspRegions),
          error,
        })
        setPage(1)

        // 라벨링 화면이 같은 파일명으로 저장해 둔 골든셋이 있으면 바로 채점한다
        // 차수가 생겼다 — 기본 차수(A)를 문다 (lib/goldenStore.ts)
        setGolden(loadDraft(draftKey(fileName, DEFAULT_PASS)))
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [withFigures],
  )

  const onFile = async (file: File | undefined) => {
    if (!file) return
    await execute(await file.arrayBuffer(), file.name)
  }

  const meta = run?.pspResult ? problemMeta(run.pspResult.problems) : new Map()

  return (
    <div className="min-h-dvh bg-[var(--canvas)] p-[var(--space-6)]">
      <header className="mb-[var(--space-5)] flex flex-wrap items-center gap-[var(--space-3)]">
        <h1 className="text-[length:var(--text-h2)] font-bold text-[color:var(--text-strong)]">
          분할 알고리즘 비교
        </h1>
        <span className="text-[14px] text-[color:var(--text-muted)]">
          기존 segmentPage · PSP v0.1
        </span>
        <div className="ml-auto flex items-center gap-[var(--space-3)]">
          <label className="cursor-pointer">
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <span className="inline-flex h-9 items-center rounded-[10px] bg-[var(--brand)] px-4 text-[14px] font-semibold text-white">
              PDF 열기
            </span>
          </label>
          <Button variant="ghost" size="sm" onClick={close}>
            닫기
          </Button>
        </div>
      </header>

      <div className="mb-[var(--space-4)] flex flex-wrap items-center gap-[var(--space-5)]">
        <Checkbox checked={showHitbox} onChange={setShowHitbox} label="선지 판정 박스(hitbox) 표시" />
        <Checkbox
          checked={withFigures}
          onChange={setWithFigures}
          label="PSP 도형 탐지 켜기 (operator list 파싱 — 추출 시간이 늘어난다)"
        />
      </div>

      {busy && <p className="text-[color:var(--text-muted)]">처리 중…</p>}
      {message && <p className="text-[color:var(--grade-x)]">{message}</p>}

      {run && (
        <>
          <GoldenPanel
            run={run}
            golden={golden}
            onLoad={setGolden}
            onError={setMessage}
            onPick={setPage}
          />

          <MetricsTable run={run} />

          {run.error && (
            <p className="mb-[var(--space-4)] rounded-[10px] bg-[var(--grade-x-bg)] px-4 py-3 text-[14px] text-[color:var(--grade-x)]">
              PSP 실패: {run.error}
            </p>
          )}

          <PageStrip run={run} current={page} onPick={setPage} />

          <DivergenceList divergence={run.divergence} onPick={setPage} />

          <div className="mb-[var(--space-3)] flex items-center gap-[var(--space-3)]">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              ← 이전
            </Button>
            <span className="text-[14px] font-medium text-[color:var(--text-default)]">
              {page} / {run.pageCount}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => Math.min(run.pageCount, p + 1))}
              disabled={page >= run.pageCount}
            >
              다음 →
            </Button>
            <span className="text-[13px] text-[color:var(--text-faint)]">{run.fileName}</span>
          </div>

          <div className="grid grid-cols-2 gap-[var(--space-5)]">
            <PageView
              title="기존 — segmentPage"
              pdf={run.pdf}
              pageNo={page}
              regions={run.old.regions.filter((r) => r.page === page)}
              showHitbox={showHitbox}
            />
            <PageView
              title="신규 — PSP v0.1"
              pdf={run.pdf}
              pageNo={page}
              regions={run.psp.regions.filter((r) => r.page === page)}
              meta={meta}
              showHitbox={showHitbox}
            />
          </div>
        </>
      )}

      {!run && !busy && (
        <p className="mt-[var(--space-8)] text-center text-[color:var(--text-muted)]">
          텍스트 레이어가 있는 문제집 PDF를 열면 두 알고리즘의 결과를 나란히 보여준다.
        </p>
      )}
    </div>
  )
}

// ---------- 지표 표 ----------

function MetricsTable({ run }: { run: Run }) {
  const a = run.old.metrics
  const b = run.psp.metrics

  const rows: { label: string; a: string; b: string; better?: 'a' | 'b' | 'same' }[] = [
    { label: '검출 문항', a: `${a.problems}`, b: `${b.problems}` },
    {
      label: '선지 5개 완비 (AC-2)',
      a: pct(a.choiceDetectRate, a.fullChoiceSets, a.multipleChoice),
      b: pct(b.choiceDetectRate, b.fullChoiceSets, b.multipleChoice),
      better: cmp(a.choiceDetectRate, b.choiceDetectRate),
    },
    {
      label: '선지 판정 박스 겹침 (AC-3)',
      a: `${a.hitboxCollisions}건`,
      b: `${b.hitboxCollisions}건`,
      better: cmp(-a.hitboxCollisions, -b.hitboxCollisions),
    },
    {
      label: '문항 bbox 겹침 (INV-2)',
      a: `${a.boundsOverlaps}건`,
      b: `${b.boundsOverlaps}건`,
      better: cmp(-a.boundsOverlaps, -b.boundsOverlaps),
    },
    {
      label: '본문 커버리지 (V-2)',
      a: `${(a.coverage * 100).toFixed(1)}%`,
      b: `${(b.coverage * 100).toFixed(1)}%`,
      better: cmp(a.coverage, b.coverage),
    },
    {
      label: '번호 유실 (V-1)',
      a: a.missingNumbers.length ? a.missingNumbers.join(', ') : '없음',
      b: b.missingNumbers.length ? b.missingNumbers.join(', ') : '없음',
      better: cmp(-a.missingNumbers.length, -b.missingNumbers.length),
    },
    { label: '텍스트 추출', a: ms(a.extractMs), b: ms(b.extractMs) },
    {
      label: '분할 연산',
      a: ms(a.segmentMs),
      b: ms(b.segmentMs),
      better: cmp(-a.segmentMs, -b.segmentMs),
    },
    {
      label: '합계',
      a: ms(a.extractMs + a.segmentMs),
      b: ms(b.extractMs + b.segmentMs),
      better: cmp(-(a.extractMs + a.segmentMs), -(b.extractMs + b.segmentMs)),
    },
  ]

  return (
    <div className="ds-card mb-[var(--space-4)] overflow-x-auto p-[var(--space-5)]">
      <table className="w-full min-w-[560px] text-[14px]">
        <thead>
          <tr className="text-left text-[color:var(--text-muted)]">
            <th className="pb-2 font-medium">지표</th>
            <th className="pb-2 font-medium">기존</th>
            <th className="pb-2 font-medium">PSP v0.1</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-[var(--border-subtle)]">
              <td className="py-2 text-[color:var(--text-default)]">{r.label}</td>
              <td className={cell(r.better === 'a')}>{r.a}</td>
              <td className={cell(r.better === 'b')}>{r.b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-[var(--space-3)] text-[13px] text-[color:var(--text-faint)]">
        문항 경계 평균 IoU {run.divergence.meanIou.toFixed(3)} · 경계가 크게 다른 문항{' '}
        {run.divergence.disagreeing.length}개 · 기존에만 {run.divergence.onlyOld.length}개 · PSP에만{' '}
        {run.divergence.onlyNew.length}개
      </p>
    </div>
  )
}

const cell = (win: boolean) =>
  `py-2 tabular-nums ${win ? 'font-semibold text-[color:var(--grade-o)]' : 'text-[color:var(--text-default)]'}`

function cmp(a: number, b: number): 'a' | 'b' | 'same' {
  if (Math.abs(a - b) < 1e-9) return 'same'
  return a > b ? 'a' : 'b'
}

const ms = (v: number) => `${v.toFixed(0)}ms`
const pct = (rate: number, n: number, d: number) =>
  d === 0 ? '—' : `${(rate * 100).toFixed(1)}% (${n}/${d})`

// ---------- 골든셋 채점 ----------

/**
 * 골든셋이 있어야 "어느 쪽이 옳은가"를 말할 수 있다.
 * 골든셋이 없으면 두 결과의 IoU는 서로 얼마나 다른지만 알려준다.
 */
function GoldenPanel({
  run,
  golden,
  onLoad,
  onError,
  onPick,
}: {
  run: Run
  golden: GoldenSet | null
  onLoad: (g: GoldenSet) => void
  onError: (m: string) => void
  onPick: (page: number) => void
}) {
  const scores = golden
    ? {
        old: scoreAgainstGolden(run.old.regions, golden),
        psp: scoreAgainstGolden(run.psp.regions, golden),
      }
    : null

  const pick = async (file: File | undefined) => {
    if (!file) return
    try {
      onLoad(parseGolden(await file.text()))
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="ds-card mb-[var(--space-4)] p-[var(--space-5)]">
      <div className="mb-[var(--space-3)] flex flex-wrap items-center gap-[var(--space-3)]">
        <h2 className="text-[15px] font-semibold text-[color:var(--text-strong)]">
          골든셋 채점
        </h2>
        {golden ? (
          <span className="text-[13px] text-[color:var(--text-muted)]">
            {golden.source} · 확인 {golden.reviewedPages.length}페이지 · 정답 {golden.boxes.length}구역
          </span>
        ) : (
          <span className="text-[13px] text-[color:var(--text-faint)]">
            골든셋이 없다. 사이드바 “골든셋 라벨링”에서 만들거나 JSON을 불러온다.
          </span>
        )}
        <label className="ml-auto cursor-pointer">
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              void pick(e.target.files?.[0])
              e.currentTarget.value = ''
            }}
          />
          <span className="inline-flex h-8 items-center rounded-[8px] border border-[var(--border-subtle)] px-3 text-[13px]">
            골든셋 JSON 불러오기
          </span>
        </label>
      </div>

      {scores && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[14px]">
              <thead>
                <tr className="text-left text-[color:var(--text-muted)]">
                  <th className="pb-2 font-medium">지표</th>
                  <th className="pb-2 font-medium">기존</th>
                  <th className="pb-2 font-medium">PSP v0.1</th>
                </tr>
              </thead>
              <tbody>
                {goldenRows(scores.old, scores.psp).map((r) => (
                  <tr key={r.label} className="border-t border-[var(--border-subtle)]">
                    <td className="py-2 text-[color:var(--text-default)]">{r.label}</td>
                    <td className={cell(r.better === 'a')}>{r.a}</td>
                    <td className={cell(r.better === 'b')}>{r.b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-[var(--space-3)] space-y-2">
            <MissList title="PSP가 놓친 구역" items={scores.psp.misses} onPick={onPick} />
            <MissList title="PSP가 잘못 만든 구역" items={scores.psp.falsePositives} onPick={onPick} />
          </div>
        </>
      )}
    </div>
  )
}

function goldenRows(a: GoldenScore, b: GoldenScore) {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`
  return [
    { label: '채점 페이지 / 정답 구역', a: `${a.pages}p · ${a.golden}개`, b: `${b.pages}p · ${b.golden}개` },
    { label: '검출 구역', a: `${a.predicted}`, b: `${b.predicted}` },
    {
      label: '경계 정확도 — 재현율 @IoU 0.7 (AC-1)',
      a: pct(a.recall),
      b: pct(b.recall),
      better: cmp(a.recall, b.recall),
    },
    { label: '정밀도', a: pct(a.precision), b: pct(b.precision), better: cmp(a.precision, b.precision) },
    { label: 'F1', a: pct(a.f1), b: pct(b.f1), better: cmp(a.f1, b.f1) },
    { label: '평균 IoU (짝지어진 쌍)', a: a.meanIou.toFixed(3), b: b.meanIou.toFixed(3), better: cmp(a.meanIou, b.meanIou) },
    {
      label: '번호 정확도',
      a: pct(a.numberAccuracy),
      b: pct(b.numberAccuracy),
      better: cmp(a.numberAccuracy, b.numberAccuracy),
    },
    {
      label: '선지 전량 검출 (AC-2)',
      a: a.choiceRecall === null ? '라벨 없음' : pct(a.choiceRecall),
      b: b.choiceRecall === null ? '라벨 없음' : pct(b.choiceRecall),
      better: cmp(a.choiceRecall ?? 0, b.choiceRecall ?? 0),
    },
  ] as { label: string; a: string; b: string; better?: 'a' | 'b' | 'same' }[]
}

function MissList({
  title,
  items,
  onPick,
}: {
  title: string
  items: { page: number; number: string }[]
  onPick: (page: number) => void
}) {
  if (!items.length) return null
  return (
    <div>
      <span className="text-[13px] font-medium text-[color:var(--text-muted)]">
        {title} {items.length}건
      </span>
      <div className="mt-1 flex flex-wrap gap-1">
        {items.slice(0, 40).map((m, i) => (
          <button
            key={`${m.page}-${m.number}-${i}`}
            onClick={() => onPick(m.page)}
            className="rounded-full border border-[var(--border-subtle)] px-2.5 py-0.5 text-[12px] hover:bg-[var(--ink-100)]"
          >
            p{m.page}·{m.number}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------- 문항 페이지 띠 ----------

/**
 * 어느 페이지가 문항 페이지로 판정됐는지 보여준다.
 * 문제집은 표지·머리말·목차·개념정리·해설이 절반 가까이를 차지하고,
 * 거기서는 구역을 나누지 않는 것이 맞다.
 */
function PageStrip({
  run,
  current,
  onPick,
}: {
  run: Run
  current: number
  onPick: (page: number) => void
}) {
  const counts = new Map<number, number>()
  for (const r of run.psp.regions) counts.set(r.page, (counts.get(r.page) ?? 0) + 1)
  const withProblems = counts.size

  return (
    <div className="ds-card mb-[var(--space-4)] p-[var(--space-5)]">
      <h2 className="mb-[var(--space-3)] text-[15px] font-semibold text-[color:var(--text-strong)]">
        문항 페이지 {withProblems} / {run.pageCount}
        <span className="ml-2 font-normal text-[13px] text-[color:var(--text-muted)]">
          회색은 문항이 없다고 판정해 구역을 나누지 않은 페이지다
        </span>
      </h2>
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: run.pageCount }, (_, i) => i + 1).map((p) => {
          const n = counts.get(p) ?? 0
          const active = p === current
          return (
            <button
              key={p}
              onClick={() => onPick(p)}
              title={n ? `${p}쪽 · ${n}문항` : `${p}쪽 · 문항 없음`}
              className={[
                'h-7 min-w-7 rounded-[6px] px-1.5 text-[12px] tabular-nums transition-colors',
                n
                  ? 'bg-[var(--grade-o-bg)] font-semibold text-[color:var(--grade-o)]'
                  : 'bg-[var(--ink-100)] text-[color:var(--text-faint)]',
                active ? 'ring-2 ring-[var(--brand)]' : '',
              ].join(' ')}
            >
              {p}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------- 차이 목록 ----------

function DivergenceList({
  divergence,
  onPick,
}: {
  divergence: Divergence
  onPick: (page: number) => void
}) {
  const items = [...divergence.onlyOld, ...divergence.onlyNew, ...divergence.disagreeing].slice(0, 40)
  if (!items.length) return null

  return (
    <div className="ds-card mb-[var(--space-4)] p-[var(--space-5)]">
      <h2 className="mb-[var(--space-3)] text-[15px] font-semibold text-[color:var(--text-strong)]">
        두 결과가 갈린 지점 {items.length}건
      </h2>
      <div className="flex flex-wrap gap-2">
        {items.map((m) => (
          <button
            key={`${m.page}:${m.numLabel}:${m.onlyIn ?? 'iou'}`}
            onClick={() => onPick(m.page)}
            className="rounded-full border border-[var(--border-subtle)] px-3 py-1 text-[13px] text-[color:var(--text-default)] hover:bg-[var(--ink-100)]"
          >
            p{m.page} · {m.numLabel}번 ·{' '}
            {m.onlyIn === 'old' ? '기존에만' : m.onlyIn === 'new' ? 'PSP에만' : `IoU ${m.iou.toFixed(2)}`}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------- 페이지 뷰 ----------

type Meta = Map<string, { confidence: number; flags: string[] }>

function problemMeta(problems: Problem[]): Meta {
  const m: Meta = new Map()
  for (const p of problems) {
    m.set(`${p.pageIndex + 1}:${p.number}`, { confidence: p.confidence, flags: p.flags })
  }
  return m
}

const VIEW_W = 520

function PageView({
  title,
  pdf,
  pageNo,
  regions,
  meta,
  showHitbox,
}: {
  title: string
  pdf: PDFDocumentProxy
  pageNo: number
  regions: AppRegion[]
  meta?: Meta
  showHitbox: boolean
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [height, setHeight] = useState(VIEW_W * 1.414)

  useEffect(() => {
    let alive = true
    if (!canvas.current) return
    void renderPage(pdf, pageNo, canvas.current, VIEW_W).then(({ cssHeight }) => {
      if (alive) setHeight(cssHeight)
    })
    return () => {
      alive = false
    }
  }, [pdf, pageNo])

  const normH = height / (VIEW_W / MAX_W)

  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-[15px] font-semibold text-[color:var(--text-strong)]">{title}</h3>
        <span className="text-[13px] text-[color:var(--text-muted)]">{regions.length}문항</span>
      </div>
      <div className="relative w-fit rounded-[10px] border border-[var(--border-subtle)] bg-white">
        <canvas ref={canvas} className="block" />
        <svg
          className="pointer-events-none absolute inset-0"
          width={VIEW_W}
          height={height}
          viewBox={`0 0 ${MAX_W} ${normH}`}
        >
          {regions.map((r) => {
            const info = meta?.get(`${r.page}:${r.numLabel}`)
            const color = info ? confidenceColor(info.confidence) : '#2F7DD1'
            return (
              <g key={r.id}>
                <rect
                  {...rect(r.bounds)}
                  fill={color}
                  opacity={0.08}
                  stroke={color}
                  strokeWidth={1.2}
                />
                {showHitbox &&
                  r.choices.map((c) => (
                    <rect
                      key={c.label}
                      {...rect(c.box)}
                      fill="none"
                      stroke={color}
                      strokeWidth={1}
                      strokeDasharray="4 3"
                    />
                  ))}
                <text x={r.bounds.x + 3} y={r.bounds.y + 12} fill={color} fontSize={11}>
                  {r.numLabel}
                  {info && info.flags.length > 0 ? ` ⚑${info.flags.length}` : ''}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

const rect = (b: Box) => ({ x: b.x, y: b.y, width: b.w, height: b.h })

/** UI-1 — 신뢰도별 색상 (녹/황/적), §6.3 라우팅 경계와 같은 임계값 */
function confidenceColor(c: number): string {
  if (c >= 0.85) return '#1E8E4F'
  if (c >= 0.5) return '#C98212'
  return '#D64545'
}

/** PSP가 실패했을 때만 쓰는 대체 분모 — 페이지 텍스트가 차지하는 실제 영역 */
function pageTextExtents(
  linesByPage: Map<number, { tokens: { box: Box }[] }[]>,
  pageCount: number,
): PageExtent[] {
  const out: PageExtent[] = []
  for (let p = 1; p <= pageCount; p++) {
    const boxes = (linesByPage.get(p) ?? []).flatMap((l) => l.tokens.map((t) => t.box))
    if (!boxes.length) continue
    const x = Math.min(...boxes.map((b) => b.x))
    const y = Math.min(...boxes.map((b) => b.y))
    out.push({
      page: p,
      box: {
        x,
        y,
        w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
        h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
      },
    })
  }
  return out
}
