// 에디터 필기 도구 상태 (시안2 좌측 툴바)
import { create } from 'zustand'

export type Tool = 'pen' | 'hi' | 'eraser' | 'lasso' | 'text'
export type InkColor = 'navy' | 'blue' | 'mint'

export const COLOR_HEX: Record<InkColor, string> = {
  navy: '#132a6b',
  blue: '#2f6bff',
  mint: '#12b98f',
}

type ToolState = {
  tool: Tool
  color: InkColor
  /** 손가락(터치) 필기 — 기본 ON (삼성노트와 동일). 끄면 S펜 전용, 한 손가락은 스크롤.
   *  켜져 있어도 두 손가락으로 스크롤·확대할 수 있다 */
  fingerDraw: boolean
  setTool: (tool: Tool) => void
  setColor: (color: InkColor) => void
  toggleFingerDraw: () => void
}

const FINGER_KEY = 'puri-draw-touch'    // 구 키(puri-finger-draw)는 기본값 변경으로 폐기

export const useToolStore = create<ToolState>((set) => ({
  tool: 'pen',
  color: 'blue',
  fingerDraw: localStorage.getItem(FINGER_KEY) !== '0',
  setTool: (tool) => set({ tool }),
  setColor: (color) => set({ color }),
  toggleFingerDraw: () =>
    set((s) => {
      const fingerDraw = !s.fingerDraw
      localStorage.setItem(FINGER_KEY, fingerDraw ? '1' : '0')
      return { fingerDraw }
    }),
}))
