// F-06 정답 직접 입력 — 문항당 한 행, 20문항을 20탭으로.
// 행은 Region[]에서 자동 생성된다. 이 화면은 분할 결과 검증을 겸한다.
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AnswerEntry, Region } from '../types'
import { useDocumentStore } from '../stores/documentStore'
import { paths } from '../routes/paths'
import { useGrade } from '../routes/useGrade'
import { Button, Chip } from '../design'

const CHOICE_VALUES = ['1', '2', '3', '4', '5'] as const
const CIRCLED = ['①', '②', '③', '④', '⑤']

export function AnswerKeyScreen() {
  const doc = useDocumentStore((s) => s.doc)
  const regionsByPage = useDocumentStore((s) => s.regionsByPage)
  const answerKey = useDocumentStore((s) => s.answerKey)
  const store = useDocumentStore.getState()
  const navigate = useNavigate()
  const grade = useGrade()

  const answerFileRef = useRef<HTMLInputElement>(null)
  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  const [inlinePrompt, setInlinePrompt] = useState(false)
  const [inlinePages, setInlinePages] = useState('')
  const [parseWarning, setParseWarning] = useState<string | null>(null)

  const rows = useMemo(() => {
    const all: { region: Region; page: number }[] = []
    for (const [page, regions] of Object.entries(regionsByPage)) {
      for (const r of regions) all.push({ region: r, page: Number(page) })
    }
    all.sort((a, b) => Number(a.region.numLabel ?? 999) - Number(b.region.numLabel ?? 999))
    return all
  }, [regionsByPage])

  if (!doc) return null

  const entryOf = new Map((answerKey?.entries ?? []).map((e) => [e.regionId, e]))
  // choices가 비어도 answerType이 choice면 입력 가능 — 주관식 오인식 복구 경로 (규칙 2)
  const choiceCapable = rows.filter(
    ({ region }) => region.choices.length > 0 || region.answerType === 'choice',
  )
  const entered = choiceCapable.filter(({ region }) => entryOf.has(region.id)).length

  const afterParse = (count: number) => {
    if (count > 0 && count !== choiceCapable.length) {
      setParseWarning(
        `정답 ${count}개를 불러왔어 · 객관식 문항 수(${choiceCapable.length}개)와 달라. 그래도 진행할 수 있어.`,
      )
    } else {
      setParseWarning(null)
    }
  }

  const select = (region: Region, value: string, index: number) => {
    const current = entryOf.get(region.id)
    if (current?.value === value) {
      void store.setAnswer(region.id, null)             // 같은 번호 재탭 → 해제 (규칙 5)
      return
    }
    void store.setAnswer(region.id, value)
    // 다음 행으로 자동 스크롤 — 이 화면의 핵심 동작 (규칙 4)
    const next = rows[index + 1]
    if (next) {
      rowRefs.current
        .get(next.region.id)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--surface-page)]">
      <header className="flex h-[60px] flex-none items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--paper)] px-[var(--space-4)]">
        <button
          aria-label="필기 화면으로"
          className="grid h-11 w-11 place-items-center rounded-[10px] text-[color:var(--text-default)]"
          onClick={() => void navigate(paths.doc(doc.id))}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <h1 className="text-[20px] font-semibold text-[color:var(--text-strong)]">정답 입력</h1>
        <span className="num ml-2 rounded-full bg-[var(--brand-tint)] px-3 py-1 text-[13px] font-semibold text-[color:var(--text-brand)]">
          {entered} / {choiceCapable.length} 입력됨
        </span>
        <div className="flex-1" />
        <Button variant="secondary" size="sm" onClick={() => answerFileRef.current?.click()}>
          정답지 PDF 불러오기
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setInlinePrompt(true)}>
          문제지에서 찾기
        </Button>
        <Button size="sm" onClick={() => { void navigate(paths.doc(doc.id)); void grade() }}>
          채점하기
        </Button>
        <input
          ref={answerFileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void store.importAnswerPdfFile(f).then(afterParse)
          }}
        />
      </header>

      {parseWarning && (
        <div className="border-b border-[var(--grade-tri-ring)] bg-[var(--grade-tri-bg)] px-[var(--space-6)] py-[var(--space-2)] text-[13px] text-[color:var(--grade-tri)]">
          {parseWarning}
        </div>
      )}

      <main className="puri-scroll mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-[var(--space-6)] py-[var(--space-4)]">
        {rows.length === 0 ? (
          <p className="py-16 text-center text-[color:var(--text-muted)]">
            분할된 문항이 없어. 이 PDF는 자동 채점을 지원하지 않아.
          </p>
        ) : (
          <ul className="ds-card divide-y divide-[var(--border-subtle)] px-[var(--space-5)]">
            {rows.map(({ region, page }, i) => {
              const capable = region.choices.length > 0 || region.answerType === 'choice'
              const entry = entryOf.get(region.id)
              return (
                <li
                  key={region.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(region.id, el)
                  }}
                  className="flex items-center gap-[var(--space-4)] py-[var(--space-3)]"
                  style={{ opacity: capable ? 1 : 0.55 }}
                  onClick={() => {
                    // 회색 행 탭 → 5지선다 전환. 오인식 복구의 유일한 경로 (규칙 2)
                    if (!capable) void store.convertRegionToChoice(region.id)
                  }}
                >
                  <span className="num w-11 shrink-0 text-[16px] font-semibold text-[color:var(--text-strong)]">
                    {region.numLabel ?? '—'}
                  </span>
                  <span className="w-8 shrink-0 text-[12px] text-[color:var(--text-faint)]">p{page}</span>

                  {capable ? (
                    <div className="flex gap-[var(--space-2)]">
                      {CHOICE_VALUES.map((v, ci) => {
                        const on = entry?.value === v
                        return (
                          <button
                            key={v}
                            className="grid h-10 w-10 place-items-center rounded-full text-[15px] transition-colors duration-[120ms]"
                            style={{
                              background: on ? 'var(--brand)' : 'var(--paper)',
                              color: on ? 'var(--text-invert)' : 'var(--text-default)',
                              border: `1.5px solid ${on ? 'var(--brand)' : 'var(--border-strong)'}`,
                            }}
                            onClick={() => select(region, v, i)}
                          >
                            {CIRCLED[ci]}
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <span className="text-[13px] text-[color:var(--text-muted)]">
                      주관식 — 1차에서는 채점하지 않습니다 <span className="text-[color:var(--text-faint)]">(탭하면 5지선다로 전환)</span>
                    </span>
                  )}

                  <span className="ml-auto">
                    <StatusChip capable={capable} entry={entry} />
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        <p className="py-[var(--space-4)] text-center text-[13px] text-[color:var(--text-faint)]">
          전 문항을 채우지 않아도 돼. 입력된 문항만 채점 대상이 된다.
        </p>
      </main>

      {/* 문제지 내 정답표 — 사용자가 정답표 페이지를 지정한다 (F-05 규칙 2) */}
      {inlinePrompt && (
        <div
          className="fixed inset-0 z-40 grid place-items-center p-6"
          style={{ background: 'rgba(27,31,22,0.32)', backdropFilter: 'blur(3px)' }}
          onClick={() => setInlinePrompt(false)}
        >
          <div
            className="w-full max-w-md rounded-[var(--radius-xl)] bg-[var(--paper)] p-[var(--space-6)] shadow-[var(--shadow-lg)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-[length:var(--text-h3)] font-semibold text-[color:var(--text-strong)]">
              문제지에서 정답표 찾기
            </h2>
            <p className="mt-1.5 text-[14px] text-[color:var(--text-muted)]">
              정답표가 있는 페이지 번호를 알려줘. 쉼표로 여러 페이지를 적을 수 있어.
            </p>
            <input
              autoFocus
              value={inlinePages}
              onChange={(e) => setInlinePages(e.target.value)}
              placeholder={`예: ${doc.pageCount}`}
              className="num mt-[var(--space-4)] h-11 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--paper)] px-3.5 text-[15px] outline-none focus:border-[var(--border-focus)] focus:shadow-[var(--shadow-focus)]"
            />
            <div className="mt-[var(--space-5)] flex justify-end gap-[var(--space-2)]">
              <Button variant="ghost" onClick={() => setInlinePrompt(false)}>
                취소
              </Button>
              <Button
                onClick={() => {
                  const pages = (inlinePages || String(doc.pageCount))
                    .split(',')
                    .map((s) => Number(s.trim()))
                    .filter((n) => Number.isInteger(n) && n >= 1)
                  setInlinePrompt(false)
                  void store.parseInlineKey(pages).then(afterParse)
                }}
              >
                찾기
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusChip({ capable, entry }: { capable: boolean; entry?: AnswerEntry }) {
  if (!capable) return <Chip size="sm" tone="muted">제외</Chip>
  if (!entry) return <Chip size="sm" tone="muted">미입력</Chip>
  if (entry.source === 'manual') return <Chip size="sm" tone="neutral">직접 입력</Chip>
  return <Chip size="sm" tone="brand">불러옴</Chip>
}
