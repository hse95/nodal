/**
 * Structural model data: materials, cross-sections, the geometry-level parts
 * produced by graph components, and the node/element model the solver works on.
 *
 * Internal units are strict SI: N, m, kg, s, K (so stresses are Pa and moments
 * N*m). Conversion to the display system happens only at component inputs and
 * outputs (see units.ts).
 *
 * Local member axes
 *   x  from the start node to the end node.
 *   z  the "up" direction of the cross-section: global Z made perpendicular to
 *      x (for vertical members: y = global Y instead). A reference vector, if
 *      given, replaces global Z. The pair (y, z) is then rotated about x by
 *      the orientation angle (right-hand rule).
 *   y  = z cross x, so (x, y, z) is right-handed.
 *   Iy is the second moment of area for bending about y (deflection along z),
 *   so for a beam under gravity Iy is the strong-axis value.
 */
import { V3, v, sub, unit, cross, dot, len, mul, add, xPoint, xRotate, Plane } from '../geom/vec';

export interface Material {
  k: 'material'; name: string;
  E: number;      // Young's modulus [Pa]
  G: number;      // shear modulus [Pa]
  nu: number;     // Poisson's ratio [-]
  rho: number;    // density [kg/m3]
  fy: number;     // yield / characteristic strength used for the simplified utilization [Pa]
  alpha: number;  // coefficient of thermal expansion [1/K]
}
export interface Section {
  k: 'section'; name: string;
  A: number;      // area [m2]
  Iy: number;     // second moment about local y [m4]
  Iz: number;     // second moment about local z [m4]
  J: number;      // St. Venant torsion constant [m4]
  Asy: number;    // shear area for shear along y [m2]
  Asz: number;    // shear area for shear along z [m2]
  cy: number;     // extreme-fiber distance along y [m]
  cz: number;     // extreme-fiber distance along z [m]
  /** Outline used to draw the section in 3D: polygon(s) in (y, z). */
  shape?: { outer: number[][]; inner?: number[][] };
}
export const sectionModuli = (s: Section): { Wy: number; Wz: number } => ({ Wy: s.cz > 0 ? s.Iy / s.cz : 0, Wz: s.cy > 0 ? s.Iz / s.cy : 0 });

export function material(name: string, E: number, nu: number, rho: number, fy: number, alpha: number, G?: number): Material {
  return { k: 'material', name, E, nu, rho, fy, alpha, G: G ?? E / (2 * (1 + nu)) };
}
/** Typical values for preliminary work; always replace with project-specific data. */
export const MATERIAL_PRESETS: Record<string, Material> = {
  'Steel S355': material('Steel S355', 210e9, 0.3, 7850, 355e6, 1.2e-5),
  'Steel S235': material('Steel S235', 210e9, 0.3, 7850, 235e6, 1.2e-5),
  'Steel A992 (Fy 50 ksi)': material('Steel A992', 200e9, 0.3, 7850, 345e6, 1.17e-5),
  'Concrete C30/37': material('Concrete C30/37', 33e9, 0.2, 2500, 30e6, 1.0e-5),
  'Timber GL24h': material('Timber GL24h', 11.5e9, 0.3, 420, 24e6, 5e-6, 0.65e9),
  'Aluminum 6061-T6': material('Aluminum 6061-T6', 69e9, 0.33, 2700, 240e6, 2.3e-5),
};

// ---- cross-sections ----------------------------------------------------------
const rectPoly = (b: number, h: number) => [[-b / 2, -h / 2], [b / 2, -h / 2], [b / 2, h / 2], [-b / 2, h / 2]];
const circlePoly = (d: number, n = 20) => Array.from({ length: n }, (_, i) => [d / 2 * Math.cos(2 * Math.PI * i / n), d / 2 * Math.sin(2 * Math.PI * i / n)]);

