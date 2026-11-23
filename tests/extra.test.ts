import { describe, it, expect } from 'vitest';
import '../src/components';
import { Engine, emptyProject, makeNode, registry } from '../src/core/graph';
import { DataTree } from '../src/core/tree';
import type { ProjectFile } from '../src/core/types';
import { catmullClark, pipeMesh, sunPosition, treeMask, tween, deform, rng } from '../src/components/extra';
import * as cv from '../src/geom/curve';
import * as ms from '../src/geom/mesh';
import * as sf from '../src/geom/surface';
import { v, len, sub } from '../src/geom/vec';

/** Run one component with constant inputs (lists as arrays) and return its output trees. */
async function run(type: string, inputs: Record<string, any> = {}): Promise<DataTree[]> {
  const def = registry.get(type)!; expect(def, type).toBeTruthy();
  const p: ProjectFile = emptyProject(), n = makeNode(type, 0, 0); p.graph.nodes.push(n);
  def.inputs.forEach((port, i) => { if (!(port.name in inputs)) return; const val = inputs[port.name], src = makeNode('test.const', -200, i * 40); src.state = { value: val }; p.graph.nodes.push(src); p.graph.wires.push({ id: 'w' + i, from: src.id, out: 0, to: n.id, inp: i }); });
  const e = new Engine(); await e.run(p);
  const st = e.status(n.id); if (st.state === 'error') throw new Error(st.messages.join(' | '));
  return e.outputs(n.id);
}
registry.add({ id: 'test.const', name: 'Const', nick: 'C', category: 'Params', desc: '', inputs: [], outputs: [{ name: 'V', nick: 'V', type: 'any', access: 'tree', desc: '' }], solveTrees: (_i, ctx) => { const x = ctx.node.state.value; return [x instanceof DataTree ? x : Array.isArray(x) ? DataTree.fromList(x) : DataTree.of(x)]; } });
const items = (t: DataTree): any[] => t.allItems() as any[];
const tree = (b: Record<string, any[]>) => { const t = new DataTree<any>(); for (const [k, list] of Object.entries(b)) t.add(k.split(';').map(Number), list); return t; };

describe('list components', () => {
  it('Split List, Cull Nth, Delete Consecutive, Repeat Data', async () => {
    const [a, b] = await run('list.split', { List: [1, 2, 3, 4, 5], Index: 2 }); expect(items(a)).toEqual([1, 2]); expect(items(b)).toEqual([3, 4, 5]);
    expect(items((await run('list.split', { List: [1, 2, 3], Index: -1 }))[0])).toEqual([1, 2]);
    expect(items((await run('list.cullnth', { List: [1, 2, 3, 4, 5, 6, 7], N: 3 }))[0])).toEqual([1, 2, 4, 5, 7]);
    const d = await run('list.dedupe', { List: [1, 1, 2, 2, 2, 3, 1, 1], Wrap: true }); expect(items(d[0])).toEqual([1, 2, 3]); expect(items(d[1])).toEqual([5]);
    expect(items((await run('list.dedupe', { List: [1, 1, 2, 1] }))[0])).toEqual([1, 2, 1]);
    expect(items((await run('list.repeat', { Data: ['a', 'b'], Length: 5 }))[0])).toEqual(['a', 'b', 'a', 'b', 'a']);
  });
  it('Jitter, Insert, Replace, Create Set', async () => {
    const list = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(items((await run('list.jitter', { List: list, Jitter: 0 }))[0])).toEqual(list);
    const j1 = items((await run('list.jitter', { List: list, Jitter: 1, Seed: 7 }))[0]), j2 = items((await run('list.jitter', { List: list, Jitter: 1, Seed: 7 }))[0]);
    expect(j1).toEqual(j2); expect([...j1].sort((a, b) => a - b)).toEqual(list); expect(j1).not.toEqual(list);
    expect(items((await run('list.insert', { List: [1, 2, 3], Items: ['a', 'b'], Indices: [0, 2] }))[0])).toEqual(['a', 1, 2, 'b', 3]);
    expect(items((await run('list.replace', { List: [1, 2, 3, 4], Items: ['x', 'y'], Indices: [1, -1] }))[0])).toEqual([1, 'x', 3, 'y']);
    const s = await run('list.set', { List: ['a', 'b', 'a', 'c', 'b'] }); expect(items(s[0])).toEqual(['a', 'b', 'c']); expect(items(s[1])).toEqual([0, 1, 0, 2, 1]);
    const r = rng(3); expect(r()).not.toBe(r());
  });
});

