import { describe, it, expect } from 'vitest';
import '../src/components';
import { Engine } from '../src/core/graph';
import { TEMPLATES } from '../src/templates';
import { pickValue } from './pick';

describe('templates', () => {
  it('have unique ids and both kinds are present', () => {
    expect(new Set(TEMPLATES.map(t => t.id)).size).toBe(TEMPLATES.length);
    expect(TEMPLATES.some(t => t.group === 'Complete models')).toBe(true);
    expect(TEMPLATES.some(t => t.group === 'Building blocks')).toBe(true);
  });
  for (const t of TEMPLATES) {
    it(`${t.title} builds${t.group === 'Complete models' ? ', solves and matches a hand calculation' : ''}`, async () => {
      const { project, expected } = t.build();
      expect(project.graph.nodes.length).toBeGreaterThan(1);
      expect(project.graph.groups.length).toBeGreaterThan(0);
      if (t.group !== 'Complete models') return;       // building blocks wait for wires from the user's graph
      const engine = new Engine();
      await engine.run(project);
      for (const n of project.graph.nodes) { const st = engine.status(n.id); expect(st.state, `${n.label ?? n.type}: ${st.messages.join(' | ')}`).toBe('ok'); }
      expect(expected.length).toBeGreaterThan(0);
      for (const e of expected) {
        const val = pickValue(engine.outputs(e.node)[e.out], e), err = e.value === 0 ? Math.abs(val) : Math.abs(val - e.value) / Math.abs(e.value);
        expect(err, `"${e.label}" computed ${val} ${e.unit}, by hand ${e.value} ${e.unit}`).toBeLessThanOrEqual(e.tol);
      }
    });
  }
});
