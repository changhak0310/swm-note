// 모든 화면을 감싸는 셸 — 토스트와 "문서 화면을 떠났을 때" 정리를 맡는다.
import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useDocumentStore } from '../stores/documentStore'

export function RootLayout() {
  const toast = useDocumentStore((s) => s.toast)
  useLeaveDocument()

  return (
    <>
      <Outlet />

      {toast && (
        <div
          className="fixed bottom-8 left-1/2 z-[60] max-w-[80vw] -translate-x-1/2 rounded-full bg-[var(--ink-800)] px-5 py-3 text-[14px] font-medium text-white shadow-[var(--shadow-lg)]"
          style={{ animation: 'puriFade .2s var(--ease-out)' }}
        >
          {toast}
        </div>
      )}
    </>
  )
}

/**
 * 문서 화면(/doc/*)을 벗어나면 열린 문서를 정리한다.
 *
 * 정리를 DocumentRoute의 언마운트 클린업에 두면 StrictMode 이중 마운트에서
 * 로더가 다시 돌지 않은 채 문서만 닫혀 빈 화면이 된다. RootLayout은 언마운트되지
 * 않으므로 여기서 경로만 보고 판단한다 — leaveDocument는 멱등이라 중복 호출도 안전하다.
 */
function useLeaveDocument() {
  const inDocument = useLocation().pathname.startsWith('/doc/')
  useEffect(() => {
    if (!inDocument) useDocumentStore.getState().leaveDocument()
  }, [inDocument])
}