export function secRect(b: number, h: number): Section {
  const a = Math.max(b, h), c = Math.min(b, h);
  // Torsion constant of a solid rectangle (Roark's formulas, a = long side, c = short side).
  const J = a * c ** 3 * (1 / 3 - 0.21 * (c / a) * (1 - c ** 4 / (12 * a ** 4)));
  return { k: 'section', name: `Rect ${fmt(b)}x${fmt(h)}`, A: b * h, Iy: b * h ** 3 / 12, Iz: h * b ** 3 / 12, J, Asy: 5 / 6 * b * h, Asz: 5 / 6 * b * h, cy: b / 2, cz: h / 2, shape: { outer: rectPoly(b, h) } };
}
export function secRectHollow(b: number, h: number, t: number): Section {
  if (2 * t >= Math.min(b, h)) throw new Error('Wall thickness is too large for the hollow section');
  const bi = b - 2 * t, hi = h - 2 * t, Am = (b - t) * (h - t), pm = 2 * ((b - t) + (h - t));
  return {
    k: 'section', name: `RHS ${fmt(b)}x${fmt(h)}x${fmt(t)}`, A: b * h - bi * hi, Iy: (b * h ** 3 - bi * hi ** 3) / 12, Iz: (h * b ** 3 - hi * bi ** 3) / 12,
    J: 4 * Am * Am * t / pm,                 // Bredt's formula for a closed thin-walled cell
    Asy: 2 * b * t, Asz: 2 * h * t, cy: b / 2, cz: h / 2, shape: { outer: rectPoly(b, h), inner: rectPoly(bi, hi) },
  };
}
export function secCircle(d: number): Section {
  const A = Math.PI * d * d / 4, I = Math.PI * d ** 4 / 64;
  return { k: 'section', name: `Round ${fmt(d)}`, A, Iy: I, Iz: I, J: 2 * I, Asy: 0.9 * A, Asz: 0.9 * A, cy: d / 2, cz: d / 2, shape: { outer: circlePoly(d) } };
}
export function secTube(d: number, t: number): Section {
  if (2 * t >= d) throw new Error('Wall thickness is too large for the tube');
  const di = d - 2 * t, A = Math.PI * (d * d - di * di) / 4, I = Math.PI * (d ** 4 - di ** 4) / 64;
  return { k: 'section', name: `CHS ${fmt(d)}x${fmt(t)}`, A, Iy: I, Iz: I, J: 2 * I, Asy: 0.5 * A, Asz: 0.5 * A, cy: d / 2, cz: d / 2, shape: { outer: circlePoly(d), inner: circlePoly(di) } };
}
export function secI(h: number, b: number, tw: number, tf: number): Section {
  if (2 * tf >= h || tw >= b) throw new Error('Flange/web thickness is too large for the I-section');
  const hw = h - 2 * tf;
  const o = [[-b / 2, -h / 2], [b / 2, -h / 2], [b / 2, -h / 2 + tf], [tw / 2, -h / 2 + tf], [tw / 2, h / 2 - tf], [b / 2, h / 2 - tf], [b / 2, h / 2], [-b / 2, h / 2], [-b / 2, h / 2 - tf], [-tw / 2, h / 2 - tf], [-tw / 2, -h / 2 + tf], [-b / 2, -h / 2 + tf]];
  return {
    k: 'section', name: `I ${fmt(h)}x${fmt(b)}x${fmt(tw)}x${fmt(tf)}`, A: 2 * b * tf + hw * tw,
    Iy: (b * h ** 3 - (b - tw) * hw ** 3) / 12, Iz: (2 * tf * b ** 3 + hw * tw ** 3) / 12,
    J: (2 * b * tf ** 3 + (h - tf) * tw ** 3) / 3,          // open thin-walled approximation
    Asy: 5 / 6 * 2 * b * tf, Asz: h * tw, cy: b / 2, cz: h / 2, shape: { outer: o },
  };
}
/** Channel with the web on the -y side. Properties are about centroidal axes; the shear-center offset is ignored. */
export function secChannel(h: number, b: number, tw: number, tf: number): Section {
  const hw = h - 2 * tf, A = 2 * b * tf + hw * tw;
  const ey = (2 * tf * b * b / 2 + hw * tw * tw / 2) / A;             // centroid from the back of the web
  const Iz = 2 * (tf * b ** 3 / 12 + tf * b * (b / 2 - ey) ** 2) + hw * tw ** 3 / 12 + hw * tw * (ey - tw / 2) ** 2;
  const y0 = -ey, o = [[y0, -h / 2], [y0 + b, -h / 2], [y0 + b, -h / 2 + tf], [y0 + tw, -h / 2 + tf], [y0 + tw, h / 2 - tf], [y0 + b, h / 2 - tf], [y0 + b, h / 2], [y0, h / 2]];
  return { k: 'section', name: `C ${fmt(h)}x${fmt(b)}x${fmt(tw)}x${fmt(tf)}`, A, Iy: (b * h ** 3 - (b - tw) * hw ** 3) / 12, Iz, J: (2 * b * tf ** 3 + (h - tf) * tw ** 3) / 3, Asy: 5 / 6 * 2 * b * tf, Asz: h * tw, cy: Math.max(ey, b - ey), cz: h / 2, shape: { outer: o } };
}
/**
 * Angle with legs h (along z) and b (along y). Properties are about the
 * centroidal axes parallel to the legs; the product of inertia (principal-axis
 * rotation) is ignored, which is a simplification for unequal bending.
 */
