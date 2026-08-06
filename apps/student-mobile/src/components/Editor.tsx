// 필기 화면 (시안2 에디터) — 상단 바 + 펜 툴바 + 페이지 스택 + 채점 시트
//
// 문항은 펜이 닿은 쪽을 그때 분석해서 나온다 (documentStore 「분석」). 그래서 이 화면은
// 채점 전에도 "무엇을 골랐나"를 배지로 띄운다 (MarkOverlay).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { findRegion, latestPerRegion, useDocumentStore } from '../stores/documentStore'
import { useInkStore } from '../stores/inkStore'
import { paths } from '../routes/paths'
import { consecutiveCorrect } from '../lib/grading'
import { Button, IconButton, RetryChip, ReviewChecks, Timer } from '@puri/ui'
import { PenToolbar } from './PenToolbar'
import { PageStack } from './PageStack'
import logo from '@puri/ui/assets/logo.svg'

export function Editor() {
  const doc = useDocumentStore((s) => s.doc)
  const attemptsAll = useDocumentStore((s) => s.attemptsAll)
  const sheet = useDocumentStore((s) => s.sheet)
  const grading = useDocumentStore((s) => s.grading)
  const sweep = useDocumentStore((s) => s.sweep)
  const store = useDocumentStore.getState()
  const navigate = useNavigate()

  if (!doc) return null

  const latest = latestPerRegion(Object.values(attemptsAll).flat())
  const graded = Object.values(latest).filter(
    (a) => a.result === 'correct' || a.result === 'incorrect',
  )
  const sumO = graded.filter((a) => a.result === 'correct').length
  const sumX = graded.length - sumO

  return (
    <div className="flex h-[var(--screen-h)] flex-col overflow-hidden bg-[var(--paper)]">
      {/* ---------- 상단 바 ---------- */}
      <header className="flex h-[60px] flex-none items-center border-b border-[var(--border-subtle)] px-[var(--space-4)]">
        <IconButton label="목록으로" onClick={() => void navigate(paths.list)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </IconButton>
        <span className="ml-1.5 truncate text-[20px] font-semibold text-[color:var(--text-strong)]">
          {doc.name}
        </span>
        {/* 채점 완료 배지는 뺐다 — 지난 채점 결과를 되비추는 표시다 */}
        <AnalysisSummary />
        <div className="flex-1" />
        {/* 정답 입력 버튼은 뺐다 — 정답 입력 화면(AnswerKeyScreen)과 /doc/:id/answers
            라우트는 그대로 살아 있고, 여기 진입점만 끊었다 */}
        <div className="flex items-center gap-[var(--space-2)]">
          {import.meta.env.DEV && <AnalysisTools />}
        </div>
      </header>

      {/* ---------- 본문 ---------- */}
      <div className="relative flex min-h-0 flex-1">
        <PenToolbar />
        <div className="relative flex min-w-0 flex-1 flex-col">
          <PageStack />
          {sheet === 'summary' && <SummarySheet sumO={sumO} sumX={sumX} />}
          {sheet === 'resolve' && <ResolveSheet />}
          {sheet === 'pill' && (
            <Button
              variant="inverse"
              className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full shadow-lg"
              icon={
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m18 15-6-6-6 6" />
                </svg>
              }
              onClick={store.expandSheet}
            >
              채점 결과 · O <span className="num">{sumO}</span> / 사선 <span className="num">{sumX}</span>
            </Button>
          )}
        </div>
      </div>

      {/* ---------- 채점 중 오버레이 (시안2) ---------- */}
      {grading && (
        <div
          className="absolute inset-0 z-50 grid place-items-center"
          style={{ background: 'rgba(27,31,22,0.32)', backdropFilter: 'blur(3px)' }}
        >
          <div className="flex flex-col items-center gap-5 rounded-[20px] bg-[var(--paper)] px-12 py-10 shadow-[var(--shadow-lg)]">
            <img src={logo} width={64} height={64} alt="" style={{ animation: 'puriSpin 1.4s linear infinite' }} />
            <div className="text-center">
              <div className="text-[19px] font-bold text-[color:var(--text-strong)]">채점하는 중</div>
              <div className="mt-1 text-[14px] text-[color:var(--text-muted)]">
                {/* 펜이 닿지 않은 쪽은 아직 문항을 모른다 — 채점 전에 남은 쪽을 훑는다 */}
                {sweep
                  ? `문항을 찾고 있어요 · ${sweep.done}/${sweep.total}쪽`
                  : '답 표시를 읽고 있어요 · 문제 옆에 O / 사선으로 표시'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================ 분석 표시

/** 채점 전에도 보이는 요약 — 지금까지 찾은 문항과 학생이 체크한 수 */
function AnalysisSummary() {
  const regions = useDocumentStore((s) => s.regionsByPage)
  const marksByPage = useDocumentStore((s) => s.marksByPage)

  const problems = Object.values(regions).reduce((n, r) => n + r.length, 0)
  if (problems === 0) return null
  const checked = Object.values(marksByPage).reduce((n, m) => n + Object.keys(m).length, 0)

  return (
    <span className="ml-3 inline-flex flex-none items-center gap-1.5 rounded-full bg-[var(--surface-sunken)] px-3 py-[5px] text-[13px] font-medium text-[color:var(--text-muted)]">
      문항 <span className="num">{problems}</span> · 체크 <span className="num">{checked}</span>
    </span>
  )
}

/**
 * 분석 확인용 도구 (DEV 전용).
 *
 * 라벨 팩은 사람이 확인한 골든셋 JSON이다 — 라벨된 쪽은 검출 대신 그것을 쓴다 (§11.2).
 */
function AnalysisTools() {
  const visiblePage = useDocumentStore((s) => s.visiblePage)
  const running = useDocumentStore((s) => s.analysis[s.visiblePage]?.status === 'running')
  const mode = useDocumentStore((s) => s.mode)
  const pack = useDocumentStore((s) => s.pack)
  const store = useDocumentStore.getState()

  return (
    <>
      <span className="text-[12px] text-[color:var(--text-faint)]">{mode}</span>
      <Button variant="ghost" size="sm" onClick={store.toggleZoneDebug}>
        구역
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={running}
        onClick={() => void store.reanalyzePage(visiblePage)}
      >
        {visiblePage}쪽 다시 분석
      </Button>
      <label className="cursor-pointer" title="사람이 확인한 골든셋 JSON — 라벨된 쪽은 검출 대신 그것을 쓴다">
        <input
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0]
            e.currentTarget.value = ''
            if (f) void store.importLabelPack(f)
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
    </>
  )
}

// ============================================================ 채점 요약 시트

function SummarySheet({ sumO, sumX }: { sumO: number; sumX: number }) {
  const retryList = useDocumentStore((s) => s.retryList)
  const regionsByPage = useDocumentStore((s) => s.regionsByPage)
  const attemptsAll = useDocumentStore((s) => s.attemptsAll)
  const store = useDocumentStore.getState()

  // 미졸업 오답 이력 + 이번 채점으로 갓 졸업한 문항(한 번만 표시)
  const wrongItems = [
    ...(retryList?.regionIds ?? []).map((id) => ({ id, grad: false })),
    ...(retryList?.graduated ?? []).map((id) => ({ id, grad: true })),
  ].map(({ id: regionId, grad }) => {
    const found = findRegion(regionsByPage, regionId)
    const consec = consecutiveCorrect(attemptsAll[regionId] ?? [])
    return {
      regionId,
      label: found?.region.numLabel ? `${found.region.numLabel}번` : '문항',
      page: found?.page,
      consec,
      graduated: grad || consec >= 3,
    }
  })

  return (
    <div
      className="absolute inset-x-0 bottom-0 rounded-t-[20px] border-t border-[var(--border-subtle)] bg-[var(--paper)] px-[var(--space-6)] pb-6 pt-3.5 shadow-[var(--shadow-lg)]"
      style={{ animation: 'puriSheet .32s var(--ease-out)' }}
    >
      <div className="mx-auto mb-3.5 h-[5px] w-11 rounded-[3px] bg-[var(--ink-200)]" />
      <div className="mb-4 flex items-center gap-3">
        <img src={logo} width={30} height={30} alt="" />
        <div className="flex-1">
          <div className="text-[17px] font-bold text-[color:var(--text-strong)]">채점 결과</div>
          <div className="text-[13px] text-[color:var(--text-muted)]">
            틀린 문제를 눌러 그 자리에서 다시 풀 수 있어.
          </div>
        </div>
        <div className="flex gap-2">
          <StatTile label="O" value={sumO} color="var(--grade-o)" bg="var(--grade-o-bg)" />
          <StatTile label="사선" value={sumX} color="var(--grade-x)" bg="var(--grade-x-bg)" />
        </div>
        <IconButton variant="sunken" label="접기" onClick={store.collapseSheet}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </IconButton>
      </div>

      {wrongItems.length > 0 ? (
        <>
          <div className="mb-2 text-[13px] tracking-[var(--track-wide)] text-[color:var(--text-faint)]">
            틀린 문제 다시풀기
          </div>
          <div className="flex flex-wrap gap-2.5">
            {wrongItems.map((w) => (
              <RetryChip
                key={w.regionId}
                label={w.label}
                page={w.page ?? undefined}
                consec={w.consec}
                graduated={w.graduated}
                onClick={() => void store.startResolve(w.regionId)}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="py-2 text-[14px] text-[color:var(--text-muted)]">
          틀린 문제가 없어. 그대로 진행하면 돼.
        </div>
      )}
    </div>
  )
}

function StatTile({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <span className="inline-flex flex-col items-center rounded-[12px] px-4 py-[7px]" style={{ background: bg }}>
      <span className="text-[11px] font-semibold" style={{ color }}>
        {label}
      </span>
      <span className="num text-[20px] font-bold" style={{ color }}>
        {value}
      </span>
    </span>
  )
}

// ============================================================ 재풀이 시트

function ResolveSheet() {
  const resolvingRegionId = useDocumentStore((s) => s.resolvingRegionId)
  const regionsByPage = useDocumentStore((s) => s.regionsByPage)
  const attemptsAll = useDocumentStore((s) => s.attemptsAll)
  const revealRegionId = useInkStore((s) => s.revealRegionId)
  const store = useDocumentStore.getState()

  // 재풀이 시간은 상대 신호 — 세션 한정, 저장하지 않는다
  const [sec, setSec] = useState(0)
  const [running, setRunning] = useState(true)
  useEffect(() => {
    setSec(0)
    setRunning(true)
  }, [resolvingRegionId])
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setSec((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [running])

  if (!resolvingRegionId) return null
  const found = findRegion(regionsByPage, resolvingRegionId)
  const consec = consecutiveCorrect(attemptsAll[resolvingRegionId] ?? [])
  const graduated = consec >= 3
  const revealed = revealRegionId === resolvingRegionId

  return (
    <div
      className="absolute inset-x-0 bottom-0 rounded-t-[20px] border-t border-[var(--border-subtle)] bg-[var(--paper)] px-[var(--space-6)] pb-[22px] pt-3.5 shadow-[var(--shadow-lg)]"
      style={{ animation: 'puriSheet .28s var(--ease-out)' }}
    >
      <div className="mx-auto mb-3 h-[5px] w-11 rounded-[3px] bg-[var(--ink-200)]" />
      <div className="mb-3.5 flex items-center gap-3">
        <IconButton variant="sunken" label="채점 결과로" onClick={store.backToSummary}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </IconButton>
        <div className="flex-1">
          <div className="text-[16px] font-bold text-[color:var(--text-strong)]">
            {found?.region.numLabel ? `${found.region.numLabel}번` : '문항'} 다시풀기
            {found?.page && (
              <span className="ml-1 text-[14px] font-normal text-[color:var(--text-muted)]">
                · p{found.page}
              </span>
            )}
          </div>
          <div className="text-[13px] text-[color:var(--text-muted)]">
            지난 풀이는 위에서 가려졌어. 다시 풀고 채점해봐.
          </div>
        </div>
        <ReviewChecks count={consec} total={3} graduated={graduated} size="sm" />
      </div>
      <div className="flex flex-wrap items-center gap-3.5">
        <Timer
          label="재풀이 시간"
          seconds={sec}
          onChange={setSec}
          running={running}
          onToggleRun={setRunning}
        />
        <Button
          variant="secondary"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          }
          onClick={store.toggleReveal}
        >
          {revealed ? '지난 풀이 숨김' : '지난 풀이 보기'}
        </Button>
        <div className="flex-1" />
        {graduated && (
          <span className="inline-flex items-center gap-[7px] rounded-full bg-[var(--brand-tint)] px-[15px] py-2.5 text-[14px] font-semibold text-[color:var(--text-brand)]">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            3회 연속 정답 · 졸업
          </span>
        )}
        {/* 채점하기 버튼은 뺐다 — 프로덕션에 남은 마지막 grade() 진입점이었다.
            채점 코드(documentStore.grade·useGrade·grading.ts)는 그대로 살아 있다. */}
      </div>
    </div>
  )
}
