import './lib/polyfills'   // 구형 WebView 호환 — 반드시 첫 import
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App as CapacitorApp } from '@capacitor/app'
import App from './App'
import { initAnalytics } from './lib/analytics'
import { flushPendingSaves } from './lib/db'
// 토큰·폰트·프리미티브는 index.css가 @puri/ui/styles.css로 한 번에 들여온다
import './index.css'

initAnalytics()

// 백그라운드 진입 시 디바운스 대기분 즉시 저장 (§8)
void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
  if (!isActive) void flushPendingSaves()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
