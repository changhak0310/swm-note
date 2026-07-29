// 1단계 · 벡터 비율 측정 — dev 전용
//
// 정답지 PDF 여러 권을 한 번에 넣고 "텍스트 경로만으로 몇 권이 끝나는가"를 잰다.
// 이 한 숫자가 전체 일정을 정한다 — 80%면 며칠, 30%면 몇 주다.
// 알고리즘을 고치기 전에 이걸 먼저 재는 것이 순서다.
//
// 자동 지표는 "텍스트가 있나"까지만 답한다. **텍스트가 있어도 스캔본에 OCR 레이어가
// 얹힌 것일 수 있으므로**, 권당 한 쪽은 미리보기로 눈으로 확인한다 (행 클릭).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDocumentStore } from '../stores/documentStore'
import { paths } from '../routes/paths'
import { Button } from '../design'
import { MAX_W } from '../lib/geometry'
import { IMAGE_OPS, getPageLines, loadPdf, renderPage, type PDFDocumentProxy } from '../lib/pdf'
import {
  probeDocument,
  summarize,
  toCsv,
  type DocProbe,
  type Verdict,
} from '../lib/probe/vectorProbe'
import type { Box } from '../types'

const STORAGE_KEY = 'puri.probe.vector'
const PREVIEW_W = 520

const VERDICT_STYLE: Record<Verdict, { label: string; cls: string }> = {
  VECTOR: { label: 'VECTOR', cls: 'bg-[var(--brand-tint-soft)] text-[color:var(--brand)]' },
  MIXED: { label: 'MIXED', cls: 'bg-[#FFF4E0] text-[#9A6300]' },
  SCAN: { label: 'SCAN', cls: 'bg-[#FDECEC] text-[color:var(--danger)]' },
  ERROR: { label: 'ERROR', cls: 'bg-[var(--ink-150)] text-[color:var(--text-muted)]' },
}

type Progress = { file: string; index: number; total: number; page: number; pages: number } | null

