/**
 * Templates: ready-made groups of components that are dropped into the current
 * project (unlike an example, which replaces it). A template is either a small
 * complete model (sliders -> geometry -> elements -> supports and loads ->
 * analysis -> results) or a building block to wire into an existing graph.
 *
 * Templates are built with the same helper as the examples and are checked by
 * tests/templates.test.ts: each complete model must solve and reproduce a hand
 * calculation.
 */
import { GB, Expected, trussBridge, BLUE, GREEN, RED, PURPLE } from '../examples';
import type { ProjectFile } from '../core/types';

export interface Template {
  id: string; title: string; group: 'Complete models' | 'Building blocks';
  /** One line shown in the list. */
  summary: string;
  build: () => { project: ProjectFile; expected: Expected[] };
}

const E = 210e9;                                   // default steel, Pa
/** Second moment of area of the idealized I section used by the I Section component, in m^4. */
const iSection = (h: number, b: number, tw: number, tf: number) => (b * h ** 3 - (b - tw) * (h - 2 * tf) ** 3) / 12 * 1e-12;
const tubeI = (d: number, t: number) => Math.PI / 64 * (d ** 4 - (d - 2 * t) ** 4) * 1e-12;

function simpleBeam() {
  const g = new GB('Simply supported beam', '');
  g.slider('L', 'Span [m]', 0, 0, 6, 1, 20, 0.5); g.slider('w', 'Load [kN/m]', 0, 1, 10, 0, 100, 1);
  g.n('B', 'vec.point', 1, 0, { label: 'Right end' }); g.w('L', 'B', 'X');
  g.n('h', 'math.div', 1, 1.5, { consts: { B: 8 }, label: 'Element size' }); g.w('L', 'h', 'A');
  g.n('neg', 'math.neg', 1, 3); g.w('w', 'neg', 'X'); g.n('wv', 'vec.vector', 2, 3, { label: 'Load vector' }); g.w('neg', 'wv', 'Z');
  g.n('line', 'crv.line', 2, 0, { consts: { A: '0, 0, 0' }, label: 'Beam axis' }); g.w('B', 'line', 'B');
  g.n('sec', 'fe.sec.i', 2, 1.3);
  g.n('beam', 'fe.beam', 3, 0); g.w('line', 'beam', 'Curve').w('sec', 'beam', 'Section').w('h', 'beam', 'Size');
  g.n('sA', 'fe.support', 3, 2.7, { consts: { Point: '0, 0, 0', Conditions: 'ux uy uz rx' }, label: 'Pin' });
  g.n('sB', 'fe.support', 3, 4.1, { consts: { Conditions: 'uy uz' }, label: 'Roller' }); g.w('B', 'sB', 'Point');
  g.n('load', 'fe.load.line', 3, 5.5); g.w('wv', 'load', 'Load');
  g.n('model', 'fe.assemble', 4, 1.5); g.w('beam', 'model', 'Elements').w('sA', 'model', 'Supports').w('sB', 'model', 'Supports').w('load', 'model', 'Loads');
  g.n('static', 'fe.static', 5, 1.5); g.w('model', 'static', 'Model');
  g.n('view', 'fe.view', 6, 0, { state: { diagram: 'My' } }); g.w('static', 'view', 'Result');
  g.n('env', 'fe.res.envelope', 6, 1.2, { consts: { Force: 'My' } }); g.w('static', 'env', 'Result');
  g.n('pm', 'param.panel', 7, 1.2, { label: 'Largest moment [kN m]', w: 190, h: 46 }); g.w('env', 'pm', 'Data', 'Highest');
  g.n('pd', 'param.panel', 7, 2.6, { label: 'Largest deflection [mm]', w: 190, h: 46 }); g.w('static', 'pd', 'Data', 'Max Displacement');
  g.group('Simply supported beam', Object.keys(g.ids), BLUE);
  return { project: g.p, expected: [g.exp('Midspan moment wL²/8', 'env', 3, 'first', 10 * 36 / 8, 1e-9, 'kN m'), g.exp('Midspan deflection 5wL⁴/384EI', 'static', 1, 'first', 5 * 10e3 * 6 ** 4 / (384 * E * iSection(300, 150, 7.1, 10.7)) * 1000, 1e-6, 'mm')] };
}

