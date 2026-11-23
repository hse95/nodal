import { JSX, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { setUi, toast } from './store';
import { viewportApi } from './Viewport';
import type { RenderJob } from './render';

/** A path-traced still picture of the current 3D view. It refines while you watch and can be saved at any time. */
export function RenderDialog(): JSX.Element {
  const [width, setWidth] = createSignal(1600), [samples, setSamples] = createSignal(200), [done, setDone] = createSignal(0), [state, setState] = createSignal<'idle' | 'running' | 'finished' | 'failed'>('idle'), [message, setMessage] = createSignal('');
  let job: RenderJob | null = null, holder!: HTMLDivElement;
  // Only one picture is prepared at a time: a change of settings while one is being prepared is applied when it is ready.
  let preparing = false, again = false, closed = false;
  const start = async () => {
    if (preparing) { again = true; return; }
    preparing = true;
    job?.free(); job = null; holder.replaceChildren(); setDone(0); setState('running'); setMessage('Preparing the scene…');
    try {
      const made = await viewportApi.render!({ width: width(), samples: samples(), onProgress: (d) => { if (job === made) { setDone(d); setMessage(''); } } });
      preparing = false;
      if (closed || again) { made.free(); if (again && !closed) { again = false; void start(); } return; }
      job = made; job.canvas.className = 'render-canvas'; holder.replaceChildren(job.canvas);
      void made.done.then(() => { if (job === made) setState(s => (s === 'running' ? 'finished' : s)); });
    } catch (e) { preparing = false; again = false; setState('failed'); setMessage((e as Error).message || 'The picture could not be rendered on this device.'); }
  };
  const save = () => { if (!job) return; job.canvas.toBlob(b => { if (!b) { toast('The picture could not be saved.'); return; } const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'nodal-render.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }, 'image/png'); };
  onMount(() => void start());
  onCleanup(() => { closed = true; job?.free(); });
  return <div class="backdrop" onPointerDown={e => { if (e.target === e.currentTarget) setUi('dialog', null); }}>
    <div class="dialog render-dialog" role="dialog" aria-label="Render">
      <div class="dialog-head"><h2>Render</h2><button class="link" onClick={() => setUi('dialog', null)} aria-label="Close">Close</button></div>
      <div class="render-bar">
        <label>Width <select value={width()} onChange={e => { setWidth(Number(e.currentTarget.value)); void start(); }} aria-label="Picture width"><option value="1200">1200 px</option><option value="1600">1600 px</option><option value="2400">2400 px</option><option value="3200">3200 px</option></select></label>
        <label>Quality <select value={samples()} onChange={e => { setSamples(Number(e.currentTarget.value)); void start(); }} aria-label="Quality"><option value="60">Draft (60 samples)</option><option value="200">Good (200)</option><option value="600">High (600)</option><option value="1500">Very high (1500)</option></select></label>
        <button onClick={() => void start()}>Render again</button>
        <span class="grow" />
        <span class="muted" aria-live="polite">{state() === 'running' ? `${done()} of ${samples()} samples` : state() === 'finished' ? 'Finished' : ''}</span>
        <Show when={state() === 'running'}><button onClick={() => { job?.stop(); setState('finished'); }}>Stop</button></Show>
        <button class="primary" disabled={!done()} onClick={save}>Save PNG</button>
      </div>
      <Show when={message()}><p class="muted pad" role={state() === 'failed' ? 'alert' : undefined}>{message()}</p></Show>
      <div class="render-holder" ref={holder} />
      <p class="muted pad">Path tracing follows light as it bounces between surfaces, which gives soft shadows and reflections that the live view only approximates. It shows the solids of the Realistic display (members, supports, shells, geometry), without diagrams, labels and lines. The picture gets cleaner with every sample; you can save it at any time.</p>
    </div>
  </div>;
}