export function VectorProbe() {
  const navigate = useNavigate()
  const close = () => void navigate(paths.list)
  const toast = useDocumentStore((s) => s.showToast)

  const [docs, setDocs] = useState<DocProbe[]>([])
  const [progress, setProgress] = useState<Progress>(null)
  const [sampleLimit, setSampleLimit] = useState(8)
  const [checkImages, setCheckImages] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)

  // 미리보기용으로 File을 들고 있는다 (측정 후 다시 열 수 있게)
  const files = useRef(new Map<string, File>())
  const abort = useRef({ aborted: false })

  // 오래 도는 측정이라 결과를 남긴다 — 실수로 닫아도 표가 살아 있다
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return
    try {
      setDocs(JSON.parse(saved) as DocProbe[])
    } catch {
      /* 형식이 바뀐 옛 결과 — 무시하고 새로 잰다 */
    }
  }, [])

  useEffect(() => {
    if (docs.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(docs))
  }, [docs])

  const summary = useMemo(() => summarize(docs), [docs])

  const run = useCallback(
    async (picked: FileList | null) => {
      const list = Array.from(picked ?? []).filter((f) => /\.pdf$/i.test(f.name))
      if (!list.length) return toast('PDF가 없다')

      abort.current = { aborted: false }
      const out: DocProbe[] = []

      for (let i = 0; i < list.length; i++) {
        if (abort.current.aborted) break
        const file = list[i]
        files.current.set(file.name, file)
        setProgress({ file: file.name, index: i + 1, total: list.length, page: 0, pages: 0 })

        try {
          const pdf = await loadPdf(await file.arrayBuffer())
          const probe = await probeDocument(
            pdf,
            { file: file.name, bytes: file.size },
            {
              sampleLimit,
              imageOps: checkImages ? IMAGE_OPS : [],
              signal: abort.current,
              onPage: (page, pages) =>
                setProgress({ file: file.name, index: i + 1, total: list.length, page, pages }),
            },
          )
          out.push(probe)
          void pdf.destroy()
        } catch (e) {
          // 한 권이 깨져도 나머지를 계속 잰다 — 100권을 한 번에 돌리는 게 목적이다
          out.push({
            file: file.name,
            bytes: file.size,
            pages: 0,
            sampled: [],
            perPage: [],
            totals: {
              textualPages: 0,
              textualRatio: 0,
              chars: 0,
              hangul: 0,
              circled: 0,
              digits: 0,
              imagePaints: 0,
              pairs: 0,
            },
            verdict: 'ERROR',
            note: '열지 못함',
            error: e instanceof Error ? e.message : String(e),
          })
        }
        // 한 권 끝날 때마다 반영 — 100권짜리 실행에서 중간 결과가 보여야 한다
        setDocs([...out])
      }

      setProgress(null)
      toast(abort.current.aborted ? '중단함' : `${out.length}권 측정 완료`)
    },
    [sampleLimit, checkImages, toast],
  )

  const download = (name: string, body: string, type: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([body], { type }))
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const selectedDoc = docs.find((d) => d.file === selected) ?? null

  return (
    <div className="min-h-dvh bg-[var(--canvas)] p-[var(--space-5)]">
      <header className="mb-[var(--space-4)] flex flex-wrap items-center gap-[var(--space-3)]">
        <h1 className="text-[length:var(--text-h2)] font-bold text-[color:var(--text-strong)]">
          1단계 · 벡터 비율 측정
        </h1>
        <span className="text-[13px] text-[color:var(--text-muted)]">
          정답지 PDF를 한꺼번에 넣어라
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-[var(--space-2)]">
          <PickButton label="PDF 여러 개" onPick={run} primary />
          <PickButton label="폴더 통째로" onPick={run} directory />
          <Button
            variant="ghost"
            size="sm"
            disabled={!docs.length}
            onClick={() => download('vector-probe.csv', toCsv(docs), 'text/csv;charset=utf-8')}
          >
            CSV
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!docs.length}
            onClick={() =>
              download('vector-probe.json', JSON.stringify(docs, null, 2), 'application/json')
            }
          >
            JSON
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!docs.length}
            onClick={() => {
              setDocs([])
              setSelected(null)
              localStorage.removeItem(STORAGE_KEY)
            }}
          >
            비우기
          </Button>
          <Button variant="ghost" size="sm" onClick={close}>
            닫기
          </Button>
        </div>
      </header>

      {/* ---------- 설정 ---------- */}
      <div className="mb-[var(--space-4)] flex flex-wrap items-center gap-[var(--space-4)] rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--paper)] px-[var(--space-4)] py-[var(--space-3)] text-[13px]">
        <label className="flex items-center gap-2">
          <span className="text-[color:var(--text-muted)]">표본 쪽수</span>
          <input
            type="number"
            min={0}
            max={200}
            value={sampleLimit}
            onChange={(e) => setSampleLimit(Math.max(0, Number(e.target.value) || 0))}
            className="h-8 w-16 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--paper)] px-2 text-center"
          />
          <span className="text-[color:var(--text-faint)]">0 = 전체 · 균등 간격으로 뽑는다</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={checkImages}
            onChange={(e) => setCheckImages(e.target.checked)}
          />
          <span className="text-[color:var(--text-muted)]">이미지 op 검사</span>
          <span className="text-[color:var(--text-faint)]">
            느리지만 스캔+OCR을 구분하는 데 쓴다
          </span>
        </label>
        {progress && (
          <Button variant="ghost" size="sm" onClick={() => (abort.current.aborted = true)}>
            중단
          </Button>
        )}
      </div>

      {progress && (
        <p className="mb-[var(--space-4)] text-[13px] text-[color:var(--text-muted)]">
          [{progress.index}/{progress.total}] {progress.file} — {progress.page}/{progress.pages}쪽
        </p>
      )}

      {/* ---------- 요약 ---------- */}
      {docs.length > 0 && (
        <div className="mb-[var(--space-4)] flex flex-wrap gap-[var(--space-3)]">
          <Tile label="파일" value={`${summary.files}권`} />
          <Tile label="VECTOR" value={`${summary.vector}권`} />
          <Tile label="MIXED" value={`${summary.mixed}권`} />
          <Tile label="SCAN" value={`${summary.scan}권`} />
          {summary.error > 0 && <Tile label="ERROR" value={`${summary.error}권`} />}
          <Tile
            label="텍스트 경로로 끝나는 비율"
            value={`${Math.round(summary.vectorRatio * 100)}%`}
            strong
          />
        </div>
      )}

      {docs.length > 0 && (
        <p className="mb-[var(--space-3)] text-[13px] text-[color:var(--text-faint)]">
          ⚠ 텍스트가 있어도 스캔본 위에 OCR 레이어가 얹힌 것일 수 있다. 판정을 믿기 전에 권당 한
          쪽은 행을 눌러 미리보기로 확인하라 — 상자가 글자에 맞게 얹히면 진짜 텍스트다.
        </p>
      )}

      {/* ---------- 표 ---------- */}
      {docs.length > 0 && (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--paper)]">
          <table className="w-full min-w-[900px] text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-[color:var(--text-muted)]">
                <Th className="text-left">파일</Th>
                <Th>쪽</Th>
                <Th>표본</Th>
                <Th>텍스트쪽</Th>
                <Th>한글</Th>
                <Th>숫자</Th>
                <Th>원문자</Th>
                <Th>이미지</Th>
                <Th>파싱쌍</Th>
                <Th>판정</Th>
                <Th className="text-left">사유</Th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const v = VERDICT_STYLE[d.verdict]
                return (
                  <tr
                    key={d.file}
                    onClick={() => setSelected(d.file === selected ? null : d.file)}
                    className={`cursor-pointer border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--surface-hover)] ${
                      d.file === selected ? 'bg-[var(--surface-hover)]' : ''
                    }`}
                  >
                    <Td className="max-w-[280px] truncate text-left">{d.file}</Td>
                    <Td>{d.pages}</Td>
                    <Td>{d.sampled.length}</Td>
                    <Td>
                      {d.totals.textualPages}
                      <span className="text-[color:var(--text-faint)]">
                        {' '}
                        ({Math.round(d.totals.textualRatio * 100)}%)
                      </span>
                    </Td>
                    <Td>{d.totals.hangul}</Td>
                    <Td>{d.totals.digits}</Td>
                    <Td>{d.totals.circled}</Td>
                    <Td>{d.totals.imagePaints}</Td>
                    <Td>{d.totals.pairs}</Td>
                    <Td>
                      <span
                        className={`rounded-[6px] px-2 py-0.5 text-[12px] font-semibold ${v.cls}`}
                      >
                        {v.label}
                      </span>
                    </Td>
                    <Td className="max-w-[320px] text-left text-[12px] text-[color:var(--text-muted)]">
                      {d.error ?? d.note}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!docs.length && !progress && (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] px-[var(--space-6)] py-[var(--space-8)] text-center text-[color:var(--text-muted)]">
          <p className="text-[15px]">정답지 PDF를 넣으면 권별로 판정한다.</p>
          <p className="mt-2 text-[13px] text-[color:var(--text-faint)]">
            VECTOR = 텍스트 경로로 끝난다 · MIXED = 일부만 OCR · SCAN = OCR 경로 필요
          </p>
        </div>
      )}

      {selectedDoc && <Preview doc={selectedDoc} file={files.current.get(selectedDoc.file)} />}
    </div>
  )
}

