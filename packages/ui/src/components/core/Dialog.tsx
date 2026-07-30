'use client'

// 푸리 DS — Dialog. 확인·입력을 받는 모달. Radix 위에 올렸다.
//
// 손으로 만든 스크림을 쓰지 않는 이유: 포커스 트랩·Escape 닫기·닫은 뒤 포커스 복원·
// body 스크롤 잠금·aria-modal이 전부 필요한데, 그걸 매번 다시 짜면 매번 빠뜨린다.
// 특히 스크림에 onClick을 거는 방식은 **다이얼로그 안에서 드래그를 시작해 스크림에서
// 손을 떼면 닫히는** 버그가 있다(텍스트 선택 중에 흔하다). Radix는 pointerdown/up의
// 타깃을 함께 보고 이를 막는다.
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '../../lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close
export const DialogPortal = DialogPrimitive.Portal

export function DialogOverlay({ className, ...rest }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn('fixed inset-0 z-50 bg-[rgba(27,31,22,0.32)] backdrop-blur-[3px]', className)}
      {...rest}
    />
  )
}

/** 스크림 + 종이 패널. 기본 폭은 max-w-md, 좌우로 24px씩 숨 쉴 자리를 남긴다. */
export function DialogContent({
  className,
  children,
  ...rest
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
          'w-[calc(100%-3rem)] max-w-md p-6 bg-paper rounded-xl shadow-lg outline-none',
          className,
        )}
        {...rest}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

export function DialogTitle({ className, ...rest }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('text-h3 font-semibold text-strong', className)} {...rest} />
}

export function DialogDescription({
  className,
  ...rest
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('mt-1.5 text-sm text-muted-foreground', className)} {...rest} />
}

/** 오른쪽 정렬된 액션 줄. 파괴적 동작은 오른쪽 끝에 두지 않는다(오조작 방지). */
export function DialogFooter({ className, ...rest }: React.ComponentProps<'div'>) {
  return <div className={cn('mt-5 flex justify-end gap-2', className)} {...rest} />
}
