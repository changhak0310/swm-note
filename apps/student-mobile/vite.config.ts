import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // pdf 워커 래퍼(pdfWorker.ts)가 본체를 동적 import — iife는 코드 스플리팅 불가
  worker: { format: 'es' },
  test: {
    // src/lib은 DOM 비의존 순수 함수 — node 환경에서 돌린다
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