function cantilever() {
  const g = new GB('Cantilever beam', '');
  g.slider('L', 'Length [m]', 0, 0, 3, 0.5, 12, 0.25); g.slider('P', 'Tip load [kN]', 0, 1, 10, 0, 200, 1);
  g.n('B', 'vec.point', 1, 0, { label: 'Tip' }); g.w('L', 'B', 'X');
  g.n('neg', 'math.neg', 1, 1.5); g.w('P', 'neg', 'X'); g.n('F', 'vec.vector', 2, 2.8, { label: 'Load vector' }); g.w('neg', 'F', 'Z');
  g.n('line', 'crv.line', 2, 0, { consts: { A: '0, 0, 0' }, label: 'Beam axis' }); g.w('B', 'line', 'B');
  g.n('sec', 'fe.sec.i', 2, 1.3);
  g.n('beam', 'fe.beam', 3, 0, { consts: { Size: 0.5 } }); g.w('line', 'beam', 'Curve').w('sec', 'beam', 'Section');
  g.n('sup', 'fe.support', 3, 2.7, { consts: { Point: '0, 0, 0', Conditions: 'fixed' }, label: 'Fixed end' });
  g.n('load', 'fe.load.point', 3, 4.1); g.w('B', 'load', 'Point').w('F', 'load', 'Force');
  g.n('model', 'fe.assemble', 4, 1.5); g.w('beam', 'model', 'Elements').w('sup', 'model', 'Supports').w('load', 'model', 'Loads');
  g.n('static', 'fe.static', 5, 1.5); g.w('model', 'static', 'Model');
  g.n('view', 'fe.view', 6, 0, { state: { diagram: 'My' } }); g.w('static', 'view', 'Result');
  g.n('env', 'fe.res.envelope', 6, 1.2, { consts: { Force: 'My' } }); g.w('static', 'env', 'Result');
  g.n('pm', 'param.panel', 7, 1.2, { label: 'Fixed-end moment [kN m]', w: 190, h: 46 }); g.w('env', 'pm', 'Data', 'Lowest');
  g.n('pd', 'param.panel', 7, 2.6, { label: 'Tip deflection [mm]', w: 190, h: 46 }); g.w('static', 'pd', 'Data', 'Max Displacement');
  g.group('Cantilever beam', Object.keys(g.ids), BLUE);
  return { project: g.p, expected: [g.exp('Fixed-end moment −PL', 'env', 2, 'first', -30, 1e-9, 'kN m'), g.exp('Tip deflection PL³/3EI', 'static', 1, 'first', 10e3 * 27 / (3 * E * iSection(300, 150, 7.1, 10.7)) * 1000, 1e-6, 'mm')] };
}

function continuousBeam() {
  const g = new GB('Continuous beam', '');
  g.slider('n', 'Spans', 0, 0, 2, 2, 8, 1, true); g.slider('L', 'Span [m]', 0, 1, 5, 1, 15, 0.5); g.slider('w', 'Load [kN/m]', 0, 2, 12, 0, 100, 1);
  g.n('cnt', 'math.add', 1, 0, { consts: { B: 1 }, label: 'Supports' }); g.w('n', 'cnt', 'A');
  g.n('xs', 'math.series', 1, 1.5, { consts: { Start: 0 }, label: 'Support positions' }); g.w('L', 'xs', 'Step').w('cnt', 'xs', 'Count');
  g.n('pts', 'vec.point', 2, 1.5, { label: 'Support points' }); g.w('xs', 'pts', 'X');
  g.n('pl', 'crv.polyline', 3, 0); g.w('pts', 'pl', 'Vertices'); g.n('seg', 'crv.explode', 4, 0, { label: 'Spans' }); g.w('pl', 'seg', 'Curve');
  g.n('h', 'math.div', 1, 3.6, { consts: { B: 4 }, label: 'Element size' }); g.w('L', 'h', 'A');
  g.n('sec', 'fe.sec.i', 4, 1.3);
  g.n('beam', 'fe.beam', 5, 0); g.w('seg', 'beam', 'Curve', 'Segments').w('sec', 'beam', 'Section').w('h', 'beam', 'Size');
  g.n('sAll', 'fe.support', 5, 2.7, { consts: { Conditions: 'uy uz' }, label: 'Rollers' }); g.w('pts', 'sAll', 'Point');
  g.n('sA', 'fe.support', 5, 4.1, { consts: { Point: '0, 0, 0', Conditions: 'ux uy uz rx' }, label: 'Pin at the start' });
  g.n('neg', 'math.neg', 3, 5.5); g.w('w', 'neg', 'X'); g.n('wv', 'vec.vector', 4, 5.5, { label: 'Load vector' }); g.w('neg', 'wv', 'Z');
  g.n('load', 'fe.load.line', 5, 5.5); g.w('wv', 'load', 'Load');
  g.n('model', 'fe.assemble', 6, 1.5); g.w('beam', 'model', 'Elements').w('sAll', 'model', 'Supports').w('sA', 'model', 'Supports').w('load', 'model', 'Loads');
  g.n('static', 'fe.static', 7, 1.5); g.w('model', 'static', 'Model');
  g.n('view', 'fe.view', 8, 0, { state: { diagram: 'My' } }); g.w('static', 'view', 'Result');
  g.n('env', 'fe.res.envelope', 8, 1.2, { consts: { Force: 'My' } }); g.w('static', 'env', 'Result');
  g.n('p1', 'param.panel', 9, 1.2, { label: 'Support moment [kN m]', w: 190, h: 46 }); g.w('env', 'p1', 'Data', 'Lowest');
  g.n('p2', 'param.panel', 9, 2.6, { label: 'Span moment [kN m]', w: 190, h: 46 }); g.w('env', 'p2', 'Data', 'Highest');
  g.group('Continuous beam', Object.keys(g.ids), BLUE);
  return { project: g.p, expected: [g.exp('Interior support moment −wL²/8 (two spans)', 'env', 2, 'first', -12 * 25 / 8, 1e-9, 'kN m')] };
}

