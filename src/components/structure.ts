/**
 * Component library, part 3: structural modeling, analysis, results,
 * form-finding, optimization, scripting and clusters.
 *
 * Every numeric port that carries a physical quantity declares its unit kind
 * (`u`), and values are converted between the project's display units and the
 * solver's SI units here and nowhere else.
 */
import { P, formatValue, registry } from '../core/graph';
import { DataTree } from '../core/tree';
import type { NodeData, PortSpec, ProjectFile, SolveContext } from '../core/types';
import { C, num, int, pt, vec } from './basic';
import { toMesh } from './geometry';
import { V3, v, mul, add, sub, len, dist, Z, O, Plane } from '../geom/vec';
import * as cv from '../geom/curve';
import * as sf from '../geom/surface';
import * as ms from '../geom/mesh';
import { unitSystem, UnitSystem } from '../fe/units';
import * as fm from '../fe/model';
import { beamChain, shellsFromMesh, support, parseDofs, pointLoad, lineLoad, gravityLoad, tempLoad, pressureLoad, combo, beam } from '../fe/parts';
import { runJob } from '../fe/client';
import type { FEResult } from '../fe/system';
import type { SizingResult } from '../fe/sizing';
import * as post from '../fe/post';
import { buildNet, forceDensity, dynamicRelaxation } from '../geom/formfind';

const U = (ctx: SolveContext): UnitSystem => unitSystem(ctx.units);
const txt = (n: string, d: string, def?: string, o: any = {}) => P(n, 'text', d, { d: def, ...o });
const bool = (n: string, d: string, def = false, o: any = {}) => P(n, 'boolean', d, { d: def, ...o });
const ids = () => P('IDs', 'text', 'Element IDs the load applies to (leave empty for all)', { list: true, opt: true, nick: 'Id' });
const lc = () => txt('Case', 'Name of the load case', 'LC1', { nick: 'LC' });
const scaleV = (a: V3, f: number): V3 => mul(a, f);
const DEFAULT_MAT = fm.MATERIAL_PRESETS['Steel S355'];

// ======================================================================= Materials and sections
C('fe.material', 'Material', 'Mat', 'Structure', 'A material from the built-in list of typical values (steel, concrete, timber, aluminum). Always check the values against your project data.', [], [P('Material', 'material', 'The material', { nick: 'M' })],
  (_i, ctx) => { const it = (ctx.node.state.items ?? [])[ctx.node.state.index ?? 0]; const m = fm.MATERIAL_PRESETS[it?.value]; if (!m) throw new Error('Unknown material'); return [m]; },
  { widget: 'valuelist', state: { items: Object.keys(fm.MATERIAL_PRESETS).map(k => ({ name: k, value: k })), index: 0 }, width: 190, noPreview: true, example: 'Material -> Mat input of Beam' });
C('fe.material.custom', 'Custom Material', 'CMat', 'Structure', 'An isotropic material from its properties. If G is left at 0 it is computed from E and Poisson\'s ratio.',
  [txt('Name', 'Material name', 'Custom', { nick: 'N' }), num('E', 'Young\'s modulus', 210000, { u: 'stress' }), num('Nu', 'Poisson\'s ratio', 0.3, { nick: 'ν' }), num('G', 'Shear modulus (0 = from E and ν)', 0, { u: 'stress' }), num('Density', 'Mass density', 7850, { nick: 'ρ', u: 'density' }), num('Strength', 'Yield or characteristic strength used for utilization', 355, { nick: 'fy', u: 'stress' }), num('Alpha', 'Coefficient of thermal expansion', 1.2e-5, { nick: 'α', u: 'alpha' })],
  [P('Material', 'material', 'The material', { nick: 'M' })],
  ([n, E, nu, G, rho, fy, al], ctx) => { const u = U(ctx); if (E <= 0) throw new Error('E must be positive'); return [fm.material(n, E * u.stress.f, nu, rho * u.density.f, fy * u.stress.f, al * u.alpha.f, G > 0 ? G * u.stress.f : undefined)]; }, { noPreview: true });
const dimPort = (n: string, d: string, def: number, nick?: string) => num(n, d, def, { u: 'dim', nick });
const secOut = [P('Section', 'section', 'The cross-section', { nick: 'S' })];
const sec = (id: string, name: string, desc: string, ins: PortSpec[], make: (a: number[]) => fm.Section, example?: string) =>
  C(`fe.sec.${id}`, name, id.slice(0, 5), 'Structure', desc + ' Local z is the depth direction (strong-axis bending is about local y).', ins, secOut, (a, ctx) => { const f = U(ctx).dim.f; if (a.some((x: number) => !(x > 0))) throw new Error('All dimensions must be positive'); return [make(a.map((x: number) => x * f))]; }, { noPreview: true, example });
sec('rect', 'Rectangular Section', 'Solid rectangle of width b and depth h.', [dimPort('Width', 'Width b (along local y)', 200, 'b'), dimPort('Depth', 'Depth h (along local z)', 400, 'h')], ([b, h]) => fm.secRect(b, h), 'Rectangular Section 200 x 400 -> Beam');
sec('rhs', 'Hollow Rectangular Section', 'Rectangular hollow section.', [dimPort('Width', 'Outer width b', 150, 'b'), dimPort('Depth', 'Outer depth h', 250, 'h'), dimPort('Thickness', 'Wall thickness', 8, 't')], ([b, h, t]) => fm.secRectHollow(b, h, t));
sec('circle', 'Circular Section', 'Solid round bar.', [dimPort('Diameter', 'Diameter', 100, 'd')], ([d]) => fm.secCircle(d));
sec('tube', 'Tube Section', 'Circular hollow section.', [dimPort('Diameter', 'Outer diameter', 168.3, 'd'), dimPort('Thickness', 'Wall thickness', 6.3, 't')], ([d, t]) => fm.secTube(d, t), 'Tube Section -> Truss members');
sec('i', 'I Section', 'I or H section.', [dimPort('Depth', 'Overall depth h', 300, 'h'), dimPort('Width', 'Flange width b', 150, 'b'), dimPort('Web', 'Web thickness', 7.1, 'tw'), dimPort('Flange', 'Flange thickness', 10.7, 'tf')], ([h, b, tw, tf]) => fm.secI(h, b, tw, tf), 'I Section 300 x 150 x 7.1 x 10.7 (similar to IPE 300)');
sec('channel', 'Channel Section', 'Channel (C) section. The shear-center offset is ignored.', [dimPort('Depth', 'Overall depth h', 200, 'h'), dimPort('Width', 'Flange width b', 75, 'b'), dimPort('Web', 'Web thickness', 8.5, 'tw'), dimPort('Flange', 'Flange thickness', 11.5, 'tf')], ([h, b, tw, tf]) => fm.secChannel(h, b, tw, tf));
sec('angle', 'Angle Section', 'Angle (L) section. Properties are about the axes parallel to the legs; the rotation of the principal axes is ignored.', [dimPort('Leg h', 'Leg along local z', 100, 'h'), dimPort('Leg b', 'Leg along local y', 100, 'b'), dimPort('Thickness', 'Leg thickness', 10, 't')], ([h, b, t]) => fm.secAngle(h, b, t));
C('fe.sec.generic', 'Generic Section', 'GSec', 'Structure', 'A cross-section defined directly by its properties.', [txt('Name', 'Section name', 'Generic', { nick: 'N' }), num('A', 'Area', 50, { u: 'area' }), num('Iy', 'Second moment of area about local y (strong axis for a beam under gravity)', 8000, { u: 'inertia' }), num('Iz', 'Second moment of area about local z', 600, { u: 'inertia' }), num('J', 'Torsion constant', 20, { u: 'inertia' }), num('Asy', 'Shear area along y (0 = 5/6 A)', 0, { u: 'area' }), num('Asz', 'Shear area along z (0 = 5/6 A)', 0, { u: 'area' })], secOut,
  ([n, A, Iy, Iz, J, ay, az], ctx) => { const u = U(ctx); if (!(A > 0)) throw new Error('Area must be positive'); return [fm.secGeneric(n, A * u.area.f, Iy * u.inertia.f, Iz * u.inertia.f, J * u.inertia.f, ay * u.area.f, az * u.area.f)]; }, { noPreview: true });