describe('tree components', () => {
  it('Entwine, Clean Tree, Tree Item', async () => {
    const e = (await run('tree.entwine', { A: [1, 2], C: ['x'] }))[0]; expect(e.branches.map(b => [b.path, b.items])).toEqual([[[0], [1, 2]], [[1], ['x']]]);
    const c = (await run('tree.clean', { Tree: tree({ '0': [1, NaN, 2], '1': [NaN] }) }))[0]; expect(c.branches.map(b => b.items)).toEqual([[1, 2]]);
    expect(items((await run('tree.item', { Tree: tree({ '0;0': [1, 2], '0;1': [3, 4] }), Path: '{0;1}', Index: -1 }))[0])).toEqual([4]);
    await expect(run('tree.item', { Tree: tree({ '0': [1] }), Path: '{5}' })).rejects.toThrow(/no branch/);
  });
  it('tree masks: numbers, ?, *, !, sets, ranges and sequences', () => {
    const m = (s: string, p: number[], i = 0) => treeMask(s)(p, i);
    expect(m('{0;1}', [0, 1])).toBe(true); expect(m('{0;1}', [0, 2])).toBe(false); expect(m('{0;?}', [0, 7])).toBe(true); expect(m('{0;?}', [0])).toBe(false);
    expect(m('{*}', [3, 4, 5])).toBe(true); expect(m('{0;*}', [0])).toBe(true); expect(m('{0;*}', [1, 2])).toBe(false); expect(m('{*;2}', [0, 1, 2])).toBe(true);
    expect(m('{!0}', [1])).toBe(true); expect(m('{!0}', [0])).toBe(false); expect(m('{(1,3)}', [3])).toBe(true); expect(m('{(1,3)}', [2])).toBe(false); expect(m('{!(1,3)}', [2])).toBe(true);
    expect(m('{(2 to 4)}', [4])).toBe(true); expect(m('{(2 to 4)}', [5])).toBe(false); expect(m('{*}[(0,2,...)]', [0], 4)).toBe(true); expect(m('{*}[(0,2,...)]', [0], 3)).toBe(false); expect(m('{*}[(0,2,...,4)]', [0], 6)).toBe(false);
    expect(m('{*}[!0]', [9], 0)).toBe(false); expect(m('{*}[!0]', [9], 2)).toBe(true);
    expect(() => treeMask('0;1')).toThrow(); expect(() => treeMask('{a}')).toThrow();
  });
  it('Split Tree and Relative Item', async () => {
    const t = tree({ '0': [10, 11, 12], '1': [20, 21, 22] });
    const [pos, neg] = await run('tree.split', { Tree: t, Mask: '{*}[0]' }); expect(pos.branches.map(b => b.items)).toEqual([[10], [20]]); expect(neg.branches.map(b => b.items)).toEqual([[11, 12], [21, 22]]);
    const [p2] = await run('tree.split', { Tree: t, Mask: '{1}' }); expect(items(p2)).toEqual([20, 21, 22]);
    const [a, b] = await run('tree.relative', { Tree: t, Offset: '{0}[+1]' }); expect(a.branches.map(x => x.items)).toEqual([[10, 11], [20, 21]]); expect(b.branches.map(x => x.items)).toEqual([[11, 12], [21, 22]]);
    const [c, d] = await run('tree.relative', { Tree: t, Offset: '{+1}[0]' }); expect(items(c)).toEqual([10, 11, 12]); expect(items(d)).toEqual([20, 21, 22]);
  });
});

