// 필기 화면 (시안2 에디터) — 상단 바 + 펜 툴바 + 페이지 스택 + 채점 시트
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { findRegion, latestPerRegion, useDocumentStore } from '../stores/documentStore'
import { useInkStore } from '../stores/inkStore'
import { paths } from '../routes/paths'
import { useGrade } from '../routes/useGrade'
import { consecutiveCorrect } from '../lib/grading'
import { Button, ReviewChecks, Timer } from '@puri/ui'
import { PenToolbar } from './PenToolbar'
import { PageStack } from './PageStack'
import logo from '@puri/ui/assets/logo.svg'

export function Editor() {
  const doc = useDocumentStore((s) => s.doc)
  const attemptsAll = useDocumentStore((s) => s.attemptsAll)
  const sheet = useDocumentStore((s) => s.sheet)
  const grading = useDocumentStore((s) => s.grading)
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
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--paper)]">
      {/* ---------- 상단 바 ---------- */}
      <header className="flex h-[60px] flex-none items-center border-b border-[var(--border-subtle)] px-[var(--space-4)]">
        <button
          aria-label="목록으로"
          className="grid h-11 w-11 place-items-center rounded-[10px] text-[color:var(--text-default)]"
          onClick={() => void navigate(paths.list)}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <span className="ml-1.5 truncate text-[20px] font-semibold text-[color:var(--text-strong)]">
          {doc.name}
        </span>
        {graded.length > 0 && (
          <span className="ml-3 inline-flex flex-none items-center gap-1.5 rounded-full bg-[var(--brand-tint)] px-3 py-[5px] text-[13px] font-semibold text-[color:var(--text-brand)]">
            채점 완료 · O <span className="num">{sumO}</span> / 사선 <span className="num">{sumX}</span>
          </span>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-[var(--space-2)]">
          <Button variant="secondary" size="sm" onClick={() => void navigate(paths.answers(doc.id))}>
            정답 입력
          </Button>
          {import.meta.env.DEV && (
            <Button variant="ghost" size="sm" onClick={store.toggleZoneDebug}>
              구역
            </Button>
          )}
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
            <button
              className="absolute bottom-5 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-[var(--text-strong)] px-5 py-[11px] text-[14px] font-semibold text-white shadow-[var(--shadow-lg)]"
              onClick={store.expandSheet}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m18 15-6-6-6 6" />
              </svg>
              채점 결과 · O <span className="num">{sumO}</span> / 사선 <span className="num">{sumX}</span>
            </button>
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
                답 표시를 읽고 있어요 · 문제 옆에 O / 사선으로 표시
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
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
        <button
          aria-label="접기"
          className="grid h-10 w-10 place-items-center rounded-[10px] bg-[var(--surface-sunken)] text-[color:var(--text-muted)]"
          onClick={store.collapseSheet}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>

      {wrongItems.length > 0 ? (
        <>
          <div className="mb-2 text-[13px] tracking-[var(--track-wide)] text-[color:var(--text-faint)]">
            틀린 문제 다시풀기
          </div>
          <div className="flex flex-wrap gap-2.5">
            {wrongItems.map((w) => (
              <button
                key={w.regionId}
                className="inline-flex items-center gap-2 rounded-[12px] border px-4 py-[11px]"
                style={{
                  borderColor: w.graduated ? 'var(--green-300)' : 'var(--grade-x-ring)',
                  background: w.graduated ? 'var(--green-100)' : 'var(--grade-x-bg)',
                }}
                onClick={() => void store.startResolve(w.regionId)}
              >
                <span className="text-[15px] font-bold text-[color:var(--text-strong)]">{w.label}</span>
                {w.page && <span className="text-[13px] text-[color:var(--text-muted)]">p{w.page}</span>}
                <span
                  className="num text-[12px] font-semibold"
                  style={{ color: w.graduated ? 'var(--text-brand)' : 'var(--text-muted)' }}
                >
                  {w.graduated ? '졸업' : `${w.consec}/3`}
                </span>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--text-brand)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                  <path d="M21 3v5h-5" />
                  <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                  <path d="M3 21v-5h5" />
                </svg>
              </button>
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
  const grade = useGrade()

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
        <button
          aria-label="채점 결과로"
          className="grid h-10 w-10 place-items-center rounded-[10px] bg-[var(--surface-sunken)] text-[color:var(--text-default)]"
          onClick={store.backToSummary}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
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
        <button
          className="inline-flex h-[46px] items-center gap-[7px] rounded-[10px] border border-[var(--border-default)] bg-[var(--paper)] px-4 text-[14px] font-medium text-[color:var(--text-default)]"
          onClick={store.toggleReveal}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          {revealed ? '지난 풀이 숨김' : '지난 풀이 보기'}
        </button>
        <div className="flex-1" />
        {graduated && (
          <span className="inline-flex items-center gap-[7px] rounded-full bg-[var(--brand-tint)] px-[15px] py-2.5 text-[14px] font-semibold text-[color:var(--text-brand)]">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            3회 연속 정답 · 졸업
          </span>
        )}
        <Button onClick={() => void grade()}>채점하기</Button>
      </div>
    </div>
  )
}