// ---------- 미리보기 ----------
// 자동 지표가 답하지 못하는 것 하나를 사람이 5초에 답한다:
// "이 텍스트가 정말 이 페이지의 텍스트인가, 아니면 스캔본에 얹힌 OCR인가."

function Preview({ doc, file }: { doc: DocProbe; file: File | undefined }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(() => bestPage(doc))
  const [boxes, setBoxes] = useState<Box[]>([])
  const [height, setHeight] = useState(PREVIEW_W * 1.414)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    setPage(bestPage(doc))
  }, [doc])

  useEffect(() => {
    if (!file) return setPdf(null)
    let alive = true
    void file
      .arrayBuffer()
      .then(loadPdf)
      .then((d) => {
        if (alive) setPdf(d)
        else void d.destroy()
      })
    return () => {
      alive = false
    }
  }, [file])

  useEffect(() => {
    if (!pdf || !canvas.current) return
    let alive = true
    void renderPage(pdf, page, canvas.current, PREVIEW_W).then(({ cssHeight }) => {
      if (alive) setHeight(cssHeight)
    })
    void getPageLines(pdf, page).then((lines) => {
      if (alive) setBoxes(lines.flatMap((l) => l.tokens.map((t) => t.box)))
    })
    return () => {
      alive = false
    }
  }, [pdf, page])

  const k = PREVIEW_W / MAX_W
  const probe = doc.perPage.find((p) => p.page === page)

  return (
    <div className="mt-[var(--space-4)] rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--paper)] p-[var(--space-4)]">
      <div className="mb-[var(--space-3)] flex flex-wrap items-center gap-[var(--space-2)] text-[13px]">
        <strong className="text-[color:var(--text-strong)]">{doc.file}</strong>
        <span className="text-[color:var(--text-muted)]">
          {page}쪽 / {doc.pages}
        </span>
        {probe && (
          <span className="text-[color:var(--text-faint)]">
            토큰 {probe.tokens} · 원문자 {probe.circled} · 파싱 {probe.pairs}쌍
            {probe.imagePaints >= 0 && ` · 이미지 op ${probe.imagePaints}`}
          </span>
        )}
        <div className="ml-auto flex items-center gap-[var(--space-2)]">
          {doc.sampled.map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`h-7 rounded-[6px] px-2 text-[12px] ${
                p === page
                  ? 'bg-[var(--brand)] text-white'
                  : 'border border-[var(--border-subtle)] text-[color:var(--text-default)]'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {!file ? (
        <p className="text-[13px] text-[color:var(--text-muted)]">
          이 파일은 저장된 결과다 — 미리보기를 보려면 PDF를 다시 선택하라.
        </p>
      ) : (
        <div className="relative" style={{ width: PREVIEW_W, height }}>
          <canvas ref={canvas} className="absolute inset-0" />
          <svg className="pointer-events-none absolute inset-0" width={PREVIEW_W} height={height}>
            {boxes.map((b, i) => (
              <rect
                key={i}
                x={b.x * k}
                y={b.y * k}
                width={b.w * k}
                height={b.h * k}
                fill="rgba(45,140,90,.14)"
                stroke="rgba(45,140,90,.55)"
                strokeWidth={0.6}
              />
            ))}
          </svg>
        </div>
      )}
      <p className="mt-[var(--space-2)] text-[12px] text-[color:var(--text-faint)]">
        초록 상자가 실제 글자 위에 정확히 얹히면 벡터 텍스트다. 어긋나거나 없으면 스캔본이다.
      </p>
    </div>
  )
}

/** 원문자가 가장 많은 쪽 — 정답표일 가능성이 가장 높은 쪽부터 보여준다 */
function bestPage(doc: DocProbe): number {
  const best = [...doc.perPage].sort((a, b) => b.circled - a.circled || b.tokens - a.tokens)[0]
  return best?.page ?? doc.sampled[0] ?? 1
}

// ---------- 조각 ----------

function Tile({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={`rounded-[var(--radius-lg)] border px-[var(--space-4)] py-[var(--space-3)] ${
        strong
          ? 'border-[var(--green-200)] bg-[var(--brand-tint-soft)]'
          : 'border-[var(--border-subtle)] bg-[var(--paper)]'
      }`}
    >
      <div className="text-[12px] text-[color:var(--text-muted)]">{label}</div>
      <div className="text-[length:var(--text-h3)] font-bold text-[color:var(--text-strong)]">
        {value}
      </div>
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-right font-medium ${className}`}>{children}</th>
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-right tabular-nums ${className}`}>{children}</td>
}

function PickButton({
  label,
  onPick,
  primary,
  directory,
}: {
  label: string
  onPick: (files: FileList | null) => void | Promise<void>
  primary?: boolean
  directory?: boolean
}) {
  return (
    <label className="cursor-pointer">
      <input
        type="file"
        accept="application/pdf"
        multiple
        // 폴더 선택 — 표준 속성이 아니라 React 타입에 없다
        {...(directory ? ({ webkitdirectory: '' } as Record<string, string>) : {})}
        className="hidden"
        onChange={(e) => {
          void onPick(e.target.files)
          e.currentTarget.value = ''
        }}
      />
      <span
        className={
          primary
            ? 'inline-flex h-8 items-center rounded-[8px] bg-[var(--brand)] px-3 text-[13px] font-semibold text-white'
            : 'inline-flex h-8 items-center rounded-[8px] border border-[var(--border-subtle)] px-3 text-[13px] text-[color:var(--text-default)]'
        }
      >
        {label}
      </span>
    </label>
  )
}
