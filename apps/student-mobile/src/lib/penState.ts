// 팜 리젝션 보조 — 펜이 그리는 동안 손바닥 터치 스크롤을 막는다 (F-04)
// InkCanvas가 세팅하고 PageStack의 터치 스크롤 핸들러가 읽는다.
export const penState = {
  active: false,
  lastUpAt: 0,
}

/** 펜을 뗀 직후 300ms는 손바닥 잔여 터치로 본다 */
export function touchScrollBlocked(): boolean {
  return penState.active || Date.now() - penState.lastUpAt < 300
}