C('fe.sec.table', 'Section Table', 'STab', 'Structure', 'Reads cross-sections from CSV text with the columns name, A, Iy, Iz, J (and optionally Asy, Asz, cy, cz) in the project units. Use it to bring in standard steel shapes from your own table.',
  [txt('CSV', 'CSV text, one section per line (a header line is allowed)', undefined, { list: true, nick: 'T' }), txt('Name', 'Name filter: only sections whose name contains this text', '', { opt: true, nick: 'N' })], [P('Sections', 'section', 'The sections, in table order', { list: true, nick: 'S' }), P('Names', 'text', 'Their names', { list: true, nick: 'N' })],
  ([lines, filter], ctx) => {
    const u = U(ctx), out: fm.Section[] = [];
    for (const line of lines.flatMap((l: string) => String(l).split('\n'))) {
      const c = line.split(/[,;\t]/).map((s: string) => s.trim());
      if (c.length < 5 || !Number.isFinite(Number(c[1]))) continue;      // header or blank line
      if (filter && !c[0].toLowerCase().includes(String(filter).toLowerCase())) continue;
      const n = c.slice(1).map(Number);
      const s = fm.secGeneric(c[0], n[0] * u.area.f, n[1] * u.inertia.f, n[2] * u.inertia.f, n[3] * u.inertia.f, (n[4] || 0) * u.area.f, (n[5] || 0) * u.area.f, (n[6] || 0) * u.dim.f, (n[7] || 0) * u.dim.f);
      out.push(s);
    }
    if (!out.length) throw new Error('No sections found. Each line needs: name, A, Iy, Iz, J');
    return [out, out.map(s => s.name)];
  }, { noPreview: true, example: 'Panel with "IPE200, 28.5, 1943, 142, 6.98" -> Section Table' });
C('fe.sec.props', 'Section Properties', 'SProp', 'Structure', 'The properties of a cross-section.', [P('Section', 'section', 'A cross-section', { nick: 'S' })], [num('A', 'Area', undefined, { u: 'area' }), num('Iy', 'Second moment about y', undefined, { u: 'inertia' }), num('Iz', 'Second moment about z', undefined, { u: 'inertia' }), num('J', 'Torsion constant', undefined, { u: 'inertia' }), txt('Name', 'Section name', undefined, { nick: 'N' })],
  ([s], ctx) => { const u = U(ctx); return [s.A / u.area.f, s.Iy / u.inertia.f, s.Iz / u.inertia.f, s.J / u.inertia.f, s.name]; }, { noPreview: true });

// ======================================================================= Elements
const toSI = (p: V3, u: UnitSystem): V3 => mul(p, u.len.f);
/** Straight pieces of a curve as SI point pairs; curved pieces are replaced by chords no longer than `size`. */
function curvePieces(c: cv.Curve, size: number, u: UnitSystem): { a: V3; b: V3; n: number }[] {
  const out: { a: V3; b: V3; n: number }[] = [];
  for (const seg of cv.explodeCurve(c)) {
    const L = cv.curveLength(seg);
    if (L < 1e-12) continue;
    if (seg.k === 'line') out.push({ a: toSI(seg.a, u), b: toSI(seg.b, u), n: size > 0 ? Math.max(1, Math.ceil(L / size - 1e-9)) : 1 });
    else {
      const n = size > 0 ? Math.max(2, Math.ceil(L / size - 1e-9)) : 12, pts = cv.divideByCount(seg, n).map(t => cv.curvePoint(seg, t));
      if (cv.curveClosed(seg)) pts.push(pts[0]);
      for (let i = 0; i + 1 < pts.length; i++) out.push({ a: toSI(pts[i], u), b: toSI(pts[i + 1], u), n: 1 });
    }
  }
  return out;
}
const elemOut = [P('Elements', 'element', 'Structural elements', { list: true, nick: 'E' })];
C('fe.beam', 'Beam', 'Beam', 'Structure', 'Turns curves into frame (beam-column) elements with six degrees of freedom per node. Straight lines become one element, or several when a target size is given; curves are replaced by straight chords.',
  [P('Curve', 'curve', 'Member axis', { nick: 'C' }), P('Section', 'section', 'Cross-section', { nick: 'S' }), P('Material', 'material', 'Material', { d: DEFAULT_MAT, nick: 'M' }), num('Size', 'Target element length (0 = one element per straight member)', 0, { u: 'len', nick: 'h' }), txt('ID', 'Element ID, used by loads and results to refer to this member', 'B', { nick: 'Id' }), bool('Shear', 'Include shear deformation (Timoshenko); off = Euler–Bernoulli', false, { nick: 'T' }), num('Angle', 'Rotation of the section about the member axis', 0, { u: 'angle', nick: 'β' }), P('Up', 'vector', 'Optional reference direction for the section depth (default: global Z)', { opt: true, nick: 'Up' })], elemOut,
  ([c, s, m, h, id, sh, ang, up], ctx) => { const u = U(ctx); return [curvePieces(c, h, u).flatMap(p => beamChain(p.a, p.b, p.n, m, s, { id, shear: sh, angle: ang * Math.PI / 180, ref: up ?? null }))]; }, { example: 'Line + I Section -> Beam -> Assemble Model' });
C('fe.truss', 'Truss', 'Truss', 'Structure', 'Turns curves into axial-only bar elements (pinned at both ends). Mode 1 makes the bar tension-only, mode 2 compression-only; those are solved by iteration.',
  [P('Curve', 'curve', 'Member axis', { nick: 'C' }), P('Section', 'section', 'Cross-section', { nick: 'S' }), P('Material', 'material', 'Material', { d: DEFAULT_MAT, nick: 'M' }), txt('ID', 'Element ID', 'T', { nick: 'Id' }), int('Mode', '0 = tension and compression, 1 = tension only, 2 = compression only', 0, { nick: 'Md' })], elemOut,
  ([c, s, m, id, mode], ctx) => { const u = U(ctx); return [curvePieces(c, 0, u).map(p => beam(p.a, p.b, m, s, { id, type: mode === 1 ? 'tension' : mode === 2 ? 'compression' : 'truss' }))]; }, { example: 'Lines of a truss -> Truss' });
C('fe.cable', 'Cable', 'Cable', 'Structure', 'Tension-only cable between the ends of a line, split into segments so it can sag in a nonlinear analysis. Pretension and a slack factor (unstressed length divided by drawn length) set its initial state.',
  [P('Curve', 'curve', 'Cable chord (straight line)', { nick: 'C' }), P('Section', 'section', 'Cross-section', { nick: 'S' }), P('Material', 'material', 'Material', { d: DEFAULT_MAT, nick: 'M' }), int('Segments', 'Number of cable elements (1 for stays in linear analysis)', 1, { nick: 'n' }), num('Pretension', 'Pretension force', 0, { u: 'force', nick: 'P0' }), num('Slack', 'Unstressed length / drawn length (1 = exactly as drawn)', 1, { nick: 'L0' }), txt('ID', 'Element ID', 'C', { nick: 'Id' })], elemOut,
  ([c, s, m, n, pre, l0, id], ctx) => { const u = U(ctx), a = toSI(cv.curveStart(c), u), b = toSI(cv.curveEnd(c), u); return [beamChain(a, b, Math.max(1, n), m, s, { id, type: 'cable', pre: pre * u.force.f, l0 })]; }, { example: 'Cable with 20 segments -> Nonlinear analysis' });
C('fe.release', 'End Releases', 'Rel', 'Structure', 'Adds hinges to beam ends. Write the released local DOFs as text: "ry rz" (or "pin") releases both bending moments, "rx" torsion, "ux" axial force.',
  [P('Elements', 'element', 'Beam elements', { list: true, nick: 'E' }), txt('Start', 'Releases at the start of each member', '', { nick: 'S' }), txt('End', 'Releases at the end of each member', 'pin', { nick: 'E' })], elemOut,
  ([els, s, e]) => { const rs = parseDofs(s), re = parseDofs(e); return [els.map((el: fm.ElementPart) => { if (el.kind !== 'beam' || el.type !== 'beam') return el; const rel = [...el.rel]; if (el.ci === 0) rs.forEach((f, i) => { if (f) rel[i] = true; }); if (el.ci === el.cn - 1) re.forEach((f, i) => { if (f) rel[6 + i] = true; }); return { ...el, rel }; })]; }, { example: 'Pin-ended secondary beams' });
