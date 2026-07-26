import { NoteList } from './components/NoteList'
import { Editor } from './components/Editor'
import { LiveNote } from './components/LiveNote'
import { AnswerKeyScreen } from './components/AnswerKeyScreen'
import { DesignGallery } from './components/DesignGallery'
import { SegmentCompare } from './components/SegmentCompare'
import { GoldenLabeler } from './components/GoldenLabeler'
import { useDocumentStore } from './stores/documentStore'

// 화면은 3개다: 문서 목록, 필기 화면, 정답 입력 (시스템 명세 §4).
// live(라이브 노트)는 그 위에 얹힌 네 번째 화면 — 채점 버튼 없이 필기 중에 판정한다.
// 라우터 없이 상태 기반 전환으로 간다 (아키텍처 §2.2). gallery는 dev 전용.
export default function App() {
  const screen = useDocumentStore((s) => s.screen)
  const toast = useDocumentStore((s) => s.toast)

  return (
    <>
      {screen === 'list' && <NoteList />}
      {screen === 'editor' && <Editor />}
      {screen === 'answers' && <AnswerKeyScreen />}
      {screen === 'live' && <LiveNote />}
      {screen === 'gallery' && <DesignGallery />}
      {screen === 'compare' && <SegmentCompare />}
      {screen === 'golden' && <GoldenLabeler />}

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