function planeTruss() {
  const g = new GB('Plane truss', '');
  trussBridge(g, 12, 2, 6, false);
  g.n('static', 'fe.static', 9, 3); g.w('model', 'static', 'Model');
  g.n('view', 'fe.view', 10, 1.5, { state: { diagram: 'N' } }); g.w('static', 'view', 'Result');
  g.n('axial', 'fe.res.axial', 10, 3); g.w('static', 'axial', 'Result'); g.n('bnd', 'math.bounds', 11, 3, { label: 'Smallest and largest force' }); g.w('axial', 'bnd', 'Numbers', 'N');
  g.n('p1', 'param.panel', 12, 2.4, { label: 'Largest compression [kN]', w: 190, h: 46 }); g.w('bnd', 'p1', 'Data', 'Min');
  g.n('p2', 'param.panel', 12, 3.8, { label: 'Largest tension [kN]', w: 190, h: 46 }); g.w('bnd', 'p2', 'Data', 'Max');
  g.group('Analysis and results', ['sec', 'tb', 'tt', 'tv', 'td', 'first', 'last', 'sA', 'sB', 'sY', 'neg', 'F', 'pl', 'model', 'static', 'view', 'axial', 'bnd', 'p1', 'p2'], RED);
  // Five loaded bottom nodes of 50 kN on a 12 m span, 2 m deep: midspan moment 3 x 125 x 2 = 450 kN m, so the middle of the top chord carries -450 / 2.
  return { project: g.p, expected: [g.exp('Top chord at midspan −M/d', 'bnd', 1, 'first', -225, 1e-9, 'kN')] };
}

