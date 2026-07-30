// 라벨 품질 — dev 전용.
//
// 골든셋 자체를 감사한다. 99%를 목표로 두는 순간 **라벨 오류율이 목표보다 한 자릿수 작아야
// 하고, 그건 신념이 아니라 측정돼야 한다.** 세 도구가 각각 다른 것을 잡는다.
//
//   ① 답지 대조 — 손 라벨 0으로 검출을 감사한다 (출판사 답지는 우리 검출기와 독립이다)
//   ② 일치도(IAA) — 규약의 모호함. 두 사람이 같은 쪽을 다르게 판단하는 곳
//   ③ 함정 쪽 — 부주의. 초안을 안 보고 Enter를 누르는 것
//
// 판정 기하 상한은 여기 없다 — 테스트 명령이다(`npx vitest run ceiling`).
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { paths } from '../routes/paths'
import { Button, Input } from '@puri/ui'
import {
  auditAgainstAnswers,
  missingRuns,
  parseAnswerBook,
  type AnswerAudit,
  type AnswerLine,
} from '../lib/answerAudit'
import {
  agreement,
  injectTraps,
  scoreTraps,
  TRAP_KINDS,
  type Agreement,
  type Trap,
  type TrapResult,
} from '../lib/labelQuality'
import { sha256Short } from '../lib/hash'
import { listDrafts, loadDraft, type DraftRef } from '../lib/goldenStore'
import {
  decidePack,
  matchPack,
  pageFingerprints,
  type PackMatch,
  type PlacementCheck,
} from '../lib/labelPack'
import { MAX_W } from '../lib/geometry'
import {
  getPageLines,
  hasTextLayer,
  loadPdf,
  renderPage,
  renderPageBitmap,
  type PDFDocumentProxy,
} from '../lib/pdf'
import { runPipeline } from '../lib/psp'
import { documentInput, toAppRegions } from '../lib/psp/adapter'
import { parseGolden, type GoldenSet } from '../lib/psp/golden'
import type { Region } from '../types'

/** IAA 합격선 — 이보다 낮으면 99% 목표는 애초에 측정할 수 없다 (문서 §11.10) */
const IAA_TARGET = 0.995

/** 함정을 심은 초안과 함께 내보내는 채점표 */
type TrapSet = { traps: Trap[]; truth: GoldenSet }

export function LabelQuality() {
  const navigate = useNavigate()
  return (
    <div className="min-h-dvh bg-[var(--canvas)] p-[var(--space-5)]">
      <header className="mb-[var(--space-4)] flex items-center gap-[var(--space-3)]">
        <h1 className="text-[length:var(--text-h2)] font-bold text-[color:var(--text-strong)]">
          라벨 품질
        </h1>
        <span className="text-[13px] text-[color:var(--text-muted)]">
          정답을 만들지 않고 정답을 감사한다
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void navigate(paths.list)}
          style={{ marginLeft: 'auto' }}
        >
          닫기
        </Button>
      </header>

      <Guide />

      <div className="mt-[var(--space-4)] grid gap-[var(--space-4)] xl:grid-cols-2">
        <PackPanel />
        <AnswerAuditPanel />
        <AgreementPanel />
        <TrapPanel />
      </div>
    </div>
  )
}

// ============================================================ ① 답지 대조

