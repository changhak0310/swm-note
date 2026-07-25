import { NoteList } from './components/NoteList'
import { Editor } from './components/Editor'
import { AnswerKeyScreen } from './components/AnswerKeyScreen'
import { DesignGallery } from './components/DesignGallery'
import { useDocumentStore } from './stores/documentStore'

// 화면은 3개다: 문서 목록, 필기 화면, 정답 입력 (시스템 명세 §4)
// 라우터 없이 상태 기반 전환으로 간다 (아키텍처 §2.2). gallery는 dev 전용.
export default function App() {
  const screen = useDocumentStore((s) => s.screen)
  const toast = useDocumentStore((s) => s.toast)

  return (
    <>
      {screen === 'list' && <NoteList />}
      {screen === 'editor' && <Editor />}
      {screen === 'answers' && <AnswerKeyScreen />}
      {screen === 'gallery' && <DesignGallery />}

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