function portalFrame() {
  const g = new GB('Portal frame', '');
  g.slider('L', 'Span [m]', 0, 0, 8, 3, 30, 0.5); g.slider('H', 'Height [m]', 0, 1, 4, 2, 12, 0.25); g.slider('w', 'Beam load [kN/m]', 0, 2, 15, 0, 100, 1); g.slider('F', 'Side load [kN]', 0, 3, 20, 0, 200, 1);
  g.n('b2', 'vec.point', 1, 0, { label: 'Right base' }); g.w('L', 'b2', 'X');
  g.n('k1', 'vec.point', 1, 1.4, { label: 'Left knee' }); g.w('H', 'k1', 'Z'); g.n('k2', 'vec.point', 1, 2.8, { label: 'Right knee' }); g.w('L', 'k2', 'X').w('H', 'k2', 'Z');
  g.n('c1', 'crv.line', 2, 0, { consts: { A: '0, 0, 0' }, label: 'Left column' }); g.w('k1', 'c1', 'B'); g.n('c2', 'crv.line', 2, 1.3, { label: 'Right column' }); g.w('b2', 'c2', 'A').w('k2', 'c2', 'B');
  g.n('bm', 'crv.line', 2, 2.6, { label: 'Beam axis' }); g.w('k1', 'bm', 'A').w('k2', 'bm', 'B');
  g.n('sec', 'fe.sec.i', 2, 4);
  g.n('cols', 'fe.beam', 3, 0, { consts: { ID: 'col', Size: 0.5 }, label: 'Beam: columns' }); g.w('c1', 'cols', 'Curve').w('c2', 'cols', 'Curve').w('sec', 'cols', 'Section');
  g.n('girder', 'fe.beam', 3, 2.6, { consts: { ID: 'beam', Size: 0.5 }, label: 'Beam: girder' }); g.w('bm', 'girder', 'Curve').w('sec', 'girder', 'Section');
  g.n('b1', 'vec.point', 1, 4.2, { label: 'Left base' });
  g.n('sup', 'fe.support', 3, 5.2, { consts: { Conditions: 'fixed' }, label: 'Fixed bases' }); g.w('b1', 'sup', 'Point').w('b2', 'sup', 'Point');
  g.n('negw', 'math.neg', 1, 5.6); g.w('w', 'negw', 'X'); g.n('wv', 'vec.vector', 2, 5.8, { label: 'Beam load vector' }); g.w('negw', 'wv', 'Z');
  g.n('ll', 'fe.load.line', 3, 6.6, { consts: { IDs: 'beam' } }); g.w('wv', 'll', 'Load');
  g.n('Fv', 'vec.vector', 2, 7.4, { label: 'Side load vector' }); g.w('F', 'Fv', 'X'); g.n('pl', 'fe.load.point', 3, 8.3); g.w('k1', 'pl', 'Point').w('Fv', 'pl', 'Force');
  g.n('model', 'fe.assemble', 4, 2); g.w('cols', 'model', 'Elements').w('girder', 'model', 'Elements').w('sup', 'model', 'Supports').w('ll', 'model', 'Loads').w('pl', 'model', 'Loads');
  g.n('static', 'fe.static', 5, 2); g.w('model', 'static', 'Model');
  g.n('view', 'fe.view', 6, 0.5, { state: { diagram: 'My' } }); g.w('static', 'view', 'Result');
  g.n('re', 'fe.res.react', 6, 1.8); g.w('static', 're', 'Result');
  g.n('p1', 'param.panel', 7, 1.8, { label: 'Sum of reactions [kN]', w: 200, h: 46 }); g.w('re', 'p1', 'Data', 'Sum');
  g.n('pd', 'param.panel', 7, 3.2, { label: 'Largest displacement [mm]', w: 200, h: 46 }); g.w('static', 'pd', 'Data', 'Max Displacement');
  g.group('Portal frame', Object.keys(g.ids), BLUE);
  return { project: g.p, expected: [g.exp('Vertical reactions balance the beam load wL', 're', 3, 'first', 15 * 8, 1e-9, 'kN', 'z'), g.exp('Horizontal reactions balance the side load', 're', 3, 'first', -20, 1e-9, 'kN', 'x')] };
}

