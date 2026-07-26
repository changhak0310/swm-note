// PSP — Problem Segmentation Pipeline v0.1 (PRD 구현)
//
// 사용법:
//   const pages = await documentInput(pdf)     // ← './psp/adapter' (pdf.js 의존)
//   const result = runPipeline(pages, { jobId })
//   const regions = toAppRegions(result, docId)
//
// 이 배럴은 순수 함수만 내보낸다. pdf.js에 의존하는 adapter는 포함하지 않는다 —
// src/lib의 아키텍처 경계(DOM·React 비의존)를 유지하기 위해서다.
// 어댑터가 필요하면 './psp/adapter'에서 직접 가져온다.
export * from './types'
export * from './lines'
export * from './layout'
export * from './anchor'
export * from './slice'
export * from './regions'
export * from './verify'
export * from './pipeline'

/** 알고리즘이 바뀌면 올린다. 기존 segment.ts의 SEGMENT_VERSION과 별개 계열 */
export const PSP_VERSION = 1
