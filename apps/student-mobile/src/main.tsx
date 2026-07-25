import './lib/polyfills'   // 구형 WebView 호환 — 반드시 첫 import
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App as CapacitorApp } from '@capacitor/app'
import App from './App'
import { flushPendingSaves } from './lib/db'
// 브랜드 폰트 — 오프라인 앱이므로 CDN 대신 로컬 번들 (디자인 시스템 §VISUAL FOUNDATIONS)
import 'pretendard/dist/web/variable/pretendardvariable.css'
import '@fontsource-variable/jetbrains-mono'
import './index.css'

// 백그라운드 진입 시 디바운스 대기분 즉시 저장 (§8)
void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
  if (!isActive) void flushPendingSaves()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