C('fe.offset', 'Rigid Offsets', 'Off', 'Structure', 'Connects beam ends to their nodes through rigid arms. Each vector goes from the node to the member end, so the member is moved off the node line (eccentric connections, beams below a slab).',
  [P('Elements', 'element', 'Beam elements', { list: true, nick: 'E' }), vec('Start', 'Offset at the member start', v(), { u: 'len', nick: 'S' }), vec('End', 'Offset at the member end', v(), { u: 'len', nick: 'E' })], elemOut,
  ([els, s, e], ctx) => { const u = U(ctx); return [els.map((el: fm.ElementPart) => (el.kind !== 'beam' ? el : { ...el, offA: el.ci === 0 && len(s) > 0 ? toSI(s, u) : el.offA, offB: el.ci === el.cn - 1 && len(e) > 0 ? toSI(e, u) : el.offB }))]; });
C('fe.shell', 'Shell', 'Shell', 'Structure', 'Turns a surface or mesh into shell elements (quads use MITC4 bending with an enriched membrane; triangles use DKT bending with a constant-strain membrane). Quads are more accurate than triangles.',
  [P('Geometry', 'brep', 'Surface or mesh', { nick: 'G' }), num('Thickness', 'Shell thickness', 200, { u: 'dim', nick: 't' }), P('Material', 'material', 'Material', { d: fm.MATERIAL_PRESETS['Concrete C30/37'], nick: 'M' }), num('Size', 'Target element edge length (0 = use the mesh as it is, or 8 x 8 for a surface)', 0, { u: 'len', nick: 'h' }), txt('ID', 'Element ID', 'S', { nick: 'Id' }), bool('Triangles', 'Split quads into triangles', false, { nick: 'Tri' })], [...elemOut, P('Mesh', 'mesh', 'The mesh that was used', { nick: 'M' })],
  ([g, t, m, h, id, tri], ctx) => {
    const u = U(ctx);
    let mesh: ms.Mesh;
    if (sf.isSurface(g)) { const [lu, lv] = sf.srfSize(g); mesh = sf.surfaceToMesh(g, h > 0 ? Math.max(1, Math.ceil(lu / h)) : 8, h > 0 ? Math.max(1, Math.ceil(lv / h)) : 8); }
    else mesh = h > 0 ? ms.quadRemesh(toMesh(g), h) : toMesh(g);
    mesh = ms.weld(mesh, 1e-9);
    if (tri) mesh = ms.triangulate(mesh);
    if (!(t > 0)) throw new Error('Thickness must be positive');
    const si: ms.Mesh = { ...mesh, v: mesh.v.map(x => x * u.len.f) };
    return [shellsFromMesh(si, m, t * u.dim.f, id), mesh];
  }, { example: 'Plane Surface -> Shell (size 0.5) -> Assemble Model' });

// ======================================================================= Supports and loads
const supOut = [P('Support', 'support', 'The support', { nick: 'S' })];
C('fe.support', 'Support', 'Sup', 'Structure', 'Restrains a node. Conditions are text: "fixed" (all six), "pinned" (three translations), or a list such as "ux uz ry". A plane makes the conditions act in rotated axes.',
  [pt('Point', 'Position of the supported node', null, { nick: 'P' }), txt('Conditions', 'Restrained DOFs: fixed, pinned, or e.g. "ux uy uz rx"', 'fixed', { nick: 'C' }), P('Plane', 'plane', 'Optional rotated axes for the conditions', { opt: true, nick: 'Pl' })], supOut,
  ([p, c, pl], ctx) => [support(toSI(p, U(ctx)), parseDofs(c), { axes: (pl as Plane) ?? null })], { example: 'End points of columns -> Support "fixed"' });
C('fe.support.disp', 'Support Displacement', 'SupD', 'Structure', 'A support that imposes a displacement or rotation (settlement). The listed conditions are fixed at the given values.',
  [pt('Point', 'Position of the node', null, { nick: 'P' }), txt('Conditions', 'DOFs that are prescribed', 'ux uy uz', { nick: 'C' }), vec('Translation', 'Imposed displacement', v(0, 0, -10), { u: 'dim', nick: 'T' }), vec('Rotation', 'Imposed rotation in radians', v(), { nick: 'R' })], supOut,
  ([p, c, t, r], ctx) => { const u = U(ctx); return [support(toSI(p, u), parseDofs(c), { disp: [t.x * u.dim.f, t.y * u.dim.f, t.z * u.dim.f, r.x, r.y, r.z] })]; });
C('fe.support.spring', 'Spring Support', 'Spr', 'Structure', 'Linear elastic springs at a node, in global directions.',
  [pt('Point', 'Position of the node', null, { nick: 'P' }), vec('Stiffness', 'Translational stiffness in X, Y, Z', v(0, 0, 10000), { u: 'spring', nick: 'K' }), vec('Rotational', 'Rotational stiffness about X, Y, Z', v(), { u: 'rotSpring', nick: 'Kr' })], supOut,
  ([p, k, kr], ctx) => { const u = U(ctx); return [support(toSI(p, u), [false, false, false, false, false, false], { spring: [k.x * u.spring.f, k.y * u.spring.f, k.z * u.spring.f, kr.x * u.rotSpring.f, kr.y * u.rotSpring.f, kr.z * u.rotSpring.f] })]; }, { example: 'Elastic foundation under a column' });
const loadOut = [P('Load', 'load', 'The load', { nick: 'L' })];
C('fe.load.point', 'Point Load', 'PLoad', 'Structure', 'A force and/or moment on a node, in global axes.', [pt('Point', 'Position of the loaded node', null, { nick: 'P' }), vec('Force', 'Force vector', v(0, 0, -10), { u: 'force', nick: 'F' }), vec('Moment', 'Moment vector', v(), { u: 'moment', nick: 'M' }), lc()], loadOut,
  ([p, f, m, c], ctx) => { const u = U(ctx); return [pointLoad(toSI(p, u), scaleV(f, u.force.f), scaleV(m, u.moment.f), c)]; }, { example: 'Point Load (0, 0, -10) at the top chord nodes' });
C('fe.load.line', 'Line Load', 'LLoad', 'Structure', 'A distributed load on line elements. Give an end value for a linearly varying load. System: 0 = global axes per unit member length, 1 = member local axes, 2 = global per unit projected length (for example snow on plan).',
  [vec('Load', 'Load per unit length (at the member start)', v(0, 0, -5), { u: 'lineLoad', nick: 'w' }), P('End Load', 'vector', 'Optional load at the member end for a linear variation', { opt: true, u: 'lineLoad', nick: 'w2' }), ids(), int('System', '0 global, 1 local, 2 projected', 0, { nick: 'Sys' }), lc()], loadOut,
  ([w, w2, id, sys, c], ctx) => { const u = U(ctx); return [lineLoad(scaleV(w, u.lineLoad.f), scaleV(w2 ?? w, u.lineLoad.f), { ids: id?.length ? id.map(String) : null, sys: sys === 1 ? 'local' : sys === 2 ? 'projected' : 'global', lc: c })]; }, { example: 'Line Load (0, 0, -12) on elements with ID "beam"' });
C('fe.load.gravity', 'Self Weight', 'SW', 'Structure', 'The weight of all elements from their density and section. The vector is in multiples of g (default one g downward).', [vec('Direction', 'Gravity vector in multiples of g', v(0, 0, -1), { nick: 'g' }), lc()], loadOut, ([d, c]) => [gravityLoad(d, c)], { example: 'Self Weight in case "DL"' });
C('fe.load.temp', 'Temperature Load', 'Temp', 'Structure', 'Uniform temperature change and through-section gradients on line elements. A positive gradient means the +z (or +y) face is warmer.', [num('Change', 'Uniform temperature change', 30, { u: 'temp', nick: 'ΔT' }), num('Gradient Z', 'Temperature gradient across the depth', 0, { u: 'tempGrad', nick: 'gz' }), num('Gradient Y', 'Temperature gradient across the width', 0, { u: 'tempGrad', nick: 'gy' }), ids(), lc()], loadOut,
  ([dT, gz, gy, id, c], ctx) => { const u = U(ctx); return [tempLoad(dT * u.temp.f, gy * u.tempGrad.f, gz * u.tempGrad.f, id?.length ? id.map(String) : null, c)]; });
