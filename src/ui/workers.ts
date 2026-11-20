/**
 * Browser-side runners: the solver worker (with cancellation by termination)
 * and the sandbox worker for the Script component.
 */
import { setFERunner, FEJob, FEJobResult } from '../fe/client';
import { setScriptRunner, SCRIPT_PRELUDE } from '../components/structure';
import FEWorker from '../fe/worker?worker';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (r: FEJobResult) => void; reject: (e: Error) => void }>();
function getWorker(): Worker {
  if (worker) return worker;
  worker = new FEWorker();
  worker.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; result?: FEJobResult; error?: string }>) => {
    const p = pending.get(ev.data.id);
    if (!p) return;
    pending.delete(ev.data.id);
    if (ev.data.ok) p.resolve(ev.data.result!); else p.reject(new Error(ev.data.error));
  };
  worker.onerror = (ev) => { for (const p of pending.values()) p.reject(new Error(ev.message || 'The solver stopped unexpectedly')); pending.clear(); worker = null; };
  return worker;
}
/** Stop everything the solver is doing (used by the Cancel button and when inputs change mid-solve). */
export function cancelSolver(): void {
  if (!worker || pending.size === 0) return;
  worker.terminate(); worker = null;
  for (const p of pending.values()) p.reject(new Error('Analysis cancelled'));
  pending.clear();
}
export const solverBusy = (): boolean => pending.size > 0;

export function installRunners(): void {
  setFERunner((job: FEJob, cancelled: () => boolean) => new Promise<FEJobResult>((resolve, reject) => {
    const id = ++seq;
    const timer = setInterval(() => { if (!pending.has(id)) clearInterval(timer); else if (cancelled()) { clearInterval(timer); cancelSolver(); } }, 120);
    pending.set(id, { resolve: (r) => { clearInterval(timer); resolve(r); }, reject: (e) => { clearInterval(timer); reject(e); } });
    getWorker().postMessage({ id, job });
  }));

  // Script sandbox: a throw-away worker built from a Blob. Network and nested-worker APIs are removed before
  // the user code runs, the code only sees the data posted to it, and the worker is killed after 5 seconds.
  setScriptRunner((code, inputs, outputs, cancelled) => new Promise((resolve, reject) => {
    const src = `
      for (const k of ['fetch','XMLHttpRequest','WebSocket','EventSource','importScripts','indexedDB','caches','Worker','SharedWorker','BroadcastChannel','navigator']) { try { Object.defineProperty(self, k, { value: undefined, configurable: false }); } catch (e) {} }
      self.onmessage = (ev) => {
        const { code, inputs, outputs } = ev.data;
        try {
          const names = Object.keys(inputs);
          const body = '"use strict"; ' + ev.data.prelude + ' let ' + outputs.join(', ') + ';\\n' + code + '\\nreturn {' + outputs.join(', ') + '};';
          const fn = new Function(...names, body);
          self.postMessage({ ok: true, result: fn(...names.map(n => inputs[n])) });
        } catch (e) { self.postMessage({ ok: false, error: String(e && e.message || e) }); }
      };`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    const done = () => { clearTimeout(timeout); clearInterval(poll); w.terminate(); URL.revokeObjectURL(url); };
    const timeout = setTimeout(() => { done(); reject(new Error('The script ran for more than 5 seconds and was stopped')); }, 5000);
    const poll = setInterval(() => { if (cancelled()) { done(); reject(new Error('Cancelled')); } }, 150);
    w.onmessage = (ev) => { done(); if (ev.data.ok) resolve(ev.data.result); else reject(new Error('Script error: ' + ev.data.error)); };
    w.onerror = (ev) => { done(); reject(new Error('Script error: ' + ev.message)); };
    try { w.postMessage({ code, inputs, outputs, prelude: SCRIPT_PRELUDE }); } catch (e) { done(); reject(new Error('Script inputs could not be passed to the sandbox: ' + (e as Error).message)); }
  }));
}
