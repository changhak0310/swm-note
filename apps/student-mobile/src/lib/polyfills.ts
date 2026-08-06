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

// iOS WKWebView(WebKit) 호환 — ReadableStream의 async iteration이 없다.
//
// ★ 이게 없으면 **PDF를 올리는 즉시 앱이 통째로 죽는다.** pdf.js v5의 getTextContent()가
//   `for await (const chunk of stream)`으로 텍스트 청크를 읽는데, WebKit에는
//   ReadableStream.prototype.values 자체가 없어 "undefined is not a function"이 난다
//   (실측 Safari 26.5 / WebKit 605.1.15). Chromium에는 있으므로 Android에서는 안 보인다.
//
// 같은 순회를 워커의 DecompressionStream(압축 이미지)과 서명 해제도 쓴다 — 그래서
// main.tsx·pdf.ts·pdfWorker.ts 세 곳 모두에서 이 파일을 가장 먼저 import한다.

type StreamProto = {
  values?: (opts?: { preventCancel?: boolean }) => AsyncIterableIterator<unknown>
  [Symbol.asyncIterator]?: unknown
}

const RS = globalThis.ReadableStream as unknown as { prototype: StreamProto } | undefined

if (RS && !RS.prototype[Symbol.asyncIterator]) {
  RS.prototype.values = function (this: ReadableStream, { preventCancel = false } = {}) {
    const reader = this.getReader()
    return {
      async next() {
        try {
          const r = await reader.read()
          if (r.done) reader.releaseLock()
          return r
        } catch (e) {
          reader.releaseLock()
          throw e
        }
      },
      // for-await가 break·throw로 빠져나갈 때 스트림을 취소하고 락을 푼다
      async return(value?: unknown) {
        if (!preventCancel) await reader.cancel(value)
        reader.releaseLock()
        return { done: true as const, value }
      },
      [Symbol.asyncIterator]() {
        return this
      },
    } as AsyncIterableIterator<unknown>
  }
  RS.prototype[Symbol.asyncIterator] = RS.prototype.values
}

export {}