C('fe.load.area', 'Area Load', 'ALoad', 'Structure', 'Pressure on shell elements. Without a direction it acts along each element normal; with a direction it acts along that vector, per unit surface area or (Projected) per unit area seen along the direction.',
  [num('Pressure', 'Load per unit area', 5, { u: 'pressure', nick: 'p' }), P('Direction', 'vector', 'Optional load direction (default: element normal)', { opt: true, d: v(0, 0, -1), nick: 'D' }), bool('Projected', 'Measure the area perpendicular to the direction (snow-type load)', false, { nick: 'Pr' }), ids(), lc()], loadOut,
  ([p, d, pr, id, c], ctx) => { const u = U(ctx); return [pressureLoad(p * u.pressure.f, { dir: d ?? null, projected: pr, ids: id?.length ? id.map(String) : null, lc: c })]; }, { example: 'Area Load 5 downward on a slab' });
C('fe.load.mesh', 'Mesh Load', 'MLoad', 'Structure', 'Spreads a pressure acting on a load mesh (cladding, deck) to the structure: each mesh vertex gets its share of the face areas and passes it to the nearest structural node.',
  [P('Mesh', 'mesh', 'Loaded surface', { nick: 'M' }), vec('Pressure', 'Load vector per unit mesh area', v(0, 0, -1), { u: 'pressure', nick: 'p' }), lc()], [P('Loads', 'load', 'Point loads', { list: true, nick: 'L' })],
  ([m, p, c], ctx) => { const u = U(ctx), acc = new Map<number, number>(); for (const f of m.f) { const a = ms.faceArea(m, f) / f.length; for (const i of f) acc.set(i, (acc.get(i) ?? 0) + a); } return [[...acc.entries()].map(([i, a]) => ({ ...pointLoad(toSI(ms.mv(m, i), u), scaleV(p, u.pressure.f * a * u.len.f * u.len.f), v(), c), snap: true }))]; });
C('fe.load.combo', 'Load Combination', 'Combo', 'Structure', 'A factored combination of load cases, such as 1.2 DL + 1.6 LL.', [txt('Name', 'Name of the combination', 'ULS', { nick: 'N' }), P('Cases', 'text', 'Load case names', { list: true, nick: 'LC' }), P('Factors', 'number', 'One factor per case', { list: true, nick: 'F' })], loadOut,
  ([n, cs, fs]) => { const f: Record<string, number> = {}; cs.forEach((c: string, i: number) => { f[String(c)] = fs[Math.min(i, fs.length - 1)]; }); return [combo(n, f)]; }, { example: 'Cases DL, LL with factors 1.2, 1.6' });

// ======================================================================= Model and analyses
C('fe.assemble', 'Assemble Model', 'Model', 'Structure', 'Builds the structural model: elements are joined at nodes that coincide within the tolerance, and supports and loads are attached to the nodes they touch. All incoming data is used, whatever its tree structure.',
  [P('Elements', 'element', 'Line and shell elements', { tree: true, nick: 'E' }), P('Supports', 'support', 'Supports', { tree: true, nick: 'S' }), P('Loads', 'load', 'Loads and combinations', { tree: true, opt: true, nick: 'L' }), num('Tolerance', 'Distance below which nodes are merged', 0.001, { u: 'len', nick: 'Tol', tree: true })],
  [P('Model', 'model', 'The structural model', { nick: 'M' }), txt('Info', 'Summary and warnings', undefined, { list: true, nick: 'i' }), num('Mass', 'Total structural mass', undefined, { u: 'mass', nick: 'm' })], null,
  {
    example: 'Elements + Supports + Loads -> Assemble Model -> Linear Static',
    solveTrees: ([e, s, l, tol], ctx) => {
      const u = U(ctx), m = fm.buildModel(e.allItems() as fm.ElementPart[], s.allItems() as fm.SupportPart[], l.allItems() as fm.LoadPart[], Number(tol.first() ?? 0.001) * u.len.f);
      m.warnings.forEach(w => ctx.warn(w));
      return [DataTree.of(m), DataTree.fromList([m.summary, ...m.warnings]), DataTree.of(post.modelMass(m) / u.mass.f)];
    },
  });
const resOut = (extra: PortSpec[] = []) => [P('Result', 'result', 'Analysis result', { nick: 'R' }), ...extra, txt('Info', 'Solver statistics and messages', undefined, { list: true, nick: 'i' })];
const statsInfo = (r: FEResult): string[] => {
  const s = r.stats, eq = r.cases.map(c => `${c.name}: applied (${c.equilibrium.applied.map(x => (x / 1000).toFixed(3)).join(', ')}) kN, reactions (${c.equilibrium.reactions.map(x => (x / 1000).toFixed(3)).join(', ')}) kN, error ${c.equilibrium.relError.toExponential(1)}`);
  return [r.summary, `${s.nodes} nodes, ${s.lineElements} line + ${s.shellElements} shell elements, ${s.freeDofs} equations of ${s.dofs} DOF`, `Non-zeros: K ${s.nnzK}, factor ${s.nnzL} (${s.ordering})`, `Time: setup ${s.tAssemble.toFixed(0)} ms, factorization ${s.tFactor.toFixed(0)} ms, total ${s.tTotal.toFixed(0)} ms`, ...eq.map(e => 'Equilibrium ' + e), ...r.notes, ...r.messages];
};
async function analyze(model: fm.FEModel, options: any, ctx: SolveContext): Promise<FEResult> {
  const r = await runJob({ type: 'analysis', model, options }, ctx.cancelled) as FEResult;
  r.messages.forEach(m => ctx.warn(m));
  return r;
}
const maxDisp = (r: FEResult, u: UnitSystem) => Math.max(0, ...r.cases.map(c => post.maxDisplacement(c).value)) / u.dim.f;
C('fe.static', 'Linear Static', 'Static', 'Structure', 'Solves every load case with one factorization and builds the combinations by superposition. Reports the largest displacement and an equilibrium check.',
  [P('Model', 'model', 'Structural model', { nick: 'M' })], resOut([num('Max Displacement', 'Largest nodal displacement over all cases', undefined, { u: 'dim', nick: 'd' })]),
  async ([m], ctx) => { const r = await analyze(m, { kind: 'static' }, ctx); return [r, maxDisp(r, U(ctx)), statsInfo(r)]; }, { example: 'Assemble Model -> Linear Static -> Result View' });
C('fe.second', 'Second-Order Analysis', '2nd', 'Structure', 'Equilibrium on the deformed structure through the geometric stiffness (P-Δ and P-δ), iterated until the displacements settle. Use several elements per member to capture member curvature effects.',
  [P('Model', 'model', 'Structural model', { nick: 'M' }), txt('Load Set', 'Load case or combination (empty = all combinations, or all cases)', '', { opt: true, nick: 'LC' })], resOut([num('Max Displacement', 'Largest nodal displacement', undefined, { u: 'dim', nick: 'd' })]),
  async ([m, set], ctx) => { const r = await analyze(m, { kind: 'second-order', loadSet: set || undefined }, ctx); return [r, maxDisp(r, U(ctx)), statsInfo(r)]; });
C('fe.buckling', 'Buckling Analysis', 'Buckl', 'Structure', 'Linear (eigenvalue) buckling: the factors by which the chosen load set must be multiplied to reach elastic instability, with the buckled shapes.',
  [P('Model', 'model', 'Structural model', { nick: 'M' }), txt('Load Set', 'Load case or combination (empty = first combination, or first case)', '', { opt: true, nick: 'LC' }), int('Modes', 'Number of modes', 4, { nick: 'n' })], resOut([P('Factors', 'number', 'Buckling load factors, lowest first', { list: true, nick: 'λ' })]),
  async ([m, set, n], ctx) => { const r = await analyze(m, { kind: 'buckling', loadSet: set || undefined, modes: Math.max(1, n) }, ctx); return [r, r.modes.map(x => x.value), statsInfo(r)]; }, { example: 'Column -> Buckling Analysis -> first factor' });
