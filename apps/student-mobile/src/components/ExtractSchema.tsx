// 3단계 · 추출과 검산 — dev 전용
//
// 정답지 PDF를 여러 권 넣으면 권별로 3경로 읽기 → 합의 → 단원 → 검산을 돌리고,
// **권별 합격/불합격 표**를 낸다.
//
// 자동 정확도를 보는 화면이 아니라 **틀렸을 때 조용히 넘어가는지**를 보는 화면이다.
//
// ☞ `answerAudit.ts`(답지로 검출을 감사)와 방향이 반대다. 저기는 답지를 자로 삼아
//   검출을 재고, 여기는 답지 자체를 영구 산출물로 굳힌다 — 좌표·합의·출처까지.
import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDocumentStore } from '../stores/documentStore'
import { paths } from '../routes/paths'
import { Button } from '../design'
import { sha256Short } from '../lib/hash'
import { getPageLines, loadPdf } from '../lib/pdf'
import { runTextExtract, type RunResult } from '../lib/extract/run'
import type { CheckStatus } from '../lib/extract/checks'
import { summarize, toCsv, validate, type ProblemFlag } from '../lib/extract/schema'

const FLAG_LABEL: Record<ProblemFlag, string> = {
  seq_gap: '수열 빈칸',
  duplicate: '키 중복',
  conflict: '경로 불일치',
  single_path: '단일 경로',
  geometry: '열 어긋남 의심',
  no_box: '위치 없음',
}

const STATUS_STYLE: Record<CheckStatus, { text: string; cls: string }> = {
  pass: { text: 'PASS', cls: 'bg-[var(--brand-tint-soft)] text-[color:var(--brand)]' },
  warn: { text: 'WARN', cls: 'bg-[#FFF4E0] text-[#9A6300]' },
  fail: { text: 'FAIL', cls: 'bg-[#FDECEC] text-[color:var(--danger)]' },
  skip: { text: 'SKIP', cls: 'bg-[var(--ink-150)] text-[color:var(--text-muted)]' },
}

type Book = { name: string; run: RunResult | null; error?: string }