describe('curves, panels and generators', () => {
  it('Tween Curve lies between its two curves and keeps lines as lines', async () => {
    const a = cv.line(v(0, 0, 0), v(10, 0, 0)), b = cv.line(v(0, 4, 0), v(10, 4, 2)), t = tween(a, b, 0.25);
    expect(t.k).toBe('line'); expect(cv.curvePoint(t, 1)).toEqual(v(10, 1, 0.5));
    const arc = cv.interpolateCurve([v(0, 0, 0), v(5, 0, 3), v(10, 0, 0)]), mid = tween(a, arc, 0.5); expect(cv.curvePoint(mid, 0.5).z).toBeCloseTo(cv.curvePoint(arc, 0.5).z / 2, 1);
    expect(items((await run('crv.tweens', { A: a, B: b, Count: 3 }))[0]).length).toBe(3); expect(items((await run('crv.tweens', { A: a, B: b, Count: 3, Ends: true }))[0]).length).toBe(5);
  });
  it('Pipe is a closed tube of the right size', () => {
    const p = pipeMesh(cv.line(v(0, 0, 0), v(0, 0, 5)), 0.5, 24);
    expect(ms.nakedEdges(p).length).toBe(0); expect(ms.meshVolume(p)).toBeCloseTo(Math.PI * 0.25 * 5, 0); expect(ms.meshVolume(p)).toBeGreaterThan(0.97 * Math.PI * 0.25 * 5);
    for (const q of ms.meshVertices(p).slice(0, 48)) expect(Math.hypot(q.x, q.y)).toBeCloseTo(0.5, 9);
    expect(() => pipeMesh(cv.line(v(0, 0, 0), v(1, 0, 0)), 0)).toThrow();
  });
  const flat = sf.planeSurface({ o: v(0, 0, 0), x: v(1, 0, 0), y: v(0, 1, 0), z: v(0, 0, 1) } as any, 8, 6);
  it('panels cover the whole surface', async () => {
    const A = ms.meshArea(sf.surfaceToMesh(flat, 2, 2));
    for (const [type, count] of [['srf.panel.quad', 4 * 3], ['srf.panel.tri', 24], ['srf.panel.diamond', 4 * 3 + 5 * 4], ['srf.panel.stagger', 4 * 2 + 5]] as const) {
      const [panels, mesh] = await run(type, { Surface: flat, U: 4, V: 3 });
      expect(items(panels).length, type).toBe(count); expect(ms.meshArea(mesh.first() as ms.Mesh), type).toBeCloseTo(A, 6);
      for (const pl of items(panels)) expect(cv.curveClosed(pl), type).toBe(true);
    }
  });
  it('Diagrid and Space Truss give the expected numbers of members', async () => {
    const [a, b, e] = await run('srf.diagrid', { Surface: flat, U: 4, V: 2 }); expect(items(a).length + items(b).length).toBe(8); expect(items(e).length).toBe(8);
    const [top, bot, web, tn, bn] = await run('srf.spacetruss', { Surface: flat, U: 3, V: 2, Depth: 1.5 });
    expect(items(top).length).toBe(3 * 3 + 4 * 2); expect(items(bot).length).toBe(2 * 2 + 3 * 1); expect(items(web).length).toBe(4 * 6); expect(items(tn).length).toBe(12); expect(items(bn).length).toBe(6);
    for (const p of items(bn)) expect(Math.abs(p.z)).toBeCloseTo(1.5, 9);
  });
  it('Truss Generator: Pratt, Howe and Warren, statically determinate member counts', async () => {
    for (const type of [0, 1]) { const [t, b, vs, d, bn, tn] = await run('fe.gen.truss', { Panels: 6, Type: type, Depth: 2 }); const m = items(t).length + items(b).length + items(vs).length + items(d).length, j = items(bn).length + items(tn).length; expect([items(t).length, items(b).length, items(vs).length, items(d).length]).toEqual([6, 6, 7, 6]); expect(m).toBe(2 * j - 3); }
    const pratt = items((await run('fe.gen.truss', { Panels: 6, Type: 0 }))[3]), howe = items((await run('fe.gen.truss', { Panels: 6, Type: 1 }))[3]);
    expect(pratt[0].a.z).toBeGreaterThan(pratt[0].b.z); expect(howe[0].a.z).toBeLessThan(howe[0].b.z);            // first diagonal falls (Pratt) or rises (Howe) toward midspan
    for (const [type, counts] of [[2, [5, 6, 0, 12]], [3, [2, 6, 3, 6]]] as const) { const [t, b, vs, d, bn, tn] = await run('fe.gen.truss', { Panels: 6, Type: type }); expect([items(t).length, items(b).length, items(vs).length, items(d).length], 'type ' + type).toEqual(counts); expect(items(t).length + items(b).length + items(vs).length + items(d).length).toBe(2 * (items(bn).length + items(tn).length) - 3); }
    const peaked = items((await run('fe.gen.truss', { Panels: 4, Type: 0, Depth: 1, 'Mid Depth': 3 }))[5]); expect(peaked.map((p: any) => p.z)).toEqual([1, 2, 3, 2, 1]);
    await expect(run('fe.gen.truss', { Depth: 0 })).rejects.toThrow();
  });
  it('Frame Grid counts columns and beams', async () => {
    const [c, bx, by, bases, floors] = await run('fe.gen.frame', { 'Bays X': 3, 'Bays Y': 2, Stories: 4 });
    expect(items(c).length).toBe(4 * 3 * 4); expect(items(bx).length).toBe(3 * 3 * 4); expect(items(by).length).toBe(4 * 2 * 4); expect(items(bases).length).toBe(12); expect(floors.branchCount).toBe(4);
    const plane = await run('fe.gen.frame', { 'Bays X': 2, 'Bays Y': 0, Stories: 2 }); expect(items(plane[2]).length).toBe(0); expect(items(plane[0]).length).toBe(6);
  });
});

