// 내용 해시 — 라벨과 PDF가 짝인지 확인하는 유일한 수단.
//
// ★ **한 곳에만 둔다.** 라벨러가 뜬 해시와 런타임이 뜬 해시가 조금이라도 다르면 팩이
//   조용히 안 붙는다 — 그리고 "안 붙는다"는 화면에 안 나오는 종류의 실패다.
//   Node 쪽(코퍼스 하네스)도 같은 규약이어야 한다: sha256 앞 16자리, `sha256:` 접두.
export async function sha256Short(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `sha256:${hex.slice(0, 16)}`
}
