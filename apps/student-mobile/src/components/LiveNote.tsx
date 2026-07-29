// 라이브 노트 — 필기하는 동안 그 페이지를 분석해 고른 번호를 문제 번호 위에 띄운다.
//
// 에디터와 다른 점은 "언제"다. 에디터는 업로드 때 전 페이지를 나누고 채점 버튼을
// 눌러야 판정한다. 여기서는 펜이 닿은 페이지만 그때 분석하고, 획을 뗄 때마다 다시
// 판정한다. 정답지는 보지 않는다 — 맞고 틀림이 아니라 "무엇을 골랐나"만 보여준다.
//
// 화면 구성은 에디터와 같은 부품이다 (PageScroller · PdfCanvas · InkCanvas · PenToolbar).
// 필기 동작이 에디터와 한 글자도 다르지 않아야 하기 때문이다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MAX_W } from '../lib/geometry'
import { detectMarks } from '../lib/liveDetect'
import { paths } from '../routes/paths'
import { useInkStore } from '../stores/inkStore'
import { getLivePdf, IDLE_ANALYSIS, useLiveStore, type PageAnalysis } from '../stores/liveStore'
import { Button, Checkbox } from '@puri/ui'
import { PenToolbar } from './PenToolbar'
import { PageScroller } from './PageScroller'
import { PdfCanvas } from './PdfCanvas'
import { InkCanvas } from './InkCanvas'
import { TextLayer } from './TextLayer'
import logo from '@puri/ui/assets/logo.svg'

const CIRCLED = ['①', '②', '③', '④', '⑤']

export function LiveNote() {
  const navigate = useNavigate()
  const close = () => void navigate(paths.list)
  const fileName = useLiveStore((s) => s.fileName)
  const docKey = useLiveStore((s) => s.docKey)
  const mode = useLiveStore((s) => s.mode)
  const pageAspects = useLiveStore((s) => s.pageAspects)
  const pages = useLiveStore((s) => s.pages)
  const marksByPage = useLiveStore((s) => s.marksByPage)
  const loading = useLiveStore((s) => s.loading)
  const message = useLiveStore((s) => s.message)
  const showZones = useLiveStore((s) => s.showZones)
  const showHitboxes = useLiveStore((s) => s.showHitboxes)
  const pack = useLiveStore((s) => s.pack)
  const store = useLiveStore.getState()

  const fileRef = useRef<HTMLInputElement>(null)
  const [visiblePage, setVisiblePage] = useState(1)
  const pdf = getLivePdf()

  // 화면을 떠났다 돌아오면 필기 스토어가 다른 문서를 보고 있다
  useEffect(() => {
    store.resume()
    return () => store.leave()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void store.openFile(file)
  }

  const analyzed = Object.values(pages).filter((p) => p.status === 'done' || p.status === 'empty')
  const problems = Object.values(pages).reduce((n, p) => n + p.regions.length, 0)
  const checked = Object.values(marksByPage).reduce((n, m) => n + Object.keys(m).length, 0)

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--paper)]">
      {/* ---------- 상단 바 ---------- */}
      <header className="flex h-[60px] flex-none items-center gap-[var(--space-2)] border-b border-[var(--border-subtle)] px-[var(--space-4)]">
        <button
          aria-label="목록으로"
          className="grid h-11 w-11 place-items-center rounded-[10px] text-[color:var(--text-default)]"
          onClick={close}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <span className="ml-0.5 truncate text-[20px] font-semibold text-[color:var(--text-strong)]">
          라이브 노트
        </span>
        {fileName && (
          <span className="truncate text-[14px] text-[color:var(--text-muted)]">· {fileName}</span>
        )}
        {pdf && mode === 'scan' && (
          <span className="flex-none rounded-full bg-[var(--grade-tri-bg)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--grade-tri)]">
            스캔 분석
          </span>
        )}
        {pdf && (
          <span className="ml-1.5 inline-flex flex-none items-center gap-1.5 rounded-full bg-[var(--brand-tint)] px-3 py-[5px] text-[13px] font-semibold text-[color:var(--text-brand)]">
            분석 <span className="num">{analyzed.length}</span>/
            <span className="num">{pageAspects.length}</span>쪽 · 문항{' '}
            <span className="num">{problems}</span> · 체크 <span className="num">{checked}</span>
          </span>
        )}
        <div className="flex-1" />
        {pdf && (
          <div className="flex flex-none items-center gap-[var(--space-4)] pr-1">
            <Checkbox checked={showZones} onChange={store.toggleZones} label="구역" />
            <Checkbox checked={showHitboxes} onChange={store.toggleHitboxes} label="선지 박스" />
            {/* 다시 분석은 여기에만 둔다 — 페이지 위에 버튼을 얹으면 그 자리에 못 쓴다 */}
            <Button
              variant="ghost"
              size="sm"
              disabled={pages[visiblePage]?.status === 'running'}
              onClick={() => void store.reanalyzePage(visiblePage)}
            >
              {visiblePage}쪽 다시 분석
            </Button>
          </div>
        )}
        {pdf && (
          <label className="cursor-pointer" title="사람이 확인한 골든셋 JSON — 라벨된 쪽은 검출 대신 그것을 쓴다">
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0]
                e.currentTarget.value = ''
                if (f) void store.importPack(f)
              }}
            />
            <span
              className="inline-flex h-8 items-center rounded-[8px] px-3 text-[13px] font-medium"
              style={
                pack
                  ? { background: 'var(--grade-o-bg)', color: 'var(--grade-o)' }
                  : { border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }
              }
            >
              {pack
                ? `라벨 팩 ${pack.pages}쪽${pack.via === 'fingerprint' ? ' · 지문' : ''}${
                    pack.offset ? ` ${pack.offset > 0 ? '+' : ''}${pack.offset}` : ''
                  }`
                : '라벨 팩'}
            </span>
          </label>
        )}
        <Button
          variant="secondary"
          size="sm"
          disabled={loading}
          onClick={() => fileRef.current?.click()}
        >
          {loading ? '여는 중…' : pdf ? '다른 PDF' : 'PDF 열기'}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={pickFile}
        />
      </header>

      {message && (
        <div className="flex flex-none items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--grade-tri-bg)] px-[var(--space-5)] py-[var(--space-3)] text-[14px] text-[color:var(--text-default)]">
          <span className="flex-1">{message}</span>
          <button
            className="text-[13px] font-semibold text-[color:var(--text-brand)]"
            onClick={store.dismissMessage}
          >
            확인
          </button>
        </div>
      )}

      {/* ---------- 본문 ---------- */}
      {pdf ? (
        <div className="relative flex min-h-0 flex-1">
          <PenToolbar showGrade={false} />
          <PageScroller
            key={docKey ?? 'none'}        // 파일이 바뀌면 스크롤·윈도를 처음부터
            pageAspects={pageAspects}
            onVisiblePage={setVisiblePage}
            onWindow={(first, last) => {
              const loadPage = useInkStore.getState().loadPage
              for (let p = first; p <= last; p++) void loadPage(p)
            }}
            renderPage={(page, { width, height }) => (
              <LivePage page={page} width={width} height={height} />
            )}
          />
        </div>
      ) : (
        <Intro busy={loading} onPick={() => fileRef.current?.click()} />
      )}
    </div>
  )
}