export function secAngle(h: number, b: number, t: number): Section {
  const A = t * (h + b - t);
  const ey = (h * t * t / 2 + (b - t) * t * (t + (b - t) / 2)) / A, ez = (b * t * t / 2 + (h - t) * t * (t + (h - t) / 2)) / A;
  const Iy = b * t ** 3 / 12 + b * t * (ez - t / 2) ** 2 + t * (h - t) ** 3 / 12 + t * (h - t) * (t + (h - t) / 2 - ez) ** 2;
  const Iz = h * t ** 3 / 12 + h * t * (ey - t / 2) ** 2 + t * (b - t) ** 3 / 12 + t * (b - t) * (t + (b - t) / 2 - ey) ** 2;
  const o = [[-ey, -ez], [b - ey, -ez], [b - ey, t - ez], [t - ey, t - ez], [t - ey, h - ez], [-ey, h - ez]];
  return { k: 'section', name: `L ${fmt(h)}x${fmt(b)}x${fmt(t)}`, A, Iy, Iz, J: (h + b - t) * t ** 3 / 3, Asy: 5 / 6 * b * t, Asz: 5 / 6 * h * t, cy: Math.max(ey, b - ey), cz: Math.max(ez, h - ez), shape: { outer: o } };
}
export function secGeneric(name: string, A: number, Iy: number, Iz: number, J: number, Asy = 0, Asz = 0, cy = 0, cz = 0): Section {
  // With no fiber distances given, estimate them from an equivalent solid rectangle so stresses can still be reported.
  const h = Math.sqrt(12 * Iy / A), b = Math.sqrt(12 * Iz / A);
  return { k: 'section', name, A, Iy, Iz, J, Asy: Asy || 5 / 6 * A, Asz: Asz || 5 / 6 * A, cy: cy || b / 2, cz: cz || h / 2, shape: { outer: rectPoly(b, h) } };
}
function fmt(x: number): string { return String(Math.round(x * 1e4) / 10); }   // meters -> millimeters for names

