import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const Center = lazy(() => import('./center/CenterApp').then(module => ({ default: module.CenterApp })))
const Cockpit = lazy(() => import('./CockpitApp'))
const inCenter = /^\/center(?:\/|$)/.test(window.location.pathname)
createRoot(document.getElementById('root')!).render(
  <StrictMode><Suspense fallback={<div role="status" className="orbix-page-loading"><span aria-hidden="true">✦</span><p>{inCenter ? 'Opening your arcade…' : 'Opening Orbix Core…'}</p></div>}>
    {inCenter ? <Center /> : <Cockpit />}
  </Suspense></StrictMode>,
)
