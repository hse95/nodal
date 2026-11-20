/**
 * Example gallery. Every example is built in code as an ordinary project
 * (the same data a saved .nodal file contains), with a short explanation and
 * the key results a user should see. tests/examples.test.ts opens and runs
 * every one of them and checks those results.
 */
import { makeNode, emptyProject, registry, newId } from '../core/graph';
import type { NodeData, ProjectFile } from '../core/types';
import { BENCHMARKS } from '../verify/load';

export interface Expected { label: string; node: string; out: number; pick: 'first' | 'max' | 'min' | 'absmax' | 'count'; comp?: 'x' | 'y' | 'z'; value: number; tol: number; unit: string }
export interface Example { id: string; title: string; group: string; summary: string; description: string; benchmark?: string; build: () => { project: ProjectFile; expected: Expected[] } }

/** Small builder for laying out example graphs on a column/row grid. */
class GB {
  p: ProjectFile;
  ids: Record<string, string> = {};
  constructor(name: string, description: string, units: 'SI' | 'US' = 'SI') { this.p = emptyProject(name); this.p.description = description; this.p.units = units; }
  n(key: string, type: string, col: number, row: number, init: Partial<NodeData> = {}): string {
    const def = registry.get(type);
    if (!def) throw new Error(`Example uses unknown component ${type}`);
    const node = makeNode(type, 40 + col * 205, 40 + row * 66, { ...init, id: 'ex_' + key } as any);
    if (init.state) node.state = { ...JSON.parse(JSON.stringify(def.state ?? {})), ...init.state };
    this.p.graph.nodes.push(node); this.ids[key] = node.id;
    return key;
  }
  slider(key: string, label: string, col: number, row: number, value: number, min: number, max: number, step = 0.1, integer = false): string { return this.n(key, 'param.slider', col, row, { label, state: { value, min, max, step, integer } }); }
  /** Wire output `out` of `from` to input `inp` (name or index) of `to`. */
  w(from: string, to: string, inp: string | number = 0, out: string | number = 0): this {
    const a = this.p.graph.nodes.find(n => n.id === this.ids[from])!, b = this.p.graph.nodes.find(n => n.id === this.ids[to])!;
    const da = registry.get(a.type)!, db = registry.get(b.type)!;
    const outs = da.ports ? da.ports(a, this.p).outputs : da.outputs, ins = db.ports ? db.ports(b, this.p).inputs : db.inputs;
    const oi = typeof out === 'number' ? out : outs.findIndex(p => p.name === out), ii = typeof inp === 'number' ? inp : ins.findIndex(p => p.name === inp);
    if (oi < 0 || ii < 0 || oi >= outs.length || ii >= ins.length) throw new Error(`Example wiring error: ${from}.${out} -> ${to}.${inp}`);
    this.p.graph.wires.push({ id: newId('w'), from: a.id, out: oi, to: b.id, inp: ii });
    return this;
  }
  group(label: string, keys: string[], color: string): void { this.p.graph.groups.push({ id: newId('g'), label, color, nodes: keys.map(k => this.ids[k]) }); }
  note(col: number, row: number, text: string, w = 300, h = 90): void { const n = makeNode('param.note', 40 + col * 205, 40 + row * 66, { w, h }); n.state = { text }; this.p.graph.nodes.push(n); }
  exp(label: string, node: string, out: number, pick: Expected['pick'], value: number, tol: number, unit: string, comp?: 'x' | 'y' | 'z'): Expected { return { label, node: this.ids[node], out, pick, value, tol, unit, comp }; }
}
const BLUE = '#4f8ef7', GREEN = '#3fae6b', RED = '#d4504c', PURPLE = '#9b7fd1', ORANGE = '#e0703a';

function quickTruss() {
  const g = new GB('Quick start: a simple truss', 'Three bars, two supports and one load. Drag the sliders and watch the forces change.');
  g.slider('span', 'Span [m]', 0, 0, 6, 2, 12); g.slider('height', 'Height [m]', 0, 1, 3, 1, 6); g.slider('load', 'Load [kN]', 0, 6.5, 10, 0, 100, 1);
  g.n('half', 'math.div', 1, 0.5, { consts: { B: 2 } }).toString(); g.w('span', 'half', 'A');
  g.n('A', 'vec.point', 1, 2, { label: 'Left support' }); g.n('B', 'vec.point', 1, 3.6, { label: 'Right support' }); g.n('C', 'vec.point', 2, 0.5, { label: 'Apex' });
  g.w('span', 'B', 'X').w('half', 'C', 'X').w('height', 'C', 'Z');
  g.n('l1', 'crv.line', 3, 0); g.n('l2', 'crv.line', 3, 1.3); g.n('l3', 'crv.line', 3, 2.6);
  g.w('A', 'l1', 'A').w('C', 'l1', 'B').w('C', 'l2', 'A').w('B', 'l2', 'B').w('A', 'l3', 'A').w('B', 'l3', 'B');
  g.n('sec', 'fe.sec.tube', 3, 4, { consts: { Diameter: 114.3, Thickness: 5 } });
  g.n('truss', 'fe.truss', 4, 1); for (const l of ['l1', 'l2', 'l3']) g.w(l, 'truss', 'Curve'); g.w('sec', 'truss', 'Section');
  g.n('sA', 'fe.support', 4, 3.2, { consts: { Conditions: 'ux uy uz' }, label: 'Pin' }); g.n('sB', 'fe.support', 4, 4.7, { consts: { Conditions: 'uy uz' }, label: 'Roller' }); g.n('sC', 'fe.support', 4, 6.2, { consts: { Conditions: 'uy' }, label: 'Keep in plane' });
  g.w('A', 'sA', 'Point').w('B', 'sB', 'Point').w('C', 'sC', 'Point');
  g.n('neg', 'math.neg', 1, 6.5); g.w('load', 'neg', 'X'); g.n('F', 'vec.vector', 2, 6.5); g.w('neg', 'F', 'Z');
  g.n('pl', 'fe.load.point', 4, 7.7); g.w('C', 'pl', 'Point').w('F', 'pl', 'Force');
  g.n('model', 'fe.assemble', 5, 3); g.w('truss', 'model', 'Elements'); for (const s of ['sA', 'sB', 'sC']) g.w(s, 'model', 'Supports'); g.w('pl', 'model', 'Loads');
  g.n('static', 'fe.static', 6, 3); g.w('model', 'static', 'Model');
  g.n('view', 'fe.view', 7, 2, { state: { diagram: 'N', sections: true } }); g.w('static', 'view', 'Result');
  g.n('axial', 'fe.res.axial', 7, 4); g.w('static', 'axial', 'Result');
  g.n('panel', 'param.panel', 8, 4, { label: 'Bar forces [kN]', w: 190, h: 90 }); g.w('axial', 'panel', 'Data');
  g.group('Geometry', ['span', 'height', 'half', 'A', 'B', 'C', 'l1', 'l2', 'l3'], GREEN); g.group('Structure', ['sec', 'truss', 'sA', 'sB', 'sC', 'pl', 'model', 'static'], RED); g.group('Results', ['view', 'axial', 'panel'], PURPLE);
  return { project: g.p, expected: [g.exp('Rafter force −P/(2 sin α)', 'axial', 0, 'min', -10 / (2 * Math.sin(Math.atan(3 / 3))), 1e-9, 'kN'), g.exp('Tie force P·L/(4h)', 'axial', 0, 'max', 10 * 6 / (4 * 3), 1e-9, 'kN')] };
}

