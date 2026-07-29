// 라우트 표 — 화면 하나당 URL 하나 (아키텍처 §2.2).
//
// 주소에 #이 붙지 않도록 BrowserRouter를 쓴다. Capacitor 7은 dist를 파일 스킴으로
// 여는 게 아니라 https://localhost 로컬 에셋 서버로 서빙하고(androidScheme 기본값
// 'https'), 그 서버는 확장자 없는 경로를 전부 index.html로 되돌린다
// (server.html5mode 기본 true). 그래서 /doc/xxx 새로고침·딥링크도 404가 아니다.
//
// 전제 조건 둘 — 깨지면 해시로 되돌려야 한다:
//   1. capacitor.config에서 server.androidScheme를 http/https 외의 값으로 바꾸지 말 것.
//      커스텀 스킴은 WebView 117부터 경로를 못 바꾼다.
//   2. 경로 마지막 조각에 점(.)이 없을 것. 있으면 에셋 요청으로 보고 404를 준다.
//      docId는 crypto.randomUUID()라 16진수와 하이픈뿐이다.
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { NoteList } from '../components/NoteList'
import { Editor } from '../components/Editor'
import { AnswerKeyScreen } from '../components/AnswerKeyScreen'
import { LiveNote } from '../components/LiveNote'
import { RootLayout } from './RootLayout'
import { documentLoader } from './documentRoute'
import { devRoutes } from './dev'
import { paths } from './paths'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      { index: true, element: <NoteList /> },

      // 문서 화면 — 로더가 doc·구역·필기를 올린 뒤에야 자식이 그려진다.
      // 정답 입력은 자식 라우트라 오갈 때 로더가 다시 돌지 않는다 (재로딩 없음).
      {
        path: 'doc/:docId',
        loader: documentLoader,
        children: [
          { index: true, element: <Editor /> },
          { path: 'answers', element: <AnswerKeyScreen /> },
        ],
      },

      // 라이브 노트 — 문서 레코드 없이 도는 별도 화면 (liveStore가 상태를 갖는다)
      { path: 'live', element: <LiveNote /> },

      ...devRoutes,

      { path: '*', element: <Navigate to={paths.list} replace /> },
    ],
  },
])