C('fe.modal', 'Modal Analysis', 'Modal', 'Structure', 'Natural frequencies and mode shapes from the stiffness and the mass of the elements.',
  [P('Model', 'model', 'Structural model', { nick: 'M' }), int('Modes', 'Number of modes', 6, { nick: 'n' }), bool('Consistent', 'Consistent mass matrix (off = lumped)', true, { nick: 'C' })], resOut([P('Frequencies', 'number', 'Natural frequencies in Hz, lowest first', { list: true, u: 'freq', nick: 'f' }), P('Periods', 'number', 'Periods in seconds', { list: true, nick: 'T' })]),
  async ([m, n, cons], ctx) => { const r = await analyze(m, { kind: 'modal', modes: Math.max(1, n), consistentMass: cons }, ctx); return [r, r.modes.map(x => x.value), r.modes.map(x => 1 / x.value), statsInfo(r)]; }, { example: 'Tower -> Modal Analysis -> first period' });
C('fe.nonlinear', 'Nonlinear Analysis', 'NL', 'Structure', 'Large-displacement analysis for cable and truss members (Newton–Raphson with load steps, or arc-length to pass limit points). Frame and shell elements stay geometrically linear in this analysis.',
  [P('Model', 'model', 'Structural model', { nick: 'M' }), txt('Load Set', 'Load case or combination (empty = all combinations, or all cases)', '', { opt: true, nick: 'LC' }), int('Steps', 'Number of load steps', 5, { nick: 'n' }), bool('Arc Length', 'Follow the path with the arc-length method (for snap-through)', false, { nick: 'Arc' })], resOut([num('Max Displacement', 'Largest nodal displacement', undefined, { u: 'dim', nick: 'd' }), P('Path', 'text', 'Load factor and displacement norm at each step', { list: true, nick: 'P' })]),
  async ([m, set, n, arc], ctx) => { const r = await analyze(m, { kind: 'nonlinear', loadSet: set || undefined, steps: Math.max(1, n), arcLength: arc }, ctx); return [r, maxDisp(r, U(ctx)), (r.path ?? []).map(p => `${p[0].toFixed(4)}, ${p[1].toExponential(4)}`), statsInfo(r)]; }, { example: 'Cable net -> Nonlinear Analysis' });
C('fe.sizing', 'Section Sizing', 'Size', 'Structure', 'Picks, for each group of members with the same ID, the lightest section from a list that keeps the simplified stress utilization under the target, repeating the analysis until the choice settles. A sizing aid, not a design-code check.',
  [P('Model', 'model', 'Structural model', { nick: 'M' }), P('Sections', 'section', 'Candidate sections', { list: true, nick: 'S' }), num('Target', 'Largest allowed utilization', 1, { nick: 'U' }), int('Passes', 'Largest number of analysis passes', 10, { nick: 'n' })],
  [P('Model', 'model', 'Model with the chosen sections', { nick: 'M' }), P('Result', 'result', 'Linear static result of the sized model', { nick: 'R' }), num('Mass', 'Structural mass', undefined, { u: 'mass', nick: 'm' }), num('Utilization', 'Largest utilization', undefined, { nick: 'U' }), txt('Log', 'What happened in each pass', undefined, { list: true, nick: 'i' })],
  async ([m, s, t, n], ctx) => { const r = await runJob({ type: 'sizing', model: m, sections: s, target: t, maxIter: Math.max(1, n) }, ctx.cancelled) as SizingResult; return [r.model, r.result, r.mass / U(ctx).mass.f, r.maxUtil, r.log]; }, { example: 'Truss + list of tubes -> Section Sizing -> Mass' });

// ======================================================================= Results
const resIn = () => P('Result', 'result', 'Analysis result', { nick: 'R' });
const caseIn = () => txt('Case', 'Load case or combination name (empty = first)', '', { opt: true, nick: 'LC' });
const fromSI = (p: V3, u: UnitSystem): V3 => mul(p, 1 / u.len.f);
export const VIEW_DEFAULTS = { caseIndex: 0, scale: -1, deformed: true, undeformed: true, diagram: 'none', contour: 'none', layer: 'top', reactions: true, loads: true, supports: true, utilization: false, mode: 0, animate: false, values: true, sections: true, localAxes: false, principal: false };
C('fe.view', 'Result View', 'View', 'Structure', 'Shows a result in the 3D view: deformed shape, member diagrams, shell contours, reactions and utilization. Choose what to show in the inspector.',
  [resIn()], [P('View', 'geometry', 'The display object', { nick: 'V' })], ([r], ctx) => [{ k: 'feview', result: r, opts: { ...VIEW_DEFAULTS, ...ctx.node.state }, summary: `View of ${r.summary}` }], { state: { ...VIEW_DEFAULTS }, example: 'Linear Static -> Result View, then pick "My" diagrams in the inspector' });
C('fe.res.disp', 'Nodal Displacements', 'Disp', 'Structure', 'Displacements and rotations of all nodes for one load case.', [resIn(), caseIn()],
  [P('Nodes', 'point', 'Node positions', { list: true, nick: 'P' }), P('Translations', 'vector', 'Displacement vectors', { list: true, u: 'dim', nick: 'U' }), P('Rotations', 'vector', 'Rotation vectors in radians', { list: true, nick: 'R' }), num('Max', 'Largest displacement', undefined, { u: 'dim' })],
  ([r, c], ctx) => { const u = U(ctx), cr = (r as FEResult).cases[post.caseIndex(r, c)]; if (!cr) throw new Error('This result has no load cases (modal results only contain modes)'); const n = fm.nodeCount(r.model), P0: V3[] = [], T: V3[] = [], R: V3[] = []; for (let i = 0; i < n; i++) { P0.push(fromSI(fm.nodeXYZ(r.model, i), u)); T.push(v(cr.u[6 * i] / u.dim.f, cr.u[6 * i + 1] / u.dim.f, cr.u[6 * i + 2] / u.dim.f)); R.push(v(cr.u[6 * i + 3], cr.u[6 * i + 4], cr.u[6 * i + 5])); } return [P0, T, R, post.maxDisplacement(cr).value / u.dim.f]; }, { noPreview: true, example: 'Max output -> optimizer fitness' });
C('fe.res.at', 'Displacement At Point', 'DispPt', 'Structure', 'Displacement of the node nearest to a point.', [resIn(), pt('Point', 'Where to read the displacement', null, { nick: 'P' }), caseIn()], [P('Translation', 'vector', 'Displacement vector', { u: 'dim', nick: 'U' }), P('Rotation', 'vector', 'Rotation vector in radians', { nick: 'R' }), num('Magnitude', 'Size of the displacement', undefined, { u: 'dim', nick: 'd' })],
  ([r, p, c], ctx) => { const u = U(ctx), cr = (r as FEResult).cases[post.caseIndex(r, c)], n = post.nearestNode(r.model, toSI(p, u)), d = post.nodeDisp(cr, n); return [v(d[0] / u.dim.f, d[1] / u.dim.f, d[2] / u.dim.f), v(d[3], d[4], d[5]), Math.hypot(d[0], d[1], d[2]) / u.dim.f]; }, { noPreview: true, example: 'Midspan deflection of a bridge' });
C('fe.res.react', 'Reactions', 'React', 'Structure', 'Support reactions for one load case, with the equilibrium check (sum of reactions against sum of applied loads).', [resIn(), caseIn()],
  [P('Points', 'point', 'Support positions', { list: true, nick: 'P' }), P('Forces', 'vector', 'Reaction forces', { list: true, u: 'force', nick: 'F' }), P('Moments', 'vector', 'Reaction moments', { list: true, u: 'moment', nick: 'M' }), P('Sum', 'vector', 'Sum of the reaction forces', { u: 'force', nick: 'ΣF' }), P('Applied', 'vector', 'Sum of the applied loads', { u: 'force', nick: 'ΣP' }), num('Error', 'Equilibrium error relative to the total load', undefined, { nick: 'err' })],
  ([r, c], ctx) => { const u = U(ctx), cr = (r as FEResult).cases[post.caseIndex(r, c)], Pp: V3[] = [], F: V3[] = [], M: V3[] = []; for (const s of (r as FEResult).model.supports) { const q = post.nodeReaction(cr, s.node); Pp.push(fromSI(fm.nodeXYZ(r.model, s.node), u)); F.push(v(q[0] / u.force.f, q[1] / u.force.f, q[2] / u.force.f)); M.push(v(q[3] / u.moment.f, q[4] / u.moment.f, q[5] / u.moment.f)); } const e = cr.equilibrium; return [Pp, F, M, v(e.reactions[0] / u.force.f, e.reactions[1] / u.force.f, e.reactions[2] / u.force.f), v(e.applied[0] / u.force.f, e.applied[1] / u.force.f, e.applied[2] / u.force.f), e.relError]; }, { noPreview: true });
