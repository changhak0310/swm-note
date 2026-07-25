// 키보드 텍스트 레이어 — 텍스트 도구일 때만 입력을 받는다.
// 빈 곳 탭 = 새 텍스트 박스, 기존 박스 탭 = 편집, 드래그 = 이동, 비우고 닫으면 삭제.
// 좌표·폭은 정규화 좌표(MAX_W 기준)로 저장해 어느 줌에서도 같은 위치에 놓인다.
import { useRef, useState } from 'react'
import type { TextItem } from '../types'
import { MAX_W } from '../lib/geometry'
import { useInkStore } from '../stores/inkStore'
import { useToolStore } from '../stores/toolStore'

const FONT_NORM = 14            // 정규화 좌표 기준 글자 크기
const DEFAULT_W = 200
const DRAG_THRESHOLD = 4        // 이만큼 움직이면 탭이 아니라 이동

type Props = { page: number; width: number }

export function TextLayer({ page, width }: Props) {
  const texts = useInkStore((s) => s.textsByPage[page])
  const tool = useToolStore((s) => s.tool)
  const [editingId, setEditingId] = useState<string | null>(null)
  const lastEndAt = useRef(0)     // blur 커밋 직후 이어지는 click이 새 박스를 만들지 않게
  const k = width / MAX_W
  const active = tool === 'text'

  const endEdit = () => {
    setEditingId(null)
    lastEndAt.current = performance.now()
  }

  // click 사용 — pointerup에 만들면 뒤따르는 호환 mousedown이 textarea를 즉시 blur시킨다
  const createAt = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!active || e.target !== e.currentTarget) return
    if (editingId) {
      endEdit()                   // 편집 중 바깥 탭은 편집 종료만
      return
    }
    if (performance.now() - lastEndAt.current < 400) return
    const rect = e.currentTarget.getBoundingClientRect()
    const item: TextItem = {
      id: crypto.randomUUID(),
      x: (e.clientX - rect.left) / k,
      y: (e.clientY - rect.top) / k,
      w: DEFAULT_W,
      text: '',
    }
    useInkStore.getState().upsertText(page, item)
    setEditingId(item.id)
  }

  return (
    <div
      className="absolute inset-0"
      style={{ pointerEvents: active ? 'auto' : 'none', touchAction: 'none' }}
      onClick={createAt}
    >
      {(texts ?? []).map((item) => (
        <TextBox
          key={item.id}
          item={item}
          page={page}
          k={k}
          interactive={active}
          editing={editingId === item.id}
          onStartEdit={() => setEditingId(item.id)}
          onEndEdit={endEdit}
        />
      ))}
    </div>
  )
}

function TextBox({
  item,
  page,
  k,
  interactive,
  editing,
  onStartEdit,
  onEndEdit,
}: {
  item: TextItem
  page: number
  k: number
  interactive: boolean
  editing: boolean
  onStartEdit: () => void
  onEndEdit: () => void
}) {
  const [draft, setDraft] = useState(item.text)
  const drag = useRef<{ startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null)
  const [, forceRender] = useState(0)

  const commitText = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) useInkStore.getState().deleteText(page, item.id)
    else useInkStore.getState().upsertText(page, { ...item, text: trimmed })
    onEndEdit()
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || editing) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startX: e.clientX, startY: e.clientY, x: item.x, y: item.y, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    e.stopPropagation()
    const dx = (e.clientX - d.startX) / k
    const dy = (e.clientY - d.startY) / k
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return
    d.moved = true
    d.x = item.x + dx
    d.y = item.y + dy
    forceRender((n) => n + 1)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    e.stopPropagation()
    if (d.moved) useInkStore.getState().upsertText(page, { ...item, x: d.x, y: d.y })
    else {
      setDraft(item.text)
      onStartEdit()               // 탭 = 편집
    }
  }

  const pos = drag.current?.moved ? drag.current : item
  const style: React.CSSProperties = {
    left: pos.x * k,
    top: pos.y * k,
    width: item.w * k,
    fontSize: FONT_NORM * k,
    lineHeight: 1.45,
    color: 'var(--text-default)',
  }

  if (editing) {
    return (
      <textarea
        autoFocus
        defaultValue={item.text}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commitText(draft)}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute resize-none rounded-[6px] border border-[var(--brand)] bg-white/90 p-1 outline-none"
        style={{ ...style, minHeight: FONT_NORM * k * 2.4 }}
      />
    )
  }
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={`absolute whitespace-pre-wrap break-words rounded-[6px] p-1 ${
        interactive ? 'cursor-move border border-dashed border-[var(--border-strong)]' : ''
      }`}
      style={style}
    >
      {item.text}
    </div>
  )
}