function columnBuckling() {
  const g = new GB('Column buckling', '');
  g.slider('H', 'Height [m]', 0, 0, 4, 1, 15, 0.25); g.slider('P', 'Axial load [kN]', 0, 1, 100, 1, 2000, 10);
  g.n('top', 'vec.point', 1, 0, { label: 'Top' }); g.w('H', 'top', 'Z');
  g.n('line', 'crv.line', 2, 0, { consts: { A: '0, 0, 0' }, label: 'Column axis' }); g.w('top', 'line', 'B');
  g.n('h', 'math.div', 1, 1.5, { consts: { B: 8 }, label: 'Element size' }); g.w('H', 'h', 'A');
  g.n('sec', 'fe.sec.tube', 2, 1.3, { consts: { Diameter: 114.3, Thickness: 5 } });
  g.n('col', 'fe.beam', 3, 0); g.w('line', 'col', 'Curve').w('sec', 'col', 'Section').w('h', 'col', 'Size');
  g.n('s1', 'fe.support', 3, 2.7, { consts: { Point: '0, 0, 0', Conditions: 'ux uy uz rz' }, label: 'Pinned base' });
  g.n('s2', 'fe.support', 3, 4.1, { consts: { Conditions: 'ux uy' }, label: 'Top held sideways' }); g.w('top', 's2', 'Point');
  g.n('neg', 'math.neg', 1, 5.5); g.w('P', 'neg', 'X'); g.n('F', 'vec.vector', 2, 5.5, { label: 'Load vector' }); g.w('neg', 'F', 'Z');
  g.n('load', 'fe.load.point', 3, 5.5); g.w('top', 'load', 'Point').w('F', 'load', 'Force');
  g.n('model', 'fe.assemble', 4, 1.5); g.w('col', 'model', 'Elements').w('s1', 'model', 'Supports').w('s2', 'model', 'Supports').w('load', 'model', 'Loads');
  g.n('buck', 'fe.buckling', 5, 1.5, { consts: { Modes: 2 } }); g.w('model', 'buck', 'Model');
  g.n('view', 'fe.view', 6, 0, { state: { animate: true, loads: false, reactions: false } }); g.w('buck', 'view', 'Result');
  g.n('first', 'list.item', 6, 1.6, { consts: { Index: 0 }, label: 'Lowest factor' }); g.w('buck', 'first', 'List', 'Factors');
  g.n('pcr', 'math.mul', 7, 2.8, { label: 'Critical load' }); g.w('first', 'pcr', 'A').w('P', 'pcr', 'B');
  g.n('p1', 'param.panel', 7, 1.4, { label: 'Buckling load factor', w: 190, h: 46 }); g.w('first', 'p1', 'Data');
  g.n('p2', 'param.panel', 8, 2.8, { label: 'Critical load [kN]', w: 190, h: 46 }); g.w('pcr', 'p2', 'Data');
  g.group('Column buckling', Object.keys(g.ids), BLUE);
  return { project: g.p, expected: [g.exp('Euler load π²EI/L²', 'pcr', 0, 'first', Math.PI ** 2 * E * tubeI(114.3, 5) / 16 / 1000, 2e-4, 'kN')] };
}

function plate() {
  const g = new GB('Rectangular plate', '');
  g.slider('a', 'Length X [m]', 0, 0, 4, 1, 20, 0.5); g.slider('b', 'Width Y [m]', 0, 1, 4, 1, 20, 0.5); g.slider('t', 'Thickness [mm]', 0, 2, 100, 50, 600, 10); g.slider('q', 'Pressure [kPa]', 0, 3, 10, 0, 100, 1);
  g.n('srf', 'srf.plane', 1, 0.5); g.w('a', 'srf', 'X Size').w('b', 'srf', 'Y Size');
  g.n('size', 'math.div', 1, 2.4, { consts: { B: 16 }, label: 'Element size' }); g.w('a', 'size', 'A');
  g.n('shell', 'fe.shell', 2, 0.5); g.w('srf', 'shell', 'Geometry').w('t', 'shell', 'Thickness').w('size', 'shell', 'Size');
  g.n('naked', 'mesh.naked', 3, 2.2, { label: 'Plate edges' }); g.w('shell', 'naked', 'Mesh', 'Mesh'); g.n('ends', 'crv.ends', 4, 2.2, { label: 'Edge nodes' }); g.w('naked', 'ends', 'Curve');
  g.n('sup', 'fe.support', 5, 2.2, { consts: { Conditions: 'pinned' }, label: 'Simply supported edges' }); g.w('ends', 'sup', 'Point', 'Start');
  g.n('load', 'fe.load.area', 4, 3.8); g.w('q', 'load', 'Pressure');
  g.n('model', 'fe.assemble', 6, 0.5); g.w('shell', 'model', 'Elements').w('sup', 'model', 'Supports').w('load', 'model', 'Loads');
  g.n('static', 'fe.static', 7, 0.5); g.w('model', 'static', 'Model');
  g.n('view', 'fe.view', 8, 0, { state: { contour: 'disp', loads: false, reactions: false, values: false } }); g.w('static', 'view', 'Result');
  g.n('pd', 'param.panel', 8, 1.4, { label: 'Largest deflection [mm]', w: 190, h: 46 }); g.w('static', 'pd', 'Data', 'Max Displacement');
  g.group('Rectangular plate', Object.keys(g.ids), BLUE);
  // Navier solution for a simply supported square plate: w = 0.00406 q a^4 / D (thin-plate theory; the shell element adds a little shear deflection).
  const D = 33e9 * 0.1 ** 3 / (12 * (1 - 0.2 ** 2));
  return { project: g.p, expected: [g.exp('Center deflection 0.00406 qa⁴/D', 'static', 1, 'first', 0.00406 * 10e3 * 4 ** 4 / D * 1000, 0.03, 'mm')] };
}

