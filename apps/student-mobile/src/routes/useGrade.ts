// 채점 실행 + 후속 이동. 스토어는 라우터를 모르므로 "정답이 없다"는 신호만 돌려주고,
// 정답 입력 화면으로 흘려보내는 건 여기서 한다 (F-05).
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDocumentStore } from '../stores/documentStore'
import { paths } from './paths'

export function useGrade() {
  const navigate = useNavigate()
  return useCallback(async () => {
    const docId = useDocumentStore.getState().doc?.id
    const result = await useDocumentStore.getState().grade()
    if (result === 'need-answers' && docId) navigate(paths.answers(docId))
  }, [navigate])
}
