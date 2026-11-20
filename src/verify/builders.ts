/**
 * Parametric model builders for the verification suite.
 *
 * A benchmark JSON file names a builder and its parameters. The builder
 * returns the model, the analysis to run, functions that extract the checked
 * quantities from the result, and (where a benchmark compares against the
 * independent reference solver or a closed form that is not a one-line
 * formula) the reference values computed here in code.
 *
 * All values are SI: N, m, Pa, kg.
 */
import { v, V3 } from '../geom/vec';
import { FEModel, Material, Section, buildModel, material, secGeneric, secCircle, secRect, ElementPart, SupportPart, LoadPart } from '../fe/model';
import { beam, beamChain, support, pointLoad, lineLoad, tempLoad, gravityLoad, shell, pressureLoad } from '../fe/parts';
import type { AnalysisOptions } from '../fe/analysis';
import type { FEResult } from '../fe/system';
import { nearestNode, memberForces, kinOf } from '../fe/post';
import { refSolve, RefModel, RefMember } from '../ref/refsolver';

export type Params = Record<string, number>;
export interface Built {
  model: FEModel;
  options: AnalysisOptions;
  quantities: Record<string, (r: FEResult) => number>;
  /** Reference values that need code (independent solver, series, root finding). */
  reference?: () => Record<string, number>;
}
export type Builder = (p: Params) => Built;

const mk = (els: ElementPart[], sups: SupportPart[], loads: LoadPart[], tol = 1e-6) => buildModel(els, sups, loads, tol);
const uAt = (r: FEResult, p: V3, d: number, c = 0) => r.cases[c].u[6 * nearestNode(r.model, p) + d];
const rAt = (r: FEResult, p: V3, d: number, c = 0) => r.cases[c].reactions[6 * nearestNode(r.model, p) + d];
/** Internal force component k at global position x on a straight member along X built from equal elements. */
function forceAtX(r: FEResult, x: number, k: number, side: 'left' | 'right' = 'right', c = 0): number {
  const m = r.model;
  for (let e = 0; e < m.beams.length; e++) {
    const xa = m.nodes[3 * m.beams[e].n[0]], xb = m.nodes[3 * m.beams[e].n[1]], eps = 1e-9 * Math.max(1, Math.abs(xb - xa));
    const inside = side === 'right' ? x >= xa - eps && x < xb - eps : x > xa + eps && x <= xb + eps;
    if (inside) return memberForces(m, r.cases[c], e, x - xa)[k];
  }
  const e = m.beams.length - 1;
  return memberForces(m, r.cases[c], e, kinOf(m, e).L)[k];
}
const steel = (p: Params): Material => material('Test material', p.E ?? 210e9, p.nu ?? 0.3, p.rho ?? 7850, 355e6, p.alpha ?? 1.2e-5);
const sect = (p: Params): Section => secGeneric('Test section', p.A ?? 5e-3, p.I ?? 4e-5, p.Iz ?? p.I ?? 4e-5, p.J ?? 2e-6, p.As ?? 0, p.As ?? 0, 0.1, 0.1);
const inPlane = 'uy rx rz';       // restraints that keep a model in the X-Z plane

/**
 * Straight beam along X in the X-Z plane.
 * left/right: 0 = free, 1 = pinned (uz, and ux at the left), 2 = fixed. mid: 1 adds a roller at mid-length (two spans of L each when spans = 2).
 */
