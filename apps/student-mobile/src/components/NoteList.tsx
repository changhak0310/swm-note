// F-01 문서 목록 — 시안2 삼성노트 셸: 사이드바 + 노트 그리드 + FAB
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Document } from '../types'
import { useDocumentStore, type ListMeta } from '../stores/documentStore'
import { paths } from '../routes/paths'
import { fmtRelative } from '../lib/format'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  IconButton,
  Input,
  NavItem,
} from '@puri/ui'
import logo from '@puri/ui/assets/logo.svg'

export function NoteList() {
  const documents = useDocumentStore((s) => s.documents)
  const listMeta = useDocumentStore((s) => s.listMeta)
  const importing = useDocumentStore((s) => s.importing)
  const store = useDocumentStore.getState()
  const navigate = useNavigate()

  const fileRef = useRef<HTMLInputElement>(null)
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

  // 문제지를 올리면 곧장 그 문서를 연다 — 로딩은 /doc/:docId 로더가 맡는다.
  //
  // 정답지 슬롯 프롬프트(F-02 규칙 1)는 흐름에서 뺐다. importPdf가 여전히
  // answerPdfPromptDocId를 세우므로, 묻지 않고 skipAnswerPdf로 그 상태를 비우고
  // 문서 id를 받아 연다. 정답지 첨부 코드(attachAnswerPdf)는 스토어에 그대로 있다.
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    void store
      .importPdf(file)
      .then(() => store.skipAnswerPdf())
      .then((docId) => {
        if (docId) void navigate(paths.doc(docId))
      })
  }

  return (
    <div className="relative flex h-[var(--screen-h)] overflow-hidden">
      {/* ---------- 사이드바 ---------- */}
      <aside className="flex w-[280px] flex-none flex-col border-r border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-[var(--space-3)]">
        <div className="flex items-center gap-[var(--space-3)] px-[var(--space-2)] py-[var(--space-3)]">
          <img src={logo} alt="" className="h-7 w-7" />
          <span className="ds-wordmark text-[length:var(--text-h3)]">푸리 노트</span>
        </div>
        <div className="mt-[var(--space-2)] flex flex-col gap-0.5">
          <NavItem
            active={view === 'notes'}
            onClick={() => setView('notes')}
            icon={<NoteIcon />}
            label="모든 노트"
            trailing={<span className="num text-[color:var(--text-faint)]">{notes.length}</span>}
          />
          <NavItem
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
        {/* 2차 예정 — 눌리지 않는다는 걸 disabled로 말한다 (회색 텍스트만으로는 부족) */}
        <NavItem icon={<FolderIcon />} label="폴더" muted disabled />

        <p className="px-[var(--space-3)] text-[length:var(--text-caption)] text-[color:var(--text-faint)]">
          폴더는 2차에서 제공돼
        </p>
        {import.meta.env.DEV && (
          <div className="mt-auto">
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
      <main className="puri-scroll flex-1 overflow-y-auto px-[var(--space-8)] pb-16 pt-[var(--space-5)]">
        <div className="pb-[var(--space-2)] pt-[var(--space-5)] text-center">
          <h1 className="text-[length:var(--text-display)] font-bold tracking-[var(--track-tight)] text-[color:var(--text-strong)]">
            {view === 'trash' ? '휴지통' : '모든 노트'}
          </h1>
          <p className="mt-1.5 text-[15px] text-[color:var(--text-muted)]">
            노트 {(view === 'trash' ? trashed : notes).length}개
          </p>
        </div>

        {/* 온보딩 배너는 뺐다 — 내용이 전부 ✦ AI 채점 버튼 사용법이었는데
            그 버튼이 툴바에서 빠져 안내가 거짓이 된다 */}

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

        <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={onFile} />
      </main>

      {/* FAB — 새 PDF 올리기 (F-02).
          스크롤 컨테이너(main) 밖에 둔다 — 안에 두면 sticky든 absolute든 콘텐츠를
          따라 흘러서 화면 오른쪽 아래에 붙어 있지 못한다. 기준은 셸 루트다. */}
      {view === 'notes' && (
        <IconButton
          variant="solid"
          label="PDF 올리기"
          className="absolute bottom-6 right-6 size-[60px] rounded-full shadow-lg"
          disabled={importing}
          onClick={() => fileRef.current?.click()}
        >
          {importing ? <Spinner /> : <PencilIcon />}
        </IconButton>
      )}

      {/* 정답지 슬롯 프롬프트(F-02 규칙 1)는 흐름에서 뺐다 — onFile이 곧장 문서를 연다 */}

      {/* ---------- 길게 누르기 메뉴 (F-01) ---------- */}
      {menuDoc && (
        <Dialog open onOpenChange={(o) => !o && setMenuDoc(null)}>
          <DialogContent>
            <DialogTitle className="truncate">{menuDoc.name}</DialogTitle>
            <div className="mt-4 flex flex-col gap-2">
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
          </DialogContent>
        </Dialog>
      )}

      {confirmDelete && (
        <Dialog open onOpenChange={(o) => !o && setConfirmDelete(null)}>
          <DialogContent>
            <DialogTitle>노트를 삭제할까?</DialogTitle>
            <DialogDescription>휴지통으로 이동돼. 휴지통에서 언제든 복원할 수 있어.</DialogDescription>
            <DialogFooter>
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
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ---------- 휴지통 메뉴: 복원 / 영구 삭제 ---------- */}
      {trashMenuDoc && (
        <Dialog open onOpenChange={(o) => !o && setTrashMenuDoc(null)}>
          <DialogContent>
            <DialogTitle className="truncate">{trashMenuDoc.name}</DialogTitle>
            <div className="mt-4 flex flex-col gap-2">
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
          </DialogContent>
        </Dialog>
      )}

      {confirmPurge && (
        <Dialog open onOpenChange={(o) => !o && setConfirmPurge(null)}>
          <DialogContent>
            <DialogTitle>영구 삭제할까?</DialogTitle>
            <DialogDescription>
              PDF 파일과 필기·회차·정답이 모두 삭제되고 되돌릴 수 없어.
            </DialogDescription>
            <DialogFooter>
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
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
    // 카드 전체가 버튼이다 — div로 두면 Tab으로 닿지 않아 키보드로는 노트를 못 연다.
    // 길게 누르기 메뉴는 포인터 전용이라, 키보드 사용자를 위해 Shift+F10/메뉴키도 받는다.
    <button
      type="button"
      className="w-full cursor-pointer select-none text-left"
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu()
      }}
      onKeyDown={(e) => {
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault()
          onMenu()
        }
      }}
      onClick={() => {
        if (longPressed.current) return
        if (missing) return onMenu()   // 파일 없음 — 열기 불가, 삭제만 (F-01 예외)
        onOpen()
      }}
    >
      <div
        className="relative aspect-[1/1.24] overflow-hidden rounded-[12px] border bg-[var(--paper)] shadow-[var(--shadow-sm)]"
        style={{ borderColor: 'var(--border-subtle)' }}
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
        {/* 「채점 대기」 배지는 뺐다 — 채점 진입점이 없어 영영 대기에 머문다 */}
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
        {/* 문항은 펜이 닿은 쪽부터 세어진다 — 아직 0이면 "0문항"이라 적지 않는다 */}
        {meta && meta.regionCount > 0 ? `${meta.regionCount}문항 · ` : ''}
        {fmtRelative(doc.lastOpenedAt)}
      </div>
      {/* 지난 채점 결과(N개 틀림) 줄도 뺐다 */}
    </button>
  )
}

// ============================================================ 소품


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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>이름 변경</DialogTitle>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name)}
          containerClassName="mt-4"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button disabled={!name.trim()} onClick={() => onSave(name)}>
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- 아이콘 (Lucide 스타일 1.8 stroke) ----------

const NoteIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z" />
    <path d="M8 4v16" />
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