function blockSection() {
  const g = new GB('Material and section', '');
  g.n('mat', 'fe.material', 0, 0); g.n('sec', 'fe.sec.i', 0, 1.2);
  g.n('props', 'fe.sec.props', 1, 1.2); g.w('sec', 'props', 'Section');
  g.n('pA', 'param.panel', 2, 1, { label: 'Area [mm²]', w: 150, h: 46 }); g.w('props', 'pA', 'Data', 'A');
  g.n('pI', 'param.panel', 2, 2.4, { label: 'Iy [mm⁴]', w: 150, h: 46 }); g.w('props', 'pI', 'Data', 'Iy');
  g.group('Material and section for a Beam', Object.keys(g.ids), GREEN);
  return { project: g.p, expected: [] };
}
function blockLoads() {
  const g = new GB('Load cases and combination', '');
  g.n('dl', 'fe.load.gravity', 0, 0, { consts: { Case: 'DL' }, label: 'Dead: self-weight' });
  g.n('ll', 'fe.load.line', 0, 1.3, { consts: { Load: '0, 0, -10', Case: 'LL' }, label: 'Live load on members' });
  g.n('combo', 'fe.load.combo', 0, 3.5, { consts: { Name: '1.2DL+1.6LL', Cases: ['DL', 'LL'], Factors: [1.2, 1.6] } });
  g.group('Loads for Assemble Model', Object.keys(g.ids), RED);
  return { project: g.p, expected: [] };
}
function blockResults() {
  const g = new GB('Results readout', '');
  g.n('view', 'fe.view', 0, 0, { state: { diagram: 'My' } });
  g.n('re', 'fe.res.react', 0, 1.2); g.n('p1', 'param.panel', 1, 1.2, { label: 'Reactions [kN]', w: 220, h: 90 }); g.w('re', 'p1', 'Data', 'Forces');
  g.n('env', 'fe.res.envelope', 0, 3.6, { consts: { Force: 'My' } }); g.n('p2', 'param.panel', 1, 3.6, { label: 'Lowest moment [kN m]', w: 220, h: 46 }); g.w('env', 'p2', 'Data', 'Lowest'); g.n('p3', 'param.panel', 1, 5, { label: 'Highest moment [kN m]', w: 220, h: 46 }); g.w('env', 'p3', 'Data', 'Highest');
  g.group('Results: connect a Result to the three inputs R', Object.keys(g.ids), PURPLE);
  return { project: g.p, expected: [] };
}

export const TEMPLATES: Template[] = [
  { id: 'beam-simple', title: 'Simply supported beam', group: 'Complete models', summary: 'Uniform load, moment diagram, deflection.', build: simpleBeam },
  { id: 'beam-cantilever', title: 'Cantilever beam', group: 'Complete models', summary: 'Fixed end and a tip load.', build: cantilever },
  { id: 'beam-continuous', title: 'Continuous beam', group: 'Complete models', summary: 'Any number of equal spans.', build: continuousBeam },
  { id: 'truss-plane', title: 'Plane truss', group: 'Complete models', summary: 'Parallel chords, span, depth and panels.', build: planeTruss },
  { id: 'frame-portal', title: 'Portal frame', group: 'Complete models', summary: 'Fixed bases, beam load and side load.', build: portalFrame },
  { id: 'column-buckling', title: 'Column buckling', group: 'Complete models', summary: 'Buckling factor and critical load.', build: columnBuckling },
  { id: 'plate', title: 'Rectangular plate', group: 'Complete models', summary: 'Simply supported shell under pressure.', build: plate },
  { id: 'block-section', title: 'Material and section', group: 'Building blocks', summary: 'With a readout of the section properties.', build: blockSection },
  { id: 'block-loads', title: 'Load cases and combination', group: 'Building blocks', summary: 'Dead load, live load and a factored combination.', build: blockLoads },
  { id: 'block-results', title: 'Results readout', group: 'Building blocks', summary: 'Result view, reactions and moment envelope.', build: blockResults },
];