const beamBuilder: Builder = (p) => {
  const spans = p.spans ?? 1, L = p.L * spans, n = Math.max(2, Math.round(p.n ?? 4)) * spans, mat = steel(p), sec = sect(p);
  const els = beamChain(v(0, 0, 0), v(L, 0, 0), n, mat, sec, { shear: !!p.shear, relEnd: p.hingeRight ? 'ry' : undefined });
  if (p.hinge) {
    // Internal hinge at x = hinge: release ry at the end of the element that finishes there.
    for (const e of els) if (Math.abs(e.b.x - p.hinge) < 1e-9) e.rel[10] = true;
  }
  const sups: SupportPart[] = [];
  const bc = (x: number, code: number, first: boolean) => {
    if (code === 2) sups.push(support(v(x, 0, 0), 'fixed'));
    else if (code === 1) sups.push(support(v(x, 0, 0), first ? 'ux uy uz rx' : 'uy uz rx'));
  };
  bc(0, p.left ?? 2, true); bc(L, p.right ?? 0, false);
  if (spans === 2) sups.push(support(v(L / 2, 0, 0), 'uy uz'));
  const loads: LoadPart[] = [];
  if (p.w) loads.push(lineLoad(v(0, 0, -p.w)));
  if (p.Ptip) loads.push(pointLoad(v(L, 0, 0), v(0, 0, -p.Ptip)));
  if (p.Pmid) loads.push(pointLoad(v(L / 2, 0, 0), v(0, 0, -p.Pmid)));
  if (p.T) loads.push(pointLoad(v(L, 0, 0), v(), v(p.T, 0, 0)));
  if (p.dT) loads.push(tempLoad(p.dT));
  if (p.gz) loads.push(tempLoad(0, 0, p.gz));
  return {
    model: mk(els, sups, loads), options: { kind: 'static' },
    quantities: {
      tipDeflection: r => -uAt(r, v(L, 0, 0), 2),
      tipRotation: r => uAt(r, v(L, 0, 0), 4),
      tipTwist: r => uAt(r, v(L, 0, 0), 3),
      midDeflection: r => -uAt(r, v(L / 2, 0, 0), 2),
      spanDeflection: r => -uAt(r, v(p.L / 2, 0, 0), 2),
      baseMoment: r => -forceAtX(r, 0, 4),                    // hogging reported positive
      endMomentRight: r => -forceAtX(r, L, 4, 'left'),
      midMoment: r => forceAtX(r, L / 2, 4),
      interiorMoment: r => -forceAtX(r, L / 2, 4),
      hingeMoment: r => forceAtX(r, p.hinge ?? L / 2, 4, 'left'),
      axialForce: r => forceAtX(r, L / 2, 0),
      leftReaction: r => rAt(r, v(0, 0, 0), 2),
      rightReaction: r => rAt(r, v(L, 0, 0), 2),
      midReaction: r => rAt(r, v(L / 2, 0, 0), 2),
      baseReactionMoment: r => Math.abs(rAt(r, v(0, 0, 0), 4)),
      equilibriumError: r => r.cases[0].equilibrium.relError,
    },
  };
};

/** Symmetric triangular truss: pin at A(0,0), roller at B(L,0), apex C(L/2,h) loaded by P downward. */
const triangleTruss: Builder = (p) => {
  const mat = steel(p), sec = sect(p), A = v(0, 0, 0), B = v(p.L, 0, 0), C = v(p.L / 2, 0, p.h);
  const els = [beam(A, C, mat, sec, { type: 'truss', id: 'AC' }), beam(C, B, mat, sec, { type: 'truss', id: 'CB' }), beam(A, B, mat, sec, { type: 'truss', id: 'AB' })];
  const sups = [support(A, 'ux uy uz'), support(B, 'uy uz'), support(C, 'uy')];
  const N = (id: string) => (r: FEResult) => memberForces(r.model, r.cases[0], r.model.beams.findIndex(b => b.id === id), 0)[0];
  return { model: mk(els, sups, [pointLoad(C, v(0, 0, -p.P))]), options: { kind: 'static' }, quantities: { rafterForce: N('AC'), tieForce: N('AB'), apexDeflection: r => -uAt(r, C, 2), leftReaction: r => rAt(r, A, 2) } };
};

