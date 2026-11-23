import { JSX, Show, lazy, Suspense } from 'solid-js';
import { ui, setUi, setSide } from './store';
import { Inspector } from './Inspector';

// The assistant is optional: its code is only loaded when the tab is opened.
const Assistant = lazy(() => import('./Assistant'));

/** The panel on the right: Inspector or Assistant. It can be resized, and hidden down to a slim rail. */
export function SidePanel(): JSX.Element {
  const startResize = (e: PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect().width;
    const move = (ev: PointerEvent) => setUi('sideWidth', Math.min(640, Math.max(240, w0 + x0 - ev.clientX)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); try { localStorage.setItem('nodal.sideWidth', String(ui.sideWidth)); } catch { /* storage unavailable */ } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const tab = (id: 'inspector' | 'assistant', label: string) => <button role="tab" aria-selected={ui.side === id} classList={{ on: ui.side === id }} onClick={() => setSide(id)}>{label}</button>;
  return <Show when={ui.side !== 'hidden'} fallback={
    <div class="side-rail" aria-label="Side panel (hidden)">
      <button title="Show inspector" aria-label="Show inspector" onClick={() => setSide('inspector')}><svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M5 5h14v14H5zM14 5v14" /></svg></button>
      <button title="Assistant (optional AI)" aria-label="Open assistant" onClick={() => setSide('assistant')}><svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M5 6h14v9H11l-4 3.5V15H5z" /><path class="ia" d="M9.5 10.5h.01M12 10.5h.01M14.5 10.5h.01" /></svg></button>
    </div>}>
    <aside class="side" classList={{ wide: ui.side === 'assistant' }} style={ui.sideWidth ? { width: ui.sideWidth + 'px' } : undefined} aria-label="Side panel">
      <div class="side-grip" role="separator" aria-label="Resize side panel" onPointerDown={startResize} />
      <div class="side-tabs" role="tablist">
        {tab('inspector', 'Inspector')}{tab('assistant', 'Assistant')}
        <span class="grow" />
        <button class="side-hide" title="Hide side panel" aria-label="Hide side panel" onClick={() => setSide('hidden')}>»</button>
      </div>
      <Show when={ui.side === 'inspector'}><Inspector /></Show>
      <Show when={ui.side === 'assistant'}><Suspense fallback={<p class="muted pad">Loading…</p>}><Assistant /></Suspense></Show>
    </aside>
  </Show>;
}
