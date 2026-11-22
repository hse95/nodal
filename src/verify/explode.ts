/**
 * A verification benchmark rebuilt from ordinary components.
 *
 * The benchmark's builder produces the same parts that components produce
 * (elements, supports, loads). This file writes those parts back out as a graph:
 * coordinate lists in panels, Line and Construct Mesh components, a material
 * and a section, element components (with releases and offsets), supports,
 * loads, Assemble Model, the analysis, a Result View and a Verification Check
 * that compares the result of this graph with the published values.
 *
 * Elements with the same properties share one component, so a beam of eight
 * elements is two coordinate panels and one Beam, not eight Beams. The test
 * suite opens every benchmark this way and requires all checks to pass.
 */
import { GB, BLUE, GREEN, RED, PURPLE, ORANGE } from '../examples';
import { registry } from '../core/graph';
import type { ProjectFile } from '../core/types';
import type { BeamPart, ShellPart, SupportPart, LoadPart, Material, Section } from '../fe/model';
import { unitSystem } from '../fe/units';
import { V3, sub, cross, unit, len } from '../geom/vec';
import { BUILDERS, lastParts } from './builders';
import type { BenchmarkDef } from './runner';
import { BENCHMARKS } from './load';

const DOF = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'];
const num = (x: number): string => String(Object.is(x, -0) ? 0 : x);
const pt = (p: V3): string => `${num(p.x)}, ${num(p.y)}, ${num(p.z)}`;
const dofs = (f: boolean[]): string => (f.every(Boolean) ? 'fixed' : f.map((on, i) => (on ? DOF[i] : '')).filter(Boolean).join(' '));