/** Convert a model made only of prismatic beams/trusses with nodal and uniform global loads into reference-solver input. */
export function toReference(m: FEModel): RefModel {
  const nn = m.nodes.length / 3;
  const members: RefMember[] = m.beams.map(b => {
    const mat = m.materials[b.mat], s = m.sections[b.sec];
    return { i: b.n[0], j: b.n[1], E: mat.E, G: mat.G, A: s.A, Iy: s.Iy, Iz: s.Iz, J: s.J, truss: b.type !== 'beam' };
  });
  const loads: RefModel['loads'] = [];
  for (const l of m.loads) {
    if (l.t === 'node') loads.push({ node: l.node, f: l.f });
    else if (l.t === 'line' && l.sys === 'global') { const mem = members[l.el]; mem.w = [(mem.w?.[0] ?? 0) + l.w1[0], (mem.w?.[1] ?? 0) + l.w1[1], (mem.w?.[2] ?? 0) + l.w1[2]]; }
    else throw new Error('Load type not supported by the reference solver');
  }
  return { nodes: Array.from({ length: nn }, (_, i) => [m.nodes[3 * i], m.nodes[3 * i + 1], m.nodes[3 * i + 2]] as [number, number, number]), members, supports: m.supports.map(s => ({ node: s.node, fix: s.fix })), loads };
}
/** Largest difference between main and reference displacements, relative to the largest reference displacement. */
export function compareWithReference(r: FEResult): { dispError: number; reactionError: number; axialError: number } {
  const ref = refSolve(toReference(r.model)), c = r.cases[0];
  const rel = (a: ArrayLike<number>, b: ArrayLike<number>) => { let d = 0, s = 0; for (let i = 0; i < b.length; i++) { d = Math.max(d, Math.abs(a[i] - b[i])); s = Math.max(s, Math.abs(b[i])); } return s > 0 ? d / s : d; };
  const axial = r.model.beams.map((_, e) => (c.beamQ[12 * e + 6] - c.beamQ[12 * e]) / 2);
  return { dispError: rel(c.u, ref.u), reactionError: rel(c.reactions, ref.reactions), axialError: rel(axial, ref.axial) };
}
const refQuantities = {
  dispError: (r: FEResult) => compareWithReference(r).dispError,
  reactionError: (r: FEResult) => compareWithReference(r).reactionError,
  axialError: (r: FEResult) => compareWithReference(r).axialError,
  equilibriumError: (r: FEResult) => r.cases[0].equilibrium.relError,
};

/** The classic 10-bar planar truss (two 360-inch bays; here in SI), loads P at the two lower free nodes. */
const tenBarTruss: Builder = (p) => {
  const a = p.a, mat = steel(p), sec = sect(p);
  const N = [v(2 * a, 0, a), v(2 * a, 0, 0), v(a, 0, a), v(a, 0, 0), v(0, 0, a), v(0, 0, 0)];   // nodes 1..6
  const conn = [[5, 3], [3, 1], [6, 4], [4, 2], [3, 4], [1, 2], [5, 4], [6, 3], [3, 2], [4, 1]];
  const els = conn.map(([i, j], k) => beam(N[i - 1], N[j - 1], mat, sec, { type: 'truss', id: `T${k + 1}` }));
  const sups = [support(N[4], 'ux uy uz'), support(N[5], 'ux uy uz'), ...N.slice(0, 4).map(q => support(q, 'uy'))];
  const loads = [pointLoad(N[1], v(0, 0, -p.P)), pointLoad(N[3], v(0, 0, -p.P))];
  return { model: mk(els, sups, loads), options: { kind: 'static' }, quantities: { ...refQuantities, tipDeflection: r => -uAt(r, N[1], 2) }, reference: () => { const m = mk(els, sups, loads); return { tipDeflection: -refSolve(toReference(m)).u[6 * nearestNode(m, N[1]) + 2] }; } };
};

/** Single-bay portal frame in the X-Z plane with a lateral load H at beam level. base: 1 pinned, 2 fixed. */
const portal: Builder = (p) => {
  const mat = steel(p), col = secGeneric('Column', p.A ?? 1, p.Ic, p.Ic, 1e-4), bm = secGeneric('Beam', p.A ?? 1, p.Ib, p.Ib, 1e-4), n = Math.round(p.n ?? 4);
  const A = v(0, 0, 0), B = v(0, 0, p.h), C = v(p.L, 0, p.h), D = v(p.L, 0, 0);
  const els = [...beamChain(A, B, n, mat, col, { id: 'col1' }), ...beamChain(B, C, n, mat, bm, { id: 'beam' }), ...beamChain(D, C, n, mat, col, { id: 'col2' })];
  const base = p.base === 2 ? 'fixed' : 'ux uy uz rx rz';
  const sups = [support(A, base), support(D, base)];
  const loads = [pointLoad(B, v(p.H, 0, 0))];
  const built = () => mk(els, sups, loads);
  return {
    model: built(), options: { kind: 'static' },
    quantities: {
      ...refQuantities,
      sway: r => uAt(r, B, 0),
      baseShear: r => -rAt(r, A, 0),
      upliftReaction: r => -rAt(r, A, 2),
      baseMoment: r => Math.abs(rAt(r, A, 4)),
      kneeMoment: r => Math.abs(memberForces(r.model, r.cases[0], n - 1, kinOf(r.model, n - 1).L)[4]),
    },
    reference: () => { const m = built(); return { sway: refSolve(toReference(m)).u[6 * nearestNode(m, B)] }; },
  };
};