export function ExtractSchema() {
  const navigate = useNavigate()
  const close = () => void navigate(paths.list)
  const toast = useDocumentStore((s) => s.showToast)

  const [books, setBooks] = useState<Book[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [onlyFlagged, setOnlyFlagged] = useState(true)
  const abort = useRef({ aborted: false })

  const run = useCallback(
    async (picked: FileList | null) => {
      const list = Array.from(picked ?? []).filter((f) => /\.pdf$/i.test(f.name))
      if (!list.length) return toast('PDF가 없다')

      abort.current = { aborted: false }
      const out: Book[] = []

      for (let i = 0; i < list.length; i++) {
        if (abort.current.aborted) break
        const file = list[i]
        setBusy(`[${i + 1}/${list.length}] ${file.name} 여는 중…`)
        try {
          const bytes = await file.arrayBuffer()
          // 지문을 먼저 만든다 — pdf.js가 버퍼를 소비하기 전에
          const source = await sha256Short(bytes.slice(0))
          const pdf = await loadPdf(bytes)
          const result = await runTextExtract({
            pages: pdf.numPages,
            getLines: (p) => getPageLines(pdf, p),
            source,
            sourceName: file.name,
            extractedAt: new Date().toISOString(),
            signal: abort.current,
            onPage: (done, total) =>
              setBusy(`[${i + 1}/${list.length}] ${file.name} — ${done}/${total}쪽`),
          })
          out.push({ name: file.name, run: result })
          void pdf.destroy()
        } catch (e) {
          out.push({
            name: file.name,
            run: null,
            error: e instanceof Error ? e.message : String(e),
          })
        }
        setBooks([...out])
      }
      setBusy(null)
      setSelected(out[0]?.name ?? null)
      toast(abort.current.aborted ? '중단함' : `${out.length}권 처리`)
    },
    [toast],
  )

  const current = books.find((b) => b.name === selected) ?? null
  const extract = current?.run?.extract ?? null
  const violations = useMemo(() => (extract ? validate(extract) : []), [extract])
  const stats = useMemo(() => (extract ? summarize(extract) : null), [extract])

  const rows = useMemo(() => {
    if (!extract) return []
    return onlyFlagged ? extract.problems.filter((p) => p.flags.length) : extract.problems
  }, [extract, onlyFlagged])

  const download = (name: string, body: string, type: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([body], { type }))
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="min-h-dvh bg-[var(--canvas)] p-[var(--space-5)]">
      <header className="mb-[var(--space-4)] flex flex-wrap items-center gap-[var(--space-3)]">
        <h1 className="text-[length:var(--text-h2)] font-bold text-[color:var(--text-strong)]">
          3단계 · 추출과 검산
        </h1>
        <span className="text-[13px] text-[color:var(--text-muted)]">
          3경로로 읽고 합의를 센 뒤 권별로 판정한다
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-[var(--space-2)]">
          <label className="cursor-pointer">
            <input
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                void run(e.target.files)
                e.currentTarget.value = ''
              }}
            />
            <span className="inline-flex h-8 items-center rounded-[8px] bg-[var(--brand)] px-3 text-[13px] font-semibold text-white">
              정답지 PDF (여러 권)
            </span>
          </label>
          <Button
            variant="ghost"
            size="sm"
            disabled={!extract}
            onClick={() =>
              extract &&
              download(
                `${extract.sourceName.replace(/\.pdf$/i, '')}.answers.json`,
                JSON.stringify(extract, null, 2),
                'application/json',
              )
            }
          >
            JSON
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!extract}
            onClick={() =>
              extract &&
              download(
                `${extract.sourceName.replace(/\.pdf$/i, '')}.answers.csv`,
                toCsv(extract),
                'text/csv;charset=utf-8',
              )
            }
          >
            CSV
          </Button>
          <Button variant="ghost" size="sm" onClick={close}>
            닫기
          </Button>
        </div>
      </header>

      {busy && (
        <p className="mb-[var(--space-4)] text-[13px] text-[color:var(--text-muted)]">
          {busy}{' '}
          <button className="underline" onClick={() => (abort.current.aborted = true)}>
            중단
          </button>
        </p>
      )}

      {!books.length && !busy && (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] px-[var(--space-6)] py-[var(--space-8)] text-center text-[color:var(--text-muted)]">
          <p className="text-[15px]">정답지 PDF를 5권쯤 한꺼번에 넣어라.</p>
          <p className="mt-2 text-[13px] text-[color:var(--text-faint)]">
            수열 · 답 분포 · 쪽 연결 · 커버리지 네 검산이 권별로 돈다
          </p>
        </div>
      )}

      {/* ---------- 권별 판정 ---------- */}
      {books.length > 0 && (
        <div className="mb-[var(--space-4)] overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--paper)]">
          <table className="w-full min-w-[860px] text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-[color:var(--text-muted)]">
                <Th className="text-left">권</Th>
                <Th>문항</Th>
                <Th>단원</Th>
                <Th>3경로 일치</Th>
                <Th>수열</Th>
                <Th>답 분포</Th>
                <Th>쪽 연결</Th>
                <Th>커버리지</Th>
                <Th>검수 큐</Th>
                <Th>판정</Th>
              </tr>
            </thead>
            <tbody>
              {books.map((b) => {
                const s = b.run ? summarize(b.run.extract) : null
                const checks = b.run?.checks
                return (
                  <tr
                    key={b.name}
                    onClick={() => setSelected(b.name)}
                    className={`cursor-pointer border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--surface-hover)] ${
                      b.name === selected ? 'bg-[var(--surface-hover)]' : ''
                    }`}
                  >
                    <Td className="max-w-[240px] truncate text-left">{b.name}</Td>
                    {b.error || !s || !checks ? (
                      <Td className="text-left text-[color:var(--danger)]" colSpan={9}>
                        {b.error ?? '실패'}
                      </Td>
                    ) : (
                      <>
                        <Td>{s.problems}</Td>
                        <Td>{s.sections}</Td>
                        <Td>
                          {s.unanimous}
                          <span className="text-[color:var(--text-faint)]">
                            {' '}
                            ({pct(s.unanimous, s.problems)})
                          </span>
                        </Td>
                        {checks.results.map((r) => (
                          <Td key={r.id}>
                            <Pill status={r.status} />
                          </Td>
                        ))}
                        <Td>{checks.queue}</Td>
                        <Td>
                          <Pill status={checks.verdict} />
                        </Td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------- 상세 ---------- */}
      {current?.run && extract && stats && (
        <>
          <div className="mb-[var(--space-4)] grid gap-[var(--space-3)] md:grid-cols-2">
            {/* 검산 */}
            <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--paper)] p-[var(--space-4)]">
              <h2 className="mb-2 text-[14px] font-semibold text-[color:var(--text-strong)]">
                검산 — {current.name}
              </h2>
              <ul className="space-y-2 text-[13px]">
                {current.run.checks.results.map((r) => (
                  <li key={r.id} className="flex gap-2">
                    <Pill status={r.status} />
                    <div className="flex-1">
                      <div className="text-[color:var(--text-default)]">
                        <b>{r.label}</b> — {r.headline}
                      </div>
                      <div className="text-[12px] text-[color:var(--text-faint)]">{r.detail}</div>
                      {r.keys.length > 0 && (
                        <div className="mt-0.5 text-[12px] text-[color:var(--text-muted)]">
                          {r.keys.slice(0, 12).join(', ')}
                          {r.keys.length > 12 && ` … 외 ${r.keys.length - 12}`}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* 경로·출처 */}
            <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--paper)] p-[var(--space-4)] text-[12px]">
              <h2 className="mb-2 text-[14px] font-semibold text-[color:var(--text-strong)]">
                경로와 출처
              </h2>
              <Row
                k="경로별 읽기"
                v={`토큰 ${current.run.perPath.token} · 줄텍스트 ${current.run.perPath.line} · 열 ${current.run.perPath.grid}`}
              />
              <Row k="단원 헤더" v={`${current.run.headers.length}개 검출`} />
              <Row
                k="합의"
                v={`3경로 ${stats.unanimous} · 불일치 ${stats.conflicts} · 단일 ${stats.singlePath}`}
              />
              <Row k="지문" v={extract.source} mono />
              <Row k="추출기" v={extract.provenance.extractorVersion} />
              <Row k="시각" v={extract.provenance.extractedAt} />
              {violations.length > 0 && (
                <div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
                  {violations.slice(0, 8).map((v, i) => (
                    <div key={i} className="text-[color:var(--text-muted)]">
                      <b className={v.level === 'error' ? 'text-[color:var(--danger)]' : ''}>
                        {v.level}
                      </b>{' '}
                      {v.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 단원 */}
          {extract.sections.length > 0 && (
            <div className="mb-[var(--space-4)] flex flex-wrap gap-2">
              {extract.sections.map((s) => (
                <span
                  key={s.id}
                  className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--paper)] px-2 py-1 text-[12px]"
                  title={`${s.startPage}쪽부터`}
                >
                  <b className="text-[color:var(--text-strong)]">{s.title}</b>{' '}
                  <span className="text-[color:var(--text-faint)]">
                    {s.from}–{s.to}
                  </span>
                </span>
              ))}
            </div>
          )}

          {/* 문항 */}
          <div className="mb-[var(--space-2)] flex items-center gap-3 text-[13px]">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={onlyFlagged}
                onChange={(e) => setOnlyFlagged(e.target.checked)}
              />
              <span className="text-[color:var(--text-muted)]">플래그만 보기</span>
            </label>
            <span className="text-[color:var(--text-faint)]">
              {rows.length}행 · 이 목록이 검수 큐의 입력이다
            </span>
          </div>

          <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--paper)]">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-[color:var(--text-muted)]">
                  <Th className="text-left">단원</Th>
                  <Th>번호</Th>
                  <Th>정답</Th>
                  <Th>객관식</Th>
                  <Th>쪽</Th>
                  <Th>합의</Th>
                  <Th>간격</Th>
                  <Th className="text-left">플래그</Th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 400).map((p) => (
                  <tr
                    key={`${p.sectionId}-${p.number}`}
                    className="border-b border-[var(--border-subtle)] last:border-0"
                  >
                    <Td className="text-left">{p.sectionId}</Td>
                    <Td>{p.number}</Td>
                    <Td className="font-semibold">{p.value}</Td>
                    <Td>{p.choice ? '○' : ''}</Td>
                    <Td>{p.page}</Td>
                    <Td>
                      {p.agreement}/{p.paths}
                    </Td>
                    <Td>
                      {p.numBox && p.valueBox
                        ? Math.round(p.valueBox.x - (p.numBox.x + p.numBox.w))
                        : '—'}
                    </Td>
                    <Td className="text-left">
                      {p.flags.map((f) => (
                        <span
                          key={f}
                          className="mr-1 inline-block rounded-[5px] bg-[var(--ink-150)] px-1.5 py-0.5 text-[11px] text-[color:var(--text-muted)]"
                        >
                          {FLAG_LABEL[f]}
                        </span>
                      ))}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 400 && (
              <p className="px-3 py-2 text-[12px] text-[color:var(--text-faint)]">
                400행까지만 표시 — 전체는 CSV로
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ---------- 조각 ----------

function pct(n: number, d: number): string {
  return d ? `${Math.round((n / d) * 100)}%` : '—'
}

function Pill({ status }: { status: CheckStatus }) {
  const s = STATUS_STYLE[status]
  return (
    <span className={`rounded-[5px] px-1.5 py-0.5 text-[11px] font-semibold ${s.cls}`}>
      {s.text}
    </span>
  )
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex gap-3 py-0.5">
      <span className="w-24 flex-none text-[color:var(--text-faint)]">{k}</span>
      <span
        className={`truncate text-[color:var(--text-default)] ${mono ? 'font-mono' : ''}`}
        title={v}
      >
        {v}
      </span>
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-right font-medium ${className}`}>{children}</th>
}

function Td({
  children,
  className = '',
  colSpan,
}: {
  children: React.ReactNode
  className?: string
  colSpan?: number
}) {
  return (
    <td colSpan={colSpan} className={`px-3 py-2 text-right tabular-nums ${className}`}>
      {children}
    </td>
  )
}
