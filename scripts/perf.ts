// Solver performance measurements: npx tsx scripts/perf.ts
// Prints timings for models of about 50,000 degrees of freedom of three different topologies.
import { v } from '../src/geom/vec';
import { material, secRect, buildModel, ElementPart, SupportPart } from '../src/fe/model';
import { beam, shell, support, pressureLoad, lineLoad } from '../src/fe/parts';
import { solveStatic } from '../src/fe/analysis';

const steel = material('Steel', 210e9, 0.3, 7850, 355e6, 1.2e-5);
function plate(n: number) {
  const els: ElementPart[] = [], sups: SupportPart[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) els.push(shell([v(i, j, 0), v(i + 1, j, 0), v(i + 1, j + 1, 0), v(i, j + 1, 0)], steel, 0.05));
  for (let i = 0; i <= n; i++) for (const p of [v(i, 0, 0), v(i, n, 0), v(0, i, 0), v(n, i, 0)]) sups.push(support(p, 'ux uy uz'));
  return buildModel(els, sups, [pressureLoad(-1000)], 1e-6);
}
function frame3d(nx: number, ny: number, nz: number) {
  const els: ElementPart[] = [], sups: SupportPart[] = [], col = secRect(0.4, 0.4), bm = secRect(0.3, 0.5);
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) {
    sups.push(support(v(6 * i, 6 * j, 0), 'fixed'));
    for (let k = 0; k < nz; k++) {
      els.push(beam(v(6 * i, 6 * j, 3.5 * k), v(6 * i, 6 * j, 3.5 * (k + 1)), steel, col, { id: 'col' }));
      if (i < nx) els.push(beam(v(6 * i, 6 * j, 3.5 * (k + 1)), v(6 * i + 6, 6 * j, 3.5 * (k + 1)), steel, bm, { id: 'beam' }));
      if (j < ny) els.push(beam(v(6 * i, 6 * j, 3.5 * (k + 1)), v(6 * i, 6 * j + 6, 3.5 * (k + 1)), steel, bm, { id: 'beam' }));
    }
  }
  return buildModel(els, sups, [lineLoad(v(0, 0, -20000), undefined, { ids: ['beam'] })], 1e-6);
}
function report(name: string, build: () => ReturnType<typeof buildModel>) {
  const tb = performance.now(), m = build(), t0 = performance.now(), r = solveStatic(m), t1 = performance.now(), s = r.stats;
  console.log(`${name}: ${s.nodes} nodes, ${s.lineElements + s.shellElements} elements, ${s.freeDofs} free DOF, nnz(K) ${s.nnzK}, nnz(L) ${s.nnzL}, ordering ${s.ordering}`);
  console.log(`   build ${(t0 - tb).toFixed(0)} ms | assemble+order ${s.tAssemble.toFixed(0)} ms | factor ${s.tFactor.toFixed(0)} ms | total solve ${(t1 - t0).toFixed(0)} ms | equilibrium ${r.cases[0].equilibrium.relError.toExponential(1)}`);
}
report('Shell plate 91 x 91', () => plate(90));
report('Plane frame 60 bays x 140 stories', () => frame3d(60, 0, 140));
report('3D building frame 12 x 12 bays x 50 stories', () => frame3d(12, 12, 50));