/** A small irregular 3D frame with member and nodal loads, mixed supports and one truss brace. */
const spaceFrame: Builder = (p) => {
  const mat = steel(p), col = secRect(0.3, 0.3), bm = secRect(0.2, 0.4), brace = secCircle(0.05);
  const P: V3[] = [v(0, 0, 0), v(5, 0, 0), v(5, 4, 0), v(0, 4, 0), v(0, 0, 3.5), v(5, 0, 3.2), v(5.4, 4, 3.5), v(0, 4.3, 3.8), v(2.5, 2, 5)];
  const els: ElementPart[] = [];
  for (let i = 0; i < 4; i++) els.push(beam(P[i], P[i + 4], mat, col, { id: 'col' }));
  for (let i = 0; i < 4; i++) els.push(beam(P[4 + i], P[4 + (i + 1) % 4], mat, bm, { id: 'beam' }));
  for (let i = 0; i < 4; i++) els.push(beam(P[4 + i], P[8], mat, bm, { id: 'rafter' }));
  els.push(beam(P[0], P[5], mat, brace, { type: 'truss', id: 'brace' }), beam(P[1], P[6], mat, brace, { type: 'truss', id: 'brace' }));
  const sups = [support(P[0], 'fixed'), support(P[1], 'ux uy uz'), support(P[2], 'fixed'), support(P[3], 'ux uy uz rz')];
  const loads = [lineLoad(v(0, 0, -p.w), undefined, { ids: ['beam', 'rafter'] }), lineLoad(v(p.w / 4, 0, 0), undefined, { ids: ['col'] }), pointLoad(P[8], v(p.H, p.H / 2, -p.H), v(0, 2000, 1000))];
  return { model: mk(els, sups, loads), options: { kind: 'static' }, quantities: { ...refQuantities } };
};

/** Quarter-circle cantilever in the X-Z plane, radius R, built from n straight elements, tip load P along -Z. */
const curvedBeam: Builder = (p) => {
  const mat = steel(p), sec = sect(p), n = Math.round(p.n), R = p.R;
  // Free end at angle 0 (tangent along X), fixed end at 90 degrees: x = R sin(t), z = -R (1 - cos(t)).
  const pt = (t: number) => v(R * Math.sin(t), 0, -R * (1 - Math.cos(t)));
  const els: ElementPart[] = [];
  for (let i = 0; i < n; i++) els.push(beam(pt(Math.PI / 2 * i / n), pt(Math.PI / 2 * (i + 1) / n), mat, sec));
  return { model: mk(els, [support(pt(Math.PI / 2), 'fixed')], [pointLoad(pt(0), v(0, 0, -p.P))]), options: { kind: 'static' }, quantities: { tipDeflection: r => -uAt(r, pt(0), 2), tipHorizontal: r => Math.abs(uAt(r, pt(0), 0)) } };
};

/** Cantilever along X whose tip node sits on a rigid vertical arm of height e; horizontal load H at that node. */
const rigidOffset: Builder = (p) => {
  const mat = steel(p), sec = sect(p), A = v(0, 0, 0), Bn = v(p.L, 0, p.e);
  // The member end is e below the node: offset from node to member end is (0, 0, -e).
  const els = [beam(A, Bn, mat, sec, { offB: v(0, 0, -p.e) })];
  return { model: mk(els, [support(A, 'fixed')], [pointLoad(Bn, v(p.H, 0, 0))]), options: { kind: 'static' }, quantities: { nodeHorizontal: r => uAt(r, Bn, 0), nodeVertical: r => uAt(r, Bn, 2), baseMoment: r => Math.abs(rAt(r, A, 4)) } };
};