C('fe.res.forces', 'Member Forces', 'MForces', 'Structure', 'Internal forces along every line element at equally spaced stations: one branch per element. N is positive in tension; My is positive for sagging (tension on the -z side).', [resIn(), caseIn(), int('Stations', 'Number of intervals along each element', 4, { nick: 'n' })],
  [P('N', 'number', 'Axial force', { tree: true, u: 'force' }), P('Vy', 'number', 'Shear force along local y', { tree: true, u: 'force' }), P('Vz', 'number', 'Shear force along local z', { tree: true, u: 'force' }), P('T', 'number', 'Torque', { tree: true, u: 'moment' }), P('My', 'number', 'Bending moment about local y', { tree: true, u: 'moment' }), P('Mz', 'number', 'Bending moment about local z', { tree: true, u: 'moment' }), P('IDs', 'text', 'Element IDs', { tree: true, nick: 'Id' })], null,
  { noPreview: true, solveTrees: ([rt, ct, nt], ctx) => { const r = rt.first() as FEResult, u = U(ctx), cr = r.cases[post.caseIndex(r, ct.first() as string)], n = Math.max(1, Number(nt.first() ?? 4)); const outs = Array.from({ length: 7 }, () => new DataTree<any>()); const f = [u.force.f, u.force.f, u.force.f, u.moment.f, u.moment.f, u.moment.f]; r.model.beams.forEach((b, e) => { const st = post.memberStations(r.model, cr, e, n); for (let k = 0; k < 6; k++) outs[k].add([e], st.f.map(x => x[k] / f[k])); outs[6].add([e], [b.id]); }); return outs; }, example: 'Member Forces -> Bounds -> largest moment' });
C('fe.res.envelope', 'Force Envelope', 'Env', 'Structure', 'The smallest and largest value of one internal force in every line element, over all load combinations (or over all load cases when the model has no combinations). Force: N, Vy, Vz, T, My or Mz.', [resIn(), txt('Force', 'Which force: N, Vy, Vz, T, My or Mz', 'My', { nick: 'F' })],
  [P('Min', 'number', 'Smallest value in each element', { list: true }), P('Max', 'number', 'Largest value in each element', { list: true }), num('Lowest', 'Smallest value in the model', undefined, { nick: 'lo' }), num('Highest', 'Largest value in the model', undefined, { nick: 'hi' }), P('IDs', 'text', 'Element IDs', { list: true, nick: 'Id' })],
  ([r, f], ctx) => { const res = r as FEResult, k = ['N', 'Vy', 'Vz', 'T', 'My', 'Mz'].indexOf(String(f)); if (k < 0) throw new Error('Force must be one of N, Vy, Vz, T, My, Mz'); if (!res.cases.length) throw new Error('This result has no load cases'); const u = U(ctx), fac = k < 3 ? u.force.f : u.moment.f, cases = res.model.combos.length ? res.cases.slice(res.model.cases.length) : res.cases; const env = res.model.beams.map((_, e) => post.memberEnvelope(res.model, cases, e)); const mn = env.map(x => x.min[k] / fac), mx = env.map(x => x.max[k] / fac); return [mn, mx, Math.min(...mn), Math.max(...mx), res.model.beams.map(b => b.id)]; }, { noPreview: true, example: 'Envelope of My over all combinations for member design' });
C('fe.res.axial', 'Axial Forces', 'Axial', 'Structure', 'One axial force per line element (average of both ends), tension positive. Handy for trusses.', [resIn(), caseIn()], [P('N', 'number', 'Axial forces', { list: true, u: 'force' }), P('Lines', 'curve', 'Element axes, in the same order', { list: true, nick: 'L' }), P('IDs', 'text', 'Element IDs', { list: true, nick: 'Id' })],
  ([r, c], ctx) => { const u = U(ctx), cr = (r as FEResult).cases[post.caseIndex(r, c)], m = (r as FEResult).model; return [m.beams.map((_, e) => (cr.beamQ[12 * e + 6] - cr.beamQ[12 * e]) / 2 / u.force.f), m.beams.map(b => cv.line(fromSI(fm.nodeXYZ(m, b.n[0]), u), fromSI(fm.nodeXYZ(m, b.n[1]), u))), m.beams.map(b => b.id)]; }, { noPreview: true, example: 'Color truss members by tension and compression' });
C('fe.res.util', 'Utilization', 'Util', 'Structure', 'Simplified elastic stress utilization of line elements: (|N|/A + |My|/Wy + |Mz|/Wz) / strength, the worst station of each element. It ignores buckling, shear and all code factors and is not a design-code check.', [resIn(), caseIn()],
  [P('Utilization', 'number', 'Utilization of each element (1 = at the strength)', { list: true, nick: 'U' }), num('Max', 'Largest utilization'), P('Stress', 'number', 'Largest normal stress in each element', { list: true, u: 'stress', nick: 'σ' }), num('Mass', 'Structural mass', undefined, { u: 'mass', nick: 'm' })],
  ([r, c], ctx) => { const u = U(ctx), res = r as FEResult; const list = c ? [res.cases[post.caseIndex(res, c)]] : res.cases; if (!list.length) throw new Error('This result has no load cases'); const ut = res.model.beams.map((_, e) => { let best = { util: 0, sigma: 0, N: 0 }; for (const cr of list) { const x = post.memberUtilization(res.model, cr, e); if (x.util > best.util) best = x; } return best; }); return [ut.map(x => x.util), Math.max(0, ...ut.map(x => x.util)), ut.map(x => x.sigma / u.stress.f), post.modelMass(res.model) / u.mass.f]; }, { noPreview: true, example: 'Max utilization as a constraint in optimization' });
C('fe.res.shell', 'Shell Results', 'ShRes', 'Structure', 'One value per shell element at its center. Quantity: vonMises, s1, s2 (surface stresses), N1, N2, Nx, Ny, Nxy (membrane forces), M1, M2, Mx, My, Mxy (moments), Qx, Qy (shears), disp. Layer: top, mid or bottom.', [resIn(), caseIn(), txt('Quantity', 'What to read', 'vonMises', { nick: 'Q' }), txt('Layer', 'top, mid or bottom', 'top', { nick: 'L' })],
  [P('Values', 'number', 'Value in each shell element', { list: true, nick: 'V' }), P('Centers', 'point', 'Element centers', { list: true, nick: 'P' }), num('Max', 'Largest value'), num('Min', 'Smallest value')],
  ([r, c, q, layer], ctx) => { const u = U(ctx), res = r as FEResult, cr = res.cases[post.caseIndex(res, c)]; const stress = ['vonMises', 's1', 's2'].includes(q), force = /^N|^Q/.test(q), mom = /^M/.test(q); const f = stress ? u.stress.f : force ? u.forcePerLen.f : mom ? u.momentPerLen.f : u.dim.f; if (!res.model.shells.length) throw new Error('The model has no shell elements'); const vals = res.model.shells.map((_, s) => post.shellElementValue(res.model, cr, s, q, layer) / f); const cen = res.model.shells.map(s => { let o = v(); for (const n of s.n) o = add(o, fm.nodeXYZ(res.model, n)); return fromSI(mul(o, 1 / s.n.length), u); }); return [vals, cen, Math.max(...vals), Math.min(...vals)]; }, { noPreview: true });
