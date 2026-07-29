// 경로는 한 곳에서만 만든다 — 문자열이 컴포넌트 여기저기 흩어지면 라우트를 못 바꾼다.
export const paths = {
  list: '/',
  doc: (docId: string) => `/doc/${docId}`,
  answers: (docId: string) => `/doc/${docId}/answers`,
  live: '/live',

  // dev 전용 (프로덕션 번들에서는 라우트 자체가 빠진다 — routes/dev.ts)
  compare: '/dev/compare',
  golden: '/dev/golden',
  quality: '/dev/quality',
  probe: '/dev/probe',
  extract: '/dev/extract',
} as const