/** Planar truss in the X-Z plane from sliders; shared by the bridge and the sizing example. */
function trussBridge(g: GB, span: number, depth: number, panels: number, groupIds: boolean) {
  g.slider('span', 'Span [m]', 0, 0, span, 8, 60, 1); g.slider('depth', 'Depth [m]', 0, 1, depth, 1, 8); g.slider('panels', 'Panels', 0, 2, panels, 2, 20, 1, true); g.slider('load', 'Load per node [kN]', 0, 9, 50, 0, 300, 5);
  g.n('end', 'vec.point', 1, 0); g.w('span', 'end', 'X');
  g.n('base', 'crv.line', 2, 0, { consts: { A: '0, 0, 0' } }); g.w('end', 'base', 'B');
  g.n('div', 'crv.divide', 3, 0); g.w('base', 'div', 'Curve').w('panels', 'div', 'Count');
  g.n('up', 'vec.unitz', 1, 1.3); g.w('depth', 'up', 'Factor');
  g.n('top', 'xform.move', 4, 1.2, { label: 'Top chord nodes' }); g.w('div', 'top', 'Geometry', 'Points').w('up', 'top', 'Motion');
  g.n('botPl', 'crv.polyline', 5, 0); g.w('div', 'botPl', 'Vertices', 'Points'); g.n('botSeg', 'crv.explode', 6, 0, { label: 'Bottom chord' }); g.w('botPl', 'botSeg', 'Curve');
  g.n('topPl', 'crv.polyline', 5, 1.3); g.w('top', 'topPl', 'Vertices'); g.n('topSeg', 'crv.explode', 6, 1.3, { label: 'Top chord' }); g.w('topPl', 'topSeg', 'Curve');
  g.n('vert', 'crv.line', 5, 2.8, { label: 'Verticals' }); g.w('div', 'vert', 'A', 'Points').w('top', 'vert', 'B');
  g.n('shift', 'list.shift', 5, 4.3, { consts: { Wrap: false } }); g.w('top', 'shift', 'List');
  g.n('diag', 'crv.line', 6, 4, { label: 'Diagonals', matching: 'shortest' }); g.w('div', 'diag', 'A', 'Points').w('shift', 'diag', 'B');
  g.n('sec', 'fe.sec.tube', 6, 6, { consts: { Diameter: 219.1, Thickness: 8 } });
  const kinds: [string, string, string][] = [['tb', 'botSeg', 'bottom'], ['tt', 'topSeg', 'top'], ['tv', 'vert', 'vertical'], ['td', 'diag', 'diagonal']];
  kinds.forEach(([key, src, id], i) => { g.n(key, 'fe.truss', 7, i * 1.6, { consts: { ID: groupIds ? id : 'T' }, label: `Truss: ${id}` }); g.w(src, key, 'Curve', src.endsWith('Seg') ? 'Segments' : 0); g.w('sec', key, 'Section'); });
  g.n('first', 'list.item', 4, 5.5, { consts: { Index: 0 } }); g.n('last', 'list.item', 4, 6.8, { consts: { Index: -1 } }); g.w('div', 'first', 'List', 'Points').w('div', 'last', 'List', 'Points');
  g.n('sA', 'fe.support', 5, 6, { consts: { Conditions: 'ux uy uz' }, label: 'Pin' }); g.n('sB', 'fe.support', 5, 7.4, { consts: { Conditions: 'uy uz' }, label: 'Roller' }); g.w('first', 'sA', 'Point').w('last', 'sB', 'Point');
  g.n('sY', 'fe.support', 5, 8.8, { consts: { Conditions: 'uy' }, label: 'Keep in plane' }); g.w('div', 'sY', 'Point', 'Points').w('top', 'sY', 'Point');
  g.n('neg', 'math.neg', 1, 9); g.w('load', 'neg', 'X'); g.n('F', 'vec.vector', 2, 9); g.w('neg', 'F', 'Z');
  g.n('pl', 'fe.load.point', 5, 10.3); g.w('div', 'pl', 'Point', 'Points').w('F', 'pl', 'Force');
  g.n('model', 'fe.assemble', 8, 3); for (const [key] of kinds) g.w(key, 'model', 'Elements'); for (const s of ['sA', 'sB', 'sY']) g.w(s, 'model', 'Supports'); g.w('pl', 'model', 'Loads');
  g.group('Parameters', ['span', 'depth', 'panels', 'load'], BLUE); g.group('Geometry', ['end', 'base', 'div', 'up', 'top', 'botPl', 'botSeg', 'topPl', 'topSeg', 'vert', 'shift', 'diag'], GREEN);
}
function bridge() {
  const g = new GB('Parametric truss bridge', 'A planar truss whose span, depth and number of panels are sliders. The panels on the right show the steel weight and the midspan deflection, which move in opposite directions as the depth changes.');
  trussBridge(g, 24, 3, 8, false);
  g.n('static', 'fe.static', 9, 3); g.w('model', 'static', 'Model');
  g.n('view', 'fe.view', 10, 1.5, { state: { diagram: 'N', values: false } }); g.w('static', 'view', 'Result');
  g.n('half', 'math.div', 9, 6, { consts: { B: 2 } }); g.w('span', 'half', 'A'); g.n('mid', 'vec.point', 10, 6); g.w('half', 'mid', 'X');
  g.n('dmid', 'fe.res.at', 11, 5); g.w('static', 'dmid', 'Result').w('mid', 'dmid', 'Point');
  g.n('pm', 'param.panel', 10, 3.5, { label: 'Steel weight [kg]', w: 170, h: 46 }); g.w('model', 'pm', 'Data', 'Mass');
  g.n('pd', 'param.panel', 12, 5, { label: 'Midspan deflection [mm]', w: 190, h: 46 }); g.w('dmid', 'pd', 'Data', 'Magnitude');
  g.group('Results', ['static', 'view', 'half', 'mid', 'dmid', 'pm', 'pd'], PURPLE);
  return { project: g.p, expected: [g.exp('Steel weight', 'model', 2, 'first', 4537.22, 1e-3, 'kg'), g.exp('Midspan deflection', 'dmid', 2, 'first', 18.9646, 1e-3, 'mm')] };
}
function sizing() {
  const g = new GB('Section sizing of a truss', 'Each member group (top chord, bottom chord, verticals, diagonals) gets the lightest tube from a list that keeps the simplified stress utilisation below the target. This is a sizing aid based on stress only; it does not check member buckling.');
  trussBridge(g, 24, 3, 8, true);
  g.n('dia', 'math.series', 7, 7.2, { consts: { Start: 60, Step: 20, Count: 12 }, label: 'Tube diameters [mm]' });
  g.n('cand', 'fe.sec.tube', 8, 7.2, { consts: { Thickness: 6 }, label: 'Candidate tubes' }); g.w('dia', 'cand', 'Diameter');
  g.n('size', 'fe.sizing', 9, 3, { consts: { Target: 0.9 } }); g.w('model', 'size', 'Model').w('cand', 'size', 'Sections');
  g.n('view', 'fe.view', 10, 1.5, { state: { utilisation: true, values: false, reactions: false } }); g.w('size', 'view', 'Result', 'Result');
  g.n('pm', 'param.panel', 10, 3.6, { label: 'Sized weight [kg]', w: 170, h: 46 }); g.w('size', 'pm', 'Data', 'Mass');
  g.n('pl2', 'param.panel', 10, 5, { label: 'Sizing log', w: 330, h: 110 }); g.w('size', 'pl2', 'Data', 'Log');
  g.group('Sizing', ['dia', 'cand', 'size', 'view', 'pm', 'pl2'], PURPLE);
  return { project: g.p, expected: [g.exp('Sized weight', 'size', 2, 'first', 1012.53, 1e-3, 'kg'), g.exp('Largest utilisation is below the target', 'size', 3, 'first', 0.80779, 5e-3, '')] };
}
function portal() {
  const g = new GB('Portal frame building with load combinations', 'Pitched portal frames repeated along a building and tied by eaves and ridge beams. Dead load, roof load and wind are separate load cases; two factored combinations are built from them. Pick the combination and the diagram in the Result View inspector.');
  g.slider('span', 'Span [m]', 0, 0, 12, 6, 30, 0.5); g.slider('eave', 'Eave height [m]', 0, 1, 5, 3, 10); g.slider('rise', 'Ridge rise [m]', 0, 2, 2, 0, 5); g.slider('bays', 'Frames', 0, 3, 4, 2, 12, 1, true); g.slider('spacing', 'Frame spacing [m]', 0, 4, 6, 3, 9, 0.5);
  g.n('half', 'math.div', 1, 0, { consts: { B: 2 } }); g.w('span', 'half', 'A'); g.n('top', 'math.add', 1, 1.6); g.w('eave', 'top', 'A').w('rise', 'top', 'B');
  g.n('b2', 'vec.point', 2, 0, { label: 'Base right' }); g.w('span', 'b2', 'X');
  g.n('e1', 'vec.point', 2, 1.4, { label: 'Eave left' }); g.w('eave', 'e1', 'Z'); g.n('e2', 'vec.point', 2, 2.8, { label: 'Eave right' }); g.w('span', 'e2', 'X').w('eave', 'e2', 'Z');
  g.n('ap', 'vec.point', 2, 4.2, { label: 'Ridge' }); g.w('half', 'ap', 'X').w('top', 'ap', 'Z');
  g.n('c1', 'crv.line', 3, 0, { consts: { A: '0, 0, 0' }, label: 'Column' }); g.w('e1', 'c1', 'B'); g.n('c2', 'crv.line', 3, 1.3, { label: 'Column' }); g.w('b2', 'c2', 'A').w('e2', 'c2', 'B');
  g.n('r1', 'crv.line', 3, 2.6, { label: 'Rafter' }); g.w('e1', 'r1', 'A').w('ap', 'r1', 'B'); g.n('r2', 'crv.line', 3, 3.9, { label: 'Rafter' }); g.w('ap', 'r2', 'A').w('e2', 'r2', 'B');
  g.n('dir', 'vec.unity', 3, 5.6); g.w('spacing', 'dir', 'Factor');
  g.n('arrC', 'xform.arraylinear', 4, 0.4, { label: 'Columns along the building' }); g.w('c1', 'arrC', 'Geometry').w('c2', 'arrC', 'Geometry').w('dir', 'arrC', 'Direction').w('bays', 'arrC', 'Count');
  g.n('arrR', 'xform.arraylinear', 4, 2.8, { label: 'Rafters along the building' }); g.w('r1', 'arrR', 'Geometry').w('r2', 'arrR', 'Geometry').w('dir', 'arrR', 'Direction').w('bays', 'arrR', 'Count');
  g.n('nb', 'math.sub', 3, 7, { consts: { B: 1 } }); g.w('bays', 'nb', 'A');
  g.n('tie', 'crv.linesdl', 4, 5.4, { label: 'Eaves and ridge beams' }); g.w('e1', 'tie', 'Start').w('e2', 'tie', 'Start').w('ap', 'tie', 'Start').w('dir', 'tie', 'Direction').w('spacing', 'tie', 'Length');
  g.n('arrT', 'xform.arraylinear', 5, 5.4); g.w('tie', 'arrT', 'Geometry').w('dir', 'arrT', 'Direction').w('nb', 'arrT', 'Count');
  g.n('secC', 'fe.sec.i', 5, 0, { consts: { Depth: 400, Width: 180, Web: 8.6, Flange: 13.5 }, label: 'Frame section' }); g.n('secT', 'fe.sec.rhs', 5, 7.2, { consts: { Width: 120, Depth: 120, Thickness: 6 }, label: 'Tie section' });
  g.n('bc', 'fe.beam', 6, 0, { consts: { ID: 'col', Size: 1.25 }, label: 'Beam: columns' }); g.w('arrC', 'bc', 'Curve').w('secC', 'bc', 'Section');
  g.n('br', 'fe.beam', 6, 2.6, { consts: { ID: 'raf', Size: 1.6 }, label: 'Beam: rafters' }); g.w('arrR', 'br', 'Curve').w('secC', 'br', 'Section');
  g.n('bt', 'fe.beam', 6, 5.2, { consts: { ID: 'tie' }, label: 'Beam: ties' }); g.w('arrT', 'bt', 'Curve').w('secT', 'bt', 'Section');
  g.n('ends', 'crv.ends', 5, 1.9); g.w('arrC', 'ends', 'Curve'); g.n('sup', 'fe.support', 6, 8, { consts: { Conditions: 'fixed' } }); g.w('ends', 'sup', 'Point', 'Start');
  g.n('dl', 'fe.load.gravity', 7, 6.6, { consts: { Case: 'DL' }, label: 'Dead: self-weight' });
  g.n('rl', 'fe.load.line', 7, 7.9, { consts: { Load: '0, 0, -6', IDs: 'raf', System: 2, Case: 'RL' }, label: 'Roof load on plan' });
  g.n('wl', 'fe.load.line', 7, 9.6, { consts: { Load: '3, 0, 0', IDs: 'col', Case: 'WL' }, label: 'Wind on columns' });
  g.n('k1', 'fe.load.combo', 7, 11.3, { consts: { Name: '1.2DL+1.6RL', Cases: ['DL', 'RL'], Factors: [1.2, 1.6] } }); g.n('k2', 'fe.load.combo', 7, 12.8, { consts: { Name: '1.2DL+RL+WL', Cases: ['DL', 'RL', 'WL'], Factors: [1.2, 1, 1] } });
  g.n('model', 'fe.assemble', 8, 3); for (const k of ['bc', 'br', 'bt']) g.w(k, 'model', 'Elements'); g.w('sup', 'model', 'Supports'); for (const k of ['dl', 'rl', 'wl', 'k1', 'k2']) g.w(k, 'model', 'Loads');
  g.n('static', 'fe.static', 9, 3); g.w('model', 'static', 'Model');
  g.n('view', 'fe.view', 10, 2, { state: { caseIndex: 3, diagram: 'My', values: false, loads: false } }); g.w('static', 'view', 'Result');
  g.n('util', 'fe.res.util', 10, 4); g.w('static', 'util', 'Result'); g.n('pu', 'param.panel', 11, 4, { label: 'Largest utilisation (simplified)', w: 210, h: 46 }); g.w('util', 'pu', 'Data', 'Max');
  g.n('pd', 'param.panel', 10, 5.6, { label: 'Largest displacement [mm]', w: 210, h: 46 }); g.w('static', 'pd', 'Data', 'Max Displacement');
  g.group('Parameters', ['span', 'eave', 'rise', 'bays', 'spacing'], BLUE); g.group('Loads and combinations', ['dl', 'rl', 'wl', 'k1', 'k2'], ORANGE); g.group('Results', ['static', 'view', 'util', 'pu', 'pd'], PURPLE);
  return { project: g.p, expected: [g.exp('Largest displacement over all cases', 'static', 1, 'first', 12.7439, 2e-3, 'mm'), g.exp('Largest utilisation (simplified stress check)', 'util', 1, 'first', 0.255828, 2e-3, '')] };
}
function spaceTruss() {
  const g = new GB('Space truss roof on a grid', 'A double-layer "square on offset square" space truss. A short Script component writes the bars from the grid size; the rest is ordinary components. The roof stands on its four corners.');
  g.slider('n', 'Bays each way', 0, 0, 6, 2, 12, 1, true); g.slider('a', 'Module [m]', 0, 1, 3, 1, 6, 0.5); g.slider('d', 'Depth [m]', 0, 2, 2, 0.5, 5); g.slider('load', 'Load per top node [kN]', 0, 6, 15, 0, 100, 1);
  g.n('script', 'script.js', 1, 0.5, { label: 'Grid generator', state: { inputs: 'n, a, d', outputs: 'bottom, top, web, topNodes, corners', code: `// Square-on-offset-square double-layer grid.\nconst N = n[0], A = a[0], D = d[0];\nconst B = (i, j) => pt(i * A, j * A, 0), T = (i, j) => pt((i + 0.5) * A, (j + 0.5) * A, D);\nbottom = []; top = []; web = []; topNodes = [];\nfor (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {\n  if (i < N) bottom.push(line(B(i, j), B(i + 1, j)));\n  if (j < N) bottom.push(line(B(i, j), B(i, j + 1)));\n}\nfor (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {\n  topNodes.push(T(i, j));\n  if (i < N - 1) top.push(line(T(i, j), T(i + 1, j)));\n  if (j < N - 1) top.push(line(T(i, j), T(i, j + 1)));\n  for (const [di, dj] of [[0, 0], [1, 0], [1, 1], [0, 1]]) web.push(line(T(i, j), B(i + di, j + dj)));\n}\ncorners = [B(0, 0), B(N, 0), B(N, N), B(0, N)];` } });
  g.w('n', 'script', 0).w('a', 'script', 1).w('d', 'script', 2);
  g.n('sec', 'fe.sec.tube', 2, 4, { consts: { Diameter: 88.9, Thickness: 4 } });
  g.n('truss', 'fe.truss', 3, 0.5); for (const o of [0, 1, 2]) g.w('script', 'truss', 'Curve', o); g.w('sec', 'truss', 'Section');
  g.n('sup', 'fe.support', 3, 3, { consts: { Conditions: 'pinned' } }); g.w('script', 'sup', 'Point', 4);
  g.n('neg', 'math.neg', 1, 6); g.w('load', 'neg', 'X'); g.n('F', 'vec.vector', 2, 6); g.w('neg', 'F', 'Z');
  g.n('pl', 'fe.load.point', 3, 5); g.w('script', 'pl', 'Point', 3).w('F', 'pl', 'Force');
  g.n('model', 'fe.assemble', 4, 2); g.w('truss', 'model', 'Elements').w('sup', 'model', 'Supports').w('pl', 'model', 'Loads');
  g.n('static', 'fe.static', 5, 2); g.w('model', 'static', 'Model');
  g.n('view', 'fe.view', 6, 1, { state: { diagram: 'none', utilisation: true, values: false, sections: false } }); g.w('static', 'view', 'Result');
  g.n('axial', 'fe.res.axial', 6, 3); g.w('static', 'axial', 'Result'); g.n('bnd', 'math.bounds', 7, 3); g.w('axial', 'bnd', 'Numbers');
  g.n('pmin', 'param.panel', 8, 2.6, { label: 'Largest compression [kN]', w: 190, h: 46 }); g.w('bnd', 'pmin', 'Data', 'Min'); g.n('pmax', 'param.panel', 8, 4, { label: 'Largest tension [kN]', w: 190, h: 46 }); g.w('bnd', 'pmax', 'Data', 'Max');
  g.n('pd', 'param.panel', 6, 5, { label: 'Largest displacement [mm]', w: 190, h: 46 }); g.w('static', 'pd', 'Data', 'Max Displacement');
  return { project: g.p, expected: [g.exp('Largest displacement', 'static', 1, 'first', 28.6877, 2e-3, 'mm'), g.exp('Largest compression', 'bnd', 1, 'first', -196.795, 2e-3, 'kN')] };
}
function gridshell() {
  const g = new GB('Gridshell form-found with dynamic relaxation', 'A flat grid of slightly slack lines is loaded upward and relaxed: the hanging-chain principle turned upside down gives a compression-friendly shell shape. The found shape is then analysed as a frame of steel tubes under its own weight and a downward load.');
  g.slider('L', 'Plan size [m]', 0, 0, 16, 6, 40, 1); g.slider('n', 'Grid cells', 0, 1, 10, 4, 24, 1, true); g.slider('slack', 'Slack factor', 0, 2, 1.08, 1.0, 1.3, 0.01); g.slider('q', 'Node load [kN]', 0, 7, 3, 0, 20, 0.5);
  g.n('srf', 'srf.plane', 1, 0); g.w('L', 'srf', 'X Size').w('L', 'srf', 'Y Size');
  g.n('mesh', 'mesh.surface', 2, 0, { preview: false }); g.w('srf', 'mesh', 'Surface').w('n', 'mesh', 'U Count').w('n', 'mesh', 'V Count');
  g.n('edges', 'mesh.edges', 3, 0, { preview: false }); g.w('mesh', 'edges', 'Mesh');
  g.n('naked', 'mesh.naked', 3, 1.3, { preview: false }); g.w('mesh', 'naked', 'Mesh'); g.n('anch', 'crv.ends', 4, 1.3, { label: 'Boundary anchors' }); g.w('naked', 'anch', 'Curve');
  g.n('dr', 'ff.dr', 5, 0, { consts: { Load: '0, 0, 1', Stiffness: 20000 }, label: 'Dynamic Relaxation (load upward)' }); g.w('edges', 'dr', 'Lines').w('anch', 'dr', 'Anchors', 'Start').w('slack', 'dr', 'Rest Factor');
  g.n('sec', 'fe.sec.tube', 5, 4.6, { consts: { Diameter: 139.7, Thickness: 5 } });
  g.n('beam', 'fe.beam', 6, 0.5); g.w('dr', 'beam', 'Curve', 'Lines').w('sec', 'beam', 'Section');
  g.n('sup', 'fe.support', 6, 3.5, { consts: { Conditions: 'pinned' } }); g.w('anch', 'sup', 'Point', 'Start');
  g.n('sw', 'fe.load.gravity', 6, 5); g.n('neg', 'math.neg', 1, 7); g.w('q', 'neg', 'X'); g.n('F', 'vec.vector', 2, 7); g.w('neg', 'F', 'Z');
  g.n('pl', 'fe.load.point', 6, 6.3); g.w('dr', 'pl', 'Point', 'Points').w('F', 'pl', 'Force');
  g.n('model', 'fe.assemble', 7, 2); g.w('beam', 'model', 'Elements').w('sup', 'model', 'Supports').w('sw', 'model', 'Loads').w('pl', 'model', 'Loads');
  g.n('static', 'fe.static', 8, 2); g.w('model', 'static', 'Model');
  g.n('view', 'fe.view', 9, 1, { state: { diagram: 'N', values: false, loads: false, sections: false } }); g.w('static', 'view', 'Result');
  g.n('bb', 'disp.bbox', 6, 8.2, { preview: false }); g.w('dr', 'bb', 'Geometry', 'Points'); g.n('rise', 'vec.devector', 7, 8.2); g.w('bb', 'rise', 'Vector', 'Size');
  g.n('pr', 'param.panel', 8, 8.6, { label: 'Rise of the shell [m]', w: 180, h: 46 }); g.w('rise', 'pr', 'Data', 'Z'); g.n('pd', 'param.panel', 9, 3.6, { label: 'Largest displacement [mm]', w: 190, h: 46 }); g.w('static', 'pd', 'Data', 'Max Displacement');
  g.group('Form-finding', ['srf', 'mesh', 'edges', 'naked', 'anch', 'dr'], ORANGE); g.group('Analysis of the found shape', ['sec', 'beam', 'sup', 'sw', 'pl', 'model', 'static', 'view', 'pd'], RED);
  return { project: g.p, expected: [g.exp('Rise of the found shape', 'rise', 2, 'first', 2.73946, 5e-3, 'm'), g.exp('Largest displacement', 'static', 1, 'first', 0.990678, 1e-2, 'mm')] };
}
function cableNet() {
  const g = new GB('Cable net form-finding', 'A saddle-shaped cable net found with the force density method. The boundary follows a hyperbolic paraboloid (two corners raised); inside, every cable gets the same force density, so the net settles into an equilibrium shape in one linear solve.');
  g.slider('L', 'Plan size [m]', 0, 0, 12, 4, 30, 1); g.slider('h', 'Corner height [m]', 0, 1, 4, 0, 10, 0.5); g.slider('n', 'Cables each way', 0, 2, 12, 4, 30, 1, true); g.slider('q', 'Force density [kN/m]', 0, 3, 5, 0.5, 50, 0.5); g.slider('w', 'Load per node [kN]', 0, 4, 0.5, 0, 5, 0.1);
  g.n('pB', 'vec.point', 1, 0); g.w('L', 'pB', 'X').w('h', 'pB', 'Z'); g.n('pC', 'vec.point', 1, 1.4); g.w('L', 'pC', 'X').w('L', 'pC', 'Y'); g.n('pD', 'vec.point', 1, 2.8); g.w('L', 'pD', 'Y').w('h', 'pD', 'Z');
  g.n('srf', 'srf.4pt', 2, 0.5, { consts: { A: '0, 0, 0' }, preview: false }); g.w('pB', 'srf', 'B').w('pC', 'srf', 'C').w('pD', 'srf', 'D');
  g.n('mesh', 'mesh.surface', 3, 0.5, { preview: false }); g.w('srf', 'mesh', 'Surface').w('n', 'mesh', 'U Count').w('n', 'mesh', 'V Count');
  g.n('edges', 'mesh.edges', 4, 0, { preview: false }); g.w('mesh', 'edges', 'Mesh'); g.n('naked', 'mesh.naked', 4, 1.3); g.w('mesh', 'naked', 'Mesh'); g.n('anch', 'crv.ends', 5, 1.3, { preview: false }); g.w('naked', 'anch', 'Curve');
  g.n('neg', 'math.neg', 1, 4.4); g.w('w', 'neg', 'X'); g.n('F', 'vec.vector', 2, 4.4); g.w('neg', 'F', 'Z');
  g.n('fdm', 'ff.fdm', 6, 0.5); g.w('edges', 'fdm', 'Lines').w('anch', 'fdm', 'Anchors', 'Start').w('q', 'fdm', 'Density').w('F', 'fdm', 'Load');
  g.n('bnd', 'math.bounds', 7, 2.4); g.w('fdm', 'bnd', 'Numbers', 'Forces');
  g.n('p1', 'param.panel', 8, 2, { label: 'Smallest cable force [kN]', w: 190, h: 46 }); g.w('bnd', 'p1', 'Data', 'Min'); g.n('p2', 'param.panel', 8, 3.4, { label: 'Largest cable force [kN]', w: 190, h: 46 }); g.w('bnd', 'p2', 'Data', 'Max');
  g.group('Boundary', ['pB', 'pC', 'pD', 'srf', 'mesh', 'edges', 'naked', 'anch'], GREEN);
  return { project: g.p, expected: [g.exp('Largest cable force', 'bnd', 2, 'first', 5.49487, 2e-3, 'kN'), g.exp('Smallest cable force (all cables stay in tension)', 'bnd', 1, 'first', 5.0001, 2e-3, 'kN')] };
}
function hypar() {
  const g = new GB('Hypar shell roof', 'A hyperbolic paraboloid concrete shell made from four corner points, two of them raised. It is meshed with quadrilateral shell elements, supported along its edges, and loaded by its own weight and a snow-type load on plan. The view shows the von Mises stress on the top surface.');
  g.slider('L', 'Plan size [m]', 0, 0, 10, 4, 30, 1); g.slider('h', 'Corner rise [m]', 0, 1, 3, 0, 8, 0.25); g.slider('t', 'Thickness [mm]', 0, 2, 80, 40, 300, 5); g.slider('size', 'Element size [m]', 0, 3, 0.625, 0.25, 2, 0.125); g.slider('snow', 'Load on plan [kPa]', 0, 4, 1.5, 0, 10, 0.25);
  g.n('pB', 'vec.point', 1, 0); g.w('L', 'pB', 'X').w('h', 'pB', 'Z'); g.n('pC', 'vec.point', 1, 1.4); g.w('L', 'pC', 'X').w('L', 'pC', 'Y'); g.n('pD', 'vec.point', 1, 2.8); g.w('L', 'pD', 'Y').w('h', 'pD', 'Z');
  g.n('srf', 'srf.4pt', 2, 0.5, { consts: { A: '0, 0, 0' }, preview: false }); g.w('pB', 'srf', 'B').w('pC', 'srf', 'C').w('pD', 'srf', 'D');
  g.n('shell', 'fe.shell', 3, 0.5, { preview: false }); g.w('srf', 'shell', 'Geometry').w('t', 'shell', 'Thickness').w('size', 'shell', 'Size');
  g.n('naked', 'mesh.naked', 4, 2, { preview: false }); g.w('shell', 'naked', 'Mesh', 'Mesh'); g.n('ends', 'crv.ends', 5, 2, { preview: false }); g.w('naked', 'ends', 'Curve');
  g.n('sup', 'fe.support', 6, 2, { consts: { Conditions: 'pinned' } }); g.w('ends', 'sup', 'Point', 'Start');
  g.n('sw', 'fe.load.gravity', 5, 3.6); g.n('al', 'fe.load.area', 5, 4.9, { consts: { Projected: true }, label: 'Snow-type load' }); g.w('snow', 'al', 'Pressure');
  g.n('model', 'fe.assemble', 7, 1); g.w('shell', 'model', 'Elements').w('sup', 'model', 'Supports').w('sw', 'model', 'Loads').w('al', 'model', 'Loads');
  g.n('static', 'fe.static', 8, 1); g.w('model', 'static', 'Model');
  g.n('view', 'fe.view', 9, 0.4, { state: { contour: 'vonMises', loads: false, reactions: false, values: false } }); g.w('static', 'view', 'Result');
  g.n('sr', 'fe.res.shell', 9, 2.4); g.w('static', 'sr', 'Result');
  g.n('p1', 'param.panel', 10, 2.4, { label: 'Largest von Mises stress, top [MPa]', w: 230, h: 46 }); g.w('sr', 'p1', 'Data', 'Max'); g.n('pd', 'param.panel', 10, 3.8, { label: 'Largest displacement [mm]', w: 230, h: 46 }); g.w('static', 'pd', 'Data', 'Max Displacement');
  return { project: g.p, expected: [g.exp('Largest displacement', 'static', 1, 'first', 0.339791, 1e-2, 'mm'), g.exp('Largest von Mises stress on the top surface', 'sr', 2, 'first', 0.667961, 1e-2, 'MPa')] };
}
function tower() {
  const g = new GB('Tower with lateral loads and modal analysis', 'A tapered four-legged steel frame tower with ring beams at every level. One branch of the graph applies wind-type lateral loads and solves the statics; the other finds the natural frequencies. Select the Modal view and turn on Animate to see a mode shape move.');
  g.slider('H', 'Height [m]', 0, 0, 30, 10, 80, 1); g.slider('B', 'Base half-width [m]', 0, 1, 4, 1, 10, 0.25); g.slider('b', 'Top half-width [m]', 0, 2, 1.5, 0.5, 6, 0.25); g.slider('n', 'Levels', 0, 3, 8, 3, 20, 1, true); g.slider('wind', 'Wind load per node [kN]', 0, 8, 1, 0, 40, 0.5);
  g.n('topO', 'vec.point', 1, 1); g.w('H', 'topO', 'Z'); g.n('topPl', 'plane.xy', 2, 1); g.w('topO', 'topPl', 'Origin');
  g.n('base', 'crv.polygon', 3, 0, { consts: { Segments: 4 }, preview: false }); g.w('B', 'base', 'Radius'); g.n('top', 'crv.polygon', 3, 1.5, { consts: { Segments: 4 }, preview: false }); g.w('topPl', 'top', 'Plane').w('b', 'top', 'Radius');
  g.n('bp', 'crv.cps', 4, 0, { preview: false }); g.w('base', 'bp', 'Curve'); g.n('tp', 'crv.cps', 4, 1.5, { preview: false }); g.w('top', 'tp', 'Curve');
  g.n('legs', 'crv.line', 5, 0.6, { label: 'Legs' }); g.w('bp', 'legs', 'A').w('tp', 'legs', 'B');
  g.n('div', 'crv.divide', 6, 0.6, { preview: false }); g.w('legs', 'div', 'Curve').w('n', 'div', 'Count');
  g.n('flip', 'tree.flip', 7, 0.6, { label: 'Points by level' }); g.w('div', 'flip', 'Tree', 'Points');
  g.n('rings', 'crv.polyline', 8, 0.6, { consts: { Closed: true }, label: 'Ring beams' }); g.w('flip', 'rings', 'Vertices');
  g.n('len', 'crv.length', 6, 2.4); g.w('legs', 'len', 'Curve'); g.n('hsize', 'math.div', 7, 2.4); g.w('len', 'hsize', 'A').w('n', 'hsize', 'B');
  g.n('secL', 'fe.sec.tube', 7, 4, { consts: { Diameter: 273, Thickness: 10 }, label: 'Leg section' }); g.n('secR', 'fe.sec.tube', 8, 4, { consts: { Diameter: 139.7, Thickness: 6.3 }, label: 'Ring section' });
  g.n('bl', 'fe.beam', 9, 0, { consts: { ID: 'leg' }, label: 'Beam: legs' }); g.w('legs', 'bl', 'Curve').w('secL', 'bl', 'Section').w('hsize', 'bl', 'Size');
  g.n('brg', 'fe.beam', 9, 2.4, { consts: { ID: 'ring' }, label: 'Beam: rings' }); g.w('rings', 'brg', 'Curve').w('secR', 'brg', 'Section');
  g.n('sup', 'fe.support', 9, 4.8, { consts: { Conditions: 'fixed' } }); g.w('bp', 'sup', 'Point');
  g.n('F', 'vec.vector', 8, 7.6); g.w('wind', 'F', 'X'); g.n('pl', 'fe.load.point', 9, 6.2, { consts: { Case: 'Wind' } }); g.w('flip', 'pl', 'Point').w('F', 'pl', 'Force');
  g.n('sw', 'fe.load.gravity', 9, 8, { consts: { Case: 'Dead' } });
  g.n('model', 'fe.assemble', 10, 2); g.w('bl', 'model', 'Elements').w('brg', 'model', 'Elements').w('sup', 'model', 'Supports').w('pl', 'model', 'Loads').w('sw', 'model', 'Loads');
  g.n('static', 'fe.static', 11, 1); g.w('model', 'static', 'Model'); g.n('modal', 'fe.modal', 11, 4.4, { consts: { Modes: 6 } }); g.w('model', 'modal', 'Model');
  g.n('vs', 'fe.view', 12, 0.4, { state: { caseIndex: 0, values: false }, label: 'Static view' }); g.w('static', 'vs', 'Result');
  g.n('vm', 'fe.view', 12, 4.4, { state: { mode: 0, loads: false, reactions: false }, label: 'Modal view', preview: false }); g.w('modal', 'vm', 'Result');
  g.n('f1', 'list.item', 12, 6, { consts: { Index: 0 } }); g.w('modal', 'f1', 'List', 'Frequencies'); g.n('pf', 'param.panel', 13, 6, { label: 'First frequency [Hz]', w: 180, h: 46 }); g.w('f1', 'pf', 'Data');
  g.n('dtop', 'fe.res.at', 12, 2); g.w('static', 'dtop', 'Result').w('topO', 'dtop', 'Point'); g.n('pd', 'param.panel', 13, 2, { label: 'Sway at the top under wind [mm]', w: 220, h: 46 }); g.w('dtop', 'pd', 'Data', 'Magnitude');
  g.group('Geometry', ['topO', 'topPl', 'base', 'top', 'bp', 'tp', 'legs', 'div', 'flip', 'rings', 'len', 'hsize'], GREEN); g.group('Statics', ['static', 'vs', 'dtop', 'pd'], PURPLE); g.group('Dynamics', ['modal', 'vm', 'f1', 'pf'], ORANGE);
  return { project: g.p, expected: [g.exp('First natural frequency', 'f1', 0, 'first', 1.09845, 2e-3, 'Hz'), g.exp('Sway at the top under wind', 'dtop', 2, 'first', 76.1927, 2e-3, 'mm')] };
}
function evolve() {
  const g = new GB('Evolutionary optimisation of a beam', 'A simply supported concrete beam under a line load. The optimiser changes the width and depth sliders to minimise the weight, with a penalty whenever the midspan deflection exceeds span/250. Select the Evolutionary Optimiser component and press Run. By hand: the width goes to its lower limit (100 mm) and the depth to about 495 mm, the smallest that satisfies the limit.');
  g.slider('b', 'Width [mm]', 0, 0, 300, 100, 400, 5); g.slider('h', 'Depth [mm]', 0, 1, 600, 200, 800, 5); g.slider('span', 'Span [m]', 0, 2.4, 8, 3, 15, 0.5); g.slider('w', 'Load [kN/m]', 0, 3.8, 20, 0, 80, 1);
  g.n('end', 'vec.point', 1, 2.4); g.w('span', 'end', 'X'); g.n('axis', 'crv.line', 2, 2.4, { consts: { A: '0, 0, 0' } }); g.w('end', 'axis', 'B');
  g.n('sec', 'fe.sec.rect', 2, 0.3); g.w('b', 'sec', 'Width').w('h', 'sec', 'Depth'); g.n('mat', 'fe.material', 2, 1.4, { state: { index: 3 } });
  g.n('beam', 'fe.beam', 3, 1, { consts: { Size: 1 } }); g.w('axis', 'beam', 'Curve').w('sec', 'beam', 'Section').w('mat', 'beam', 'Material');
  g.n('sA', 'fe.support', 3, 3.6, { consts: { Point: '0, 0, 0', Conditions: 'ux uy uz rx' } }); g.n('sB', 'fe.support', 3, 5, { consts: { Conditions: 'uy uz' } }); g.w('end', 'sB', 'Point');
  g.n('neg', 'math.neg', 1, 3.8); g.w('w', 'neg', 'X'); g.n('F', 'vec.vector', 2, 3.8); g.w('neg', 'F', 'Z'); g.n('ll', 'fe.load.line', 3, 6.4); g.w('F', 'll', 'Load');
  g.n('model', 'fe.assemble', 4, 2.5); g.w('beam', 'model', 'Elements').w('sA', 'model', 'Supports').w('sB', 'model', 'Supports').w('ll', 'model', 'Loads');
  g.n('static', 'fe.static', 5, 2.5); g.w('model', 'static', 'Model'); g.n('view', 'fe.view', 6, 1, { state: { diagram: 'My' } }); g.w('static', 'view', 'Result');
  g.n('lim', 'math.expr', 5, 5, { state: { expr: 'L * 1000 / 250' }, label: 'Deflection limit [mm]' }); g.w('span', 'lim', 'L');
  g.n('fit', 'math.expr', 6, 3.6, { state: { expr: 'm + 2000 * max(0, d - lim)' }, label: 'Weight + penalty' }); g.w('model', 'fit', 'm', 'Mass').w('static', 'fit', 'd', 'Max Displacement').w('lim', 'fit', 'lim');
  g.n('opt', 'opt.evolve', 7, 3.6); g.w('fit', 'opt', 'Fitness');
  g.p.graph.nodes.find(n => n.id === g.ids.opt)!.state.genes = [g.ids.b, g.ids.h];
  g.n('pm', 'param.panel', 5, 0.6, { label: 'Weight [kg]', w: 150, h: 46 }); g.w('model', 'pm', 'Data', 'Mass'); g.n('pd', 'param.panel', 6, 5.4, { label: 'Deflection [mm]', w: 150, h: 46 }); g.w('static', 'pd', 'Data', 'Max Displacement');
  return { project: g.p, expected: [g.exp('Starting weight b·h·L·ρ', 'model', 2, 'first', 0.3 * 0.6 * 8 * 2500, 1e-9, 'kg'), g.exp('Starting deflection 5wL⁴/384EI', 'static', 1, 'first', 5 * 20000 * 8 ** 4 / (384 * 33e9 * 0.3 * 0.6 ** 3 / 12) * 1000, 1e-6, 'mm')] };
}
function benchmarkExample(id: string) {
  const def = BENCHMARKS.find(b => b.id === id)!, index = BENCHMARKS.indexOf(def);
  const g = new GB(`${def.id} ${def.title}`, `${def.description}\n\nReference: ${def.source}`);
  g.n('bm', 'fe.benchmark', 0, 0, { state: { index } });
  const shell = def.group === 'Shells', modes = def.builder === 'vibration' || (def.builder === 'column' && !def.params.second);
  g.n('view', 'fe.view', 1.3, 0, { state: { contour: shell ? 'disp' : 'none', diagram: shell || modes || def.builder === 'cable' ? 'none' : def.builder === 'triangleTruss' || def.builder === 'tenBarTruss' ? 'N' : 'My', values: !shell, sections: false, animate: modes } }); g.w('bm', 'view', 'Result', 'Result');
  g.n('panel', 'param.panel', 1.3, 2.4, { label: 'Computed vs reference', w: 620, h: 190 }); g.w('bm', 'panel', 'Data', 'Table');
  return { project: g.p, expected: [g.exp('All checks of this benchmark pass', 'bm', 3, 'first', 1, 0, '')] };
}