// ---- geometry-level parts (what graph components pass around) ----------------------
export type MemberType = 'beam' | 'truss' | 'cable' | 'tension' | 'compression';
export interface BeamPart {
  k: 'element'; kind: 'beam'; id: string; a: V3; b: V3; type: MemberType; mat: Material; sec: Section;
  shear: boolean;                 // true = Timoshenko, false = Euler–Bernoulli
  ref: V3 | null; angle: number;  // local-axis orientation
  rel: boolean[];                 // 12 release flags in local DOF order (ux,uy,uz,rx,ry,rz at start, then end)
  offA: V3 | null; offB: V3 | null;   // rigid offsets from node to member end, global [m]
  pre: number;                    // pretension for cables [N]
  l0: number;                     // unstressed length as a multiple of the drawn length (1 = as drawn; >1 = slack cable)
  ci: number; cn: number;         // position in a subdivided member: element ci of cn
  summary: string;
}
export interface ShellPart { k: 'element'; kind: 'shell'; id: string; pts: V3[]; mat: Material; t: number; summary: string }
export type ElementPart = BeamPart | ShellPart;
export interface SupportPart {
  k: 'support'; p: V3; fix: boolean[]; axes: Plane | null;
  disp: number[] | null;          // prescribed displacement / rotation for fixed DOFs
  spring: number[] | null;        // spring stiffness per DOF [N/m, N*m/rad]
  summary: string;
}
export type LoadPart = { k: 'load'; lc: string; summary: string } & (
  | { kind: 'point'; p: V3; f: V3; m: V3; snap?: boolean }
  | { kind: 'line'; ids: string[] | null; w1: V3; w2: V3; sys: 'global' | 'local' | 'projected' }
  | { kind: 'gravity'; dir: V3 }                 // multiples of g, e.g. (0,0,-1)
  | { kind: 'temp'; ids: string[] | null; dT: number; gy: number; gz: number }
  | { kind: 'pressure'; ids: string[] | null; p: number; dir: V3 | null; projected: boolean }
  | { kind: 'combo'; factors: Record<string, number> });

// ---- solver model --------------------------------------------------------------
export interface FEBeam {
  id: string; n: [number, number]; type: MemberType; mat: number; sec: number; shear: boolean;
  ref: number[] | null; angle: number; rel: boolean[]; off: [number[], number[]] | null; pre: number; l0: number;
  /** Index of the geometry-level part this element came from (several elements share one when a member is subdivided). */
  part: number;
}
export interface FEShell { id: string; n: number[]; mat: number; t: number; part: number }
export interface FESupport { node: number; fix: boolean[]; axes: number[] | null; disp: number[] | null; spring: number[] | null }
export type FELoad = { lc: number } & (
  | { t: 'node'; node: number; f: number[] }
  | { t: 'line'; el: number; w1: number[]; w2: number[]; sys: 'global' | 'local' | 'projected' }
  | { t: 'gravity'; dir: number[] }
  | { t: 'temp'; el: number; dT: number; gy: number; gz: number }
  | { t: 'pressure'; el: number; p: number; dir: number[] | null; projected: boolean });
export interface FEModel {
  k: 'model';
  nodes: number[];                 // flat xyz
  beams: FEBeam[]; shells: FEShell[];
  materials: Material[]; sections: Section[];
  supports: FESupport[]; loads: FELoad[];
  cases: string[];
  combos: { name: string; factors: number[] }[];   // factor per load case
  g: number;                       // gravitational acceleration [m/s2]
  warnings: string[];
  summary: string;
}
export const G_STANDARD = 9.80665;
export const nodeXYZ = (m: FEModel, i: number): V3 => v(m.nodes[3 * i], m.nodes[3 * i + 1], m.nodes[3 * i + 2]);
export const nodeCount = (m: FEModel): number => m.nodes.length / 3;

/** Merge points closer than `tol` using a spatial hash. */
export class NodeMerger {
  readonly coords: number[] = [];
  private cells = new Map<string, number[]>();
  constructor(readonly tol: number) {}
  find(p: V3, create: boolean): number {
    const h = Math.max(this.tol, 1e-9), cx = Math.floor(p.x / h), cy = Math.floor(p.y / h), cz = Math.floor(p.z / h);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of this.cells.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
        if (Math.hypot(this.coords[3 * j] - p.x, this.coords[3 * j + 1] - p.y, this.coords[3 * j + 2] - p.z) <= this.tol) return j;
      }
    }
    if (!create) return -1;
    const idx = this.coords.length / 3;
    this.coords.push(p.x, p.y, p.z);
    const key = `${cx},${cy},${cz}`, cell = this.cells.get(key);
    if (cell) cell.push(idx); else this.cells.set(key, [idx]);
    return idx;
  }
}