function AnswerAuditPanel() {
  const [problem, setProblem] = useState<File | null>(null)
  const [answer, setAnswer] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [audit, setAudit] = useState<AnswerAudit | null>(null)
  const [pageOf, setPageOf] = useState<Map<number, number>>(new Map())
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (!problem || !answer) return
    setBusy(true)
    setError(null)
    setAudit(null)
    try {
      // 답지 — 줄 텍스트와 토큰이 둘 다 필요하다 (정답표는 칸이 토큰으로 쪼개져 온다)
      const aPdf = await loadPdf(await answer.arrayBuffer())
      const lines: AnswerLine[] = []
      for (let p = 1; p <= aPdf.numPages; p++) {
        for (const l of await getPageLines(aPdf, p)) {
          lines.push({ text: l.text, tokens: l.tokens.map((t) => t.str) })
        }
      }
      const answers = parseAnswerBook(lines)

      // 문제집 — 번호 '값'이 필요하므로 텍스트 경로로 돈다.
      // ★ 스캔본에는 이 감사를 쓸 수 없다. 스캔 경로는 설계상 번호 '값'을 읽지 않아
      //   (§4.3) 번호로 견줄 수가 없다. 그대로 두면 재현율 0%가 나와 "검출이 실패했다"로
      //   읽히는데, 실은 잣대가 없는 것이다 — 다른 이유를 다른 문구로 말해야 한다
      const pPdf = await loadPdf(await problem.arrayBuffer())
      if (!(await hasTextLayer(pPdf))) {
        setError(
          '이 문제집에는 텍스트 레이어가 없다(스캔본). 답지 대조는 번호 값을 읽어야 하는데 ' +
            '스캔 경로는 설계상 값을 읽지 않는다 — 이 책은 손 라벨로 가야 한다.',
        )
        return
      }
      const regions = toAppRegions(
        runPipeline(await documentInput(pPdf, true), { jobId: 'audit' }),
        'audit',
      )
      const map = new Map<number, number>()
      for (const r of regions) {
        const n = Number(r.numLabel)
        if (Number.isFinite(n) && !map.has(n)) map.set(n, r.page)
      }
      setPageOf(map)
      setAudit(auditAgainstAnswers(regions, answers))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="① 답지 대조" hint="손 라벨 0쪽. 출판사 답지는 우리 검출기와 독립이다">
      <div className="flex flex-wrap gap-2">
        <FilePick label={problem ? `문제: ${problem.name}` : '문제 PDF'} accept="application/pdf" onPick={setProblem} />
        <FilePick label={answer ? `답지: ${answer.name}` : '답지 PDF'} accept="application/pdf" onPick={setAnswer} />
        <Button size="sm" onClick={() => void run()} disabled={!problem || !answer || busy}>
          {busy ? '대조 중…' : '대조'}
        </Button>
      </div>

      {error && <Note tone="bad">{error}</Note>}

      {audit && (
        <>
          {!audit.reliable && (
            <Note tone="bad">
              이 책에는 이 감사를 쓸 수 없다 — 검출 번호의 {pct(audit.duplicateRate)}가 중복이다.
              단원마다 번호가 1부터 다시 시작하는 조판이면 “번호가 문서 안에서 유일하다”는
              전제가 깨지고, 아래 수치는 낮은 게 아니라 잣대가 안 맞는 것이다.
            </Note>
          )}
          <Rows
            rows={[
              ['답지 문항', String(audit.expected)],
              ['검출 번호', String(audit.detected)],
              ['번호 재현율', pct(audit.numberRecall)],
              [
                '객관식 판정',
                audit.kind.accuracy === null
                  ? '–'
                  : `${audit.kind.agreed}/${audit.kind.compared} (${pct(audit.kind.accuracy)})`,
              ],
            ]}
          />
          {audit.missing.length > 0 && (
            <Detail summary={`놓친 번호 ${audit.missing.length}개`}>
              <p className="mb-1 text-[12px] text-[color:var(--text-faint)]">
                연속 구간이 먼저 볼 곳이다 — 쪽이 통째로 무너진 자리다
              </p>
              {missingRuns(audit.missing).map((r) => (
                <div key={`${r.from}-${r.to}`} className="text-[13px]">
                  {r.from}~{r.to} ({r.to - r.from + 1}개) — {near(r, pageOf)}
                </div>
              ))}
              <p className="mt-2 break-all text-[12px] text-[color:var(--text-muted)]">
                {audit.missing.join(' ')}
              </p>
            </Detail>
          )}
          {audit.kind.mismatches.length > 0 && (
            <Detail summary={`객관식 오판 ${audit.kind.mismatches.length}건`}>
              {audit.kind.mismatches.slice(0, 40).map((m) => (
                <div key={m.num} className="text-[13px]">
                  {m.num}번 정답 “{m.answer}” — 답지 {m.expected} ≠ 검출 {m.detected}
                </div>
              ))}
            </Detail>
          )}
          {audit.duplicated.length > 0 && (
            <Detail summary={`중복 검출 ${audit.duplicated.length}개`}>
              <p className="break-all text-[13px]">{audit.duplicated.join(' ')}</p>
            </Detail>
          )}
        </>
      )}
    </Card>
  )
}

/** 놓친 구간 앞뒤로 검출된 번호가 있던 쪽 */
function near(run: { from: number; to: number }, pageOf: Map<number, number>): string {
  const nums = [...pageOf.keys()].sort((a, b) => a - b)
  const before = [...nums].reverse().find((n) => n < run.from)
  const after = nums.find((n) => n > run.to)
  if (before === undefined && after === undefined) return '쪽 모름'
  if (before === undefined) return `p${pageOf.get(after!)} 앞`
  if (after === undefined) return `p${pageOf.get(before)} 뒤`
  const a = pageOf.get(before)
  const b = pageOf.get(after)
  return a === b ? `p${a}` : `p${a}~p${b}`
}

// ============================================================ ② 일치도 (IAA)

