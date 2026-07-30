import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/* tailwind-merge에게 우리 테마를 알려준다.
 *
 * ★ 이 설정이 없으면 클래스가 조용히 사라진다. tailwind-merge는 기본 Tailwind 이름만 알아서
 *   `text-body`·`text-h3`처럼 t-shirt 사이즈가 아닌 이름을 전부 **글자색**으로 분류한다.
 *   그러면 `text-invert`(진짜 색)와 같은 그룹으로 묶여 뒤에 온 쪽만 살아남는다 —
 *   실제로 primary 버튼에서 `text-invert`가 지워져 초록 배경에 어두운 글자가 나왔다.
 *
 * 토큰을 추가할 때 이 목록도 같이 갱신한다. 안 하면 증상이 "가끔 스타일이 안 먹는다"로 나타난다.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      // typography.css의 타입 스케일 (sm은 Tailwind가 이미 아는 이름이라 뺀다)
      'font-size': [{ text: ['display', 'h1', 'h2', 'h3', 'body-lg', 'body', 'caption'] }],
      // spacing.css의 반경·그림자 중 t-shirt 사이즈가 아닌 것
      rounded: [{ rounded: ['pill'] }],
      shadow: [{ shadow: ['focus'] }],
    },
  },
})

/** shadcn 규약의 클래스 병합기 — 뒤에 온 클래스가 앞선 같은 축의 클래스를 이긴다.
 *  `cn('p-4', props.className)`처럼 써서 호출부가 스타일을 덮을 수 있게 한다. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