// ============================================================ 페이지 한 장

function LivePage({ page, width, height }: { page: number; width: number; height: number }) {
  const analysis = useLiveStore((s) => s.pages[page]) ?? IDLE_ANALYSIS
  const analyzePage = useLiveStore((s) => s.analyzePage)
  const pdf = getLivePdf()
  if (!pdf) return null

  return (
    <>
      <PdfCanvas pdf={pdf} page={page} width={width} />
      <InkCanvas
        page={page}
        regions={analysis.regions}
        width={width}
        height={height}
        // ★ 펜 접촉이 분석 신호다 (요구 1~2). 같은 페이지에 몇 번을 대도 한 번만 돈다
        onInkStart={() => void analyzePage(page)}
      />
      <TextLayer page={page} width={width} />
      <MarkOverlay page={page} analysis={analysis} width={width} height={height} />
      <StatusChip page={page} analysis={analysis} />
    </>
  )
}

// ============================================================ 판정 오버레이

/**
 * 마크는 필기에서 파생된 값이라 저장하지 않는다 — 획이 바뀔 때마다 다시 센다.
 * 스트로크 수·문항 수 모두 페이지 단위라 매번 다시 세도 부담이 없다.
 */
function MarkOverlay({
  page,
  analysis,
  width,
  height,
}: {
  page: number
  analysis: PageAnalysis
  width: number
  height: number
}) {
  const strokes = useInkStore((s) => s.strokesByPage[page])
  const showZones = useLiveStore((s) => s.showZones)
  const showHitboxes = useLiveStore((s) => s.showHitboxes)
  const pack = useLiveStore((s) => s.pack)
  const reportMarks = useLiveStore((s) => s.reportMarks)
  const crops = useLiveStore((s) => s.numCrops)

  const regions = analysis.regions
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
        const chosen = r.choices.find((c) => c.label === picked)
        return (
          <g key={r.id}>
            {showZones && (
              <rect
                x={r.bounds.x}
                y={r.bounds.y}
                width={r.bounds.w}
                height={r.bounds.h}
                fill="var(--brand)"
                opacity={0.05}
                stroke="var(--green-300)"
                strokeWidth={1}
                strokeDasharray="6 4"
              />
            )}

            {/* 요구 2 — 연결해 둔 ①~⑤ 체크 좌표 */}
            {showHitboxes &&
              r.choices.map((c) => (
                <rect
                  key={c.label}
                  x={c.box.x}
                  y={c.box.y}
                  width={c.box.w}
                  height={c.box.h}
                  fill="none"
                  stroke="var(--ink-400)"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                />
              ))}

            {/* 요구 3 — 펜이 닿은 선지 */}
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
            {picked && r.numBox && (
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

            {/* 요구 4 — 문제 번호 위에 "몇 번 문제인지 + 고른 번호" */}
            {picked && <PickBadge region={r} label={picked} crop={crops[r.id]} />}
          </g>
        )
      })}
    </svg>
  )
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
function StatusChip({ page, analysis }: { page: number; analysis: PageAnalysis }) {
  const marks = useLiveStore((s) => s.marksByPage[page])
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
          문항 <span className="num">{analysis.regions.length}</span> · 체크{' '}
          <span className="num">{checked}</span>
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
        </>
      )}
    </div>
  )
}

