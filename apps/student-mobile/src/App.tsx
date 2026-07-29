import { RouterProvider } from 'react-router-dom'
import { router } from './routes'

// 화면 전환은 전부 라우터가 맡는다 — 라우트 표는 routes/index.tsx.
export default function App() {
  return <RouterProvider router={router} />
}
