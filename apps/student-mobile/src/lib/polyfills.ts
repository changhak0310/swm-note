// 구형 Android WebView 호환 (Chrome <128) — pdf.js v5가 쓰는 최신 Promise API.
// 실기기는 WebView가 자동 업데이트되지만 에뮬레이터 이미지는 오래된 버전이 흔하다.
// main.tsx와 pdf 워커 양쪽에서 가장 먼저 import해야 한다.

type PromiseCtor = typeof Promise & {
  try?: (fn: (...a: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown>
  withResolvers?: <T>() => {
    promise: Promise<T>
    resolve: (v: T | PromiseLike<T>) => void
    reject: (r?: unknown) => void
  }
}

const P = Promise as PromiseCtor

if (typeof P.try !== 'function') {
  P.try = function (fn, ...args) {
    return new Promise((resolve) => resolve(fn(...args)))
  }
}

if (typeof P.withResolvers !== 'function') {
  P.withResolvers = function <T>() {
    let resolve!: (v: T | PromiseLike<T>) => void
    let reject!: (r?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
}

export {}
