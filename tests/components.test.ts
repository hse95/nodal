import { describe, it, expect } from 'vitest';
import '../src/components';
import { registry, Engine, makeNode, emptyProject } from '../src/core/graph';
import type { ProjectFile } from '../src/core/types';
import { meshBoolean } from '../src/components/geometry';
import { meshBox, meshVolume } from '../src/geom/mesh';
import { WORLD_XY, v } from '../src/geom/vec';
import * as cv from '../src/geom/curve';
import { revolve, srfPoint, loft, isoCurve } from '../src/geom/surface';
import { optimise } from '../src/core/optimize';
import { buildNet, forceDensity, dynamicRelaxation } from '../src/geom/formfind';

function graph(build: (add: (type: string, init?: any) => string, wire: (a: string, out: number, b: string, inp: number) => void, p: ProjectFile) => void): ProjectFile {
  const p = emptyProject();
  const add = (type: string, init: any = {}) => { const n = makeNode(type, 0, 0, init); if (init.state) n.state = { ...registry.get(type)!.state, ...init.state }; p.graph.nodes.push(n); return n.id; };
  build(add, (a, out, b, inp) => p.graph.wires.push({ id: `w${p.graph.wires.length}`, from: a, out, to: b, inp }), p);
  return p;
}

describe('component library', () => {
  it('every component has complete help metadata and unique ids', () => {
    const all = registry.all();
    expect(all.length).toBeGreaterThan(200);
    for (const d of all) {
      expect(d.name.length, d.id).toBeGreaterThan(0); expect(d.desc.length, d.id).toBeGreaterThan(10); expect(d.category.length, d.id).toBeGreaterThan(0);
      for (const p of [...d.inputs, ...d.outputs]) { expect(p.desc.length, `${d.id}.${p.name}`).toBeGreaterThan(0); expect(p.nick.length, `${d.id}.${p.name}`).toBeGreaterThan(0); }
      expect(!!d.solve || !!d.solveTrees || d.widget === 'note', d.id).toBe(true);
    }
  });
  it('solves a parametric truss from sliders to reactions', async () => {
    let react = '', stat = '', util = '';
    const p = graph((add, wire) => {
      const span = add('param.slider', { state: { value: 6, min: 2, max: 12 } }), h = add('param.slider', { state: { value: 4 } });
      const half = add('math.div', { consts: { B: 2 } }), A = add('vec.point'), B = add('vec.point'), Cn = add('vec.point');
      wire(span, 0, half, 0); wire(span, 0, B, 0); wire(half, 0, Cn, 0); wire(h, 0, Cn, 2);
      const l1 = add('crv.line'), l2 = add('crv.line'), l3 = add('crv.line');
      wire(A, 0, l1, 0); wire(Cn, 0, l1, 1); wire(Cn, 0, l2, 0); wire(B, 0, l2, 1); wire(A, 0, l3, 0); wire(B, 0, l3, 1);
      const sec = add('fe.sec.tube'), truss = add('fe.truss');
      for (const l of [l1, l2, l3]) wire(l, 0, truss, 0);
      wire(sec, 0, truss, 1);
      const sA = add('fe.support', { consts: { Conditions: 'ux uy uz' } }), sB = add('fe.support', { consts: { Conditions: 'uy uz' } }), sC = add('fe.support', { consts: { Conditions: 'uy' } });
      wire(A, 0, sA, 0); wire(B, 0, sB, 0); wire(Cn, 0, sC, 0);
      const load = add('fe.load.point', { consts: { Force: '0, 0, -100' } }); wire(Cn, 0, load, 0);
      const model = add('fe.assemble'); wire(truss, 0, model, 0); for (const s of [sA, sB, sC]) wire(s, 0, model, 1); wire(load, 0, model, 2);
      stat = add('fe.static'); wire(model, 0, stat, 0);
      react = add('fe.res.react'); wire(stat, 0, react, 0);
      util = add('fe.res.axial'); wire(stat, 0, util, 0);
    });
    const e = new Engine();
    await e.run(p);
    for (const n of p.graph.nodes) expect(e.status(n.id).state, `${n.type}: ${e.status(n.id).messages.join('; ')}`).toBe('ok');
    const forces = e.outputs(react)[1].allItems() as any[];
    expect(forces[0].z).toBeCloseTo(50, 8); expect(forces[1].z).toBeCloseTo(50, 8);          // kN
    const N = e.outputs(util)[0].allItems() as number[];
    expect(N[0]).toBeCloseTo(-62.5, 8); expect(N[2]).toBeCloseTo(37.5, 8);                   // -P/(2 sin a), P L/(4 h)
    // Changing a slider recomputes the answer.
    p.graph.nodes[1].state.value = 3;
    await e.run(p);
    expect((e.outputs(util)[0].allItems() as number[])[2]).toBeCloseTo(50, 8);
  });
  it('US units give the same physics', async () => {
    let dsp = '';
    const p = graph((add, wire, proj) => {
      proj.units = 'US';
      const ln = add('crv.line', { consts: { A: '0,0,0', B: '10,0,0' } }), sec = add('fe.sec.rect', { consts: { Width: 4, Depth: 8 } }), bm = add('fe.beam');
      const mat = add('fe.material.custom', { consts: { E: 29000, Density: 490, Strength: 50 } });
      wire(ln, 0, bm, 0); wire(sec, 0, bm, 1); wire(mat, 0, bm, 2);
      const sup = add('fe.support', { consts: { Point: '0,0,0' } }), load = add('fe.load.point', { consts: { Point: '10,0,0', Force: '0,0,-2' } });
      const model = add('fe.assemble'); wire(bm, 0, model, 0); wire(sup, 0, model, 1); wire(load, 0, model, 2);
      const st = add('fe.static'); wire(model, 0, st, 0);
      dsp = add('fe.res.at', { consts: { Point: '10,0,0' } }); wire(st, 0, dsp, 0);
    });
    const e = new Engine();
    await e.run(p);
    expect(e.status(dsp).messages).toEqual([]);
    // PL^3/3EI with P = 2 kip, L = 120 in, E = 29000 ksi, I = 4*8^3/12 in^4 -> inches
    expect(-(e.outputs(dsp)[0].first() as any).z).toBeCloseTo(2 * 120 ** 3 / (3 * 29000 * (4 * 8 ** 3 / 12)), 9);
  });
  it('reports a mechanism in plain language', async () => {
    let st = '';
    const p = graph((add, wire) => {
      const ln = add('crv.line', { consts: { A: '0,0,0', B: '4,0,0' } }), sec = add('fe.sec.tube'), tr = add('fe.truss'); wire(ln, 0, tr, 0); wire(sec, 0, tr, 1);
      const sup = add('fe.support', { consts: { Point: '0,0,0', Conditions: 'pinned' } }), load = add('fe.load.point', { consts: { Point: '4,0,0', Force: '5,0,0' } });
      const model = add('fe.assemble'); wire(tr, 0, model, 0); wire(sup, 0, model, 1); wire(load, 0, model, 2);
      st = add('fe.static'); wire(model, 0, st, 0);
    });
    const e = new Engine();
    await e.run(p);
    expect(e.status(st).state).toBe('ok');           // axial load on a bar restrained at one end is fine
    p.graph.nodes.find(n => n.type === 'fe.load.point')!.consts.Force = '0,0,-5';
    await e.run(p);
    expect(e.status(st).state).toBe('error'); expect(e.status(st).messages[0]).toMatch(/no element provides stiffness|not stable/);
  });
});