/** Column along Z for buckling / second-order checks. bc: 1 pinned-pinned, 2 fixed-free, 3 fixed-pinned, 4 fixed-fixed. */
const column: Builder = (p) => {
  const mat = steel(p), sec = sect(p), n = Math.round(p.n ?? 8), L = p.L, top = v(0, 0, L), bot = v(0, 0, 0);
  const els = beamChain(bot, top, n, mat, sec);
  const sups: SupportPart[] = [];
  for (let i = 1; i < n; i++) sups.push(support(v(0, 0, L * i / n), inPlane));
  const bc = Math.round(p.bc ?? 2);
  sups.push(support(bot, bc === 1 ? 'ux uy uz rx rz' : 'fixed'));
  sups.push(support(top, bc === 1 || bc === 3 ? 'ux uy rx rz' : bc === 4 ? 'ux uy rx ry rz' : inPlane));
  const loads = [pointLoad(top, v(p.H ?? 0, 0, -(p.P ?? 1)))];
  const kind = p.second ? 'second-order' : 'buckling';
  return {
    model: mk(els, sups, loads), options: { kind, modes: 3 },
    quantities: {
      criticalLoad: r => r.modes[0].value * (p.P ?? 1),
      tipSway: r => uAt(r, top, 0),
      baseMoment: r => Math.abs(rAt(r, bot, 4)),
    },
    reference: () => {
      // Exact beam-column: cantilever with axial P and tip shear H (Timoshenko & Gere, Theory of Elastic Stability, art. 1.4).
      const EI = mat.E * sec.Iy, u = L * Math.sqrt((p.P ?? 1) / EI), H = p.H ?? 0;
      return { tipSway: H * L ** 3 / (3 * EI) * 3 * (Math.tan(u) - u) / u ** 3, baseMoment: H * L * Math.tan(u) / u };
    },
  };
};

/** Beam along X for modal analysis. bc: 1 simply supported, 2 cantilever. */
const vibration: Builder = (p) => {
  const mat = steel(p), sec = sect(p), n = Math.round(p.n ?? 20), L = p.L;
  const els = beamChain(v(0, 0, 0), v(L, 0, 0), n, mat, sec);
  const sups: SupportPart[] = [];
  for (let i = 1; i < n; i++) sups.push(support(v(L * i / n, 0, 0), 'ux ' + inPlane));
  if (Math.round(p.bc) === 1) sups.push(support(v(0, 0, 0), 'ux uy uz rx rz'), support(v(L, 0, 0), 'ux uy uz rx rz'));
  else sups.push(support(v(0, 0, 0), 'fixed'), support(v(L, 0, 0), 'ux ' + inPlane));
  return { model: mk(els, sups, []), options: { kind: 'modal', modes: 3, consistentMass: p.lumped ? false : true }, quantities: { f1: r => r.modes[0].value, f2: r => r.modes[1].value, f3: r => r.modes[2].value } };
};

