// 표시용 포맷 유틸

/** 상대 시간 — F-01 "3일 전" */
export function fmtRelative(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return '방금 전'
  if (min < 60) return `${min}분 전`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}시간 전`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day}일 전`
  const d = new Date(ts)
  return `${d.getMonth() + 1}월 ${d.getDate()}일`
}
