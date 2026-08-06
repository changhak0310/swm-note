// PostHog Cloud 이벤트 수집
//
// Capacitor 웹뷰는 capacitor:// 스킴이라 쿠키가 불안정하다 —
// persistence는 반드시 localStorage로 둔다 (PostHog Capacitor 가이드).
import posthog from 'posthog-js'

/** 키가 없으면(로컬 개발) 아무것도 하지 않는다 — 이벤트는 조용히 버려진다. */
export function initAnalytics(): void {
  const key = import.meta.env.VITE_POSTHOG_KEY
  if (!key) return

  posthog.init(key, {
    // ??가 아니라 || — .env에 VITE_POSTHOG_HOST= 빈 값이 있으면 ""가 들어와 localhost로 전송된다
    api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
    persistence: 'localStorage',
    // SPA 라우트 전환(history API)마다 $pageview 자동 캡처
    capture_pageview: 'history_change',
  })
}

/** 커스텀 이벤트 — init 전이나 키 없이 호출해도 안전(no-op). */
export function track(event: string, properties?: Record<string, unknown>): void {
  if (!posthog.__loaded) return
  posthog.capture(event, properties)
}
