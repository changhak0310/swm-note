// F-01 문서 목록 — 시안2 삼성노트 셸: 사이드바 + 노트 그리드 + FAB
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Document } from '../types'
import { useDocumentStore, type ListMeta } from '../stores/documentStore'
import { paths } from '../routes/paths'
import { fmtRelative } from '../lib/format'
import { Button } from '../design'
import logo from '../assets/logo.svg'

export function NoteList() {
  const documents = useDocumentStore((s) => s.documents)
  const listMeta = useDocumentStore((s) => s.listMeta)
  const importing = useDocumentStore((s) => s.importing)
  const answerPdfPromptDocId = useDocumentStore((s) => s.answerPdfPromptDocId)
  const store = useDocumentStore.getState()
  const navigate = useNavigate()

  // 정답지 슬롯을 마치면 그 문서를 연다 (F-02) — 로딩은 /doc/:docId 로더가 맡는다
  const openAfterPrompt = (docId: string | null) => {
    if (docId) void navigate(paths.doc(docId))
  }

  const fileRef = useRef<HTMLInputElement>(null)
  const answerFileRef = useRef<HTMLInputElement>(null)
  const [banner, setBanner] = useState(() => !localStorage.getItem('puri-banner-dismissed'))
  const [menuDoc, setMenuDoc] = useState<Document | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Document | null>(null)
  const [renaming, setRenaming] = useState<Document | null>(null)
  const [view, setView] = useState<'notes' | 'trash'>('notes')
  const [trashMenuDoc, setTrashMenuDoc] = useState<Document | null>(null)
  const [confirmPurge, setConfirmPurge] = useState<Document | null>(null)

  const notes = documents.filter((d) => !d.deletedAt)
  const trashed = documents.filter((d) => d.deletedAt)

  useEffect(() => {
    void store.loadDocuments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void store.importPdf(file)
  }

  const dismissBanner = () => {
    localStorage.setItem('puri-banner-dismissed', '1')
    setBanner(false)
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* ---------- 사이드바 ---------- */}
      <aside className="flex w-[280px] flex-none flex-col border-r border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-[var(--space-3)]">
        <div className="flex items-center gap-[var(--space-3)] px-[var(--space-2)] py-[var(--space-3)]">
          <img src={logo} alt="" className="h-7 w-7" />
          <span className="ds-wordmark text-[length:var(--text-h3)]">푸리 노트</span>
        </div>
        <div className="mt-[var(--space-2)] flex flex-col gap-0.5">
          <SideItem
            active={view === 'notes'}
            onClick={() => setView('notes')}
            icon={<NoteIcon />}
            label="모든 노트"
            trailing={<span className="num text-[color:var(--text-faint)]">{notes.length}</span>}
          />
          <SideItem
            active={view === 'trash'}
            onClick={() => setView('trash')}
            icon={<TrashIcon />}
            label="휴지통"
            muted={trashed.length === 0}
            trailing={
              trashed.length > 0 ? (
                <span className="num text-[color:var(--text-faint)]">{trashed.length}</span>
              ) : undefined
            }
          />
        </div>
        <div className="mx-[var(--space-2)] my-[var(--space-3)] h-px bg-[var(--border-subtle)]" />
        <SideItem
          onClick={() => void navigate(paths.live)}
          icon={<LiveIcon />}
          label="라이브 노트"
          trailing={
            <span className="rounded-full bg-[var(--brand-tint)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--text-brand)]">
              새 기능
            </span>
          }
        />
        <p className="px-[var(--space-3)] pb-[var(--space-2)] text-[length:var(--text-caption)] text-[color:var(--text-faint)]">
          필기하는 동안 고른 번호를 읽어줘
        </p>
        <div className="mx-[var(--space-2)] my-[var(--space-3)] h-px bg-[var(--border-subtle)]" />
        <div className="flex items-center gap-[var(--space-3)] rounded-[10px] px-[var(--space-3)] py-[var(--space-2)] text-[color:var(--text-muted)]">
          <FolderIcon />
          <span className="flex-1 text-[15px] font-medium">폴더</span>
        </div>
        <p className="px-[var(--space-3)] text-[length:var(--text-caption)] text-[color:var(--text-faint)]">
          폴더는 2차에서 제공돼
        </p>
        {import.meta.env.DEV && (
          <div className="mt-auto">
            <Button variant="ghost" size="sm" onClick={() => void navigate(paths.gallery)}>
              디자인 시스템
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void navigate(paths.compare)}>
              분할 비교
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void navigate(paths.golden)}>
              골든셋 라벨링
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void navigate(paths.probe)}>
              1단계 · 벡터 비율 측정
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void navigate(paths.extract)}>
              3단계 · 추출과 검산
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void navigate(paths.quality)}>
              라벨 품질
            </Button>
          </div>
        )}
      </aside>

      {/* ---------- 메인 ---------- */}
      <main className="puri-scroll relative flex-1 overflow-y-auto px-[var(--space-8)] pb-16 pt-[var(--space-5)]">
        <div className="pb-[var(--space-2)] pt-[var(--space-5)] text-center">
          <h1 className="text-[length:var(--text-display)] font-bold tracking-[var(--track-tight)] text-[color:var(--text-strong)]">
            {view === 'trash' ? '휴지통' : '모든 노트'}
          </h1>
          <p className="mt-1.5 text-[15px] text-[color:var(--text-muted)]">
            노트 {(view === 'trash' ? trashed : notes).length}개
          </p>
        </div>

        {view === 'notes' && banner && (
          <div className="mb-[var(--space-5)] mt-[var(--space-4)] flex items-start gap-[var(--space-4)] rounded-[var(--radius-lg)] border border-[var(--green-200)] bg-[var(--brand-tint-soft)] px-[var(--space-5)] py-[var(--space-4)]">
            <img src={logo} width={34} height={34} alt="" className="mt-0.5 flex-none" />
            <div className="flex-1">
              <div className="text-[16px] font-semibold text-[color:var(--text-strong)]">
                노트에서 벗어나지 않고 채점
              </div>
              <div className="mt-0.5 text-[14px] leading-5 text-[color:var(--text-muted)]">
                풀이를 마치면 왼쪽 <b className="text-[color:var(--text-brand)]">✦ AI 버튼</b>으로
                채점 — 시험지처럼 문제 옆에 O·사선이 그려져. 틀린 문제는 그 자리에서 다시 풀 수
                있어.
              </div>
            </div>
            <button
              className="flex-none self-end px-1 py-1.5 text-[14px] font-semibold text-[color:var(--text-brand)]"
              onClick={dismissBanner}
            >
              확인
            </button>
          </div>
        )}

        {view === 'trash' ? (
          trashed.length === 0 ? (
            <div className="mt-24 flex flex-col items-center gap-[var(--space-4)]">
              <img src={logo} alt="" className="h-14 w-14 opacity-40" />
              <p className="text-[color:var(--text-muted)]">휴지통이 비어 있어요</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-[var(--space-4)] gap-y-[var(--space-5)] sm:grid-cols-3 lg:grid-cols-4">
              {trashed.map((d) => (
                <NoteCard
                  key={d.id}
                  doc={d}
                  meta={listMeta[d.id]}
                  onOpen={() => setTrashMenuDoc(d)}
                  onMenu={() => setTrashMenuDoc(d)}
                />
              ))}
            </div>
          )
        ) : notes.length === 0 ? (
          <div className="mt-24 flex flex-col items-center gap-[var(--space-4)]">
            <img src={logo} alt="" className="h-14 w-14 opacity-60" />
            <p className="text-[color:var(--text-muted)]">PDF를 올리고 답에 동그라미를 치며 푸세요</p>
            <Button disabled={importing} onClick={() => fileRef.current?.click()}>
              {importing ? '가져오는 중…' : 'PDF 올리기'}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-[var(--space-4)] gap-y-[var(--space-5)] sm:grid-cols-3 lg:grid-cols-4">
            {notes.map((d) => (
              <NoteCard
                key={d.id}
                doc={d}
                meta={listMeta[d.id]}
                onOpen={() => void navigate(paths.doc(d.id))}
                onMenu={() => setMenuDoc(d)}
              />
            ))}
          </div>
        )}

        {/* FAB — 새 PDF 올리기 (F-02) */}
        {view === 'notes' && (
          <button
            className="sticky bottom-5 float-right mt-[var(--space-5)] grid h-[60px] w-[60px] place-items-center rounded-full text-white shadow-[var(--shadow-lg)] disabled:opacity-50"
            style={{ background: 'var(--brand)' }}
            disabled={importing}
            aria-label="PDF 올리기"
            onClick={() => fileRef.current?.click()}
          >
            {importing ? <Spinner /> : <PencilIcon />}
          </button>
        )}
        <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={onFile} />
      </main>

      {/* ---------- 정답지 슬롯 (F-02 규칙 1) ---------- */}
      {answerPdfPromptDocId && (
        <Modal>
          <h2 className="text-[length:var(--text-h3)] font-semibold text-[color:var(--text-strong)]">
            정답지 PDF도 있나요?
          </h2>
          <p className="mt-1.5 text-[14px] text-[color:var(--text-muted)]">
            정답지를 올리면 정답을 자동으로 불러와. 나중에 정답 입력 화면에서 올릴 수도 있어.
          </p>
          <div className="mt-[var(--space-5)] flex justify-end gap-[var(--space-2)]">
            <Button variant="ghost" onClick={() => void store.skipAnswerPdf().then(openAfterPrompt)}>
              건너뛰기
            </Button>
            <Button onClick={() => answerFileRef.current?.click()}>정답지 올리기</Button>
          </div>
          <input
            ref={answerFileRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void store.attachAnswerPdf(f).then(openAfterPrompt)
            }}
          />
        </Modal>
      )}

      {/* ---------- 길게 누르기 메뉴 (F-01) ---------- */}
      {menuDoc && (
        <Modal onClose={() => setMenuDoc(null)}>
          <h2 className="truncate text-[length:var(--text-h3)] font-semibold text-[color:var(--text-strong)]">
            {menuDoc.name}
          </h2>
          <div className="mt-[var(--space-4)] flex flex-col gap-[var(--space-2)]">
            <Button
              variant="secondary"
              block
              onClick={() => {
                setRenaming(menuDoc)
                setMenuDoc(null)
              }}
            >
              이름 변경
            </Button>
            <Button
              variant="danger"
              block
              onClick={() => {
                setConfirmDelete(menuDoc)
                setMenuDoc(null)
              }}
            >
              삭제
            </Button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(null)}>
          <h2 className="text-[length:var(--text-h3)] font-semibold text-[color:var(--text-strong)]">
            노트를 삭제할까?
          </h2>
          <p className="mt-1.5 text-[14px] text-[color:var(--text-muted)]">
            휴지통으로 이동돼. 휴지통에서 언제든 복원할 수 있어.
          </p>
          <div className="mt-[var(--space-5)] flex justify-end gap-[var(--space-2)]">
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              취소
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                void store.deleteDocument(confirmDelete.id)
                setConfirmDelete(null)
              }}
            >
              삭제
            </Button>
          </div>
        </Modal>
      )}

      {/* ---------- 휴지통 메뉴: 복원 / 영구 삭제 ---------- */}
      {trashMenuDoc && (
        <Modal onClose={() => setTrashMenuDoc(null)}>
          <h2 className="truncate text-[length:var(--text-h3)] font-semibold text-[color:var(--text-strong)]">
            {trashMenuDoc.name}
          </h2>
          <div className="mt-[var(--space-4)] flex flex-col gap-[var(--space-2)]">
            <Button
              variant="secondary"
              block
              onClick={() => {
                void store.restoreDocument(trashMenuDoc.id)
                setTrashMenuDoc(null)
              }}
            >
              복원
            </Button>
            <Button
              variant="danger"
              block
              onClick={() => {
                setConfirmPurge(trashMenuDoc)
                setTrashMenuDoc(null)
              }}
            >
              영구 삭제
            </Button>
          </div>
        </Modal>
      )}

      {confirmPurge && (
        <Modal onClose={() => setConfirmPurge(null)}>
          <h2 className="text-[length:var(--text-h3)] font-semibold text-[color:var(--text-strong)]">
            영구 삭제할까?
          </h2>
          <p className="mt-1.5 text-[14px] text-[color:var(--text-muted)]">
            PDF 파일과 필기·회차·정답이 모두 삭제되고 되돌릴 수 없어.
          </p>
          <div className="mt-[var(--space-5)] flex justify-end gap-[var(--space-2)]">
            <Button variant="ghost" onClick={() => setConfirmPurge(null)}>
              취소
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                void store.purgeDocument(confirmPurge.id)
                setConfirmPurge(null)
              }}
            >
              영구 삭제
            </Button>
          </div>
        </Modal>
      )}

      {renaming && (
        <RenameModal
          doc={renaming}
          onClose={() => setRenaming(null)}
          onSave={(name) => {
            void store.renameDocument(renaming.id, name)
            setRenaming(null)
          }}
        />
      )}
    </div>
  )
}

