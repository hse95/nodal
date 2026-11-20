import { describe, it, expect } from 'vitest';
import '../src/components';
import { Engine } from '../src/core/graph';
import { EXAMPLES, Expected } from '../src/examples';
import { setScriptRunner, SCRIPT_PRELUDE } from '../src/components/structure';
import { optimize } from '../src/core/optimize';
import type { DataTree } from '../src/core/tree';

// In Node there is no Worker: run example scripts directly (the code under test is the examples, not the sandbox).
setScriptRunner(async (code, inputs, outputs) => {
  const names = Object.keys(inputs);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(...names, `"use strict"; ${SCRIPT_PRELUDE} let ${outputs.join(', ')};\n${code}\nreturn {${outputs.join(', ')}};`)(...names.map(n => inputs[n]));
});

export function pickValue(t: DataTree | undefined, e: Expected): number {
  const items = (t?.allItems() ?? []).map((x: any) => (e.comp ? x?.[e.comp] : typeof x === 'boolean' ? Number(x) : x)) as number[];
  switch (e.pick) {
    case 'count': return items.length;
    case 'max': return Math.max(...items);
    case 'min': return Math.min(...items);
    case 'absmax': return Math.max(...items.map(Math.abs));
    default: return items[0];
  }
}

describe('example gallery', () => {
  it('contains the required examples and one entry per benchmark', () => {
    expect(EXAMPLES.filter(e => e.id.startsWith('bench-')).length).toBe(28);
    for (const id of ['quick-truss', 'truss-bridge', 'portal-building', 'space-truss', 'gridshell', 'cable-net', 'hypar-shell', 'tower', 'sizing', 'evolve-beam']) expect(EXAMPLES.some(e => e.id === id), id).toBe(true);
  });
  for (const ex of EXAMPLES) {
    it(`${ex.title} opens, runs and matches its stated results`, async () => {
      const { project, expected } = ex.build();
      const engine = new Engine();
      await engine.run(project);
      for (const n of project.graph.nodes) {
        const st = engine.status(n.id);
        expect(st.state, `${n.label ?? n.type}: ${st.messages.join(' | ')}`).not.toBe('error');
        if (n.type !== 'param.note' && n.type !== 'opt.evolve') expect(['ok', 'warning'], `${n.label ?? n.type}: ${st.messages.join(' | ')}`).toContain(st.state);
      }
      expect(expected.length).toBeGreaterThan(0);
      const problems: string[] = [];
      for (const e of expected) {
        const val = pickValue(engine.outputs(e.node)[e.out], e);
        if (process.env.PRINT_EXAMPLES) (await import('node:fs')).appendFileSync(process.env.PRINT_EXAMPLES, `${ex.id} | ${e.label} | ${val}\n`);
        const err = e.value === 0 ? Math.abs(val) : Math.abs(val - e.value) / Math.abs(e.value);
        if (!(err <= e.tol + 1e-12)) problems.push(`"${e.label}" computed ${val} ${e.unit}, stated ${e.value} ${e.unit}`);
      }
      expect(problems, `${ex.title}: ${problems.join('; ')}`).toEqual([]);
    });
  }
  it('the beam optimization example reaches the hand-calculated optimum', async () => {
    const ex = EXAMPLES.find(e => e.id === 'evolve-beam')!, { project } = ex.build(), engine = new Engine();
    const opt = project.graph.nodes.find(n => n.type === 'opt.evolve')!, sliders = (opt.state.genes as string[]).map(id => project.graph.nodes.find(n => n.id === id)!);
    const res = await optimize(sliders.map(s => ({ min: s.state.min, max: s.state.max })), async (x) => { sliders.forEach((s, i) => { s.state.value = x[i]; }); await engine.run(project); return engine.outputs(opt.id)[0].first() as number; }, { population: 20, generations: 15, localSearch: true, seed: 1 });
    // By hand: b = 100 mm (lower limit), h from 5wL^4/(384 E b h^3/12) = L/250.
    const hOpt = Math.cbrt(12 * 5 * 20000 * 8 ** 4 / (384 * 33e9 * 0.1 * 0.032)) * 1000;
    expect(res.best.x[0]).toBeLessThan(108); expect(Math.abs(res.best.x[1] - hOpt)).toBeLessThan(12);
    expect(res.best.f).toBeLessThan(0.1 * (hOpt + 12) / 1000 * 8 * 2500 * 1.02);
  });
});
