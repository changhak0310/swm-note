// /doc/:docId 로더 — 화면이 그려지기 전에 문서를 연다.
//
// 목록에서 카드를 눌러 들어오든 주소를 직접 열든(웹뷰 새로고침) 같은 경로를 탄다.
// 열 수 없는 문서(파일 없음·삭제됨)는 목록으로 되돌린다 — 안내 토스트는 스토어가 띄운다.
import { redirect, type LoaderFunctionArgs } from 'react-router-dom'
import { useDocumentStore } from '../stores/documentStore'
import { paths } from './paths'

export async function documentLoader({ params }: LoaderFunctionArgs) {
  const docId = params.docId
  if (!docId) throw redirect(paths.list)
  const opened = await useDocumentStore.getState().openDocument(docId)
  if (!opened) throw redirect(paths.list)
  return null
}