C('fe.res.deformed', 'Deformed Geometry', 'Deform', 'Structure', 'The deformed structure as geometry (member curves and shell mesh) for use further down the graph.', [resIn(), caseIn(), num('Scale', 'Displacement magnification', 1, { nick: 's' })], [P('Curves', 'curve', 'Deformed member axes', { list: true, nick: 'C' }), P('Mesh', 'mesh', 'Deformed shell mesh', { nick: 'M' })],
  ([r, c, s], ctx) => { const u = U(ctx), res = r as FEResult, cr = res.cases[post.caseIndex(res, c)], m = res.model; const curves = m.beams.map((_, e) => cv.polyline(Array.from({ length: 9 }, (_, i) => fromSI(post.memberDeflected(m, cr, e, i / 8, s), u)))); let mesh: ms.Mesh | null = null; if (m.shells.length) { const pts = Array.from({ length: fm.nodeCount(m) }, (_, i) => fromSI(add(fm.nodeXYZ(m, i), v(s * cr.u[6 * i], s * cr.u[6 * i + 1], s * cr.u[6 * i + 2])), u)); mesh = ms.meshFromPointsFaces(pts, m.shells.map(sh => sh.n)); } return [curves, mesh]; });
C('fe.res.modes', 'Modes', 'Modes', 'Structure', 'The values (frequencies in Hz or buckling load factors) and labels of the modes in a modal or buckling result.', [resIn()], [P('Values', 'number', 'Frequency or load factor of each mode', { list: true, nick: 'V' }), P('Labels', 'text', 'Description of each mode', { list: true, nick: 'L' })], ([r]) => [(r as FEResult).modes.map(m => m.value), (r as FEResult).modes.map(m => m.label)], { noPreview: true });
C('fe.res.table', 'Result Table', 'Table', 'Structure', 'A table of results as CSV text (first row is the header). Table: 0 nodal displacements, 1 reactions, 2 member end forces, 3 shell stress resultants. Connect it to a Panel, or use the result tables in the inspector.', [resIn(), caseIn(), int('Table', '0 displacements, 1 reactions, 2 member forces, 3 shells', 0, { nick: 'T' })], [P('Rows', 'text', 'CSV rows', { list: true, nick: 'R' })],
  ([r, c, t], ctx) => [resultTable(r, post.caseIndex(r, c), t, U(ctx)).map(row => row.join(', '))], { noPreview: true });
/** Result tables shared by the Result Table component, the inspector and CSV export. */
export function resultTable(r: FEResult, ci: number, table: number, u: UnitSystem): (string | number)[][] {
  const cr = r.cases[ci], m = r.model, g = (x: number) => parseFloat(x.toPrecision(6));
  if (!cr) return [['Mode', r.kind === 'modal' ? 'Frequency [Hz]' : 'Load factor'], ...r.modes.map((md, i) => [i + 1, g(md.value)])];
  if (table === 1) return [['Node', `X [${u.len.label}]`, `Y [${u.len.label}]`, `Z [${u.len.label}]`, `Fx [${u.force.label}]`, `Fy [${u.force.label}]`, `Fz [${u.force.label}]`, `Mx [${u.moment.label}]`, `My [${u.moment.label}]`, `Mz [${u.moment.label}]`],
    ...m.supports.map(s => { const p = fm.nodeXYZ(m, s.node), q = post.nodeReaction(cr, s.node); return [s.node, g(p.x / u.len.f), g(p.y / u.len.f), g(p.z / u.len.f), ...q.slice(0, 3).map(x => g(x / u.force.f)), ...q.slice(3).map(x => g(x / u.moment.f))]; })];
  if (table === 2) return [['Element', 'ID', 'End', `N [${u.force.label}]`, `Vy [${u.force.label}]`, `Vz [${u.force.label}]`, `T [${u.moment.label}]`, `My [${u.moment.label}]`, `Mz [${u.moment.label}]`, 'Utilization'],
    ...m.beams.flatMap((b, e) => { const L = post.kinOf(m, e).L, ut = post.memberUtilization(m, cr, e).util; return [0, L].map((x, k) => { const f = post.memberForces(m, cr, e, x); return [e, b.id, k ? 'end' : 'start', ...f.slice(0, 3).map(q => g(q / u.force.f)), ...f.slice(3).map(q => g(q / u.moment.f)), g(ut)]; }); })];
  if (table === 3) return [['Shell', 'ID', `Nx [${u.forcePerLen.label}]`, `Ny [${u.forcePerLen.label}]`, `Nxy [${u.forcePerLen.label}]`, `Mx [${u.momentPerLen.label}]`, `My [${u.momentPerLen.label}]`, `Mxy [${u.momentPerLen.label}]`, `von Mises top [${u.stress.label}]`, `von Mises bottom [${u.stress.label}]`],
    ...m.shells.map((s, i) => [i, s.id, ...[0, 1, 2].map(k => g(cr.shellS[8 * i + k] / u.forcePerLen.f)), ...[3, 4, 5].map(k => g(cr.shellS[8 * i + k] / u.momentPerLen.f)), g(post.shellElementValue(m, cr, i, 'vonMises', 'top') / u.stress.f), g(post.shellElementValue(m, cr, i, 'vonMises', 'bottom') / u.stress.f)])];
  return [['Node', `X [${u.len.label}]`, `Y [${u.len.label}]`, `Z [${u.len.label}]`, `ux [${u.dim.label}]`, `uy [${u.dim.label}]`, `uz [${u.dim.label}]`, 'rx [rad]', 'ry [rad]', 'rz [rad]'],
    ...Array.from({ length: fm.nodeCount(m) }, (_, n) => { const p = fm.nodeXYZ(m, n), d = post.nodeDisp(cr, n); return [n, g(p.x / u.len.f), g(p.y / u.len.f), g(p.z / u.len.f), ...d.slice(0, 3).map(x => g(x / u.dim.f)), ...d.slice(3).map(g)]; })];
}

// ======================================================================= Form-finding
const lineList = () => P('Lines', 'curve', 'Network of lines (cables, mesh edges, grid members)', { list: true, nick: 'L' });
const netOuts = [P('Lines', 'curve', 'Lines in their equilibrium position', { list: true, nick: 'L' }), P('Points', 'point', 'Node positions', { list: true, nick: 'P' }), P('Forces', 'number', 'Force in each line (tension positive, in the units implied by the inputs)', { list: true, nick: 'F' })];
const asLines = (cs: cv.Curve[]) => cs.flatMap(c => cv.explodeCurve(c)).map(c => ({ a: cv.curveStart(c), b: cv.curveEnd(c) }));
const perNode = (loads: V3[] | undefined, n: number, fixed: boolean[]): V3[] => Array.from({ length: n }, (_, i) => (fixed[i] || !loads?.length ? v() : loads[Math.min(i, loads.length - 1)]));
C('ff.fdm', 'Force Density', 'FDM', 'Form-Finding', 'Finds the equilibrium shape of a cable or bar network with the force density method: each line gets a force density q = force / length, and the node positions follow from a linear system. Anchors stay where they are.',
  [lineList(), P('Anchors', 'point', 'Fixed points', { list: true, nick: 'A' }), P('Density', 'number', 'Force density of each line (one value for all, or a list)', { list: true, d: [1], nick: 'q' }), P('Load', 'vector', 'Load on each free node (one vector for all, or a list in node order)', { list: true, d: [v(0, 0, 0)], nick: 'P' }), num('Tolerance', 'Distance below which line ends are treated as one node', 1e-4, { nick: 'Tol' })],
  [...netOuts, num('Residual', 'Largest out-of-balance force', undefined, { nick: 'r' })],
  ([ls, an, q, ld, tol]) => { const net = buildNet(asLines(ls), an, tol); if (!net.fixed.some(Boolean)) throw new Error('No anchor touches the network. Anchors must lie on line ends.'); const qs = net.edges.map((_, k) => q[Math.min(k, q.length - 1)]), pts = forceDensity(net, qs, perNode(ld, net.pts.length, net.fixed)); return [net.edges.map(([a, b]) => cv.line(pts[a], pts[b])), pts, net.edges.map(([a, b], k) => qs[k] * dist(pts[a], pts[b])), 0]; }, { example: 'Flat cable net + raised anchors -> Force Density' });
