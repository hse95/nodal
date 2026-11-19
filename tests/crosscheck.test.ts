import { describe, it, expect } from 'vitest';
import { v, V3 } from '../src/geom/vec';
import { material, secRect, secCircle, buildModel, ElementPart, SupportPart, LoadPart } from '../src/fe/model';
import { beam, support, pointLoad, lineLoad } from '../src/fe/parts';
import { solveStatic } from '../src/fe/analysis';
import { compareWithReference } from '../src/verify/builders';
import { SymCSC, buildPattern, factorLDL, minDegreeOrder, rcmOrder, fillCount, jacobiEigen } from '../src/fe/sparse';

/** Deterministic pseudo-random numbers so failures can be reproduced from the seed. */
function rng(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

function randomFrame(seed: number) {
  const r = rng(seed), n = 5 + Math.floor(r() * 6);
  const mat = material('M', 50e9 + r() * 200e9, 0.2 + r() * 0.15, 7850, 355e6, 1.2e-5);
  const P: V3[] = Array.from({ length: n }, () => v(r() * 10, r() * 8, r() * 6));
  const els: ElementPart[] = [], used = new Set<string>();
  const add = (i: number, j: number) => {
    const key = i < j ? `${i}_${j}` : `${j}_${i}`;
    if (i === j || used.has(key)) return;
    used.add(key);
    const truss = r() < 0.2, sec = truss ? secCircle(0.03 + r() * 0.05) : secRect(0.1 + r() * 0.3, 0.1 + r() * 0.4);
    els.push(beam(P[i], P[j], mat, sec, { type: truss && els.length > n ? 'truss' : 'beam', id: `E${els.length}` }));
  };
  for (let i = 1; i < n; i++) add(i, Math.floor(r() * i));          // spanning tree of beams keeps the frame stable
  for (let k = 0; k < n; k++) add(Math.floor(r() * n), Math.floor(r() * n));
  const sups: SupportPart[] = [support(P[0], 'fixed'), support(P[1], r() < 0.5 ? 'ux uy uz' : 'uz rx')];
  const loads: LoadPart[] = [];
  for (let k = 0; k < 3; k++) loads.push(pointLoad(P[2 + Math.floor(r() * (n - 2))], v((r() - 0.5) * 1e5, (r() - 0.5) * 1e5, (r() - 0.5) * 1e5), v((r() - 0.5) * 1e4, (r() - 0.5) * 1e4, (r() - 0.5) * 1e4)));
  loads.push(lineLoad(v((r() - 0.5) * 4e3, (r() - 0.5) * 4e3, -r() * 1e4)));
  return buildModel(els, sups, loads, 1e-6);
}
/** Fully triangulated tower truss with jittered nodes: always stable. */
function randomTruss(seed: number) {
  const r = rng(seed), levels = 2 + Math.floor(r() * 3), mat = material('M', 70e9 + r() * 140e9, 0.3, 7850, 355e6, 1.2e-5);
  const P: V3[][] = [];
  for (let l = 0; l <= levels; l++) P.push([0, 1, 2].map(k => v(Math.cos(2.1 * k) * (2 + r() * 0.5), Math.sin(2.1 * k) * (2 + r() * 0.5), 3 * l + (l ? r() * 0.4 : 0))));
  const els: ElementPart[] = [];
  const bar = (a: V3, b: V3) => els.push(beam(a, b, mat, secCircle(0.02 + r() * 0.06), { type: 'truss', id: `T${els.length}` }));
  for (let l = 0; l < levels; l++) for (let k = 0; k < 3; k++) { bar(P[l][k], P[l + 1][k]); bar(P[l][k], P[l + 1][(k + 1) % 3]); bar(P[l + 1][k], P[l + 1][(k + 1) % 3]); }
  const sups = P[0].map(q => support(q, 'ux uy uz'));
  const loads = P[levels].map(q => pointLoad(q, v((r() - 0.5) * 2e5, (r() - 0.5) * 2e5, -r() * 3e5)));
  return buildModel(els, sups, loads, 1e-6);
}

describe('main solver vs independent reference solver on random models', () => {
  for (let seed = 1; seed <= 40; seed++) {
    it(`random 3D frame, seed ${seed}`, () => {
      const res = solveStatic(randomFrame(seed)), c = compareWithReference(res);
      expect(c.dispError, 'displacements').toBeLessThan(1e-7);
      expect(c.reactionError, 'reactions').toBeLessThan(1e-7);
      expect(c.axialError, 'axial forces').toBeLessThan(1e-7);
      expect(res.cases[0].equilibrium.relError, 'equilibrium').toBeLessThan(1e-8);
    });
  }
  for (let seed = 101; seed <= 115; seed++) {
    it(`random space truss, seed ${seed}`, () => {
      const res = solveStatic(randomTruss(seed)), c = compareWithReference(res);
      expect(c.dispError).toBeLessThan(1e-8); expect(c.axialError).toBeLessThan(1e-8);
      expect(res.cases[0].equilibrium.relError).toBeLessThan(1e-9);
    });
  }
});

describe('sparse solver', () => {
  it('LDL^T solves a random sparse SPD system to machine precision', () => {
    const r = rng(7), n = 200, els: Int32Array[] = [];
    for (let e = 0; e < 400; e++) els.push(Int32Array.from([Math.floor(r() * n), Math.floor(r() * n), Math.floor(r() * n)]));
    const A = buildPattern(n, els);
    for (const eq of els) for (let a = 0; a < 3; a++) for (let b = a; b < 3; b++) { if (eq[a] === eq[b] && a !== b) continue; A.add(eq[a], eq[b], a === b ? 4 + r() : -r()); }
    for (let i = 0; i < n; i++) A.add(i, i, 5);
    const x0 = Float64Array.from({ length: n }, () => r() - 0.5), b = A.mul(x0);
    const f = factorLDL(A);
    expect(f.zeroPivots.length).toBe(0); expect(f.negativePivots).toBe(0);
    const x = f.solve(b);
    let err = 0; for (let i = 0; i < n; i++) err = Math.max(err, Math.abs(x[i] - x0[i]));
    expect(err).toBeLessThan(1e-10);
  });
  it('reports singular matrices and counts negative pivots', () => {
    const A = buildPattern(3, [Int32Array.from([0, 1]), Int32Array.from([1, 2])]);
    A.add(0, 0, 1); A.add(0, 1, -1); A.add(1, 1, 2); A.add(1, 2, -1); A.add(2, 2, 1);      // free-free chain: singular
    expect(factorLDL(A).zeroPivots.length).toBe(1);
    const B = new SymCSC(2, Int32Array.from([0, 1, 3]), Int32Array.from([0, 0, 1]), Float64Array.from([1, 2, 1]));   // eigenvalues 3 and -1
    expect(factorLDL(B).negativePivots).toBe(1);
  });
  it('orderings are permutations and minimum degree reduces fill on a grid', () => {
    const k = 20, n = k * k, adj: number[][] = Array.from({ length: n }, () => []);
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) { const a = i * k + j; if (j + 1 < k) { adj[a].push(a + 1); adj[a + 1].push(a); } if (i + 1 < k) { adj[a].push(a + k); adj[a + k].push(a); } }
    const natural = Int32Array.from({ length: n }, (_, i) => i), md = minDegreeOrder(n, adj), rcm = rcmOrder(n, adj);
    for (const p of [md, rcm]) expect(new Set(p).size).toBe(n);
    expect(fillCount(n, adj, md)).toBeLessThan(fillCount(n, adj, natural));
    expect(fillCount(n, adj, rcm)).toBeLessThanOrEqual(fillCount(n, adj, natural) * 1.2);
  });
  it('Jacobi eigen-solver reproduces a known spectrum', () => {
    const e = jacobiEigen([[2, -1, 0], [-1, 2, -1], [0, -1, 2]]);
    expect(e.values[0]).toBeCloseTo(2 - Math.SQRT2, 12); expect(e.values[2]).toBeCloseTo(2 + Math.SQRT2, 12);
  });
});