describe('geometry kernel', () => {
  it('NURBS circle, arc length and sub-curves are exact', () => {
    const c = cv.circle(WORLD_XY, 2), n = cv.arcToNurbs(c);
    for (const t of [0, 0.13, 0.5, 0.77, 1]) expect(Math.hypot(cv.nurbsPoint(n, t).x, cv.nurbsPoint(n, t).y)).toBeCloseTo(2, 12);
    expect(cv.curveLength(n)).toBeCloseTo(4 * Math.PI, 6);
    const sub = cv.subCurve(n, 0.2, 0.6), ang = (p: any) => (Math.atan2(p.y, p.x) + 2 * Math.PI) % (2 * Math.PI);
    // The rational parameter is not proportional to arc length, so compare with the arc between the two end points.
    expect(cv.curveLength(sub)).toBeCloseTo(2 * (ang(cv.curveEnd(sub)) - ang(cv.curveStart(sub))), 6);
    expect(cv.curveStart(sub).x).toBeCloseTo(cv.curvePoint(n, 0.2).x, 10); expect(cv.curveEnd(sub).y).toBeCloseTo(cv.curvePoint(n, 0.6).y, 10);
  });
  it('interpolation passes through its points; division is by arc length', () => {
    const pts = [v(0, 0, 0), v(1, 2, 0), v(3, 2, 1), v(4, 0, 0), v(6, 1, 2)], c = cv.interpolateCurve(pts) as cv.Nurbs;
    for (const p of pts) expect(cv.curveClosestPoint(c, p).dist).toBeLessThan(1e-6);
    const ts = cv.divideByCount(c, 8), q = ts.map(t => cv.curvePoint(c, t)), L = cv.curveLength(c);
    for (let i = 1; i < q.length; i++) expect(cv.curveLength(cv.subCurve(c, ts[i - 1], ts[i]))).toBeCloseTo(L / 8, 3);
  });
  it('fillet, offset, join and intersection behave on simple cases', () => {
    const sq = cv.polyline([v(0, 0, 0), v(4, 0, 0), v(4, 4, 0), v(0, 4, 0)], true);
    expect(cv.curveLength(cv.filletPolyline(sq, 1))).toBeCloseTo(16 - 8 + 2 * Math.PI, 9);
    expect(cv.curveLength(cv.offsetCurve(sq, 1))).toBeCloseTo(24, 9);      // positive = right of travel = outward for a counter-clockwise square
    const j = cv.joinCurves([cv.line(v(2, 0, 0), v(1, 0, 0)), cv.line(v(0, 0, 0), v(1, 0, 0)), cv.line(v(2, 0, 0), v(2, 3, 0))]);
    expect(j.length).toBe(1); expect(cv.curveLength(j[0])).toBeCloseTo(5, 12);
    const x = cv.curveCurveIntersect(cv.line(v(0, 0, 0), v(2, 2, 0)), cv.circle(WORLD_XY, 1));
    expect(x.length).toBe(1); expect(x[0].point.x).toBeCloseTo(Math.SQRT1_2, 3);
  });
  it('revolve is an exact sphere; loft interpolates its sections; isocurves lie on the surface', () => {
    const arc: cv.Arc = { k: 'arc', plane: { k: 'plane', o: v(), x: v(1, 0, 0), y: v(0, 0, 1), z: v(0, -1, 0) }, r: 3, a0: 0, a1: Math.PI / 2 };
    const s = revolve(arc, v(), v(0, 0, 1));
    for (const [a, b] of [[0.1, 0.2], [0.5, 0.5], [0.9, 0.83]]) { const p = srfPoint(s, a, b); expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(3, 10); }
    const l = loft([cv.line(v(0, 0, 0), v(4, 0, 0)), cv.line(v(0, 2, 1), v(4, 2, 1)), cv.line(v(0, 4, 0), v(4, 4, 0))], 4);
    expect(srfPoint(l, 0.5, 0.5).z).toBeCloseTo(1, 9);
    const iso = isoCurve(s, 'v', 0.3);
    expect(cv.curvePoint(iso, 0.4).x).toBeCloseTo(srfPoint(s, 0.4, 0.3).x, 10);
  });
  it('mesh booleans through Manifold give the right volumes', async () => {
    const a = meshBox(WORLD_XY, 2, 2, 2), b = meshBox({ ...WORLD_XY, o: v(1, 1, 1) }, 2, 2, 2);
    expect(Math.abs(meshVolume(await meshBoolean(a, b, 'union')))).toBeCloseTo(15, 5);
    expect(Math.abs(meshVolume(await meshBoolean(a, b, 'difference')))).toBeCloseTo(7, 5);
    expect(Math.abs(meshVolume(await meshBoolean(a, b, 'intersection')))).toBeCloseTo(1, 5);
  });
});