// ============================================================ 카드

function NoteCard({
  doc,
  meta,
  onOpen,
  onMenu,
}: {
  doc: Document
  meta?: ListMeta
  onOpen: () => void
  onMenu: () => void
}) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)

  const startPress = () => {
    longPressed.current = false
    pressTimer.current = setTimeout(() => {
      longPressed.current = true
      onMenu()
    }, 550)
  }
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current)
  }

  const missing = meta?.fileMissing ?? false

  return (
    <div
      className="cursor-pointer select-none"
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu()
      }}
      onClick={() => {
        if (longPressed.current) return
        if (missing) return onMenu()   // 파일 없음 — 열기 불가, 삭제만 (F-01 예외)
        onOpen()
      }}
    >
      <div
        className="relative aspect-[1/1.24] overflow-hidden rounded-[12px] border bg-[var(--paper)] shadow-[var(--shadow-sm)]"
        style={{ borderColor: meta?.pendingGrade ? 'var(--green-300)' : 'var(--border-subtle)' }}
      >
        <div
          className="absolute inset-0 opacity-70"
          style={{
            backgroundImage: 'radial-gradient(var(--ink-100) 1px, transparent 1px)',
            backgroundSize: '14px 14px',
          }}
        />
        <img
          src={doc.thumbnail}
          alt=""
          className="relative h-full w-full object-cover object-top"
          style={{ opacity: missing ? 0.35 : 1 }}
        />
        {meta?.pendingGrade && (
          <span className="absolute right-2.5 top-2.5 rounded-full bg-[var(--brand)] px-2 py-1 text-[10px] font-bold text-white">
            채점 대기
          </span>
        )}
        {missing && (
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--ink-800)] px-3 py-1.5 text-[12px] font-semibold text-white">
            파일 없음
          </span>
        )}
      </div>
      <div className="mt-2 truncate text-[14px] font-medium text-[color:var(--text-strong)]">
        {doc.name}
      </div>
      <div className="mt-0.5 text-[12px] text-[color:var(--text-faint)]">
        {meta ? `${meta.regionCount}문항 · ` : ''}
        {fmtRelative(doc.lastOpenedAt)}
      </div>
      {meta?.lastResult && (
        <div className="mt-0.5 text-[12px] font-medium" style={{ color: meta.lastResult.wrong > 0 ? 'var(--grade-x)' : 'var(--grade-o)' }}>
          {meta.lastResult.total}문항 중 {meta.lastResult.wrong}개 틀림
        </div>
      )}
    </div>
  )
}

