// 버튼 리디자인 시안 비교판 — 결정용 임시 페이지. 시안이 정해지면 이 파일은 지운다.
// 4개 시안을 같은 문구·같은 배치로 나란히 둬서, 다른 조건이 아니라 디자인만 비교되게 한다.
import { Button } from '../src'

const ROWS: { key: string; title: string; note: string; cls: string; icon: string }[] = [
  {
    key: 'A',
    title: 'A · 현재',
    note: '반경 10px · 그림자 xs · 좌우 20px',
    cls: '',
    icon: '',
  },
  {
    key: 'B',
    title: 'B · 알약',
    note: '반경 999px · 그림자 유지 — 가장 눈에 띄는 변화',
    cls: 'rounded-pill',
    icon: '',
  },
  {
    key: 'C',
    title: 'C · 납작',
    note: '그림자 제거 · 반경 14px — 종이에 인쇄된 느낌',
    cls: 'rounded-lg shadow-none',
    icon: '',
  },
  {
    key: 'D',
    title: 'D · 묵직',
    note: '높이 52 · 좌우 32px · 그림자 md — 주 액션의 무게를 키움',
    cls: 'h-13 px-8 shadow-md',
    icon: '',
  },
]

export function ButtonProposals() {
  return (
    <div className="min-h-dvh bg-background p-8">
      <h1 className="ds-wordmark mb-1 text-h1">버튼 시안</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        같은 문구·같은 순서로 배치했습니다. 색·글꼴·굵기는 넷 다 동일하고 모양만 다릅니다.
      </p>

      <div className="flex flex-col gap-6">
        {ROWS.map((r) => (
          <section key={r.key} className="ds-card p-6">
            <div className="mb-4">
              <div className="text-h3 font-semibold text-strong">{r.title}</div>
              <div className="text-sm text-muted-foreground">{r.note}</div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Button className={r.cls}>PDF 올리기</Button>
              <Button variant="secondary" className={r.cls}>
                정답 입력
              </Button>
              <Button variant="ghost" className={r.cls}>
                건너뛰기
              </Button>
              <Button variant="danger" className={r.cls}>
                삭제
              </Button>
              <Button disabled className={r.cls}>
                비활성
              </Button>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