export function benchmarkAsComponents(def: BenchmarkDef): ProjectFile {
  const built = BUILDERS[def.builder](def.params), parts = lastParts;
  if (!parts) throw new Error('This benchmark cannot be opened as components.');
  const u = unitSystem('SI'), g = new GB(`${def.id} ${def.title} (as components)`, `${def.description}\n\nReference: ${def.source}\n\nThis is the verification model built from ordinary components. The table compares the result of this graph with the reference values, which belong to the dimensions and loads as given here.`);
  const ends: string[] = [], sups: string[] = [], loads: string[] = [];
  /** Next free row in each column of the layout. */
  const rows: number[] = [];
  let count = 0;
  const place = (type: string, col: number, init: Record<string, unknown> = {}): string => {
    const d = registry.get(type)!, key = `n${count++}`, r = rows[col] ?? 0;
    const height = type === 'param.panel' ? Number(init.h ?? 90) + 30 : 30 + 20 * Math.max(d.inputs.length, d.outputs.length, 1) + (d.widget ? 26 : 0);
    g.n(key, type, col, r, init as any);
    rows[col] = r + Math.max(1, Math.ceil((height + 16) / 66 * 10) / 10);
    return key;
  };
  const level = (...cols: number[]) => { const r = Math.max(...cols.map(c => rows[c] ?? 0)); for (const c of cols) rows[c] = r; };
  const panel = (label: string, lines: string[], col: number) => place('param.panel', col, { label, state: { text: lines.join('\n') }, w: 175, h: Math.min(170, 26 + 15 * lines.length) });
  /** A point input: one point is written on the component itself, several come from a panel. */
  const points = (target: string, input: string, list: V3[], label: string, col: number) => { const key = panel(label, list.map(pt), col); g.w(key, target, input); return key; };

  // ---- materials and sections, one component each
  const mats = new Map<Material, string>(), secs = new Map<Section, string>(), geometryKeys: string[] = [], propertyKeys: string[] = [], elementKeys: string[] = [];
  const matKey = (m: Material) => { let k = mats.get(m); if (!k) { k = place('fe.material.custom', 2, { consts: { Name: m.name, E: m.E / u.stress.f, Nu: m.nu, G: m.G / u.stress.f, Density: m.rho / u.density.f, Strength: m.fy / u.stress.f, Alpha: m.alpha / u.alpha.f } }); mats.set(m, k); propertyKeys.push(k); } return k; };
  const secKey = (s: Section) => { let k = secs.get(s); if (!k) { k = place('fe.sec.generic', 2, { label: `Section: ${s.name}`, consts: { Name: s.name, A: s.A / u.area.f, Iy: s.Iy / u.inertia.f, Iz: s.Iz / u.inertia.f, J: s.J / u.inertia.f, Asy: s.Asy / u.area.f, Asz: s.Asz / u.area.f } }); secs.set(s, k); propertyKeys.push(k); } return k; };

  // ---- line elements: one component per set of equal properties
  const beams = parts.els.filter((e): e is BeamPart => e.kind === 'beam'), shells = parts.els.filter((e): e is ShellPart => e.kind === 'shell');
  // Elements are grouped in runs: consecutive elements with equal properties share a component. Keeping the
  // original order keeps the node and element numbering of the benchmark, which some of its checks rely on.
  const matIds = new Map<object, number>(), idOf = (o: object) => { if (!matIds.has(o)) matIds.set(o, matIds.size); return matIds.get(o)!; };
  const runs = <T,>(list: T[], keyOf: (x: T) => string): T[][] => { const out: T[][] = []; let last = ''; for (const x of list) { const k = keyOf(x); if (out.length && k === last) out[out.length - 1].push(x); else out.push([x]); last = k; } return out; };
  const beamGroups = runs(beams, b => JSON.stringify([b.type, idOf(b.mat), idOf(b.sec), b.shear, b.angle, b.ref, b.rel, b.offA, b.offB, b.pre, b.l0, b.id]));
  beamGroups.forEach((list, gi) => {
    const b = list[0], many = beamGroups.length > 1, tag = many ? ` ${gi + 1}` : '';
    level(0, 1, 3);
    const line = place('crv.line', 1, { label: `Member axes${tag}` });
    geometryKeys.push(points(line, 'A', list.map(e => e.a), `Start points${tag}`, 0), points(line, 'B', list.map(e => e.b), `End points${tag}`, 0), line);
    let el: string;
    if (b.type === 'cable') el = place('fe.cable', 3, { consts: { Segments: 1, Pretension: b.pre / u.force.f, Slack: b.l0, ID: b.id } });
    else if (b.type === 'beam') el = place('fe.beam', 3, { consts: { Size: 0, ID: b.id, Shear: b.shear, Angle: b.angle * 180 / Math.PI, ...(b.ref ? { Up: b.ref } : {}) } });
    else el = place('fe.truss', 3, { consts: { ID: b.id, Mode: b.type === 'tension' ? 1 : b.type === 'compression' ? 2 : 0 } });
    g.w(line, el, 'Curve').w(secKey(b.sec), el, 'Section').w(matKey(b.mat), el, 'Material');
    elementKeys.push(el);
    // Each line is one element, so a release or an offset on the element is one at the member start or end.
    if (b.rel.some(Boolean)) { const r = place('fe.release', 4, { consts: { Start: b.rel.slice(0, 6).map((on, i) => (on ? DOF[i] : '')).filter(Boolean).join(' '), End: b.rel.slice(6).map((on, i) => (on ? DOF[i] : '')).filter(Boolean).join(' ') } }); g.w(el, r, 'Elements'); elementKeys.push(r); el = r; }
    if (b.offA || b.offB) { const o = place('fe.offset', 4, { consts: { Start: b.offA ?? { x: 0, y: 0, z: 0 }, End: b.offB ?? { x: 0, y: 0, z: 0 } } }); g.w(el, o, 'Elements'); elementKeys.push(o); el = o; }
    ends.push(el);
  });

  // ---- shells: a mesh from a list of vertices and a list of faces
  for (const list of runs(shells, s => JSON.stringify([idOf(s.mat), s.t, s.id]))) {
    const s = list[0], index = new Map<string, number>(), verts: V3[] = [], faces: string[] = [];
    for (const e of list) faces.push(e.pts.map(p => { const k = pt(p); let i = index.get(k); if (i === undefined) { i = verts.length; verts.push(p); index.set(k, i); } return i; }).join(';'));
    level(0, 1, 3);
    const mesh = place('mesh.construct', 1, { preview: false });
    geometryKeys.push(points(mesh, 'Vertices', verts, `Mesh vertices (${verts.length})`, 0), mesh);
    const fk = panel(`Mesh faces (${faces.length})`, faces, 0); g.w(fk, mesh, 'Faces'); geometryKeys.push(fk);
    const el = place('fe.shell', 3, { consts: { Thickness: s.t / u.dim.f, Size: 0, ID: s.id, Triangles: false } });
    g.w(mesh, el, 'Geometry').w(matKey(s.mat), el, 'Material');
    elementKeys.push(el); ends.push(el);
  }

  // ---- supports
  const supportKeys: string[] = [], supGroups = new Map<string, SupportPart[]>();
  for (const s of parts.sups) {
    if (s.axes) throw new Error('This benchmark has supports in rotated axes, which this conversion does not write out.');
    const key = JSON.stringify([s.fix, s.disp, s.spring]); const l = supGroups.get(key); if (l) l.push(s); else supGroups.set(key, [s]);
  }
  level(5, 6);
  for (const list of supGroups.values()) {
    const s = list[0];
    let k: string;
    if (s.spring && !s.fix.some(Boolean)) k = place('fe.support.spring', 6, { consts: { Stiffness: { x: s.spring[0] / u.spring.f, y: s.spring[1] / u.spring.f, z: s.spring[2] / u.spring.f }, Rotational: { x: s.spring[3] / u.rotSpring.f, y: s.spring[4] / u.rotSpring.f, z: s.spring[5] / u.rotSpring.f } } });
    else if (s.spring) throw new Error('This benchmark combines a spring with a restraint at one node, which this conversion does not write out.');
    else if (s.disp) k = place('fe.support.disp', 6, { consts: { Conditions: dofs(s.fix), Translation: { x: s.disp[0] / u.dim.f, y: s.disp[1] / u.dim.f, z: s.disp[2] / u.dim.f }, Rotation: { x: s.disp[3], y: s.disp[4], z: s.disp[5] } } });
    else k = place('fe.support', 6, { label: `Support: ${dofs(s.fix)}`, consts: { Conditions: dofs(s.fix) } });
    supportKeys.push(k, points(k, 'Point', list.map(x => x.p), list.length > 1 ? `Supported points (${list.length})` : 'Supported point', 5));
    level(5, 6);
    sups.push(k);
  }

  // ---- loads
  const loadKeys: string[] = [], pointGroups = new Map<string, Extract<LoadPart, { kind: 'point' }>[]>();
  for (const l of parts.loads) if (l.kind === 'point') { const key = JSON.stringify([l.f, l.m, l.lc]); const list = pointGroups.get(key); if (list) list.push(l); else pointGroups.set(key, [l]); }
  for (const list of pointGroups.values()) {
    const l = list[0];
    level(5, 6);
    const k = place('fe.load.point', 6, { consts: { Force: { x: l.f.x / u.force.f, y: l.f.y / u.force.f, z: l.f.z / u.force.f }, Moment: { x: l.m.x / u.moment.f, y: l.m.y / u.moment.f, z: l.m.z / u.moment.f }, Case: l.lc } });
    loadKeys.push(k, points(k, 'Point', list.map(x => x.p), list.length > 1 ? `Loaded points (${list.length})` : 'Loaded point', 5));
    level(5, 6);
    loads.push(k);
  }
  for (const l of parts.loads) {
    if (l.kind === 'point') continue;
    let k: string;
    const ids = (list: string[] | null) => (list?.length ? { IDs: list } : {});
    if (l.kind === 'line') k = place('fe.load.line', 6, { consts: { Load: { x: l.w1.x / u.lineLoad.f, y: l.w1.y / u.lineLoad.f, z: l.w1.z / u.lineLoad.f }, ...(len(sub(l.w2, l.w1)) > 0 ? { 'End Load': { x: l.w2.x / u.lineLoad.f, y: l.w2.y / u.lineLoad.f, z: l.w2.z / u.lineLoad.f } } : {}), System: l.sys === 'local' ? 1 : l.sys === 'projected' ? 2 : 0, Case: l.lc, ...ids(l.ids) } });
    else if (l.kind === 'gravity') k = place('fe.load.gravity', 6, { consts: { Direction: l.dir, Case: l.lc } });
    else if (l.kind === 'temp') k = place('fe.load.temp', 6, { consts: { Change: l.dT / u.temp.f, 'Gradient Z': l.gz / u.tempGrad.f, 'Gradient Y': l.gy / u.tempGrad.f, Case: l.lc, ...ids(l.ids) } });
    else if (l.kind === 'pressure') {
      // The Area Load component always takes a direction. A pressure along the element normal is written with the
      // normal of the shells, which is only possible when they all share one (a flat plate).
      let dir = l.dir;
      if (!dir) { const ns = shells.map(s => unit(cross(sub(s.pts[1], s.pts[0]), sub(s.pts[2], s.pts[0])))); if (!ns.length || ns.some(n => len(sub(n, ns[0])) > 1e-9)) throw new Error('This benchmark has a pressure normal to a curved shell, which this conversion does not write out.'); dir = ns[0]; }
      k = place('fe.load.area', 6, { consts: { Pressure: l.p / u.pressure.f, Direction: dir, Projected: l.projected, Case: l.lc, ...ids(l.ids) } });
    } else k = place('fe.load.combo', 6, { consts: { Name: l.lc, Cases: Object.keys(l.factors), Factors: Object.values(l.factors) } });
    loadKeys.push(k); loads.push(k);
  }

  // ---- model, analysis, results
  const top = 0;
  rows[7] = top; rows[8] = top; rows[9] = top;
  const model = place('fe.assemble', 7, { consts: { Tolerance: parts.tol / u.len.f } });
  // Each element component puts the elements of every line on a branch of its own. With several components
  // those branches would be merged side by side, which mixes up the element order, so each list is flattened first.
  if (ends.length > 1) { rows[5] = Math.max(rows[5] ?? 0, 0); ends.forEach((e, i) => { const f = place('tree.flatten', 4, { label: 'Flatten' }); g.w(e, f, 0); ends[i] = f; elementKeys.push(f); }); }
  for (const e of ends) g.w(e, model, 'Elements');
  for (const s of sups) g.w(s, model, 'Supports');
  for (const l of loads) g.w(l, model, 'Loads');
  const o = built.options, set = o.loadSet ?? '';
  const analysis = o.kind === 'static' ? place('fe.static', 8)
    : o.kind === 'second-order' ? place('fe.second', 8, { consts: { 'Load Set': set } })
    : o.kind === 'buckling' ? place('fe.buckling', 8, { consts: { 'Load Set': set, Modes: o.modes ?? 4 } })
    : o.kind === 'modal' ? place('fe.modal', 8, { consts: { Modes: o.modes ?? 6, Consistent: o.consistentMass !== false } })
    : place('fe.nonlinear', 8, { consts: { 'Load Set': set, Steps: o.steps ?? 5, 'Arc Length': !!o.arcLength } });
  g.w(model, analysis, 'Model');
  const hasBeams = beams.length > 0, modes = o.kind === 'buckling' || o.kind === 'modal', frame = beams.some(b => b.type === 'beam');
  const view = place('fe.view', 9, { state: { diagram: !hasBeams || modes ? 'none' : frame ? 'My' : 'N', contour: shells.length ? 'disp' : 'none', reactions: !modes, loads: !modes && !shells.length, values: !shells.length, animate: modes } });
  g.w(analysis, view, 'Result');
  const index = BENCHMARKS.findIndex(b => b.id === def.id);
  const check = place('fe.benchmark.check', 9, { state: { index } });
  g.w(analysis, check, 'Result');
  const table = place('param.panel', 9, { label: 'Computed vs reference', w: 520, h: 100 + 36 * def.checks.length });
  g.w(check, table, 'Data', 'Table');

  if (geometryKeys.length) g.group('Geometry: coordinates in meters', geometryKeys, GREEN);
  if (propertyKeys.length) g.group('Material and section', propertyKeys, ORANGE);
  if (elementKeys.length) g.group('Elements', elementKeys, BLUE);
  if (supportKeys.length || loadKeys.length) g.group('Supports and loads', [...supportKeys, ...loadKeys], RED);
  g.group('Model, analysis and check', [model, analysis, view, check, table], PURPLE);
  return g.p;
}