export const EXAMPLES: Example[] = [
  { id: 'quick-truss', title: 'Quick start: a simple truss', group: 'Start here', summary: 'Three bars, two supports, one load.', description: 'The smallest complete workflow: points → lines → truss elements → supports and a load → model → analysis → results. Expected: rafters −7.07 kN, tie +5.00 kN for the default sliders.', benchmark: 'B10', build: quickTruss },
  { id: 'truss-bridge', title: 'Parametric truss bridge', group: 'Parametric structures', summary: 'Depth and panel sliders with a live weight and deflection readout.', description: 'Expected for the defaults (24 m span, 3 m deep, 8 panels, 50 kN per bottom node): steel weight about 4,537 kg and midspan deflection about 19.0 mm. Increase the depth and the deflection drops while the weight rises.', build: bridge },
  { id: 'portal-building', title: 'Portal frame building with load combinations', group: 'Parametric structures', summary: 'Five frames, three load cases, two combinations.', description: 'Expected for the defaults: largest displacement about 12.7 mm (in the 1.2DL+1.6RL combination) and a largest simplified utilisation of about 0.26.', benchmark: 'B13', build: portal },
  { id: 'space-truss', title: 'Space truss roof on a grid', group: 'Parametric structures', summary: 'Double-layer grid generated by a script component.', description: 'Expected for the defaults (6 × 6 bays of 3 m, 2 m deep, 15 kN on each of the 36 top nodes): largest displacement about 28.7 mm and largest bar compression about 197 kN.', build: spaceTruss },
  { id: 'gridshell', title: 'Gridshell form-found by dynamic relaxation', group: 'Form-finding', summary: 'Hanging-chain shape, then a frame analysis of it.', description: 'Expected for the defaults: the relaxed grid rises about 2.74 m over a 16 m square plan, and the largest displacement of the tube gridshell under self-weight plus 3 kN per node is about 1.0 mm.', build: gridshell },
  { id: 'cable-net', title: 'Cable net form-finding', group: 'Form-finding', summary: 'Saddle net by the force density method.', description: 'Expected for the defaults: all cables in tension, with forces between about 5.00 and 5.49 kN.', build: cableNet },
  { id: 'hypar-shell', title: 'Hypar shell roof', group: 'Shells', summary: 'Hyperbolic paraboloid concrete shell with stress contours.', description: 'Expected for the defaults (10 m plan, 3 m corner rise, 80 mm thick, self-weight plus 1.5 kPa on plan): largest displacement about 0.34 mm and largest top-surface von Mises stress about 0.67 MPa. The low values show how efficiently the doubly curved shell carries load by membrane action.', benchmark: 'B22', build: hypar },
  { id: 'tower', title: 'Tower with lateral loads and modal analysis', group: 'Parametric structures', summary: 'Static sway and natural frequencies of a tapered frame tower.', description: 'Expected for the defaults (30 m high): first natural frequency about 1.10 Hz and a sway of about 76 mm at the top under 1 kN per node. The tower has no diagonal bracing, so it is a flexible frame.', benchmark: 'B18', build: tower },
  { id: 'sizing', title: 'Cross-section sizing of a truss', group: 'Optimisation', summary: 'Lightest tubes per member group under a stress target.', description: 'Expected for the defaults: the sized truss weighs about 1,013 kg with a largest utilisation of about 0.81 (target 0.9), compared with about 4,537 kg for a uniform 219 × 8 tube.', build: sizing },
  { id: 'evolve-beam', title: 'Evolutionary optimisation of a beam', group: 'Optimisation', summary: 'Minimum weight under a deflection limit.', description: 'Starting point: 300 × 600 mm, 3,600 kg, 5.99 mm deflection (limit 32 mm). After running the optimiser the width should reach 100 mm and the depth about 495 mm, giving about 990 kg.', benchmark: 'B03', build: evolve },
  ...BENCHMARKS.map(b => ({ id: 'bench-' + b.id.toLowerCase(), title: `${b.id} ${b.title}`, group: `Verification: ${b.group}`, summary: b.checks.length + ' checks against ' + (b.source.split(/[;(]/)[0].trim().slice(0, 70)), description: b.description, benchmark: b.id, build: () => benchmarkExample(b.id) })),
];