describe('form-finding and optimisation', () => {
  const grid = (n: number) => { const ls: any[] = [], an: any[] = []; for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) { if (i < n) ls.push({ a: v(i, j, 0), b: v(i + 1, j, 0) }); if (j < n) ls.push({ a: v(i, j, 0), b: v(i, j + 1, 0) }); if (i === 0 || j === 0 || i === n || j === n) an.push(v(i, j, 0)); } return { ls, an }; };
  it('force density reproduces the discrete membrane solution and dynamic relaxation agrees with it', () => {
    const { ls, an } = grid(4), net = buildNet(ls, an), loads = net.pts.map((_, i) => (net.fixed[i] ? v() : v(0, 0, -1)));
    const pts = forceDensity(net, net.edges.map(() => 1), loads);
    // Out-of-balance check: sum q (x_j - x_i) + p = 0 at every free node.
    net.pts.forEach((_, i) => { if (net.fixed[i]) return; let r = -1; net.edges.forEach(([a, b]) => { if (a === i) r += pts[b].z - pts[a].z; if (b === i) r += pts[a].z - pts[b].z; }); expect(Math.abs(r)).toBeLessThan(1e-10); });
    const centre = pts.reduce((m, p) => Math.min(m, p.z), 0);
    expect(centre).toBeLessThan(-0.5);
    // A stiff, strongly pretensioned net under a small load sags by about (load / force density) times the same shape.
    const dr = dynamicRelaxation(net, { stiffness: net.edges.map(() => 1e4), rest: net.edges.map(() => 0.5), loads: loads.map(l => v(0, 0, l.z * 10)), tol: 1e-9 });
    expect(dr.converged).toBe(true);
    const T = dr.forces[0], sag = dr.pts.reduce((m, p) => Math.min(m, p.z), 0);
    expect(sag / (centre * 10 / T)).toBeGreaterThan(0.97); expect(sag / (centre * 10 / T)).toBeLessThan(1.03);
  });
  it('the evolutionary optimiser finds the minimum of a smooth function', async () => {
    const r = await optimise([{ min: -5, max: 5 }, { min: -5, max: 5 }, { min: 0, max: 10, integer: true }], async ([x, y, k]) => (x - 1.5) ** 2 + (y + 2) ** 2 + (k - 7) ** 2, { population: 24, generations: 25, localSearch: true, seed: 3 });
    expect(r.best.f).toBeLessThan(1e-3); expect(r.best.x[2]).toBe(7);
    expect(r.history[r.history.length - 1]).toBeLessThanOrEqual(r.history[0]);
  });
});