// ============================================================ 소품

function SideItem({
  icon,
  label,
  trailing,
  active,
  muted,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  trailing?: React.ReactNode
  active?: boolean
  muted?: boolean
  onClick?: () => void
}) {
  return (
    <div
      className="flex cursor-pointer items-center gap-[var(--space-3)] rounded-[12px] px-[var(--space-3)] py-[var(--space-2)]"
      onClick={onClick}
      style={{
        background: active ? 'var(--ink-150)' : 'transparent',
        color: muted ? 'var(--text-faint)' : 'var(--text-default)',
      }}
    >
      {icon}
      <span className="flex-1 text-[15px]" style={{ fontWeight: active ? 600 : 500 }}>
        {label}
      </span>
      {trailing}
    </div>
  )
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center p-6"
      style={{ background: 'rgba(27,31,22,0.32)', backdropFilter: 'blur(3px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[var(--radius-xl)] bg-[var(--paper)] p-[var(--space-6)] shadow-[var(--shadow-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

function RenameModal({
  doc,
  onClose,
  onSave,
}: {
  doc: Document
  onClose: () => void
  onSave: (name: string) => void
}) {
  const [name, setName] = useState(doc.name)
  return (
    <Modal onClose={onClose}>
      <h2 className="text-[length:var(--text-h3)] font-semibold text-[color:var(--text-strong)]">
        이름 변경
      </h2>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name)}
        className="mt-[var(--space-4)] h-11 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--paper)] px-3.5 text-[15px] text-[color:var(--text-strong)] outline-none focus:border-[var(--border-focus)] focus:shadow-[var(--shadow-focus)]"
      />
      <div className="mt-[var(--space-5)] flex justify-end gap-[var(--space-2)]">
        <Button variant="ghost" onClick={onClose}>
          취소
        </Button>
        <Button disabled={!name.trim()} onClick={() => onSave(name)}>
          저장
        </Button>
      </div>
    </Modal>
  )
}

// ---------- 아이콘 (Lucide 스타일 1.8 stroke) ----------

const NoteIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z" />
    <path d="M8 4v16" />
  </svg>
)
const LiveIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    <circle cx="6.5" cy="6.5" r="2.5" />
  </svg>
)
const TrashIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
)
const FolderIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
  </svg>
)
const PencilIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    <path d="m15 5 4 4" />
  </svg>
)
const Spinner = () => (
  <img src={logo} alt="" className="h-7 w-7" style={{ animation: 'puriSpin 1.4s linear infinite' }} />
)