/** Elastic catenary: H from Irvine, "Cable Structures" (1981), eq. 1.24 with level supports, by bisection. */
export function catenary(span: number, L0: number, w: number, EA: number): { H: number; sag: number; Tmax: number } {
  const W = w * L0, f = (H: number) => H * L0 / EA + 2 * H * L0 / W * Math.asinh(W / (2 * H)) - span;
  let lo = 1e-9 * W, hi = 1e9 * W;
  for (let i = 0; i < 300; i++) { const mid = Math.sqrt(lo * hi); if (f(mid) > 0) hi = mid; else lo = mid; }
  const H = Math.sqrt(lo * hi);
  return { H, sag: W * L0 / (8 * EA) + H * L0 / W * (Math.sqrt(1 + (W / (2 * H)) ** 2) - 1), Tmax: Math.hypot(H, W / 2) };
}
/** Cable of unstressed length L0 hung between level supports `span` apart, under self-weight. */
const cable: Builder = (p) => {
  const n = Math.round(p.n ?? 40), mat = material('Cable', p.E, 0.3, p.rho, 1e9, 1.2e-5), sec = secGeneric('Cable', p.A, 1e-12, 1e-12, 1e-12);
  const els: ElementPart[] = [];
  for (let i = 0; i < n; i++) els.push(beam(v(p.span * i / n, 0, 0), v(p.span * (i + 1) / n, 0, 0), mat, sec, { type: 'cable', l0: p.L0 / p.span }));
  const sups = [support(v(0, 0, 0), 'ux uy uz'), support(v(p.span, 0, 0), 'ux uy uz')];
  for (let i = 1; i < n; i++) sups.push(support(v(p.span * i / n, 0, 0), 'uy'));
  // The weight is that of the unstressed length, applied on the drawn (shorter) length: scale gravity accordingly.
  const loads = [gravityLoad(v(0, 0, -p.L0 / p.span))];
  const w = p.rho * p.A * 9.80665;
  return {
    model: mk(els, sups, loads), options: { kind: 'nonlinear', steps: 1, maxIter: 2000, tol: 1e-9 },
    quantities: {
      sag: r => -uAt(r, v(p.span / 2, 0, 0), 2),
      horizontalForce: r => Math.abs(rAt(r, v(0, 0, 0), 0)),
      maxTension: r => { let t = 0; for (let e = 0; e < n; e++) t = Math.max(t, (r.cases[0].beamQ[12 * e + 6] - r.cases[0].beamQ[12 * e]) / 2); return t; },
    },
    reference: () => { const c = catenary(p.span, p.L0, w, p.E * p.A); return { sag: c.sag, horizontalForce: c.H, maxTension: c.Tmax }; },
  };
};

export const BUILDERS: Record<string, Builder> = { beam: beamBuilder, triangleTruss, tenBarTruss, portal, spaceFrame, curvedBeam, rigidOffset, column, vibration, cable };
export { shell, pressureLoad, mk, uAt, rAt, steel };

// ---- shell benchmarks ---------------------------------------------------------------
type Fix = (p: V3, u: number, w: number) => string | null;
/** Structured (n1 x n2) shell mesh on a mapped parameter square; `fix` returns the restrained DOFs for a grid point. */
function gridShell(n1: number, n2: number, map: (u: number, w: number) => V3, mat: Material, t: number, tri: boolean, fix: Fix): { els: ElementPart[]; sups: SupportPart[] } {
  const P: V3[][] = [], els: ElementPart[] = [], sups: SupportPart[] = [];
  for (let i = 0; i <= n1; i++) { P.push([]); for (let j = 0; j <= n2; j++) { const q = map(i / n1, j / n2); P[i].push(q); const f = fix(q, i / n1, j / n2); if (f) sups.push(support(q, f)); } }
  for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) {
    const a = P[i][j], b = P[i + 1][j], c = P[i + 1][j + 1], d = P[i][j + 1];
    if (tri) els.push(shell([a, b, c], mat, t), shell([a, c, d], mat, t)); else els.push(shell([a, b, c, d], mat, t));
  }
  return { els, sups };
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const join = (...parts: (string | false)[]) => { const s = parts.filter(Boolean).join(' '); return s || null; };

