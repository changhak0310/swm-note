// 시안2 좌측 펜 툴바 — 펜·형광펜·지우개·색 3종·실행취소 + ✦ AI 채점 (주 진입점)
// 키보드·올가미 등은 1차 범위 밖이라 비활성으로만 보여준다
import type { ReactNode } from 'react'
import { useDocumentStore } from '../stores/documentStore'
import { useInkStore } from '../stores/inkStore'
import { COLOR_HEX, useToolStore, type InkColor, type Tool } from '../stores/toolStore'

/** showGrade=false — 채점이 없는 화면(라이브 노트)에서 ✦ 버튼만 뺀다 */
export function PenToolbar({ showGrade = true }: { showGrade?: boolean }) {
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
  const grade = useDocumentStore((s) => s.grade)
  const gradable = useDocumentStore((s) => s.doc?.gradable ?? false)
  const graded = useDocumentStore((s) => Object.keys(s.attemptsAll).length > 0)

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
      <ToolButton
        label={fingerDraw ? '손가락 필기 켜짐 — 두 손가락으로 스크롤·확대' : '손가락 필기 꺼짐 — S펜 전용'}
        active={fingerDraw}
        onClick={toggleFingerDraw}
      >
        <FingerIcon />
      </ToolButton>
      <Divider />

      {/* ✦ AI 채점 — 시안2의 주 진입점 (F-07) */}
      {showGrade && (
        <>
          <button
            title={gradable ? 'AI 채점' : '이 PDF는 자동 채점을 지원하지 않습니다'}
            aria-label="AI 채점"
            disabled={!gradable}
            onClick={() => void grade()}
            className="relative grid h-12 w-12 flex-none cursor-pointer place-items-center rounded-[13px] text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="absolute inset-0 rounded-[13px] bg-[var(--brand)] shadow-[var(--shadow-sm)]" />
            {!graded && gradable && (
              <span
                className="absolute inset-0 rounded-[13px]"
                style={{ animation: 'puriPulse 2.2s var(--ease-out) infinite' }}
              />
            )}
            <SparkIcon />
          </button>
          <Divider />
        </>
      )}

      {(Object.keys(COLOR_HEX) as InkColor[]).map((c) => (
        <button
          key={c}
          aria-label={`잉크 색 ${c}`}
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
    </div>
  )
}

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
    <button
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="relative grid h-11 w-11 flex-none cursor-pointer place-items-center rounded-[11px] disabled:cursor-not-allowed"
      style={{ color: disabled ? 'var(--text-faint)' : 'var(--text-default)' }}
    >
      {active && <span className="absolute inset-0 rounded-[11px] bg-[var(--brand-tint)]" />}
      <span className="relative">{children}</span>
    </button>
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
const FingerIcon = () => (
  <I>
    <path d="M18 11V6a2 2 0 0 0-4 0v5" />
    <path d="M14 10V4a2 2 0 0 0-4 0v2" />
    <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
    <path d="m7 15-1.76-1.76a2 2 0 0 0-2.83 2.82l3.6 3.6A8 8 0 0 0 22 14V7a2 2 0 0 0-4 0" />
  </I>
)
const SparkIcon = () => (
  <svg className="relative" width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    <path d="m6.3 6.3 2.8 2.8M14.9 14.9l2.8 2.8M17.7 6.3l-2.8 2.8M9.1 14.9l-2.8 2.8" />
  </svg>
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