describe('meshes and deformations', () => {
  it('Catmull-Clark: a cube becomes rounder, stays closed, and each face becomes four', () => {
    const box = ms.meshBox({ o: v(-1, -1, -1), x: v(1, 0, 0), y: v(0, 1, 0), z: v(0, 0, 1) } as any, 2, 2, 2), s1 = catmullClark(box), s3 = catmullClark(catmullClark(s1));
    expect(s1.f.length).toBe(24); expect(s1.f.every(f => f.length === 4)).toBe(true); expect(ms.nakedEdges(s1).length).toBe(0); expect(s3.f.length).toBe(6 * 64);
    // The corners of a cube move to 5/9 of their distance from the center after one step (the standard limit rule).
    const corner = ms.meshVertices(s1).filter(p => Math.min(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)) > 0.5); expect(corner.length).toBe(8); for (const p of corner) expect(len(p)).toBeCloseTo(Math.sqrt(3) * 5 / 9, 9);
    expect(ms.meshVolume(s1)).toBeLessThan(8); expect(ms.meshVolume(s3)).toBeLessThan(ms.meshVolume(s1)); expect(ms.meshVolume(s3)).toBeGreaterThan(2.2);
  });
  it('Catmull-Clark keeps the edge of an open mesh on the edge', () => {
    const plane = ms.meshFromPointsFaces([v(0, 0, 0), v(1, 0, 0), v(2, 0, 0), v(0, 1, 0), v(1, 1, 0), v(2, 1, 0)], [[0, 1, 4, 3], [1, 2, 5, 4]]), s = catmullClark(plane);
    expect(s.f.length).toBe(8); for (const p of ms.meshVertices(s)) { expect(p.z).toBe(0); expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(2); expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(1); }
    expect(ms.meshArea(s)).toBeLessThanOrEqual(2 + 1e-9);
  });
  it('Subdivide, Smooth and Weld components', async () => {
    const box = ms.meshBox({ o: v(0, 0, 0), x: v(1, 0, 0), y: v(0, 1, 0), z: v(0, 0, 1) } as any, 2, 2, 2);
    expect(((await run('mesh.subdivide', { Mesh: box, Levels: 2 }))[0].first() as ms.Mesh).f.length).toBe(96);
    const bumpy = ms.meshFromPointsFaces([v(0, 0, 0), v(1, 0, 0), v(2, 0, 0), v(0, 1, 0), v(1, 1, 5), v(2, 1, 0), v(0, 2, 0), v(1, 2, 0), v(2, 2, 0)], [[0, 1, 4, 3], [1, 2, 5, 4], [3, 4, 7, 6], [4, 5, 8, 7]]);
    const sm = (await run('mesh.smooth', { Mesh: bumpy, Strength: 1, Steps: 1 }))[0].first() as ms.Mesh; expect(ms.mv(sm, 4).z).toBe(0); expect(ms.mv(sm, 0)).toEqual(v(0, 0, 0));
    const two = ms.joinMeshes([ms.meshFromPointsFaces([v(0, 0, 0), v(1, 0, 0), v(1, 1, 0)], [[0, 1, 2]]), ms.meshFromPointsFaces([v(1, 0, 0), v(2, 0, 0), v(1, 1, 0)], [[0, 1, 2]])]);
    expect(items((await run('mesh.weld', { Mesh: two }))[1])).toEqual([4]);
  });
  it('Twist, Taper and Bend move points as their definitions say', async () => {
    const top = v(1, 0, 10), tw = (await run('xform.twist', { Geometry: top, Angle: 90 }))[0].first() as any; expect(tw.x).toBeCloseTo(0, 9); expect(tw.y).toBeCloseTo(1, 9); expect(tw.z).toBeCloseTo(10, 9);
    const half = (await run('xform.twist', { Geometry: v(1, 0, 5), Angle: 90 }))[0].first() as any; expect(Math.atan2(half.y, half.x)).toBeCloseTo(Math.PI / 4, 9);
    const tp = (await run('xform.taper', { Geometry: v(2, 0, 10), 'End Factor': 0.5 }))[0].first(); expect(tp).toEqual(v(1, 0, 10));
    const bent = (await run('xform.bend', { Geometry: v(10, 0, 0), Angle: 90 }))[0].first() as any, R = 10 / (Math.PI / 2); expect(bent.x).toBeCloseTo(R, 9); expect(bent.z).toBeCloseTo(R, 9);
    const line = deform(cv.line(v(0, 0, 0), v(10, 0, 0)), p => v(p.x, 0, 0.1 * p.x * (10 - p.x))); expect(cv.curvePoint(line, 0.5).z).toBeCloseTo(2.5, 2); expect(cv.curveLength(line)).toBeGreaterThan(10);
    const m = deform(ms.meshBox({ o: v(0, 0, 0), x: v(1, 0, 0), y: v(0, 1, 0), z: v(0, 0, 1) } as any, 1, 1, 1), p => v(p.x * 2, p.y, p.z)); expect(ms.meshVolume(m)).toBeCloseTo(2, 9);
  });
});