const p3 = (a: V3): string => `(${+a.x.toFixed(3)}, ${+a.y.toFixed(3)}, ${+a.z.toFixed(3)})`;

/** Assemble geometry-level parts into a node/element model, merging coincident nodes within `tol`. */
export function buildModel(elements: ElementPart[], supports: SupportPart[], loads: LoadPart[], tol = 1e-4, g = G_STANDARD): FEModel {
  const merger = new NodeMerger(tol), warnings: string[] = [];
  const materials: Material[] = [], sections: Section[] = [];
  const indexOf = <T>(list: T[], item: T): number => {
    const key = JSON.stringify(item);
    let i = list.findIndex(x => JSON.stringify(x) === key);
    if (i < 0) { i = list.length; list.push(item); }
    return i;
  };
  const beams: FEBeam[] = [], shells: FEShell[] = [];
  elements.forEach((e, part) => {
    if (e.kind === 'beam') {
      const off = e.offA || e.offB ? [toArr(e.offA ?? v()), toArr(e.offB ?? v())] as [number[], number[]] : null;
      beams.push({ id: e.id, n: [merger.find(e.a, true), merger.find(e.b, true)], type: e.type, mat: indexOf(materials, e.mat), sec: indexOf(sections, e.sec), shear: e.shear, ref: e.ref ? toArr(e.ref) : null, angle: e.angle, rel: [...e.rel], off, pre: e.pre, l0: e.l0 || 1, part });
    } else {
      shells.push({ id: e.id, n: e.pts.map(p => merger.find(p, true)), mat: indexOf(materials, e.mat), t: e.t, part });
    }
  });
  const fsup: FESupport[] = [];
  for (const s of supports) {
    const node = merger.find(s.p, false);
    if (node < 0) { warnings.push(`A support at ${p3(s.p)} does not touch any node of the model and was ignored. Move it onto an element end or increase the merge tolerance.`); continue; }
    const existing = fsup.find(x => x.node === node);
    const axes = s.axes ? [s.axes.x.x, s.axes.x.y, s.axes.x.z, s.axes.y.x, s.axes.y.y, s.axes.y.z, s.axes.z.x, s.axes.z.y, s.axes.z.z] : null;
    if (existing) {
      // Two supports on one node: union of fixities.
      existing.fix = existing.fix.map((f, i) => f || s.fix[i]);
      if (s.disp) existing.disp = (existing.disp ?? [0, 0, 0, 0, 0, 0]).map((d, i) => d + s.disp![i]);
      if (s.spring) existing.spring = (existing.spring ?? [0, 0, 0, 0, 0, 0]).map((d, i) => d + s.spring![i]);
    } else fsup.push({ node, fix: [...s.fix], axes, disp: s.disp ? [...s.disp] : null, spring: s.spring ? [...s.spring] : null });
  }
  const cases: string[] = [];
  const caseIndex = (name: string) => { let i = cases.indexOf(name); if (i < 0) { i = cases.length; cases.push(name); } return i; };
  const fl: FELoad[] = [];
  const match = (ids: string[] | null, id: string) => ids === null || ids.length === 0 || ids.includes(id);
  for (const l of loads) {
    if (l.kind === 'combo') continue;
    const lc = caseIndex(l.lc || 'LC1');
    switch (l.kind) {
      case 'point': {
        let node = merger.find(l.p, false);
        if (node < 0 && l.snap) {
          // Loads that come from a load mesh go to the nearest node.
          let bd = Infinity;
          for (let i = 0; i < merger.coords.length / 3; i++) { const d = Math.hypot(merger.coords[3 * i] - l.p.x, merger.coords[3 * i + 1] - l.p.y, merger.coords[3 * i + 2] - l.p.z); if (d < bd) { bd = d; node = i; } }
        }
        if (node < 0) warnings.push(`A point load at ${p3(l.p)} does not touch any node and was ignored.`);
        else fl.push({ lc, t: 'node', node, f: [l.f.x, l.f.y, l.f.z, l.m.x, l.m.y, l.m.z] });
        break;
      }
      case 'line': {
        let n = 0;
        beams.forEach((b, el) => { if (match(l.ids, b.id)) { n++; fl.push({ lc, t: 'line', el, w1: toArr(l.w1), w2: toArr(l.w2), sys: l.sys }); } });
        if (!n) warnings.push(`A line load refers to element IDs (${l.ids?.join(', ')}) that are not in the model.`);
        break;
      }
      case 'gravity': fl.push({ lc, t: 'gravity', dir: toArr(l.dir) }); break;
      case 'temp': beams.forEach((b, el) => { if (match(l.ids, b.id)) fl.push({ lc, t: 'temp', el, dT: l.dT, gy: l.gy, gz: l.gz }); }); break;
      case 'pressure': {
        let n = 0;
        shells.forEach((s, el) => { if (match(l.ids, s.id)) { n++; fl.push({ lc, t: 'pressure', el, p: l.p, dir: l.dir ? toArr(l.dir) : null, projected: l.projected }); } });
        if (!n) warnings.push('An area load found no shell elements to act on.');
        break;
      }
    }
  }
  if (cases.length === 0) cases.push('LC1');
  const combos = loads.filter(l => l.kind === 'combo').map(l => {
    const c = l as Extract<LoadPart, { kind: 'combo' }>;
    for (const name of Object.keys(c.factors)) if (!cases.includes(name)) warnings.push(`Combination "${c.lc}" refers to load case "${name}", which has no loads.`);
    return { name: c.lc, factors: cases.map(name => c.factors[name] ?? 0) };
  });
  const nn = merger.coords.length / 3;
  return {
    k: 'model', nodes: merger.coords, beams, shells, materials, sections, supports: fsup, loads: fl, cases, combos, g, warnings,
    summary: `Model: ${nn} nodes, ${beams.length} line elements, ${shells.length} shell elements, ${fsup.length} supports, ${cases.length} load case${cases.length === 1 ? '' : 's'}`,
  };
}
const toArr = (p: V3): number[] => [p.x, p.y, p.z];

