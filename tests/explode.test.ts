import { describe, it, expect } from 'vitest';
import '../src/components';
import { Engine } from '../src/core/graph';
import { BENCHMARKS } from '../src/verify/load';
import { benchmarkAsComponents } from '../src/verify/explode';

/**
 * Every benchmark is opened as ordinary components, solved by the graph engine,
 * and checked by the Verification Check component against the same reference
 * values as the single-component benchmark.
 */
describe('benchmarks rebuilt from components', () => {
  for (const def of BENCHMARKS) {
    it(`${def.id} ${def.title}`, async () => {
      const project = benchmarkAsComponents(def);
      expect(project.graph.nodes.some(n => n.type === 'fe.benchmark')).toBe(false);       // no single-component shortcut
      const engine = new Engine();
      await engine.run(project);
      for (const n of project.graph.nodes) { const st = engine.status(n.id); expect(st.state, `${n.label ?? n.type}: ${st.messages.join(' | ')}`).not.toBe('error'); }
      const check = project.graph.nodes.find(n => n.type === 'fe.benchmark.check')!;
      const [table, pass] = engine.outputs(check.id).map(t => t.first() as any);
      const failed = (table.rows as string[][]).filter(r => r[r.length - 1] !== '✓').map(r => `${r[0]}: computed ${r[2]}, reference ${r[3]}`);
      expect(failed, failed.join('\n')).toEqual([]);
      expect(pass).toBe(true);
    });
  }
});
