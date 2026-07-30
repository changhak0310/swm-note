import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 플레이그라운드(갤러리) 전용 설정. 패키지 자체는 소스를 그대로 소비하는
// 빌드 없는 패키지라 라이브러리 빌드가 없다 — 그래서 build 스크립트도 없다.
export default defineConfig({
  root: 'playground',
  plugins: [react(), tailwindcss()],
})
