// dev 전용 화면 — 분할 비교 · 골든셋 라벨링 · 라벨 품질 ·
// 벡터 비율 측정(1단계) · 추출과 검산(3단계).
//
// 디자인 갤러리는 여기 없다 — @puri/ui 패키지의 플레이그라운드로 옮겼다
// (`pnpm --filter @puri/ui dev`). 두 앱이 같은 디자인 시스템을 쓰므로
// 갤러리가 한쪽 앱에 살면 다른 앱에서는 볼 수 없다.
//
// import.meta.env.DEV는 빌드 시 리터럴로 치환되므로, 프로덕션에서는 이 배열이 통째로
// []가 되고 아래 동적 import는 도달 불가가 되어 청크조차 생기지 않는다. 골든셋
// 라벨링(GoldenLabeler)만 800줄이라 이 분리가 번들에 그대로 드러난다.
import type { RouteObject } from 'react-router-dom'

export const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: 'dev/compare',
        lazy: async () => ({ Component: (await import('../components/SegmentCompare')).SegmentCompare }),
      },
      {
        path: 'dev/golden',
        lazy: async () => ({ Component: (await import('../components/GoldenLabeler')).GoldenLabeler }),
      },
      {
        path: 'dev/quality',
        lazy: async () => ({ Component: (await import('../components/LabelQuality')).LabelQuality }),
      },
      {
        path: 'dev/probe',
        lazy: async () => ({ Component: (await import('../components/VectorProbe')).VectorProbe }),
      },
      {
        path: 'dev/extract',
        lazy: async () => ({ Component: (await import('../components/ExtractSchema')).ExtractSchema }),
      },
    ]
  : []
