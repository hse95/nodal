import { describe, it, expect } from 'vitest';
import { v } from '../src/geom/vec';
import { material, secGeneric, buildModel } from '../src/fe/model';
import { beam, support, pointLoad, lineLoad } from '../src/fe/parts';
import { solveNonlinear, solveStatic } from '../src/fe/analysis';
import { memberForces } from '../src/fe/post';

// Shallow two-bar (von Mises) truss: supports at (-a, 0) and (a, 0), apex at height h, load P downward at the apex.
const a = 2, h = 0.3, E = 210e9, A = 1e-3, L0 = Math.hypot(a, h);
/** Exact equilibrium load for an apex displacement w (engineering strain on the current chord). */
const loadAt = (w: number) => { const y = h - w, l = Math.hypot(a, y); return -2 * (E * A * (l - L0) / L0) * y / l; };
function vonMises(P: number) {
  const mat = material('S', E, 0.3, 0, 1e9, 0), sec = secGeneric('bar', A, 1e-8, 1e-8, 1e-8);
  const els = [beam(v(-a, 0, 0), v(0, 0, h), mat, sec, { type: 'truss' }), beam(v(a, 0, 0), v(0, 0, h), mat, sec, { type: 'truss' })];
  return buildModel(els, [support(v(-a, 0, 0), 'pinned'), support(v(a, 0, 0), 'pinned'), support(v(0, 0, h), 'ux uy')], [pointLoad(v(0, 0, h), v(0, 0, -P))], 1e-9);
}
let wLimit = 0, Plimit = 0;
for (let w = 0; w < h; w += h / 20000) { const P = loadAt(w); if (P > Plimit) { Plimit = P; wLimit = w; } }

describe('geometrically nonlinear analysis', () => {
  it('Newton load stepping follows the exact pre-limit path of the von Mises truss', () => {
    const P = 0.8 * Plimit, r = solveNonlinear(vonMises(P), { kind: 'nonlinear', steps: 8 });
    const w = -r.cases[0].u[6 * 1 + 2];
    expect(w).toBeGreaterThan(0); expect(w).toBeLessThan(wLimit);
    expect(Math.abs(loadAt(w) / P - 1)).toBeLessThan(1e-6);
    // Much softer than the linear answer close to the limit load.
    const lin = -solveStatic(vonMises(P)).cases[0].u[6 * 1 + 2];
    expect(w / lin).toBeGreaterThan(1.3);
    expect(r.cases[0].equilibrium.relError).toBeLessThan(1e-8);
  });
  it('the arc-length method passes the limit point and reaches the load on the snapped-through branch', () => {
    const P = 1.5 * Plimit, r = solveNonlinear(vonMises(P), { kind: 'nonlinear', steps: 30, arcLength: true, maxIter: 50 });
    const path = r.path!, lambdas = path.map(p => p[0]);
    // The load factor rises to the limit load, falls, and rises again: a snap-through path.
    let peak = 0, peakIdx = 0;
    for (let i = 1; i < lambdas.length - 1; i++) if (lambdas[i] > lambdas[i - 1] && lambdas[i] > lambdas[i + 1]) { peak = lambdas[i]; peakIdx = i; break; }
    expect(peakIdx, 'a limit point was found on the path').toBeGreaterThan(0);
    expect(peak * P / Plimit).toBeGreaterThan(0.97); expect(peak * P / Plimit).toBeLessThanOrEqual(1 + 1e-6);
    // Every converged point lies on the exact curve.
    for (const [lam, norm] of path.slice(1)) expect(Math.abs(loadAt(norm) / P - lam)).toBeLessThan(1e-6);
    const w = -r.cases[0].u[6 * 1 + 2];
    expect(lambdas[lambdas.length - 1]).toBeGreaterThan(0.999);
    expect(w).toBeGreaterThan(2 * h);                                   // the apex is now below the supports, bars in tension
    expect(memberForces(r.model, r.cases[0], 0, 0)[0]).toBeGreaterThan(0);
  });
  it('a pretensioned cable carries a transverse load with the geometric stiffness of its tension', () => {
    // Taut string of length 2L with pretension T and a small central load: sag = P L / (2 T) to first order.
    const L = 5, T = 50000, P = 200, mat = material('C', 1.6e11, 0.3, 0, 1e9, 0), sec = secGeneric('c', 2e-4, 1e-12, 1e-12, 1e-12);
    const els = [beam(v(-L, 0, 0), v(0, 0, 0), mat, sec, { type: 'cable', pre: T }), beam(v(0, 0, 0), v(L, 0, 0), mat, sec, { type: 'cable', pre: T })];
    const m = buildModel(els, [support(v(-L, 0, 0), 'pinned'), support(v(L, 0, 0), 'pinned'), support(v(0, 0, 0), 'ux uy')], [pointLoad(v(0, 0, 0), v(0, 0, -P))], 1e-9);
    const r = solveNonlinear(m, { kind: 'nonlinear', steps: 2 }), sag = -r.cases[0].u[6 * 1 + 2];
    expect(sag / (P * L / (2 * T))).toBeGreaterThan(0.99); expect(sag / (P * L / (2 * T))).toBeLessThan(1.001);
  });
  it('tension-only bracing goes slack under compression in a linear analysis', () => {
    // A pin-jointed square panel with two crossing tension-only diagonals and a lateral load: only one diagonal works.
    const mat = material('S', E, 0.3, 0, 1e9, 0), sec = secGeneric('bar', A, 1e-8, 1e-8, 1e-8), s = 3, H = 10000;
    const p = [v(0, 0, 0), v(s, 0, 0), v(s, 0, s), v(0, 0, s)];
    const els = [beam(p[0], p[3], mat, sec, { type: 'truss', id: 'col' }), beam(p[1], p[2], mat, sec, { type: 'truss', id: 'col' }), beam(p[3], p[2], mat, sec, { type: 'truss', id: 'top' }),
      beam(p[0], p[2], mat, sec, { type: 'tension', id: 'd1' }), beam(p[1], p[3], mat, sec, { type: 'tension', id: 'd2' })];
    const m = buildModel(els, [support(p[0], 'pinned'), support(p[1], 'pinned'), support(p[2], 'uy'), support(p[3], 'uy')], [pointLoad(p[3], v(H, 0, 0))], 1e-9);
    const r = solveStatic(m), N = (id: string) => memberForces(m, r.cases[0], m.beams.findIndex(b => b.id === id), 0)[0];
    expect(N('d1')).toBeCloseTo(H * Math.SQRT2, 4);       // the diagonal rising in the load direction takes all the shear
    expect(Math.abs(N('d2'))).toBeLessThan(1e-3);
    expect(r.cases[0].active![m.beams.findIndex(b => b.id === 'd2')]).toBe(0);
    expect(r.cases[0].equilibrium.relError).toBeLessThan(1e-8);
    void lineLoad;
  });
});