/**
 * Rows of the 3x3 rotation matrix are the local x, y, z axes of a member in
 * global coordinates (see the header for the convention).
 */
export function memberAxes(a: V3, b: V3, ref: number[] | null, angle: number): number[] {
  const x = unit(sub(b, a));
  let up = ref ? unit(v(ref[0], ref[1], ref[2])) : v(0, 0, 1);
  let z: V3, y: V3;
  if (len(cross(x, up)) < 1e-6) {
    // Member parallel to the reference direction (e.g. a vertical column): take y = global Y (or X if that is parallel too).
    y = Math.abs(x.y) < 0.999 ? v(0, 1, 0) : v(1, 0, 0);
    y = unit(sub(y, mul(x, dot(x, y))));
    z = cross(x, y);
  } else {
    z = unit(sub(up, mul(x, dot(up, x))));
    y = cross(z, x);
  }
  if (angle !== 0) {
    const r = xRotate(v(), x, angle);
    y = xPoint(r, y); z = xPoint(r, z);
  }
  return [x.x, x.y, x.z, y.x, y.y, y.z, z.x, z.y, z.z];
}
/** End points of a beam element including rigid offsets. */
export function beamEnds(m: FEModel, b: FEBeam): [V3, V3] {
  let a = nodeXYZ(m, b.n[0]), c = nodeXYZ(m, b.n[1]);
  if (b.off) { a = add(a, v(b.off[0][0], b.off[0][1], b.off[0][2])); c = add(c, v(b.off[1][0], b.off[1][1], b.off[1][2])); }
  return [a, c];
}
