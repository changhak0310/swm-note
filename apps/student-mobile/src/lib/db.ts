// IndexedDB 접근 (§4 스토어 정의, §8 저장 전략)
// 스트로크는 페이지 단위로 묶어 저장한다 — 획 단위 레코드는 조회가 번거롭다.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { LabelPack } from './labelPack'
import type {
  AnswerKey,
  Attempt,
  AttemptState,
  Document,
  PageInk,
  RetryList,
  SegmentCache,
} from '../types'

interface PuriDB extends DBSchema {
  documents: {
    key: string
    value: Document
    indexes: { lastOpenedAt: number }
  }
  segments: {
    key: [string, number]
    value: SegmentCache
    indexes: { docId: string }
  }
  ink: {
    key: [string, number]
    value: PageInk
    indexes: { docId: string }
  }
  answerKeys: { key: string; value: AnswerKey }
  attempts: {
    key: [string, string, number]
    value: Attempt
    indexes: { docId: string }
  }
  retryLists: { key: string; value: RetryList }
  attemptState: { key: string; value: AttemptState }
  /**
   * 라벨 팩 — 사람이 확인한 골든셋 (§11).
   *
   * ★ 키가 **내용 해시**다. 파일명이 아니다. 이름은 바뀌고, 다른 책이 같은 이름일 수 있다.
   *   잘못 앉은 라벨은 검출 실패보다 나쁘므로 신원 확인이 헐거우면 안 된다.
   */
  goldenPacks: { key: string; value: LabelPack }
}

let dbPromise: Promise<IDBPDatabase<PuriDB>> | null = null

export function getDB(): Promise<IDBPDatabase<PuriDB>> {
  dbPromise ??= openDB<PuriDB>('puri', 3, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const documents = db.createObjectStore('documents', { keyPath: 'id' })
        documents.createIndex('lastOpenedAt', 'lastOpenedAt')

        const segments = db.createObjectStore('segments', { keyPath: ['docId', 'page'] })
        segments.createIndex('docId', 'docId')

        const ink = db.createObjectStore('ink', { keyPath: ['docId', 'page'] })
        ink.createIndex('docId', 'docId')

        db.createObjectStore('answerKeys', { keyPath: 'docId' })

        const attempts = db.createObjectStore('attempts', {
          keyPath: ['docId', 'regionId', 'no'],
        })
        attempts.createIndex('docId', 'docId')

        db.createObjectStore('retryLists', { keyPath: 'docId' })
      }
      if (oldVersion < 2) {
        // v2: 문제별 회차 (F-09)
        db.createObjectStore('attemptState', { keyPath: 'docId' })
      }
      if (oldVersion < 3) {
        // v3: 라벨 팩 (§11) — 키는 내용 해시
        db.createObjectStore('goldenPacks', { keyPath: 'sourceHash' })
      }
    },
  })
  return dbPromise
}

// ---------- documents ----------

export async function putDocument(doc: Document) {
  await (await getDB()).put('documents', doc)
}

export async function getDocument(id: string) {
  return (await getDB()).get('documents', id)
}

export async function listDocuments(): Promise<Document[]> {
  const all = await (await getDB()).getAllFromIndex('documents', 'lastOpenedAt')
  return all.reverse()             // 최근 연 순
}

// ---------- segments ----------

export async function putSegments(cache: SegmentCache) {
  await (await getDB()).put('segments', cache)
}

export async function getSegments(docId: string, page: number) {
  return (await getDB()).get('segments', [docId, page])
}

// ---------- ink ----------

export async function putPageInk(ink: PageInk) {
  await (await getDB()).put('ink', ink)
}

export async function getPageInk(docId: string, page: number) {
  return (await getDB()).get('ink', [docId, page])
}

// ---------- answerKeys ----------

export async function putAnswerKey(key: AnswerKey) {
  await (await getDB()).put('answerKeys', key)
}

export async function getAnswerKey(docId: string) {
  return (await getDB()).get('answerKeys', docId)
}

// ---------- attempts ----------

export async function putAttempts(attempts: Attempt[]) {
  const tx = (await getDB()).transaction('attempts', 'readwrite')
  for (const a of attempts) tx.store.put(a)
  await tx.done
}

export async function getAttempts(docId: string) {
  return (await getDB()).getAllFromIndex('attempts', 'docId', docId)
}

// ---------- retryLists ----------

export async function putRetryList(list: RetryList) {
  await (await getDB()).put('retryLists', list)
}

export async function getRetryList(docId: string) {
  return (await getDB()).get('retryLists', docId)
}

// ---------- goldenPacks (라벨 팩) ----------

export async function putGoldenPack(pack: LabelPack) {
  await (await getDB()).put('goldenPacks', pack)
}

export async function getGoldenPack(sourceHash: string) {
  return (await getDB()).get('goldenPacks', sourceHash)
}

export async function listGoldenPacks(): Promise<LabelPack[]> {
  return (await getDB()).getAll('goldenPacks')
}

export async function deleteGoldenPack(sourceHash: string) {
  await (await getDB()).delete('goldenPacks', sourceHash)
}

// ---------- attemptState (문제별 회차) ----------

export async function putAttemptState(state: AttemptState) {
  await (await getDB()).put('attemptState', state)
}

export async function getAttemptState(docId: string) {
  return (await getDB()).get('attemptState', docId)
}

// ---------- 문서 삭제 (F-01 — 스트로크·회차·정답 전부 제거) ----------

export async function deleteDocumentData(docId: string) {
  const db = await getDB()
  const tx = db.transaction(
    ['documents', 'segments', 'ink', 'answerKeys', 'attempts', 'retryLists', 'attemptState'],
    'readwrite',
  )
  await tx.objectStore('documents').delete(docId)
  for (const name of ['segments', 'ink', 'attempts'] as const) {
    const store = tx.objectStore(name)
    const keys = await store.index('docId').getAllKeys(docId)
    for (const k of keys) await store.delete(k)
  }
  await tx.objectStore('answerKeys').delete(docId)
  await tx.objectStore('retryLists').delete(docId)
  await tx.objectStore('attemptState').delete(docId)
  await tx.done
}

// ---------- 주관식 → 5지선다 전환 (F-06 규칙 2) ----------

export async function setRegionAnswerType(
  docId: string,
  page: number,
  regionId: string,
  answerType: 'choice' | 'integer' | 'expression',
) {
  const db = await getDB()
  const seg = await db.get('segments', [docId, page])
  if (!seg) return
  const region = seg.regions.find((r) => r.id === regionId)
  if (!region) return
  region.answerType = answerType
  await db.put('segments', seg)
}

// ---------- 디바운스 저장 (§8) ----------
// pointerup마다 페이지 전체를 다시 쓰되 1초 디바운스로 묶는다.
// 백그라운드 진입 시 flushPendingSaves()로 대기분을 즉시 저장한다.

const SAVE_DEBOUNCE_MS = 1000
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; run: () => Promise<void> }>()

export function scheduleSave(key: string, run: () => Promise<void>) {
  const existing = pending.get(key)
  if (existing) clearTimeout(existing.timer)
  const timer = setTimeout(() => {
    pending.delete(key)
    void run()
  }, SAVE_DEBOUNCE_MS)
  pending.set(key, { timer, run })
}

export async function flushPendingSaves() {
  const tasks = [...pending.values()]
  pending.clear()
  for (const t of tasks) clearTimeout(t.timer)
  await Promise.all(tasks.map((t) => t.run()))
}