/** Scordelis–Lo roof, one quarter by symmetry. Axis along X, crown at theta = 0. */
const scordelisLo: Builder = (p) => {
  const n = Math.round(p.n), R = p.R, L = p.L, th = p.theta * Math.PI / 180, mat = material('Roof', p.E, p.nu, 0, 1, 0);
  const map = (u: number, w: number) => v(u * L / 2, R * Math.sin(w * th), R * Math.cos(w * th));
  const { els, sups } = gridShell(n, n, map, mat, p.t, !!p.tri, (_q, u, w) => join(near(u, 0) && 'uy uz', near(u, 1) && 'ux ry rz', near(w, 0) && 'uy rx rz'));
  return { model: mk(els, sups, [pressureLoad(p.q, { dir: v(0, 0, -1) })]), options: { kind: 'static' }, quantities: { edgeDeflection: r => -uAt(r, map(1, 1), 2) } };
};
/** Pinched cylinder with rigid end diaphragms, one octant. */
const pinchedCylinder: Builder = (p) => {
  const n = Math.round(p.n), R = p.R, L = p.L, mat = material('Cylinder', p.E, p.nu, 0, 1, 0);
  const map = (u: number, w: number) => v(u * L / 2, R * Math.sin(w * Math.PI / 2), R * Math.cos(w * Math.PI / 2));
  const { els, sups } = gridShell(n, n, map, mat, p.t, !!p.tri, (_q, u, w) => join(near(u, 0) && 'uy uz', near(u, 1) && 'ux ry rz', near(w, 0) && 'uy rx rz', near(w, 1) && 'uz rx ry'));
  return { model: mk(els, sups, [pointLoad(map(1, 0), v(0, 0, -p.P / 4))]), options: { kind: 'static' }, quantities: { loadDeflection: r => -uAt(r, map(1, 0), 2) } };
};
/** Hemisphere with an 18-degree hole at the pole, one quadrant, alternating unit loads on the equator. */
const hemisphere: Builder = (p) => {
  const n = Math.round(p.n), R = p.R, top = (90 - p.hole) * Math.PI / 180, mat = material('Hemisphere', p.E, p.nu, 0, 1, 0);
  const map = (u: number, w: number) => v(R * Math.cos(w * top) * Math.cos(u * Math.PI / 2), R * Math.cos(w * top) * Math.sin(u * Math.PI / 2), R * Math.sin(w * top));
  const { els, sups } = gridShell(n, n, map, mat, p.t, !!p.tri, (_q, u, w) => join(near(u, 0) && 'uy rx rz', near(u, 1) && 'ux ry rz', near(u, 0) && near(w, 0) && 'uz'));
  return { model: mk(els, sups, [pointLoad(map(0, 0), v(p.F, 0, 0)), pointLoad(map(1, 0), v(0, -p.F, 0))]), options: { kind: 'static' }, quantities: { radialDisplacement: r => uAt(r, map(0, 0), 0), inwardDisplacement: r => -uAt(r, map(1, 0), 1) } };
};
/** Navier double-sine series for the center deflection of a simply supported square plate under uniform pressure. */
export function navierCenter(q: number, a: number, D: number, terms = 99): number {
  let s = 0;
  for (let m = 1; m <= terms; m += 2) for (let n = 1; n <= terms; n += 2) s += Math.sin(m * Math.PI / 2) * Math.sin(n * Math.PI / 2) / (m * n * (m * m + n * n) ** 2);
  return 16 * q * a ** 4 / (Math.PI ** 6 * D) * s;
}
/** Square plate a x a in the X-Y plane under uniform pressure. bc: 1 simply supported (hard), 2 clamped. */
const squarePlate: Builder = (p) => {
  const n = Math.round(p.n), a = p.a, mat = material('Plate', p.E, p.nu, 0, 1, 0), clamped = Math.round(p.bc) === 2;
  const map = (u: number, w: number) => v(u * a, w * a, 0);
  const { els, sups } = gridShell(n, n, map, mat, p.t, !!p.tri, (_q, u, w) => {
    const ex = near(u, 0) || near(u, 1), ey = near(w, 0) || near(w, 1);
    return join('ux uy rz', (ex || ey) && 'uz', clamped ? (ex || ey) && 'rx ry' : join(ex && 'rx', ey && 'ry') ?? false);
  });
  const D = p.E * p.t ** 3 / (12 * (1 - p.nu * p.nu));
  return {
    model: mk(els, sups, [pressureLoad(-p.q)]), options: { kind: 'static' },
    quantities: { centerDeflection: r => -uAt(r, map(0.5, 0.5), 2) },
    reference: () => ({ navier: navierCenter(p.q, a, D) }),
  };
};
/** Cantilever plate strip L x b along X, clamped at x = 0, total tip load P shared by the tip nodes. */
const plateStrip: Builder = (p) => {
  const n = Math.round(p.n), nb = Math.max(1, Math.round(p.nb ?? 2)), mat = material('Strip', p.E, 0, 0, 1, 0);
  const map = (u: number, w: number) => v(u * p.L, w * p.b, 0);
  const { els, sups } = gridShell(n, nb, map, mat, p.t, !!p.tri, (_q, u) => (near(u, 0) ? 'fixed' : null));
  const loads: LoadPart[] = [];
  for (let j = 0; j <= nb; j++) loads.push(pointLoad(map(1, j / nb), v(0, 0, -p.P / nb * (j === 0 || j === nb ? 0.5 : 1))));
  return { model: mk(els, sups, loads), options: { kind: 'static' }, quantities: { tipDeflection: r => -uAt(r, map(1, 0.5), 2) } };
};
/**
 * MacNeal–Harder patch test: a 0.24 x 0.12 rectangle meshed with five distorted quadrilaterals. Boundary nodes are
 * driven by a displacement field of constant strain (mode 1, membrane) or constant curvature (mode 2, bending);
 * the interior nodes and the element stress resultants must reproduce that field exactly.
 */
