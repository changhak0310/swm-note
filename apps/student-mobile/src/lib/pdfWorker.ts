// pdf.js 워커 래퍼 — 워커 스코프에도 폴리필을 먼저 깔고 본체를 로드한다.
// 정적 import는 호이스팅되어 폴리필이 항상 먼저 실행되고,
// 모듈 그래프 평가가 끝날 때까지 수신 메시지가 큐잉되어 유실 경합도 없다.
// legacy 빌드: 구형 WebView에 없는 최신 API를 pdf.js가 자체 폴리필한다.
import './polyfills'
import 'pdfjs-dist/legacy/build/pdf.worker.min.mjs'
