import { Component, lazy, Suspense, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import type { Controls } from './scene';

const Scene = lazy(() => import('./scene'));
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div className="loading" role="alert"><div><strong>The island could not open.</strong><p>Try a browser with hardware acceleration, or reload to try again.</p><button className="reset" onClick={() => window.location.reload()}>Reload playground</button></div></div> : this.props.children;
  }
}
function App() {
  const controls = useRef<Controls>({ up: false, down: false, left: false, right: false });
  const [reset, setReset] = useState(0);
  const [ready, setReady] = useState(false);
  const [moving, setMoving] = useState(false);
  const clear = () => { Object.keys(controls.current).forEach((key) => { controls.current[key as keyof Controls] = false; }); };
  const keys: Record<string, keyof Controls> = { ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down', ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' };
  return <main>
    <header><a className="brand" href="#playground" aria-label="Orbix playground"><span className="brand-icon">O</span>orbix<span className="brand-dot">.</span></a><span className="lab-label">CREATIVE PLAYGROUND / 01</span><span className="status"><i />Local lab</span></header>
    <section className="intro"><div><p className="eyebrow">SMALL WORLD. BIG POSSIBILITIES.</p><h1>Meet your next<br /><span>playground.</span></h1></div><p className="intro-copy">A little island of color, motion and possibility.<br />Take our tiny explorer for a wander.</p></section>
    <section className="playground" id="playground" aria-label="Interactive 3D playground">
      <div className="canvas-wrap" tabIndex={0} role="group" aria-label="Movement area. Use arrow keys or W A S D to move."
        onKeyDown={(event) => { const action = keys[event.key]; if (action) { event.preventDefault(); controls.current[action] = true; } }}
        onKeyUp={(event) => { const action = keys[event.key]; if (action) { event.preventDefault(); controls.current[action] = false; } }} onBlur={clear}>
        <SceneBoundary><Suspense fallback={<div className="loading" role="status"><span className="loading-orb" />Building your little world…</div>}>
          <Scene controls={controls} reset={reset} onReady={() => setReady(true)} onMoving={setMoving} />
        </Suspense></SceneBoundary>
      </div>
      <div className="arena-tag"><span className="tiny-dot" /> SUNRISE ISLAND<span className="arena-sub">Motion & rendering study</span></div>
      <div className="live-pill" role="status">{ready ? moving ? 'Explorer on the move' : 'Ready to explore' : 'Preparing the island'}</div>
      <div className="control-bar"><div className="control-copy"><strong>Find your own rhythm.</strong><span>Focus the island, then use WASD or arrow keys.</span></div><div className="direction-pad" aria-label="Touch movement controls">
        {(['left', 'up', 'down', 'right'] as const).map((direction) => <button key={direction} aria-label={`Move ${direction}`} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); controls.current[direction] = true; }} onPointerUp={() => { controls.current[direction] = false; }} onPointerCancel={() => { controls.current[direction] = false; }} onLostPointerCapture={() => { controls.current[direction] = false; }} onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); controls.current[direction] = true; } }} onKeyUp={() => { controls.current[direction] = false; }} onBlur={() => { controls.current[direction] = false; }}>{ { left: '←', up: '↑', down: '↓', right: '→' }[direction]}</button>)}
      </div><button className="reset" onClick={() => { clear(); setReset((value) => value + 1); }}>Start again <span>↗</span></button></div>
    </section>
    <footer><p><strong>Made for play.</strong> Built to feel good.</p><p className="fixture-note">Development fixture · local movement · no rewards or multiplayer connected</p></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