function AgreementPanel() {
  const navigate = useNavigate()
  const [drafts, setDrafts] = useState<DraftRef[]>(() => listDrafts())
  const [aKey, setAKey] = useState<string | null>(null)
  const [bKey, setBKey] = useState<string | null>(null)
  const [result, setResult] = useState<Agreement | null>(null)
  const [error, setError] = useState<string | null>(null)

  const a = aKey ? loadDraft(aKey) : null
  const b = bKey ? loadDraft(bKey) : null

  // 같은 책의 다른 차수끼리만 견주는 것이 정상이다. 그 외에는 경고를 띄운다
  const aRef = drafts.find((d) => d.key === aKey)
  const bRef = drafts.find((d) => d.key === bKey)
  const sameBook = !aRef || !bRef || aRef.source === bRef.source
  const samePass = !!aRef && !!bRef && aRef.pass === bRef.pass

  const run = () => {
    if (!a || !b) return
    try {
      setResult(agreement(a, b))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Card
      title="② 라벨러 간 일치도 (IAA)"
      hint="규약의 모호함을 잡는다 — 사람마다 다르게 판단하는 곳"
    >
      <p className="text-[12px] text-[color:var(--text-faint)]">
        같은 파일을 <b>차수 A·B로 각각 라벨</b>한 뒤 여기서 견준다. B는 A를 보지 않고
        독립으로 라벨해야 뜻이 있다 — 보고 따라 그리면 일치율은 100%가 되지만 아무것도
        재지 못한다.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setDrafts(listDrafts())}>
          목록 새로고침
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void navigate(paths.golden)}>
          라벨러 열기 (A)
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void navigate(`${paths.golden}?pass=B`)}>
          라벨러 열기 (B)
        </Button>
      </div>

      {drafts.length === 0 ? (
        <Note tone="bad">
          저장된 라벨이 없다. 「라벨러 열기」로 같은 파일을 A·B 두 차수로 라벨한 뒤 돌아온다.
        </Note>
      ) : (
        <div className="grid gap-[var(--space-2)] sm:grid-cols-2">
          <DraftPick label="A" drafts={drafts} value={aKey} onChange={setAKey} />
          <DraftPick label="B" drafts={drafts} value={bKey} onChange={setBKey} />
        </div>
      )}

      {!sameBook && (
        <Note tone="bad">
          서로 다른 파일의 라벨이다 — 같은 쪽을 견주는 것이 아니라 다른 책을 견주게 된다.
        </Note>
      )}
      {samePass && (
        <Note tone="bad">
          같은 차수를 두 번 골랐다. 자기 자신과 견주면 언제나 100%다.
        </Note>
      )}

      <div>
        <Button size="sm" onClick={run} disabled={!a || !b || !sameBook || samePass}>
          견주기
        </Button>
      </div>

      {error && <Note tone="bad">{error}</Note>}

      {result && (
        <>
          <Note tone={result.m4 >= IAA_TARGET ? 'good' : 'bad'}>
            M4 일치 {pct(result.m4)} —{' '}
            {result.m4 >= IAA_TARGET
              ? `합격선 ${pct(IAA_TARGET)} 이상. 이 규약으로 라벨을 늘려도 된다`
              : `합격선 ${pct(IAA_TARGET)} 미달. 두 정답이 이만큼 다르면 99% 목표는 측정할 수 없다 — 규약부터 고친다`}
          </Note>
          <Rows
            rows={[
              ['견준 쪽', `${result.pages}쪽`],
              ['문항', `A ${result.problems.a} · B ${result.problems.b} · 짝 ${result.problems.matched}`],
              [
                '선지 자리',
                `${result.choices.samePlace}/${result.choices.total} · 평균 겹침 ${result.choices.meanIou.toFixed(3)}`,
              ],
              ['번호 불일치', String(result.numberMismatch)],
              ['유형 불일치', String(result.kindMismatch)],
            ]}
          />
          {result.pages === 0 && (
            <Note tone="bad">
              양쪽 다 확인 완료한 쪽이 없다. 두 차수가 <b>같은 쪽</b>을 라벨해야 견줄 수 있다.
            </Note>
          )}
          {result.disagreements.length > 0 && (
            <Detail summary={`불일치 ${result.disagreements.length}건 — 규약으로 굳힐 자리`}>
              {result.disagreements.map((d, i) => (
                <div key={i} className="text-[13px]">
                  <span className="text-[color:var(--text-faint)]">p{d.page}</span> [{d.kind}]{' '}
                  {d.detail}
                </div>
              ))}
            </Detail>
          )}
        </>
      )}
    </Card>
  )
}

/** 저장된 초안 하나 고르기 */
function DraftPick({
  label,
  drafts,
  value,
  onChange,
}: {
  label: string
  drafts: DraftRef[]
  value: string | null
  onChange: (key: string) => void
}) {
  return (
    <label className="block text-[13px]">
      <span className="text-[color:var(--text-muted)]">{label}</span>
      <select
        className="mt-1 block w-full rounded-[8px] border border-[var(--border-subtle)] bg-white px-2 py-1.5 text-[13px]"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— 고르기 —</option>
        {drafts.map((d) => (
          <option key={d.key} value={d.key}>
            {d.source} · {d.pass}차 · {d.pages}쪽 · {d.boxes}구역
          </option>
        ))}
      </select>
    </label>
  )
}

// ============================================================ ③ 함정 쪽