const patchTest: Builder = (p) => {
  const bending = Math.round(p.mode) === 2, mat = material('Patch', p.E, p.nu, 0, 1, 0), t = p.t;
  const O = [v(0, 0, 0), v(0.24, 0, 0), v(0.24, 0.12, 0), v(0, 0.12, 0)], I = [v(0.04, 0.02, 0), v(0.18, 0.03, 0), v(0.16, 0.08, 0), v(0.08, 0.08, 0)];
  const quads = [[O[0], O[1], I[1], I[0]], [O[1], O[2], I[2], I[1]], [O[2], O[3], I[3], I[2]], [O[3], O[0], I[0], I[3]], [I[0], I[1], I[2], I[3]]];
  const els: ElementPart[] = [];
  for (const q of quads) { if (p.tri) els.push(shell([q[0], q[1], q[2]], mat, t), shell([q[0], q[2], q[3]], mat, t)); else els.push(shell(q, mat, t)); }
  const c = 1e-3;
  const field = (q: V3): number[] => bending
    ? [0, 0, c * (q.x * q.x + q.x * q.y + q.y * q.y) / 2, c * (q.y + q.x / 2), -c * (q.x + q.y / 2), 0]
    : [c * (q.x + q.y / 2), c * (q.y + q.x / 2), 0, 0, 0, 0];
  const sups: SupportPart[] = [];
  for (const q of O) sups.push(support(q, bending ? 'fixed' : 'ux uy uz rx ry', { disp: field(q) }));
  for (const q of I) sups.push(support(q, bending ? 'ux uy rz' : 'uz rx ry'));
  const D = p.E * t ** 3 / (12 * (1 - p.nu * p.nu));
  const exact = bending ? { a: -D * (1 + p.nu) * c, b: -D * (1 - p.nu) / 2 * c } : { a: p.E / (1 - p.nu) * c * t, b: p.E / (2 * (1 + p.nu)) * c * t };
  const off = bending ? 3 : 0;
  return {
    model: mk(els, sups, [], 1e-9), options: { kind: 'static' },
    quantities: {
      // Largest error of the interior-node displacements relative to the largest exact value.
      interiorError: r => { let e = 0, s = 0; for (const q of I) { const n = nearestNode(r.model, q), f = field(q); for (let d = 0; d < 6; d++) { e = Math.max(e, Math.abs(r.cases[0].u[6 * n + d] - f[d])); s = Math.max(s, Math.abs(f[d])); } } return e / s; },
      // Largest error of the element direct / shear resultants relative to the exact constant values.
      directError: r => { let e = 0; for (let i = 0; i < r.model.shells.length; i++) for (const k of [0, 1]) e = Math.max(e, Math.abs(r.cases[0].shellS[8 * i + off + k] - exact.a)); return e / Math.abs(exact.a); },
      shearError: r => { let e = 0; for (let i = 0; i < r.model.shells.length; i++) e = Math.max(e, Math.abs(r.cases[0].shellS[8 * i + off + 2] - exact.b)); return e / Math.abs(exact.b); },
      direct: r => r.cases[0].shellS[off],
    },
    reference: () => ({ direct: exact.a, shear: exact.b }),
  };
};
Object.assign(BUILDERS, { scordelisLo, pinchedCylinder, hemisphere, squarePlate, plateStrip, patchTest });