describe('sun position (checked against the NOAA solar calculator and simple astronomy)', () => {
  it('equinox noon on the equator is overhead; solstice noon altitude is 90 - latitude ± 23.44', () => {
    const eq = sunPosition(0, 0, 2026, 3, 20, 12 + 7.4 / 60, 0); expect(eq.altitude).toBeGreaterThan(89.5);
    // Local solar noon: clock noon corrected for the equation of time (about -1.8 min on June 21, +1.8 min on Dec 21, and longitude 0).
    const jun = Math.max(...[11.9, 11.95, 12, 12.05, 12.1].map(h => sunPosition(40, 0, 2026, 6, 21, h, 0).altitude)), dec = Math.max(...[11.9, 11.95, 12, 12.05].map(h => sunPosition(40, 0, 2026, 12, 21, h, 0).altitude));
    expect(jun).toBeCloseTo(90 - 40 + 23.44, 1); expect(dec).toBeCloseTo(90 - 40 - 23.44, 1);
    expect(sunPosition(40, 0, 2026, 6, 21, 12, 0).declination).toBeCloseTo(23.44, 1);
  });
  it('the sun is in the east in the morning and the west in the afternoon, and south at noon in the north', () => {
    const am = sunPosition(39.19, -96.58, 2026, 6, 21, 9, -6), noon = sunPosition(39.19, -96.58, 2026, 6, 21, 12.45, -6), pm = sunPosition(39.19, -96.58, 2026, 6, 21, 16, -6);
    expect(am.azimuth).toBeGreaterThan(60); expect(am.azimuth).toBeLessThan(120); expect(am.dir.x).toBeGreaterThan(0); expect(pm.azimuth).toBeGreaterThan(240); expect(pm.dir.x).toBeLessThan(0);
    expect(Math.abs(noon.azimuth - 180)).toBeLessThan(3); expect(noon.altitude).toBeCloseTo(90 - 39.19 + 23.44, 0); expect(len(noon.dir)).toBeCloseTo(1, 12);
    expect(sunPosition(39.19, -96.58, 2026, 6, 21, 0.5, -6).altitude).toBeLessThan(0);
  });
  it('Sun Path gives about 15 hours of daylight in Kansas in June and 9.3 in December; Shadow flattens geometry onto the ground', async () => {
    const jun = await run('env.sunpath', {}), dec = await run('env.sunpath', { Month: 12 });
    expect(items(jun[3])[0]).toBeGreaterThan(14.5); expect(items(jun[3])[0]).toBeLessThan(15.2); expect(items(dec[3])[0]).toBeGreaterThan(9.1); expect(items(dec[3])[0]).toBeLessThan(9.7);
    expect(items(jun[1]).length).toBeGreaterThan(13); for (const p of items(jun[1])) expect(len(p)).toBeCloseTo(20, 6);
    const sh = (await run('env.shadow', { Geometry: v(0, 0, 10), Sun: v(1, 0, 1) }))[0].first(); expect(sh).toEqual(v(-10, 0, 0));
    await expect(run('env.shadow', { Geometry: v(0, 0, 1), Sun: v(1, 0, -0.2) })).rejects.toThrow(/horizon/);
    const s = (await run('env.sun', { Hour: 12.45 })); expect(items(s[3])[0]).toBe(true); expect(len(sub(items(s[0])[0], v(0, 0, 0)))).toBeCloseTo(1, 9);
  });
});