function TrapPanel() {
  const [drafts, setDrafts] = useState<DraftRef[]>(() => listDrafts())
  const [truthKey, setTruthKey] = useState<string | null>(null)
  const [truth, setTruth] = useState<GoldenSet | null>(null)
  const [seed, setSeed] = useState('1')
  const [rate, setRate] = useState('5')
  const [made, setMade] = useState<{ draft: GoldenSet; traps: Trap[] } | null>(null)

  const [trapSet, setTrapSet] = useState<TrapSet | null>(null)
  const [submitted, setSubmitted] = useState<GoldenSet | null>(null)
  const [score, setScore] = useState<TrapResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const make = () => {
    if (!truth) return
    const out = injectTraps(truth, Number(seed) || 1, (Number(rate) || 5) / 100)
    setMade(out)
  }

  const grade = () => {
    if (!trapSet || !submitted) return
    setScore(scoreTraps(submitted, trapSet.traps, trapSet.truth))
  }

  const readJson = <T,>(parse: (t: string) => T, set: (v: T) => void) => async (file: File | null) => {
    if (!file) return
    try {
      set(parse(await file.text()))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Card
      title="③ 함정 쪽"
      hint="부주의를 잡는다 — 초안을 안 보고 Enter를 누르는 것"
    >
      <p className="text-[12px] text-[color:var(--text-faint)]">
        <b>검증이 끝난</b> 골든셋을 흐트러뜨려 초안을 만든다. 검출 결과를 흐트러뜨리면 원래 값이
        옳다는 보장이 없어 “잡았다/놓쳤다”를 판정할 수 없다.
      </p>

      <div className="mt-[var(--space-3)] grid gap-[var(--space-2)] sm:grid-cols-2">
        <DraftPick
          label="원본 (검증 끝난 라벨)"
          drafts={drafts}
          value={truthKey}
          onChange={(k) => {
            setTruthKey(k)
            setTruth(loadDraft(k))
            setMade(null)
          }}
        />
        <div className="flex items-end gap-2">
          <FilePick
            label={truth && !truthKey ? `파일: ${truth.source}` : '파일에서'}
            accept="application/json"
            onPick={readJson(parseGolden, (g) => {
              setTruthKey(null)
              setTruth(g)
              setMade(null)
            })}
          />
          <Button size="sm" variant="ghost" onClick={() => setDrafts(listDrafts())}>
            새로고침
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-[13px]">
          seed
          <Input size="sm" value={seed} onChange={(e) => setSeed(e.target.value)} style={{ width: 64 }} />
        </label>
        <label className="flex items-center gap-1 text-[13px]">
          비율%
          <Input size="sm" value={rate} onChange={(e) => setRate(e.target.value)} style={{ width: 56 }} />
        </label>
        <Button size="sm" onClick={make} disabled={!truth}>
          함정 심기
        </Button>
      </div>

      {made && (
        <>
          <Note tone="good">
            함정 {made.traps.length}개를 심었다. 같은 seed는 같은 함정을 만든다 — 재현되지 않으면
            감사가 아니라 일화다.
          </Note>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => download(`draft-${made.draft.source}.json`, made.draft)}
            >
              초안 내려받기 (라벨러에게)
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                truth && download(`trapset-${truth.source}.json`, { traps: made.traps, truth })
              }
            >
              채점표 내려받기 (보관)
            </Button>
          </div>
          <p className="text-[12px] text-[color:var(--text-faint)]">
            ★ <b>채점표는 라벨러에게 주지 않는다.</b> 정답이 통째로 들어 있어서, 보면 함정이
            감시가 아니라 시험이 된다. 라벨러에게 주는 것은 초안뿐이다.
          </p>
          <Detail summary={`심은 함정 ${made.traps.length}개`}>
            {made.traps.map((t, i) => (
              <div key={i} className="text-[13px]">
                <span className="text-[color:var(--text-faint)]">p{t.page}</span> [{t.kind}] {t.detail}
              </div>
            ))}
          </Detail>
        </>
      )}

      <hr className="my-[var(--space-3)] border-[var(--border-subtle)]" />

      <div className="flex flex-wrap gap-2">
        <FilePick
          label={trapSet ? '채점표 ✓' : '채점표'}
          accept="application/json"
          onPick={readJson(
            (t) => {
              const raw = JSON.parse(t) as { traps: Trap[]; truth: unknown }
              return { traps: raw.traps, truth: parseGolden(JSON.stringify(raw.truth)) }
            },
            setTrapSet,
          )}
        />
        <FilePick
          label={submitted ? '제출본 ✓' : '라벨러 제출본'}
          accept="application/json"
          onPick={readJson(parseGolden, setSubmitted)}
        />
        <Button size="sm" onClick={grade} disabled={!trapSet || !submitted}>
          채점
        </Button>
      </div>

      {error && <Note tone="bad">{error}</Note>}

      {score && (
        <>
          <Note tone={score.missRate === 0 ? 'good' : 'bad'}>
            부주의율 {pct(score.missRate)} — 함정 {score.total}개 중 {score.caught}개를 잡았다.
            {score.missRate === 1 && ' 초안을 그대로 승인한 것이다.'}
          </Note>
          <Rows
            rows={TRAP_KINDS.filter((k) => score.byKind[k].total > 0).map((k) => [
              k,
              `${score.byKind[k].caught}/${score.byKind[k].total}`,
            ])}
          />
          {score.missed.length > 0 && (
            <Detail summary={`못 잡은 함정 ${score.missed.length}개`}>
              {score.missed.map((t, i) => (
                <div key={i} className="text-[13px]">
                  <span className="text-[color:var(--text-faint)]">p{t.page}</span> [{t.kind}] {t.detail}
                </div>
              ))}
            </Detail>
          )}
        </>
      )}
    </Card>
  )
}

