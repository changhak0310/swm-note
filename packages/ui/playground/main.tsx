import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { Gallery } from './Gallery'
import { ButtonProposals } from './ButtonProposals'

// ?proposals 로 열면 버튼 시안 비교판. 시안이 정해지면 이 분기와 파일을 지운다.
const view = new URLSearchParams(location.search).has('proposals') ? <ButtonProposals /> : <Gallery />

createRoot(document.getElementById('root')!).render(<StrictMode>{view}</StrictMode>)
