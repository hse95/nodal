/**
 * The direct stiffness method written out for a small frame or truss, for teaching. It uses the solver's
 * own element stiffness and transformation, assembles the structure matrix in full, applies the supports
 * and solves the remaining equations by plain Gaussian elimination. The result is compared with what the
 * solver itself returned, so the two can be seen to agree.
 */
import type { FEModel } from '../fe/model';
import { nodeCount, nodeXYZ } from '../fe/model';
import type { FEResult } from '../fe/system';
import { beamKinematics, congruence, Mat, zeros } from '../fe/beam';

export const DOF = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'];
export interface TeachElement { id: string; nodes: [number, number]; L: number; type: string; kLocal: number[][]; T: number[][]; kGlobal: number[][]; dofs: number[]; labels: string[] }
export interface Teach {
  plane: boolean;
  /** The degrees of freedom shown per node (indices into ux..rz). */
  per: number[];
  nodes: { x: number; y: number; z: number }[];
  labels: string[];
  elements: TeachElement[];
  K: number[][];
  F: number[];
  fixed: boolean[];
  free: number[];
  Kff: number[][];
  Ff: number[];
  u: number[];
  reactions: number[];
  /** Largest difference between this solution and the solver's, relative to the largest displacement. */
  agreement: number;
  caseName: string;
  notes: string[];
}
export const TEACH_LIMIT = { nodes: 10, elements: 14 };

