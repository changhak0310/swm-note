// 시안2 좌측 펜 툴바 — 펜·형광펜·지우개·색 3종·실행취소
// 키보드·올가미 등은 1차 범위 밖이라 비활성으로만 보여준다
//
// ✦ AI 채점 버튼은 툴바에서 뺐다 — 채점 코드(documentStore.grade)는 그대로 살아 있고
// 진입점만 끊었다. 되살리려면 여기에 버튼을 다시 달면 된다.
import type { ReactNode } from 'react'
import { Toggle } from '@puri/ui'
import { useInkStore } from '../stores/inkStore'
import { COLOR_HEX, useToolStore, type InkColor, type Tool } from '../stores/toolStore'

export function PenToolbar() {
  const tool = useToolStore((s) => s.tool)
  const color = useToolStore((s) => s.color)
  const fingerDraw = useToolStore((s) => s.fingerDraw)
  const setTool = useToolStore((s) => s.setTool)
  const setColor = useToolStore((s) => s.setColor)
  const toggleFingerDraw = useToolStore((s) => s.toggleFingerDraw)
  const undo = useInkStore((s) => s.undo)
  const redo = useInkStore((s) => s.redo)
  const canUndo = useInkStore((s) => s.undoStack.length > 0)
  const canRedo = useInkStore((s) => s.redoStack.length > 0)

  return (
    <div className="puri-scroll flex w-[66px] flex-none flex-col items-center gap-1 overflow-y-auto border-r border-[var(--border-subtle)] bg-[var(--paper)] py-3">
      <ToolButton label="키보드 텍스트" active={tool === 'text'} onClick={() => setTool('text')}>
        <KeyboardIcon />
      </ToolButton>
      <Divider />
      <ToolButton label="펜" active={tool === 'pen'} onClick={() => setTool('pen')}>
        <PenIcon />
      </ToolButton>
      <ToolButton label="형광펜" active={tool === 'hi'} onClick={() => setTool('hi')}>
        <HighlighterIcon />
      </ToolButton>
      <ToolButton label="지우개 (스트로크 단위)" active={tool === 'eraser'} onClick={() => setTool('eraser')}>
        <EraserIcon />
      </ToolButton>
      <ToolButton label="올가미 (선택·이동·삭제)" active={tool === 'lasso'} onClick={() => setTool('lasso')}>
        <LassoIcon />
      </ToolButton>
      <Divider />

      {(Object.keys(COLOR_HEX) as InkColor[]).map((c) => (
        <button
          key={c}
          aria-label={`잉크 색 ${c}`}
          aria-pressed={color === c}
          onClick={() => {
            setColor(c)
            if (tool === 'eraser') setTool('pen')
          }}
          className="relative grid h-9 w-11 flex-none cursor-pointer place-items-center"
        >
          {color === c && (
            <span className="absolute h-[30px] w-[30px] rounded-full border-2 border-[var(--brand)]" />
          )}
          <span
            className="rounded-full"
            style={{
              width: color === c ? 21 : 17,
              height: color === c ? 21 : 17,
              background: COLOR_HEX[c],
            }}
          />
        </button>
      ))}
      <div className="my-1.5 h-[5px] w-[22px] rounded-[3px] bg-[var(--ink-800)]" />

      <ToolButton label="실행취소" disabled={!canUndo} onClick={undo}>
        <UndoIcon />
      </ToolButton>
      <ToolButton label="다시실행" disabled={!canRedo} onClick={redo}>
        <RedoIcon />
      </ToolButton>

      {/* ---------- 설정 ---------- */}
      {/* 손가락 필기는 도구가 아니라 설정이다. 도구들 사이에 같은 스타일로 두면
          기본값이 켜짐이라 펜과 함께 늘 불이 들어오고, 손 아이콘은 이동 도구로
          읽히기 때문에 "펜과 이동 모드가 동시에 켜졌다"로 보인다.
          그래서 그룹을 나누고, 켜짐을 브랜드 배경 대신 아이콘으로 말한다 —
          꺼지면 손에 빗금이 그어진다. */}
      <Divider />
      <ToolButton
        label={fingerDraw ? '손가락 필기 켜짐 — 두 손가락으로 스크롤·확대' : '손가락 필기 꺼짐 — S펜 전용'}
        onClick={toggleFingerDraw}
      >
        <FingerIcon off={!fingerDraw} />
      </ToolButton>
    </div>
  )
}

/** 툴바 한 칸 — 디자인 시스템 Toggle의 얇은 래퍼. 여기서만 쓰는 이름 맞추기용이다. */
function ToolButton({
  children,
  label,
  active,
  disabled,
  onClick,
}: {
  children: ReactNode
  label: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <Toggle label={label} pressed={active} disabled={disabled} onClick={onClick}>
      {children}
    </Toggle>
  )
}

const Divider = () => <div className="my-0.5 h-px w-[26px] bg-[var(--border-subtle)]" />

// ---------- 아이콘 (시안2 인라인 셋) ----------

const I = ({ children, w = 24 }: { children: ReactNode; w?: number }) => (
  <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)
const KeyboardIcon = () => (
  <I>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
  </I>
)
const PenIcon = () => (
  <I>
    <path d="M12 19l7-7 3 3-7 7-3-3z" />
    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18z" />
    <path d="M2 2l7.586 7.586" />
    <circle cx="11" cy="11" r="2" />
  </I>
)
const HighlighterIcon = () => (
  <I>
    <path d="m9 11-6 6v3h9l3-3" />
    <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
  </I>
)
const EraserIcon = () => (
  <I>
    <path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21" />
    <path d="M22 21H7" />
    <path d="m5 11 9 9" />
  </I>
)
const LassoIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 3">
    <path d="M7 22a5 5 0 0 1-2-4" />
    <path d="M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1" />
  </svg>
)
/** off면 빗금을 긋는다 — 켜짐/꺼짐을 배경색이 아니라 아이콘으로 말한다 */
const FingerIcon = ({ off }: { off?: boolean }) => (
  <I>
    <path d="M18 11V6a2 2 0 0 0-4 0v5" />
    <path d="M14 10V4a2 2 0 0 0-4 0v2" />
    <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
    <path d="m7 15-1.76-1.76a2 2 0 0 0-2.83 2.82l3.6 3.6A8 8 0 0 0 22 14V7a2 2 0 0 0-4 0" />
    {off && <path d="M3 3 21 21" strokeWidth="2" />}
  </I>
)
const UndoIcon = () => (
  <I w={23}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </I>
)
const RedoIcon = () => (
  <I w={23}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </I>
)