// ============================================================ 시작 화면

function Intro({ busy, onPick }: { busy: boolean; onPick: () => void }) {
  const steps = [
    '펜이 페이지에 닿으면 그 쪽을 분석해 문제 번호를 찾아',
    '객관식이면 ①②③④⑤ 체크 자리 좌표를 문항에 연결해 둬',
    '그 자리에 동그라미·체크를 치면 어느 번호인지 바로 읽어',
    '읽은 번호를 문제 번호 위에 띄워 — 고쳐 치면 따라 바뀌어',
  ]
  const notes = [
    '텍스트 PDF — 첫 접촉에서 파일 전체를 한 번 훑어. 조판(단·머리말·번호 정렬)은 여러 장을 겹쳐 봐야 잡히거든. 그다음 페이지부터는 바로 나와.',
    '스캔본 — 페이지 그림에서 ①~⑤ 링과 색 번호를 직접 찾아. 쪽마다 따로 도니까 첫 쪽부터 바로 나와. 번호 값은 그 자리만 잘라 숫자 OCR로 읽고, 못 읽으면 그 자리 그림을 그대로 띄워.',
    '필기는 파일 이름 기준으로 저장돼 같은 파일을 다시 열면 이어서 쓸 수 있어. 이 화면의 노트는 목록에 올라가지 않아.',
  ]

  return (
    <div className="puri-scroll flex-1 overflow-y-auto bg-[var(--canvas)] px-[var(--space-6)] py-[var(--space-12)]">
      <div className="mx-auto max-w-[560px] text-center">
        <img src={logo} alt="" className="mx-auto h-12 w-12" />
        <h1 className="mt-[var(--space-4)] text-[length:var(--text-h1)] font-bold tracking-[var(--track-tight)] text-[color:var(--text-strong)]">
          채점 버튼 없이, 필기하는 동안 읽는다
        </h1>
        <p className="mt-2 text-[15px] leading-6 text-[color:var(--text-muted)]">
          문제집 PDF를 열어줘. 텍스트 PDF는 글자를, 스캔본은 이미지를 보고 찾아.
        </p>

        <ol className="mt-[var(--space-6)] space-y-2 text-left">
          {steps.map((s, i) => (
            <li
              key={i}
              className="flex items-start gap-3 rounded-[12px] border border-[var(--border-subtle)] bg-[var(--paper)] px-[var(--space-4)] py-[var(--space-3)]"
            >
              <span className="num mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full bg-[var(--brand-tint)] text-[12px] font-bold text-[color:var(--text-brand)]">
                {i + 1}
              </span>
              <span className="text-[14px] leading-6 text-[color:var(--text-default)]">{s}</span>
            </li>
          ))}
        </ol>

        <div className="mt-[var(--space-6)]">
          <Button disabled={busy} onClick={onPick}>
            {busy ? '여는 중…' : 'PDF 열기'}
          </Button>
        </div>
        <div className="mt-[var(--space-5)] space-y-1.5 text-left">
          {notes.map((n) => (
            <p key={n} className="text-[13px] leading-5 text-[color:var(--text-faint)]">
              {n}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}
