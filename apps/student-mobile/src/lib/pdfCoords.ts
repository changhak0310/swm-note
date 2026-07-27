// PDF 사용자 공간 → 페이지 좌표 변환. 한 곳에만 둔다.
//
// ★ 함정: PDF의 좌표 원점은 (0,0)이 아닐 수 있다.
//
//   페이지의 표시 영역은 CropBox가 정하는데, 스캔한 원본을 잘라 만든 PDF는 이 상자가
//   원점에서 한참 떨어져 있다 — 실측 ~/Downloads/hi_math.pdf: 1쪽 [702.99, 34.02,
//   1341.68, 886.72], 2쪽 이후 [36.85, 36.85, 674.65, 887.24]. (2단 스캔의 한쪽만
//   잘라 쓴 흔적이다.) 반면 수능 PDF는 [0, 0, 842, 1191]이라 이 문제가 드러나지 않는다.
//
//   그래서 `item.transform[4]`를 그대로 x로 쓰면 안 된다. 그렇게 뒀더니 hi_math 1쪽의
//   글자가 폭 760인 페이지에서 x 887~1217에 찍혔다 — 문항 박스가 화면 밖으로 나가
//   "다 깨져" 보였다. 나머지 쪽도 44px씩 밀려 있었다.
//
//   뷰포트 변환(getViewport().transform)이 CropBox 원점과 페이지 회전을 함께 처리한다.
//   pdf.js가 캔버스에 그릴 때 쓰는 바로 그 행렬이라, 화면과 좌표가 어긋날 수 없다.

export type ViewportLike = {
  width: number
  height: number
  /** [a, b, c, d, e, f] — pdf.js PageViewport.transform */
  transform: number[]
}

/** PDF 사용자 공간의 점 → 뷰포트 좌표(좌상단 원점, pt 단위) */
export function toViewportPoint(vp: ViewportLike, x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = vp.transform
  return [a * x + c * y + e, b * x + d * y + f]
}

/** 페이지가 90°·270° 회전이면 글자의 가로·세로가 뒤바뀐다 */
export function isRotatedQuarter(vp: ViewportLike): boolean {
  return Math.abs(vp.transform[1]) > Math.abs(vp.transform[0])
}