// ============================================================ 부품

function Card({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <section className="ds-card space-y-[var(--space-3)] p-[var(--space-4)]">
      <div>
        <h2 className="text-[15px] font-semibold text-[color:var(--text-strong)]">{title}</h2>
        <p className="text-[12px] text-[color:var(--text-faint)]">{hint}</p>
      </div>
      {children}
    </section>
  )
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-[var(--space-4)] gap-y-1 text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-[color:var(--text-muted)]">{k}</dt>
          <dd className="tabular-nums text-[color:var(--text-strong)]">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Note({ tone, children }: { tone: 'good' | 'bad'; children: React.ReactNode }) {
  return (
    <p
      className="rounded-[8px] px-[var(--space-3)] py-[var(--space-2)] text-[13px]"
      style={{
        background: tone === 'good' ? 'var(--grade-o-bg)' : 'var(--grade-x-bg)',
        color: tone === 'good' ? 'var(--grade-o)' : 'var(--grade-x)',
      }}
    >
      {children}
    </p>
  )
}

function Detail({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="rounded-[8px] bg-[var(--ink-50)] px-[var(--space-3)] py-[var(--space-2)]">
      <summary className="cursor-pointer text-[13px] font-medium">{summary}</summary>
      <div className="puri-scroll mt-[var(--space-2)] max-h-64 space-y-0.5 overflow-y-auto">
        {children}
      </div>
    </details>
  )
}

function FilePick({
  label,
  accept,
  onPick,
}: {
  label: string
  accept: string
  onPick: (f: File | null) => void
}) {
  // 파일 입력은 Button으로 감쌀 수 없다 — label + hidden input이 유일한 접근성 있는 방법이다
  // (GoldenLabeler의 FileButton과 같은 모양을 쓴다)
  return (
    <label className="cursor-pointer">
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          onPick(e.target.files?.[0] ?? null)
          e.currentTarget.value = ''
        }}
      />
      <span className="inline-flex h-8 max-w-[240px] items-center truncate rounded-[8px] border border-[var(--border-subtle)] px-3 text-[13px] text-[color:var(--text-default)]">
        {label}
      </span>
    </label>
  )
}

