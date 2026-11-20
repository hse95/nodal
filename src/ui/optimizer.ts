/**
 * Runs the evolutionary optimizer against the live graph: each candidate sets
 * the chosen sliders, waits for the graph to solve, and reads the fitness that
 * arrives at the optimizer component.
 */
import { createSignal } from 'solid-js';
import { project, mutate, pushUndo, settled, engine, toast } from './store';
import { optimize, Gene, Evaluated } from '../core/optimize';

export const [optRunning, setOptRunning] = createSignal<string | null>(null);
export const [optStatus, setOptStatus] = createSignal('');
let stop = false;
export const stopOptimizer = (): void => { stop = true; };

function setSliders(ids: string[], x: number[]): void {
  mutate(p => { ids.forEach((id, i) => { const n = p.graph.nodes.find(q => q.id === id); if (n) n.state.value = x[i]; }); }, { undo: false, run: false });
}
export function reinstate(nodeId: string, e: Evaluated): void {
  const node = project.graph.nodes.find(n => n.id === nodeId);
  if (!node) return;
  pushUndo(); setSliders(node.state.genes ?? [], e.x);
  mutate(() => undefined, { undo: false });
}
export async function runOptimizer(nodeId: string): Promise<void> {
  const node = project.graph.nodes.find(n => n.id === nodeId);
  if (!node || optRunning()) return;
  const ids: string[] = (node.state.genes ?? []).filter((id: string) => project.graph.nodes.some(n => n.id === id && n.type === 'param.slider'));
  if (!ids.length) { toast('Choose at least one slider for the optimizer to change.'); return; }
  if (!project.graph.wires.some(w => w.to === nodeId)) { toast('Connect a number to the Fitness input first.'); return; }
  const genes: Gene[] = ids.map(id => { const s = project.graph.nodes.find(n => n.id === id)!.state; return { min: s.min, max: s.max, integer: !!s.integer }; });
  stop = false; setOptRunning(nodeId); pushUndo();
  let evals = 0;
  try {
    const res = await optimize(genes, async (x) => {
      setSliders(ids, x);
      await settled();
      evals++;
      const f = engine.outputs(nodeId)[0]?.first();
      return typeof f === 'number' ? f : NaN;
    }, { population: node.state.population, generations: node.state.generations, maximize: node.state.maximize, localSearch: node.state.localSearch, seed: node.state.seed }, (p) => {
      setOptStatus(`${p.phase}: generation ${p.generation}, best ${p.best.f.toPrecision(6)}, ${evals} designs evaluated`);
      mutate(pr => { const n = pr.graph.nodes.find(q => q.id === nodeId); if (n) n.state.history = p.history; }, { undo: false, run: false });
    }, () => stop);
    setSliders(ids, res.best.x);
    mutate(p => { const n = p.graph.nodes.find(q => q.id === nodeId); if (n) { n.state.history = res.history; n.state.top = res.top.slice(0, 12); } }, { undo: false });
    setOptStatus(`${res.stopped ? 'Stopped' : 'Finished'}: best ${res.best.f.toPrecision(6)} after ${res.evaluations} designs. The sliders are set to the best design.`);
  } catch (e) { setOptStatus('Optimization failed: ' + (e as Error).message); }
  setOptRunning(null);
}
