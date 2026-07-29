// PSP 파이프라인 오케스트레이션 — §4
//
// 각 stage는 멱등이다. 같은 입력을 다시 넣으면 같은 출력이 나오고,
// 중간에 죽어도 같은 stage부터 재실행하면 동일 결과가 나온다 (§4, 준비도 #7·#8).
// 재개 지점은 stage 이름 하나로 결정된다 — 숨은 상태가 없다.
import { bodyFontSize, findCandidates, medianColumnWidth, resolveAnchors } from './anchor'
import { layoutPages, probe, type PageLayout } from './layout'
import { buildRegions } from './regions'
import { dominantChoiceFamily } from './markerGroups'
import { sliceProblems, type Slice } from './slice'
import {
  PspError,
  clampBBox,
  type PageInput,
  type Problem,
  type SourceType,
  type Stage,
} from './types'
import { verify, type VerifyReport } from './verify'

export type PipelineOptions = {
  jobId: string
  /** 1-based, 양끝 포함. 생략 시 전체 */
  pageRange?: [number, number]
}

export type PipelineResult = {
  jobId: string
  sourceType: SourceType
  problems: Problem[]
  layouts: PageLayout[]
  report: VerifyReport
  /** stage별 소요 ms — 성능 비교용 */
  timings: Partial<Record<Stage, number>>
  /** 앵커 클러스터링에서 폐기된 후보 수 */
  discardedAnchors: number
  /**
   * 문항이 검출된 페이지 (0-based, 오름차순).
   *
   * 문제집은 절반 가까이가 문항이 아니다 — 표지·머리말·목차·핵심개념정리·해설.
   * 여기 없는 페이지는 구역을 나누지 않았다는 뜻이고, 그건 실패가 아니라
   * 의도된 결과다. 검수 UI는 이 목록으로 훑을 페이지를 좁힌다.
   */
  problemPages: number[]
}

const now = () => (globalThis.performance?.now() ?? 0)

export function runPipeline(allPages: PageInput[], opts: PipelineOptions): PipelineResult {
  const timings: Partial<Record<Stage, number>> = {}
  const stage = <T>(name: Stage, fn: () => T): T => {
    const t0 = now()
    const out = fn()
    timings[name] = (timings[name] ?? 0) + (now() - t0)
    return out
  }

  const pages = opts.pageRange
    ? allPages.filter((p) => p.index + 1 >= opts.pageRange![0] && p.index + 1 <= opts.pageRange![1])
    : allPages

  // [PROBE]
  const probed = stage('PROBE', () => probe(pages))

  // [LAYOUT]
  const layouts = stage('LAYOUT', () => layoutPages(pages))

  const fontSize = bodyFontSize(layouts)

  // [ANCHOR]
  const { anchors, discarded } = stage('ANCHOR', () => {
    const candidates = layouts.flatMap((l) => findCandidates(l, fontSize))
    if (candidates.length === 0) throw new PspError('ERR_NO_ANCHOR')
    return resolveAnchors(candidates, medianColumnWidth(layouts))
  })

  // [SLICE]
  const slices = stage('SLICE', () => sliceProblems(anchors, layouts))

  // 이 책이 선지에 쓰는 계열을 문서 전체에서 하나로 확정한다.
  // 문항 단위로만 보면 소문항 ⑴⑵⑶⑷와 그림 라벨 ㉠~㉤이 선지가 된다 (markerGroups.ts)
  const choiceFamily = stage('REGION', () => dominantChoiceFamily(layouts, fontSize))

  // [REGION] + [RENDER]
  const problems = stage('REGION', () =>
    slices.map((s) => toProblem(s, opts.jobId, choiceFamily)),
  )

  // [VERIFY]
  const report = stage('VERIFY', () => verify(problems, layouts))

  return {
    jobId: opts.jobId,
    sourceType: probed.sourceType,
    problems: report.problems,
    layouts,
    report,
    timings,
    discardedAnchors: discarded,
    problemPages: [...new Set(report.problems.map((p) => p.pageIndex))].sort((a, b) => a - b),
  }
}

function toProblem(slice: Slice, jobId: string, choiceFamily: string | null): Problem {
  // id는 결정적이어야 한다 — 재분할해도 정답·필기 귀속이 보존된다
  const id = `${jobId}:p${slice.pageIndex}:c${slice.columnIndex}:n${slice.anchor.numberText}`
  const bbox = clampBBox(slice.bbox)
  const region = buildRegions({ ...slice, bbox }, id, choiceFamily)

  const flags = [...region.flags]
  if (slice.spansBoundary) flags.push('FLAG_SPANS_BOUNDARY')
  // V-6 — 마커는 보였는데 C-1~C-3 확정에 실패한 경우
  if (region.markersSeen >= 2 && region.problemType !== 'MULTIPLE_CHOICE') {
    flags.push('FLAG_CHOICES_MISSING')
  }

  return {
    id,
    jobId,
    pageIndex: slice.pageIndex,
    columnIndex: slice.columnIndex,
    number: slice.anchor.numberText,
    numberInt: slice.anchor.numberInt,
    bbox,
    numberBBox: clampBBox(slice.anchor.bbox),
    continuation: slice.continuation
      ? { ...slice.continuation, bbox: clampBBox(slice.continuation.bbox) }
      : undefined,
    // §4.6 파일명 규약. 인라인 실행에서는 크롭을 만들지 않지만 경로 규약은 고정한다
    cropUri: cropPath(jobId, slice.pageIndex, slice.anchor.numberText),
    ocrText: region.ocrText || null,
    problemType: region.problemType,
    regions: region.regions,
    confidence: 1,
    flags,
    reviewedAt: null,
  }
}

/** §4.6 — {jobId}/{pageIndex:03d}_{number}.png */
export function cropPath(jobId: string, pageIndex: number, number: string): string {
  return `${jobId}/${String(pageIndex).padStart(3, '0')}_${number}.png`
}