function download(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`

// ============================================================ ④ 라벨 팩 점검
//
// "라벨이 붙었는가"와 "제대로 붙었는가"는 다른 질문이다. 앞은 표가 답하고, **뒤는 눈이
// 답한다** — 배치 검증(§11.4)은 표본 여섯 칸의 잉크만 보는 약한 검사라, 최종 확인은
// 인쇄물 위에 겹쳐 보는 것이다. 그래서 이 칸에는 쪽별 판정표와 오버레이가 함께 있다.

/** 앱의 렌더 폭 (stores/documentStore.ts) — 여기서도 같은 픽셀을 봐야 판정이 같다 */
const SCAN_WIDTH = 1700
const VECTOR_SCAN_WIDTH = 2800
const VIEW_W = 640

type Verdict = {
  page: number
  use: boolean
  reason?: string
  check?: PlacementCheck
  regions: Region[]
}

function PackPanel() {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [fileName, setFileName] = useState('')
  const [docHash, setDocHash] = useState<string | null>(null)
  const [vector, setVector] = useState(false)
  const [drafts, setDrafts] = useState<DraftRef[]>(() => listDrafts())
  const [goldenKey, setGoldenKey] = useState<string | null>(null)
  const [golden, setGolden] = useState<GoldenSet | null>(null)
  const [verdicts, setVerdicts] = useState<Verdict[] | null>(null)
  const [match, setMatch] = useState<PackMatch | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [page, setPage] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const openPdf = async (file: File | null) => {
    if (!file) return
    setError(null)
    setVerdicts(null)
    setPage(null)
    try {
      const bytes = await file.arrayBuffer()
      // ★ 해시를 먼저 — pdf.js가 버퍼 소유권을 가져간다 (documentStore와 같은 순서)
      const hash = await sha256Short(bytes)
      const doc = await loadPdf(bytes)
      setPdf(doc)
      setFileName(file.name)
      setDocHash(hash)
      setVector(await hasTextLayer(doc))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const run = async () => {
    if (!pdf || !golden || !docHash) return
    setError(null)
    setPage(null)
    const pack = { sourceHash: golden.sourceHash ?? '', golden, importedAt: 0 }
    // 점검도 런타임과 같은 길을 탄다 — 해시로 안 붙으면 지문으로 (§11.3 L1)
    let match = matchPack([pack], docHash, null)
    if (!match && golden.pageFingerprints?.length) {
      const fps = await pageFingerprints(pdf, renderPageBitmap)
      match = matchPack([pack], docHash, fps)
    }
    setMatch(match)
    const pages = golden.reviewedPages.filter((p) => p + (match?.offset ?? 0) >= 1)
    const out: Verdict[] = []
    setProgress({ done: 0, total: pages.length })
    try {
      for (const p of pages) {
        // 앱과 같은 폭으로 그린다 — 폭이 다르면 잉크 문턱이 달라져 판정이 갈린다
        // 팩의 p쪽은 이 문서에서 p+offset쪽이다
        const docPage = p + (match?.offset ?? 0)
        if (docPage < 1 || docPage > pdf.numPages) continue
        const raster = await renderPageBitmap(pdf, docPage, vector ? VECTOR_SCAN_WIDTH : SCAN_WIDTH)
        const d = decidePack(match, docPage, 'check', raster)
        out.push(
          d.use
            ? { page: docPage, use: true, check: d.check, regions: d.regions }
            : { page: docPage, use: false, reason: d.reason, check: d.check, regions: [] },
        )
        setProgress({ done: out.length, total: pages.length })
      }
      setVerdicts(out)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setProgress(null)
    }
  }

  const hashOk = !!golden?.sourceHash && golden.sourceHash === docHash
  const used = verdicts?.filter((v) => v.use).length ?? 0
  const selected = verdicts?.find((v) => v.page === page) ?? null

  return (
    <section className="ds-card space-y-[var(--space-3)] p-[var(--space-4)] xl:col-span-2">
      <div>
        <h2 className="text-[15px] font-semibold text-[color:var(--text-strong)]">
          ④ 라벨 팩 점검
        </h2>
        <p className="text-[12px] text-[color:var(--text-faint)]">
          라벨이 어느 쪽에 붙었는지, 그리고 <b>제대로 앉았는지</b>를 인쇄물 위에서 확인한다
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilePick label={fileName ? `PDF: ${fileName}` : 'PDF'} accept="application/pdf" onPick={openPdf} />
        <div className="min-w-[220px]">
          <DraftPick
            label="라벨"
            drafts={drafts}
            value={goldenKey}
            onChange={(k) => {
              setGoldenKey(k)
              setGolden(loadDraft(k))
              setVerdicts(null)
            }}
          />
        </div>
        <FilePick
          label={golden && !goldenKey ? `파일: ${golden.source}` : '파일에서'}
          accept="application/json"
          onPick={async (f) => {
            if (!f) return
            try {
              setGoldenKey(null)
              setGolden(parseGolden(await f.text()))
              setVerdicts(null)
              setError(null)
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
        <Button size="sm" variant="ghost" onClick={() => setDrafts(listDrafts())}>
          새로고침
        </Button>
        <Button size="sm" onClick={() => void run()} disabled={!pdf || !golden || !!progress}>
          {progress ? `점검 중… ${progress.done}/${progress.total}` : '점검'}
        </Button>
      </div>

      {error && <Note tone="bad">{error}</Note>}

      {pdf && golden && (
        <Note tone={hashOk || match?.via === 'fingerprint' ? 'good' : 'bad'}>
          {!golden.sourceHash
            ? '이 라벨에는 원본 해시가 없다 — 라벨러에서 다시 내보내야 런타임에 붙는다.'
            : hashOk
              ? `신원 확인 (L0) — 해시가 같다. 이 PDF의 라벨이 맞다.`
              : match?.via === 'fingerprint'
                ? `신원 확인 (L1) — 해시는 다르지만 쪽 그림이 ${match.alignment?.matched}/${match.alignment?.comparable}쪽 맞았다` +
                  `${match.offset ? ` · 쪽 ${match.offset > 0 ? '+' : ''}${match.offset} 밀림` : ''}. 재압축·재다운로드본으로 보인다.`
                : golden.pageFingerprints?.length
                  ? `해시가 다르고 쪽 지문도 안 맞는다 — 다른 책이다. 붙지 않는다.`
                  : `해시가 다르다. 이 라벨에는 쪽 지문이 없어 L1로도 붙일 수 없다 — 라벨러에서 다시 열어 지문을 만들면 된다.`}
        </Note>
      )}

      {verdicts && (
        <>
          <Rows
            rows={[
              ['라벨된 쪽', `${verdicts.length}쪽 / 전체 ${pdf?.numPages ?? 0}쪽`],
              ['팩이 적용될 쪽', `${used}쪽`],
              ['검출로 떨어질 쪽', `${verdicts.length - used}쪽`],
            ]}
          />
          <div className="flex flex-wrap gap-1">
            {verdicts.map((v) => (
              <button
                key={v.page}
                onClick={() => setPage(v.page)}
                title={v.use ? `배치 확인 ${v.check?.inked}/${v.check?.sampled}` : v.reason}
                className="h-7 min-w-8 rounded-[6px] px-1 text-[12px] tabular-nums"
                style={{
                  background: v.use ? 'var(--grade-o-bg)' : 'var(--grade-x-bg)',
                  color: v.use ? 'var(--grade-o)' : 'var(--grade-x)',
                  outline: v.page === page ? '2px solid var(--text-brand)' : undefined,
                }}
              >
                {v.page}
              </button>
            ))}
          </div>
          {verdicts.some((v) => !v.use) && (
            <Detail summary={`검출로 떨어질 쪽 ${verdicts.length - used}개`}>
              {verdicts
                .filter((v) => !v.use)
                .map((v) => (
                  <div key={v.page} className="text-[13px]">
                    p{v.page} — {v.reason}
                  </div>
                ))}
            </Detail>
          )}
          <p className="text-[12px] text-[color:var(--text-faint)]">
            쪽 번호를 누르면 그 쪽에 라벨을 겹쳐 그린다. 배치 검증이 실제로 본 칸은 네모로
            표시된다 — 초록은 잉크가 있던 칸, 빨강은 비어 있던 칸이다.
          </p>
          {selected && pdf && <PageOverlay pdf={pdf} verdict={selected} golden={golden!} />}
        </>
      )}
    </section>
  )
}

/** 페이지 렌더 위에 라벨과 검증 표본을 겹쳐 그린다 */
function PageOverlay({
  pdf,
  verdict,
  golden,
}: {
  pdf: PDFDocumentProxy
  verdict: Verdict
  golden: GoldenSet
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [height, setHeight] = useState(VIEW_W * 1.414)

  useEffect(() => {
    if (!canvas.current) return
    let alive = true
    void renderPage(pdf, verdict.page, canvas.current, VIEW_W).then(({ cssHeight }) => {
      if (alive) setHeight(cssHeight)
    })
    return () => {
      alive = false
    }
  }, [pdf, verdict.page])

  // 떨어진 쪽도 라벨은 그려 준다 — 왜 떨어졌는지는 겹쳐 봐야 안다
  const boxes = verdict.use
    ? verdict.regions
    : golden.boxes
        .filter((b) => b.page === verdict.page)
        .map((b) => ({ id: b.id, bounds: b.bbox, choices: b.choices, numLabel: b.number }))
  const normH = height / (VIEW_W / MAX_W)

  return (
    <div className="relative w-fit rounded-[10px] border border-[var(--border-subtle)] bg-white">
      <canvas ref={canvas} className="block" />
      <svg
        className="pointer-events-none absolute inset-0"
        width={VIEW_W}
        height={height}
        viewBox={`0 0 ${MAX_W} ${normH}`}
      >
        {boxes.map((b) => (
          <g key={b.id}>
            <rect
              x={b.bounds.x}
              y={b.bounds.y}
              width={b.bounds.w}
              height={b.bounds.h}
              fill="#2F7DD1"
              opacity={0.06}
              stroke="#2F7DD1"
              strokeWidth={1}
            />
            {b.numLabel && (
              <text x={b.bounds.x + 3} y={b.bounds.y + 11} fill="#2F7DD1" fontSize={10} fontWeight={700}>
                {b.numLabel}
              </text>
            )}
            {b.choices.map((c) => (
              <rect
                key={c.label}
                x={c.box.x}
                y={c.box.y}
                width={c.box.w}
                height={c.box.h}
                fill="none"
                stroke="#C98212"
                strokeWidth={0.8}
                strokeDasharray="3 2"
              />
            ))}
          </g>
        ))}
        {/* 배치 검증이 실제로 본 칸 — 이게 §11.4가 판정에 쓴 근거 전부다 */}
        {verdict.check?.samples.map((s, i) => (
          <rect
            key={i}
            x={s.box.x}
            y={s.box.y}
            width={s.box.w}
            height={s.box.h}
            fill={s.inked ? '#26A65E' : '#D5493F'}
            fillOpacity={0.22}
            stroke={s.inked ? '#1E8E4F' : '#D5493F'}
            strokeWidth={1.2}
          />
        ))}
      </svg>
    </div>
  )
}

// ============================================================ 가이드

/**
 * 네 도구는 순서가 있다. 그 순서가 곧 §11.10의 라벨링 절차다 —
 * 초안 없이 시드 → 규약 확정 → IAA → 규모 확대(+함정). 화면에도 그 순서를 적어 둔다.
 */
function Guide() {
  return (
    <details className="ds-card p-[var(--space-4)]" open>
      <summary className="cursor-pointer text-[15px] font-semibold text-[color:var(--text-strong)]">
        쓰는 순서
      </summary>

      <p className="mt-[var(--space-2)] text-[13px] text-[color:var(--text-muted)]">
        라벨은 <b>사람이</b> 만든다. 이 화면은 만들지 않고 <b>잰다</b> — 99%를 목표로 두면
        라벨 오류율이 목표보다 한 자릿수 작아야 하고, 그건 신념이 아니라 측정돼야 한다.
      </p>

      <ol className="mt-[var(--space-3)] space-y-[var(--space-3)] text-[13px]">
        <Step
          n="①"
          title="답지 대조 — 라벨을 만들기 전에"
          need="문제 PDF + 답지 PDF (둘 다 텍스트 레이어 필요)"
          out="놓친 번호 · 연속 구간 · 객관식 오판"
        >
          손 라벨 0쪽으로 지금 검출의 실패 지점을 짚는다. <b>연속 구간이 먼저 라벨할 쪽</b>이다 —
          낱개로 놓친 번호는 그 문항 하나의 문제지만, 연속으로 놓쳤으면 그 쪽이 통째로 무너진
          것이라 원인이 다르다. 스캔본에는 쓸 수 없다(번호 값을 안 읽는다).
        </Step>

        <Step
          n="②"
          title="일치도(IAA) — 규모를 늘리기 전에"
          need="같은 파일을 차수 A·B로 라벨한 것 (파일 주고받기 없음)"
          out={`M4 일치율 (합격선 ${pct(IAA_TARGET)}) · 불일치 목록`}
        >
          잡는 것은 <b>규약의 모호함</b>이다 — 선지 박스 오른쪽 끝을 어디로 볼지, 소문항
          <code> 8-1</code>을 별개 문항으로 볼지, 그림을 bounds에 넣을지. 합격선에 미달하면
          라벨을 더 만들 게 아니라 <b>규약을 먼저 고친다</b>. 두 정답이 그만큼 다르면 99%
          목표는 애초에 측정할 수 없다.
        </Step>

        <Step
          n="③"
          title="함정 쪽 — 규모를 늘리는 동안 계속"
          need="검증이 끝난 골든 JSON (시드셋)"
          out="초안 JSON(라벨러에게) · 채점표 JSON(보관) → 나중에 부주의율"
        >
          잡는 것은 <b>부주의</b>다 — 초안을 안 보고 Enter를 누르는 것. 라벨러는 초안을 받아
          평소대로 라벨하고, 그 제출본을 채점표와 함께 올리면 함정을 몇 개 잡았는지 나온다.
          <b> 검증이 끝난 라벨에만 심는다</b> — 검출 결과를 흐트러뜨리면 원래 값이 옳다는
          보장이 없어 “잡았다/놓쳤다”를 판정할 수 없다.
        </Step>

        <Step
          n="④"
          title="라벨 팩 점검 — 라벨을 앱에 넣기 전에"
          need="PDF + 라벨 JSON"
          out="쪽별 팩/검출 판정 · 인쇄물 위 오버레이"
        >
          런타임과 <b>같은 함수·같은 렌더 폭</b>으로 돌려 “이 라벨이 실제로 붙는가”를 미리
          본다. 표가 답하는 것은 “붙었는가”이고, <b>“제대로 앉았는가”는 오버레이가 답한다</b> —
          배치 검증은 표본 여섯 칸의 잉크만 보는 약한 검사라 최종 확인은 눈이 해야 한다.
          초록/빨강 네모가 검증이 실제로 본 칸이다.
        </Step>
      </ol>

      <p className="mt-[var(--space-3)] rounded-[8px] bg-[var(--ink-50)] px-[var(--space-3)] py-[var(--space-2)] text-[12px] text-[color:var(--text-muted)]">
        <b>전체 흐름</b> — ① 답지 대조로 라벨할 쪽을 고른다 → <code>/dev/golden</code>에서
        시드 20~25쪽을 <b>「초안 자동」을 끄고</b> 라벨한다(차수 A) → 같은 쪽을 차수 B로 다시
        라벨한다 → ②로 규약을 굳힌다 → ③을 켜고 규모를 늘린다 → ④로 확인하고 에디터
        헤더의 「라벨 팩」으로 넣는다.
        <br />
        라벨은 브라우저에 <b>차수별로</b> 저장되므로(<code>{'{파일명}#{차수}'}</code>) ②③④에서
        파일을 주고받을 필요가 없다 — 목록에서 바로 고른다. 파일 넣기는 다른 기기에서 만든
        라벨을 들여올 때만 쓴다.
      </p>
    </details>
  )
}

function Step({
  n,
  title,
  need,
  out,
  children,
}: {
  n: string
  title: string
  need: string
  out: string
  children: React.ReactNode
}) {
  return (
    <li className="border-l-2 border-[var(--border-subtle)] pl-[var(--space-3)]">
      <div className="font-semibold text-[color:var(--text-strong)]">
        {n} {title}
      </div>
      <div className="mt-0.5 text-[12px] text-[color:var(--text-faint)]">
        넣는 것: {need} · 나오는 것: {out}
      </div>
      <p className="mt-1 text-[color:var(--text-default)]">{children}</p>
    </li>
  )
}
