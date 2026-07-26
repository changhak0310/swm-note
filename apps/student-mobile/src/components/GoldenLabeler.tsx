// 골든셋 라벨링 — dev 전용.
//
// 알고리즘 결과를 씨앗으로 깔고 사람이 고친다. 빈 화면에서 그리게 하면 50문항에
// 한 시간이 넘게 걸리고, 그러면 골든셋이 영영 안 만들어진다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDocumentStore } from '../stores/documentStore'
import { Button, Input } from '../design'
import { MAX_W } from '../lib/geometry'
import { loadPdf, renderPage, type PDFDocumentProxy } from '../lib/pdf'
import { runPipeline } from '../lib/psp'
import { documentInput, toAppRegions } from '../lib/psp/adapter'
import {
  emptyGolden,
  parseGolden,
  type GoldenBox,
  type GoldenChoice,
  type GoldenSet,
} from '../lib/psp/golden'
import type { Box, ChoiceLabel } from '../types'

const VIEW_W = 720
const HANDLE = 7          // 정규화 좌표 기준 핸들 반변
const MIN_SIZE = 6

type Corner = 'nw' | 'ne' | 'sw' | 'se'

type Drag =
  /** parentId가 있으면 그 문항의 새 선지를, 없으면 새 문항을 만든다 */
  | { mode: 'new'; from: Pt; to: Pt; parentId: string | null }
  | { mode: 'move'; from: Pt; orig: Box }
  | { mode: 'resize'; corner: Corner; orig: Box }
  | null

type Pt = { x: number; y: number }

/** 선택 대상 — 문항 상자 또는 그 안의 선지 상자 */
type Sel = { boxId: string; choice: ChoiceLabel | null }

const storageKey = (source: string) => `puri.golden.${source}`