/** Why a model cannot be shown step by step, or null if it can. */
export function teachable(m: FEModel): string | null {
  if (m.shells.length) return 'The step-by-step view covers frames and trusses; this model has shell elements.';
  if (!m.beams.length) return 'The model has no members.';
  if (nodeCount(m) > TEACH_LIMIT.nodes || m.beams.length > TEACH_LIMIT.elements) return `The step-by-step view is for small models (up to ${TEACH_LIMIT.nodes} nodes and ${TEACH_LIMIT.elements} members), where the matrices can still be read. This model has ${nodeCount(m)} nodes and ${m.beams.length} members.`;
  if (m.beams.some(b => b.type !== 'beam' && b.type !== 'truss')) return 'Cable and tension- or compression-only members are solved by iteration, which this view does not show.';
  if (m.supports.some(s => s.axes || s.spring || (s.disp && s.disp.some(d => d !== 0)))) return 'Rotated supports, spring supports and prescribed displacements are not shown in this view.';
  return null;
}
function solveDense(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-9 * Math.max(1, ...M.map(r => Math.abs(r[c])))) throw new Error('The stiffness matrix of the free degrees of freedom is singular: the structure is a mechanism.');
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}
export function teach(r: FEResult, caseIndex = 0): Teach {
  const m = r.model, why = teachable(m); if (why) throw new Error(why);
  const cr = r.cases[caseIndex]; if (!cr) throw new Error('This result has no load case to show.');
  if (r.kind !== 'static') throw new Error('The step-by-step view shows a linear static analysis.');
  const nn = nodeCount(m), nd = 6 * nn, notes: string[] = [];
  // Full 3D assembly with the solver's element matrices.
  const K = zeros(nd), kins = m.beams.map(b => beamKinematics(m, b)), kg: Mat[] = [];
  m.beams.forEach((b, e) => { const g = congruence(kins[e].k, kins[e].B), map = [0, 1, 2, 3, 4, 5].map(i => 6 * b.n[0] + i).concat([0, 1, 2, 3, 4, 5].map(i => 6 * b.n[1] + i)); kg.push(g); for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) K[map[i]][map[j]] += g[i][j]; });
  // Nodal loads: K u minus the solver's reactions gives the load vector the solver used, including the
  // equivalent nodal loads of member loads. It is recovered this way so that both solutions use the same loads.
  const uS = Array.from(cr.u), F = new Array<number>(nd).fill(0);
  for (let i = 0; i < nd; i++) { let s = 0; for (let j = 0; j < nd; j++) s += K[i][j] * uS[j]; F[i] = s - cr.reactions[i]; }
  const scaleF = Math.max(1e-12, ...F.map(Math.abs)); for (let i = 0; i < nd; i++) if (Math.abs(F[i]) < 1e-9 * scaleF) F[i] = 0;
  const fixed = new Array<boolean>(nd).fill(false); for (const s of m.supports) s.fix.forEach((f, i) => { if (f) fixed[6 * s.node + i] = true; });
  // A plane model in X-Z needs only ux, uz and ry; a plane truss only ux and uz.
  const pts = Array.from({ length: nn }, (_, i) => nodeXYZ(m, i)), flat = pts.every(p => Math.abs(p.y - pts[0].y) < 1e-9), inPlane = [0, 2, 4], out = [1, 3, 5];
  let plane = flat && F.every((f, i) => f === 0 || inPlane.includes(i % 6));
  if (plane) for (let i = 0; i < nd && plane; i++) for (let j = 0; j < nd; j++) if (inPlane.includes(i % 6) && out.includes(j % 6) && Math.abs(K[i][j]) > 1e-9 * Math.abs(K[i][i] || 1)) { plane = false; break; }
  const allTruss = m.beams.every(b => b.type === 'truss'), per = plane ? (allTruss ? [0, 2] : inPlane) : allTruss ? [0, 1, 2] : [0, 1, 2, 3, 4, 5];
  if (plane) notes.push(allTruss ? 'The model lies in the X-Z plane, so each node has two unknowns: ux and uz.' : 'The model lies in the X-Z plane and is loaded in it, so each node has three unknowns: ux, uz and the rotation ry.');
  const idx: number[] = []; for (let n = 0; n < nn; n++) for (const d of per) idx.push(6 * n + d);
  const sub = (A: number[][], rows: number[], cols: number[]) => rows.map(i => cols.map(j => A[i][j]));
  const labels = idx.map(i => `${DOF[i % 6]}${Math.floor(i / 6) + 1}`), Ks = sub(K, idx, idx), Fs = idx.map(i => F[i]), fx = idx.map(i => fixed[i]);
  // A degree of freedom with no stiffness at all (a truss node's rotation, for instance) is left out by the solver.
  const dead = Ks.map((row, i) => !fx[i] && Math.abs(row[i]) < 1e-12 * Math.max(...Ks.map((r, k) => Math.abs(r[k]))));
  const free = Ks.map((_, i) => i).filter(i => !fx[i] && !dead[i]);
  if (dead.some(Boolean)) notes.push('Degrees of freedom that no member stiffens are left out of the solution.');
  const Kff = sub(Ks, free, free), Ff = free.map(i => Fs[i]), uf = solveDense(Kff, Ff), u = new Array<number>(idx.length).fill(0);
  free.forEach((i, k) => { u[i] = uf[k]; });
  const reactions = Ks.map((row, i) => (fx[i] ? row.reduce((s, kij, j) => s + kij * u[j], 0) - Fs[i] : 0));
  const big = Math.max(1e-30, ...uS.map(Math.abs)), agreement = Math.max(...idx.map((g, i) => Math.abs(u[i] - uS[g]))) / big;
  const elements: TeachElement[] = m.beams.map((b, e) => {
    const gl = (plane ? (allTruss ? [0, 2] : inPlane) : per), gmap = [...gl, ...gl.map(i => i + 6)], Bm = kins[e].B;
    // The local degrees of freedom that take part: the axial pair for a truss member; for a frame member in a plane model, those that are driven by the in-plane global ones.
    const local = b.type === 'truss' ? [0, 6] : plane ? [...Array(12).keys()].filter(i => gmap.some(g => Math.abs(Bm[i][g]) > 1e-9)) : [...Array(12).keys()];
    const dofs = [...gl.map(i => idx.indexOf(6 * b.n[0] + i)), ...gl.map(i => idx.indexOf(6 * b.n[1] + i))];
    return { id: b.id, nodes: [b.n[0] + 1, b.n[1] + 1], L: kins[e].L, type: b.type, kLocal: sub(kins[e].k, local, local), T: sub(kins[e].B, local, gmap), kGlobal: sub(kg[e], gmap, gmap), dofs, labels: dofs.map(i => labels[i]) };
  });
  if (m.beams.some(b => b.rel.some(Boolean))) notes.push('Members with end releases: the released rotations are condensed out of the element matrix before assembly.');
  if (m.beams.some(b => b.shear && b.type === 'beam')) notes.push('The beam elements include shear deformation (Timoshenko), so their stiffness terms are slightly smaller than the textbook 12EI/L³ and 4EI/L.');
  return { plane, per, nodes: pts, labels, elements, K: Ks, F: Fs, fixed: fx, free, Kff, Ff, u, reactions, agreement, caseName: cr.name || 'load case 1', notes };
}