C('ff.dr', 'Dynamic Relaxation', 'DR', 'Form-Finding', 'Relaxes a network of elastic lines to equilibrium under loads (dynamic relaxation with kinetic damping). Rest length factor < 1 pretensions the lines; target lengths override it. Use it for cable nets, membranes modeled by their mesh edges, and hanging-chain gridshells (apply the load upward).',
  [lineList(), P('Anchors', 'point', 'Fixed points', { list: true, nick: 'A' }), P('Load', 'vector', 'Load on each free node (one vector for all, or a list)', { list: true, d: [v(0, 0, 0)], nick: 'P' }), P('Stiffness', 'number', 'Axial stiffness EA of the lines (one value or a list)', { list: true, d: [1000], nick: 'EA' }), P('Rest Factor', 'number', 'Rest length as a fraction of the drawn length (one value or a list)', { list: true, d: [1], nick: 'k' }), P('Target Lengths', 'number', 'Optional rest lengths that replace the factor', { list: true, opt: true, nick: 'L0' }), bool('Tension Only', 'Lines go slack instead of taking compression', false, { nick: 'T' }), num('Anchor Spring', 'Optional spring stiffness holding free nodes near their start position', 0, { nick: 'ks' }), int('Iterations', 'Largest number of iterations', 20000, { nick: 'n' }), num('Tolerance', 'Residual force relative to the largest force', 1e-6, { nick: 'Tol' })],
  [...netOuts, int('Iterations', 'Iterations used', undefined, { nick: 'i' }), num('Residual', 'Largest out-of-balance force', undefined, { nick: 'r' })],
  ([ls, an, ld, ea, rf, tl, to, ks, it, tol], ctx) => {
    const net = buildNet(asLines(ls), an, 1e-6);
    if (!net.fixed.some(Boolean) && !(ks > 0)) throw new Error('No anchor touches the network. Anchors must lie on line ends.');
    const rest = net.edges.map(([a, b], k) => (tl?.length ? tl[Math.min(k, tl.length - 1)] : rf[Math.min(k, rf.length - 1)] * dist(net.pts[a], net.pts[b])));
    const r = dynamicRelaxation(net, { stiffness: net.edges.map((_, k) => ea[Math.min(k, ea.length - 1)]), rest, loads: perNode(ld, net.pts.length, net.fixed), tensionOnly: to, anchorSpring: ks, maxIter: it, tol, cancelled: ctx.cancelled });
    if (!r.converged) ctx.warn(`Not converged after ${r.iterations} iterations (residual ${r.residual.toExponential(2)}). Increase the iteration limit or check that the network can carry the load.`);
    return [net.edges.map(([a, b]) => cv.line(r.pts[a], r.pts[b])), r.pts, r.forces, r.iterations, r.residual];
  }, { example: 'Grid of lines + upward load + corner anchors -> gridshell shape' });

// ======================================================================= Optimization, script, clusters
C('opt.evolve', 'Evolutionary Optimizer', 'Evolve', 'Optimization', 'Searches slider values that minimize (or maximize) a number. Select this component, choose the sliders it may change in the inspector, then press Run. Uses a genetic algorithm with an optional local search, and keeps the best designs so any of them can be reinstated.',
  [num('Fitness', 'The number to minimize or maximize', undefined, { nick: 'F' })], [num('Fitness', 'The current fitness value', undefined, { nick: 'F' })], ([f]) => [f],
  { widget: 'optimizer', state: { genes: [], population: 20, generations: 15, maximize: false, localSearch: true, seed: 1, history: [], top: [] }, width: 200, noPreview: true, example: 'Mass + penalty -> Fitness; sliders for depth and width as genes' });

/** Helper functions available inside user scripts for building geometry values. */
export const SCRIPT_PRELUDE = 'const pt = (x, y, z = 0) => ({ x, y, z }); const line = (a, b) => ({ k: "line", a, b }); const polyline = (pts, closed = false) => ({ k: "polyline", pts, closed });';
/** Sandboxed script execution is installed by the app (a worker); tests may install their own. */
export type ScriptRunner = (code: string, inputs: Record<string, any>, outputs: string[], cancelled: () => boolean) => Promise<Record<string, any>>;
let scriptRunner: ScriptRunner = async () => { throw new Error('The script sandbox is not available in this environment'); };
export function setScriptRunner(r: ScriptRunner): void { scriptRunner = r; }
const names = (s: any, d: string[]) => { const l = String(s ?? '').split(/[,\s]+/).filter(x => /^[A-Za-z_][A-Za-z0-9_]*$/.test(x)); return l.length ? l : d; };
C('script.js', 'Script', 'JS', 'Script', 'Runs your own JavaScript in a sandboxed worker (no page, storage or network access). Inputs are available as variables holding the whole list for each branch; assign your results to the output variables. Helpers: pt(x, y, z), line(a, b), polyline(points, closed). Edit the code and the port names in the inspector.',
  [], [], async (ins, ctx) => {
    const st = ctx.node.state, inN = names(st.inputs, ['a', 'b']), outN = names(st.outputs, ['result']);
    const data: Record<string, any> = {};
    inN.forEach((n, i) => { data[n] = ins[i] ?? []; });
    const res = await scriptRunner(String(st.code ?? ''), data, outN, ctx.cancelled);
    return outN.map(n => { const r = res[n]; return r === undefined || r === null ? [] : Array.isArray(r) ? r : [r]; });
  }, {
    state: { code: '// Inputs: a, b (arrays). Assign outputs.\nresult = a.map((x, i) => x + (b[i] ?? b[b.length - 1] ?? 0));', inputs: 'a, b', outputs: 'result' }, width: 150, example: 'Custom formula over lists',
    ports: (node: NodeData) => ({ inputs: names(node.state.inputs, ['a', 'b']).map(n => P(n, 'any', `Input "${n}" (the list of items in each branch)`, { list: true, opt: true, nick: n })), outputs: names(node.state.outputs, ['result']).map(n => P(n, 'any', `Output "${n}"`, { list: true, nick: n })) }),
  });

const clusterPorts = (node: NodeData, project: ProjectFile) => {
  const def = project.clusters[node.state.clusterId], ins: PortSpec[] = [], outs: PortSpec[] = [];
  for (const n of def?.graph.nodes ?? []) {
    if (n.type === 'cluster.in') ins.push(P(n.state.name || 'In', 'any', 'Cluster input', { tree: true, opt: true }));
    if (n.type === 'cluster.out') outs.push(P(n.state.name || 'Out', 'any', 'Cluster output', { tree: true }));
  }
  return { inputs: ins, outputs: outs };
};
C('cluster', 'Cluster', 'Cluster', 'Script', 'A reusable group of components with its own inputs and outputs. Make one by selecting components and choosing Cluster in the right-click menu; saved clusters appear in the component list.',
  [], [], null, { state: { clusterId: '' }, ports: clusterPorts, width: 150, solveTrees: async (trees, ctx) => {
    const def = ctx.project.clusters[ctx.node.state.clusterId];
    if (!def) throw new Error('This cluster definition is missing from the project');
    const { inputs, outputs } = clusterPorts(ctx.node, ctx.project), data: Record<string, DataTree> = {};
    inputs.forEach((p, i) => { data[p.name] = trees[i]; });
    const res = await ctx.runSubgraph(def.graph, data);
    return outputs.map(p => res[p.name] ?? new DataTree());
  } });
C('cluster.in', 'Cluster Input', 'In', 'Script', 'An input of the cluster it sits in. Its name becomes the port name.', [], [P('Data', 'any', 'Data arriving at the cluster input', { tree: true, nick: 'D' })], null,
  { state: { name: 'In' }, widget: 'text', width: 120, noPreview: true, solveTrees: (_t, ctx) => [((ctx as any).clusterInputs?.[ctx.node.state.name || 'In'] as DataTree) ?? new DataTree()] });
C('cluster.out', 'Cluster Output', 'Out', 'Script', 'An output of the cluster it sits in. Its name becomes the port name.', [P('Data', 'any', 'Data to send out of the cluster', { tree: true, opt: true, nick: 'D' })], [], null, { state: { name: 'Out' }, widget: 'text', width: 120, noPreview: true, solveTrees: () => [] });

export { registry, formatValue, sub, Z, O };