export function GoldenLabeler() {
  const close = useDocumentStore((s) => s.closeGolden)
  const toast = useDocumentStore((s) => s.showToast)

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [fileName, setFileName] = useState('')
  const [golden, setGolden] = useState<GoldenSet | null>(null)
  const [page, setPage] = useState(1)
  const [sel, setSel] = useState<Sel | null>(null)
  const [drag, setDrag] = useState<Drag>(null)
  const [seeded, setSeeded] = useState<Map<number, GoldenBox[]>>(new Map())
  const [busy, setBusy] = useState(false)
  const [choiceMode, setChoiceMode] = useState(false)

  const canvas = useRef<HTMLCanvasElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const [height, setHeight] = useState(VIEW_W * 1.414)

  // ---------- 로드 ----------

  const openPdf = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const doc = await loadPdf(await file.arrayBuffer())
      setPdf(doc)
      setFileName(file.name)
      setPage(1)
      setSel(null)

      const saved = localStorage.getItem(storageKey(file.name))
      setGolden(saved ? parseGolden(saved) : emptyGolden(file.name, doc.numPages))

      // PSP 결과를 씨앗으로 준비 — 페이지마다 "채우기"로 꺼내 쓴다
      try {
        const result = runPipeline(await documentInput(doc, true), { jobId: 'golden' })
        const byPage = new Map<number, GoldenBox[]>()
        for (const r of toAppRegions(result, 'golden')) {
          const arr = byPage.get(r.page) ?? []
          arr.push({
            id: `${r.page}-${r.numLabel}-${arr.length}`,
            page: r.page,
            number: r.numLabel ?? '',
            bbox: r.bounds,
            choices: r.choices.map((c) => ({ label: c.label, box: c.box })),
          })
          byPage.set(r.page, arr)
        }
        setSeeded(byPage)
      } catch {
        setSeeded(new Map())     // 앵커를 못 찾는 문서 — 빈 화면에서 시작한다
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // 변경할 때마다 저장 — 실수로 닫아도 작업이 남는다
  useEffect(() => {
    if (!golden) return
    localStorage.setItem(storageKey(golden.source), JSON.stringify(golden))
  }, [golden])

  useEffect(() => {
    if (!pdf || !canvas.current) return
    let alive = true
    void renderPage(pdf, page, canvas.current, VIEW_W).then(({ cssHeight }) => {
      if (alive) setHeight(cssHeight)
    })
    return () => {
      alive = false
    }
  }, [pdf, page])

  // ---------- 편집 ----------

  const boxes = useMemo(
    () => (golden?.boxes ?? []).filter((b) => b.page === page),
    [golden, page],
  )
  const reviewed = !!golden?.reviewedPages.includes(page)

  const mutate = useCallback(
    (fn: (g: GoldenSet) => GoldenSet) =>
      setGolden((g) => (g ? { ...fn(g), updatedAt: new Date().toISOString() } : g)),
    [],
  )

  const updateBox = useCallback(
    (id: string, patch: Partial<GoldenBox>) =>
      mutate((g) => ({
        ...g,
        boxes: g.boxes.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      })),
    [mutate],
  )

  const removeSelected = useCallback(() => {
    if (!sel) return
    if (sel.choice === null) {
      mutate((g) => ({ ...g, boxes: g.boxes.filter((b) => b.id !== sel.boxId) }))
      setSel(null)
    } else {
      mutate((g) => ({
        ...g,
        boxes: g.boxes.map((b) =>
          b.id === sel.boxId ? { ...b, choices: b.choices.filter((c) => c.label !== sel.choice) } : b,
        ),
      }))
      setSel({ ...sel, choice: null })
    }
  }, [sel, mutate])

  const seedPage = useCallback(() => {
    const src = seeded.get(page) ?? []
    mutate((g) => ({
      ...g,
      boxes: [
        ...g.boxes.filter((b) => b.page !== page),
        ...src.map((b, i) => ({ ...b, id: `${page}-seed-${i}-${b.number}` })),
      ],
    }))
    setSel(null)
  }, [seeded, page, mutate])

  const clearPage = useCallback(() => {
    mutate((g) => ({ ...g, boxes: g.boxes.filter((b) => b.page !== page) }))
    setSel(null)
  }, [page, mutate])

  const setReviewed = useCallback(
    (on: boolean) =>
      mutate((g) => ({
        ...g,
        reviewedPages: on
          ? [...new Set([...g.reviewedPages, page])].sort((a, b) => a - b)
          : g.reviewedPages.filter((p) => p !== page),
      })),
    [page, mutate],
  )

  const gotoPage = useCallback(
    (p: number) => {
      if (!golden) return
      setPage(Math.min(golden.pageCount, Math.max(1, p)))
      setSel(null)
    },
    [golden],
  )

  // ---------- 좌표 ----------

  const toNormPt = useCallback((e: { clientX: number; clientY: number }): Pt => {
    const rect = svg.current!.getBoundingClientRect()
    const f = MAX_W / rect.width
    return { x: (e.clientX - rect.left) * f, y: (e.clientY - rect.top) * f }
  }, [])

  const selectedBox = boxes.find((b) => b.id === sel?.boxId) ?? null
  const activeBox: Box | null =
    sel && selectedBox
      ? sel.choice === null
        ? selectedBox.bbox
        : (selectedBox.choices.find((c) => c.label === sel.choice)?.box ?? null)
      : null

  const applyActive = useCallback(
    (box: Box) => {
      if (!sel || !selectedBox) return
      if (sel.choice === null) updateBox(sel.boxId, { bbox: box })
      else {
        // 선지는 문항 밖으로 나갈 수 없다 — 채점기가 문항 안에서만 히트테스트한다
        const clamped = clampTo(box, selectedBox.bbox)
        updateBox(sel.boxId, {
          choices: selectedBox.choices.map((c) => (c.label === sel.choice ? { ...c, box: clamped } : c)),
        })
      }
    },
    [sel, selectedBox, updateBox],
  )

  const onPointerDown = (e: React.PointerEvent) => {
    if (!golden) return
    const p = toNormPt(e)
    svg.current?.setPointerCapture(e.pointerId)

    // 선택된 상자의 핸들 먼저
    if (activeBox) {
      const corner = hitCorner(p, activeBox)
      if (corner) return setDrag({ mode: 'resize', corner, orig: activeBox })
    }

    // 선지 편집 모드 — 선택된 문항 안에서는 문항을 옮기지 않고 선지를 다룬다.
    // 이동 분기를 먼저 태우면 새 선지를 그릴 자리가 없어진다.
    if (choiceMode && selectedBox) {
      const c = selectedBox.choices.find((c) => inside(p, c.box))
      if (c) {
        setSel({ boxId: selectedBox.id, choice: c.label })
        return setDrag({ mode: 'move', from: p, orig: c.box })
      }
      if (inside(p, selectedBox.bbox)) {
        setSel({ boxId: selectedBox.id, choice: null })
        return setDrag({ mode: 'new', from: p, to: p, parentId: selectedBox.id })
      }
    }

    if (activeBox && inside(p, activeBox)) {
      return setDrag({ mode: 'move', from: p, orig: activeBox })
    }

    const hit = [...boxes].reverse().find((b) => inside(p, b.bbox))
    if (hit) {
      setSel({ boxId: hit.id, choice: null })
      return setDrag({ mode: 'move', from: p, orig: hit.bbox })
    }

    setSel(null)
    setDrag({ mode: 'new', from: p, to: p, parentId: null })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return
    const p = toNormPt(e)
    if (drag.mode === 'new') return setDrag({ ...drag, to: p })
    if (drag.mode === 'move') {
      applyActive({
        ...drag.orig,
        x: drag.orig.x + (p.x - drag.from.x),
        y: drag.orig.y + (p.y - drag.from.y),
      })
      return
    }
    applyActive(resize(drag.orig, drag.corner, p))
  }

  const onPointerUp = () => {
    if (drag?.mode === 'new') {
      const box = rectOf(drag.from, drag.to)
      if (box.w >= MIN_SIZE && box.h >= MIN_SIZE) {
        const parent = drag.parentId ? boxes.find((b) => b.id === drag.parentId) : null
        if (parent) addChoice(parent, clampTo(box, parent.bbox))
        else addProblem(box)
      }
    }
    setDrag(null)
  }

  const addProblem = (bbox: Box) => {
    const nums = boxes.map((b) => Number(b.number)).filter(Number.isFinite)
    const next = nums.length ? String(Math.max(...nums) + 1) : ''
    const id = `${page}-new-${Date.now()}`
    mutate((g) => ({ ...g, boxes: [...g.boxes, { id, page, number: next, bbox, choices: [] }] }))
    setSel({ boxId: id, choice: null })
  }

  const addChoice = (parent: GoldenBox, box: Box) => {
    const used = new Set(parent.choices.map((c) => c.label))
    const label = ([1, 2, 3, 4, 5] as ChoiceLabel[]).find((l) => !used.has(l))
    if (!label) return toast('선지는 5개까지다')
    updateBox(parent.id, {
      choices: [...parent.choices, { label, box }].sort((a, b) => a.label - b.label),
    })
    setSel({ boxId: parent.id, choice: label })
  }

  // ---------- 단축키 (UI-7) ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.isContentEditable) return
      if (!golden) return

      switch (e.key) {
        case 'Enter':
          e.preventDefault()
          setReviewed(true)
          gotoPage(page + 1)
          break
        case ' ':
          e.preventDefault()
          gotoPage(page + 1)
          break
        case 'Backspace':
          e.preventDefault()
          gotoPage(page - 1)
          break
        case 'Delete':
          e.preventDefault()
          removeSelected()
          break
        case 'f':
        case 'F':
          e.preventDefault()
          seedPage()
          break
        case 'c':
        case 'C':
          e.preventDefault()
          setChoiceMode((v) => !v)
          break
        case 'Escape':
          setSel(null)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [golden, page, gotoPage, setReviewed, removeSelected, seedPage])

  // ---------- 내보내기 ----------

  const exportJson = () => {
    if (!golden) return
    const blob = new Blob([JSON.stringify(golden, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `golden-${golden.source.replace(/\.pdf$/i, '')}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importJson = async (file: File | undefined) => {
    if (!file) return
    try {
      const g = parseGolden(await file.text())
      setGolden(g)
      toast(`골든셋 ${g.boxes.length}구역 · 확인 ${g.reviewedPages.length}페이지 불러옴`)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    }
  }

  const normH = height / (VIEW_W / MAX_W)
  const previewNew = drag?.mode === 'new' ? rectOf(drag.from, drag.to) : null

  return (
    <div className="min-h-dvh bg-[var(--canvas)] p-[var(--space-5)]">
      <header className="mb-[var(--space-4)] flex flex-wrap items-center gap-[var(--space-3)]">
        <h1 className="text-[length:var(--text-h2)] font-bold text-[color:var(--text-strong)]">
          골든셋 라벨링
        </h1>
        {fileName && (
          <span className="text-[13px] text-[color:var(--text-muted)]">{fileName}</span>
        )}
        <div className="ml-auto flex items-center gap-[var(--space-2)]">
          <FileButton accept="application/pdf" onPick={openPdf} label="PDF 열기" primary />
          <FileButton accept="application/json" onPick={importJson} label="JSON 가져오기" />
          <Button variant="ghost" size="sm" onClick={exportJson} disabled={!golden}>
            JSON 내보내기
          </Button>
          <Button variant="ghost" size="sm" onClick={close}>
            닫기
          </Button>
        </div>
      </header>

      {busy && <p className="text-[color:var(--text-muted)]">PDF를 읽고 초안을 만드는 중…</p>}

      {!golden && !busy && (
        <div className="mt-[var(--space-8)] text-center text-[color:var(--text-muted)]">
          <p>PDF를 열면 알고리즘 결과가 초안으로 깔린다. 그걸 고쳐서 정답을 만든다.</p>
          <p className="mt-2 text-[13px] text-[color:var(--text-faint)]">
            작업은 브라우저에 자동 저장된다. 끝나면 JSON으로 내보내 리포지토리에 넣는다.
          </p>
        </div>
      )}

      {golden && (
        <div className="flex gap-[var(--space-5)]">
          {/* ---------- 캔버스 ---------- */}
          <div>
            <div className="mb-2 flex items-center gap-[var(--space-2)]">
              <Button variant="ghost" size="sm" onClick={() => gotoPage(page - 1)}>
                ←
              </Button>
              <span className="text-[14px] font-medium tabular-nums">
                {page} / {golden.pageCount}
              </span>
              <Button variant="ghost" size="sm" onClick={() => gotoPage(page + 1)}>
                →
              </Button>
              <span className="ml-2 text-[13px] text-[color:var(--text-muted)]">
                {boxes.length}구역
                {reviewed ? ' · 확인 완료' : ''}
              </span>
            </div>

            <div
              className="relative w-fit rounded-[10px] border border-[var(--border-subtle)] bg-white"
              style={{ touchAction: 'none' }}
            >
              <canvas ref={canvas} className="block" />
              <svg
                ref={svg}
                className="absolute inset-0 cursor-crosshair"
                width={VIEW_W}
                height={height}
                viewBox={`0 0 ${MAX_W} ${normH}`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >
                {boxes.map((b) => {
                  const on = b.id === sel?.boxId
                  return (
                    <g key={b.id}>
                      <rect
                        {...rectAttrs(b.bbox)}
                        fill={on ? '#26A65E' : '#2F7DD1'}
                        opacity={on ? 0.16 : 0.08}
                        stroke={on ? '#1E8E4F' : '#2F7DD1'}
                        strokeWidth={on ? 2 : 1.2}
                      />
                      <text
                        x={b.bbox.x + 4}
                        y={b.bbox.y + 14}
                        fill={on ? '#1E8E4F' : '#2F7DD1'}
                        fontSize={12}
                        fontWeight={600}
                      >
                        {b.number || '?'}
                      </text>
                      {(on || choiceMode) &&
                        b.choices.map((c) => (
                          <rect
                            key={c.label}
                            {...rectAttrs(c.box)}
                            fill="none"
                            stroke={sel?.boxId === b.id && sel.choice === c.label ? '#C98212' : '#9AA091'}
                            strokeWidth={sel?.boxId === b.id && sel.choice === c.label ? 2 : 1}
                            strokeDasharray="4 3"
                          />
                        ))}
                    </g>
                  )
                })}

                {activeBox &&
                  corners(activeBox).map(([cx, cy], i) => (
                    <rect
                      key={i}
                      x={cx - HANDLE}
                      y={cy - HANDLE}
                      width={HANDLE * 2}
                      height={HANDLE * 2}
                      fill="#fff"
                      stroke="#1E8E4F"
                      strokeWidth={2}
                    />
                  ))}

                {previewNew && (
                  <rect
                    {...rectAttrs(previewNew)}
                    fill="#26A65E"
                    opacity={0.15}
                    stroke="#1E8E4F"
                    strokeDasharray="6 4"
                  />
                )}
              </svg>
            </div>
          </div>

          {/* ---------- 패널 ---------- */}
          <aside className="w-[300px] shrink-0 space-y-[var(--space-4)]">
            <div className="ds-card p-[var(--space-4)]">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={seedPage} disabled={!seeded.get(page)?.length}>
                  PSP로 채우기 (F)
                </Button>
                <Button variant="ghost" size="sm" onClick={clearPage}>
                  페이지 비우기
                </Button>
              </div>
              <label className="mt-[var(--space-3)] flex items-center gap-2 text-[14px]">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                이 페이지 확인 완료
              </label>
              <p className="mt-1 text-[12px] text-[color:var(--text-faint)]">
                구역이 하나도 없는 채로 확인 완료하면 “문항 없음이 정답”이라는 뜻이다.
                확인하지 않은 페이지는 채점에서 빠진다.
              </p>
              <label className="mt-[var(--space-3)] flex items-center gap-2 text-[14px]">
                <input
                  type="checkbox"
                  checked={choiceMode}
                  onChange={(e) => setChoiceMode(e.target.checked)}
                />
                선지 편집 모드 (C)
              </label>
            </div>

            {selectedBox && (
              <div className="ds-card p-[var(--space-4)]">
                <h3 className="mb-[var(--space-2)] text-[14px] font-semibold">선택한 구역</h3>
                <Input
                  size="sm"
                  value={selectedBox.number}
                  onChange={(e) => updateBox(selectedBox.id, { number: e.target.value })}
                  placeholder="문항 번호"
                />
                <div className="mt-[var(--space-3)] flex flex-wrap gap-1">
                  {selectedBox.choices.map((c) => (
                    <button
                      key={c.label}
                      onClick={() => setSel({ boxId: selectedBox.id, choice: c.label })}
                      className={`h-7 w-7 rounded-[6px] text-[13px] ${
                        sel?.choice === c.label
                          ? 'bg-[var(--grade-tri-bg)] font-semibold text-[color:var(--grade-tri)]'
                          : 'bg-[var(--ink-100)] text-[color:var(--text-muted)]'
                      }`}
                    >
                      {'①②③④⑤'[c.label - 1]}
                    </button>
                  ))}
                  {selectedBox.choices.length === 0 && (
                    <span className="text-[13px] text-[color:var(--text-faint)]">
                      선지 라벨 없음 (채점에서 제외)
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={removeSelected}
                  style={{ marginTop: 'var(--space-3)' }}
                >
                  {sel?.choice === null ? '구역 삭제 (Del)' : '선지 삭제 (Del)'}
                </Button>
              </div>
            )}

            <div className="ds-card p-[var(--space-4)]">
              <h3 className="mb-[var(--space-2)] text-[14px] font-semibold">
                진행 {golden.reviewedPages.length} / {golden.pageCount} 페이지 · 총{' '}
                {golden.boxes.length}구역
              </h3>
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: golden.pageCount }, (_, i) => i + 1).map((p) => {
                  const done = golden.reviewedPages.includes(p)
                  const n = golden.boxes.filter((b) => b.page === p).length
                  return (
                    <button
                      key={p}
                      onClick={() => gotoPage(p)}
                      title={done ? `${p}쪽 · 확인 완료 · ${n}구역` : `${p}쪽 · 미확인`}
                      className={[
                        'h-6 min-w-6 rounded-[5px] px-1 text-[11px] tabular-nums',
                        done
                          ? n
                            ? 'bg-[var(--grade-o-bg)] font-semibold text-[color:var(--grade-o)]'
                            : 'bg-[var(--ink-200)] text-[color:var(--text-muted)]'
                          : 'bg-[var(--ink-100)] text-[color:var(--text-faint)]',
                        p === page ? 'ring-2 ring-[var(--brand)]' : '',
                      ].join(' ')}
                    >
                      {p}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="ds-card p-[var(--space-4)] text-[12px] leading-relaxed text-[color:var(--text-muted)]">
              <b className="text-[color:var(--text-default)]">단축키</b>
              <br />
              Enter 확인 완료 후 다음 · Space 다음 · Backspace 이전
              <br />
              Del 선택 삭제 · F PSP로 채우기 · C 선지 모드 · Esc 선택 해제
              <br />
              빈 곳 드래그로 새 구역, 모서리 드래그로 크기 조정
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

// ---------- 보조 ----------

function FileButton({
  accept,
  onPick,
  label,
  primary,
}: {
  accept: string
  onPick: (f: File | undefined) => void | Promise<void>
  label: string
  primary?: boolean
}) {
  return (
    <label className="cursor-pointer">
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          void onPick(e.target.files?.[0])
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

const rectAttrs = (b: Box) => ({ x: b.x, y: b.y, width: b.w, height: b.h })

const inside = (p: Pt, b: Box) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h

function corners(b: Box): [number, number][] {
  return [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x, b.y + b.h],
    [b.x + b.w, b.y + b.h],
  ]
}

function hitCorner(p: Pt, b: Box): Corner | null {
  const names: Corner[] = ['nw', 'ne', 'sw', 'se']
  const cs = corners(b)
  for (let i = 0; i < cs.length; i++) {
    if (Math.abs(p.x - cs[i][0]) <= HANDLE && Math.abs(p.y - cs[i][1]) <= HANDLE) return names[i]
  }
  return null
}

/** 부모 문항 안으로 잘라 넣는다 */
function clampTo(b: Box, parent: Box): Box {
  const x = Math.min(Math.max(b.x, parent.x), parent.x + parent.w)
  const y = Math.min(Math.max(b.y, parent.y), parent.y + parent.h)
  return {
    x,
    y,
    w: Math.min(b.w, parent.x + parent.w - x),
    h: Math.min(b.h, parent.y + parent.h - y),
  }
}

function rectOf(a: Pt, b: Pt): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  }
}

function resize(orig: Box, corner: Corner, p: Pt): Box {
  const left = corner === 'nw' || corner === 'sw'
  const top = corner === 'nw' || corner === 'ne'
  const anchor: Pt = { x: left ? orig.x + orig.w : orig.x, y: top ? orig.y + orig.h : orig.y }
  const box = rectOf(anchor, p)
  return { ...box, w: Math.max(MIN_SIZE, box.w), h: Math.max(MIN_SIZE, box.h) }
}

export type { GoldenChoice }
