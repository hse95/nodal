/**
 * Result queries: nodal values, member diagrams, envelopes, shell contours and
 * the simplified stress utilization. Pure functions of (model, result), used by
 * the viewport, the inspector, the result components and the benchmarks.
 */
import { FEModel, nodeXYZ, nodeCount, beamEnds, sectionModuli } from './model';
import type { FEResult, CaseResult } from './system';
import { beamKinematics, sectionForces, localDeflection, BeamKin } from './beam';
import { surfaceStress, principal2D, vonMises2D, shellGeometry } from './shell';
import { V3, v, dist, add, mul } from '../geom/vec';

export function nearestNode(m: FEModel, p: V3): number {
  let best = -1, bd = Infinity;
  for (let i = 0; i < nodeCount(m); i++) { const d = dist(nodeXYZ(m, i), p); if (d < bd) { bd = d; best = i; } }
  return best;
}
export function caseIndex(r: FEResult, name?: string | number): number {
  if (typeof name === 'number') return Math.min(Math.max(0, Math.round(name)), r.cases.length - 1);
  if (!name) return 0;
  const i = r.cases.findIndex(c => c.name === name);
  if (i < 0) throw new Error(`Load case "${name}" is not in the results. Available: ${r.cases.map(c => c.name).join(', ')}.`);
  return i;
}
export const nodeDisp = (c: CaseResult, n: number): number[] => Array.from(c.u.subarray(6 * n, 6 * n + 6));
export const nodeReaction = (c: CaseResult, n: number): number[] => Array.from(c.reactions.subarray(6 * n, 6 * n + 6));

const kinCache = new WeakMap<FEModel, BeamKin[]>();
export function kinOf(m: FEModel, e: number): BeamKin {
  let list = kinCache.get(m);
  if (!list) { list = []; kinCache.set(m, list); }
  return (list[e] ??= beamKinematics(m, m.beams[e]));
}
/** [N, Vy, Vz, T, My, Mz] at distance x along element e. */
export function memberForces(m: FEModel, c: CaseResult, e: number, x: number): number[] {
  const L = kinOf(m, e).L;
  return sectionForces(c.beamQ.subarray(12 * e, 12 * e + 12), Array.from(c.beamW.subarray(6 * e, 6 * e + 3)), Array.from(c.beamW.subarray(6 * e + 3, 6 * e + 6)), L, x);
}
/** Forces at n+1 equally spaced stations. */
export function memberStations(m: FEModel, c: CaseResult, e: number, n = 10): { x: number[]; f: number[][] } {
  const L = kinOf(m, e).L, x: number[] = [], f: number[][] = [];
  for (let i = 0; i <= n; i++) { x.push(L * i / n); f.push(memberForces(m, c, e, L * i / n)); }
  return { x, f };
}
/** Global position of the deflected member axis at xi (scale multiplies the displacement). */
export function memberDeflected(m: FEModel, c: CaseResult, e: number, xi: number, scale = 1): V3 {
  const kin = kinOf(m, e), b = m.beams[e], [pa, pb] = beamEnds(m, b);
  const d = Array.from(c.beamD.subarray(12 * e, 12 * e + 12));
  const [ul, vl, wl] = localDeflection(kin, d, Array.from(c.beamW.subarray(6 * e, 6 * e + 3)), Array.from(c.beamW.subarray(6 * e + 3, 6 * e + 6)), m.materials[b.mat], m.sections[b.sec], xi);
  const R = kin.R, base = add(pa, mul(v(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z), xi));
  return v(base.x + scale * (R[0] * ul + R[3] * vl + R[6] * wl), base.y + scale * (R[1] * ul + R[4] * vl + R[7] * wl), base.z + scale * (R[2] * ul + R[5] * vl + R[8] * wl));
}
/**
 * Simplified elastic stress utilization of a line element:
 *   max over stations of ( |N|/A + |My|/Wy + |Mz|/Wz ) / fy
 * This is a linear stress check only. It ignores buckling, shear, torsion and
 * every code-specific factor, and is NOT a design-code verification.
 */
export function memberUtilization(m: FEModel, c: CaseResult, e: number, stations = 8): { util: number; sigma: number; N: number } {
  const b = m.beams[e], sec = m.sections[b.sec], mat = m.materials[b.mat], { Wy, Wz } = sectionModuli(sec);
  let sigma = 0, Nmax = 0;
  for (const f of memberStations(m, c, e, stations).f) {
    const s = Math.abs(f[0]) / sec.A + (b.type === 'beam' && Wy > 0 ? Math.abs(f[4]) / Wy : 0) + (b.type === 'beam' && Wz > 0 ? Math.abs(f[5]) / Wz : 0);
    if (s > sigma) sigma = s;
    if (Math.abs(f[0]) > Math.abs(Nmax)) Nmax = f[0];
  }
  return { util: mat.fy > 0 ? sigma / mat.fy : 0, sigma, N: Nmax };
}
/** Envelope over several cases: per element and force component, the min and max over stations. */
export function memberEnvelope(m: FEModel, cases: CaseResult[], e: number, stations = 8): { min: number[]; max: number[] } {
  const min = new Array<number>(6).fill(Infinity), max = new Array<number>(6).fill(-Infinity);
  for (const c of cases) for (const f of memberStations(m, c, e, stations).f) for (let k = 0; k < 6; k++) { min[k] = Math.min(min[k], f[k]); max[k] = Math.max(max[k], f[k]); }
  return { min, max };
}
export function maxDisplacement(c: CaseResult): { value: number; node: number } {
  let value = 0, node = 0;
  for (let n = 0; n < c.u.length / 6; n++) { const d = Math.hypot(c.u[6 * n], c.u[6 * n + 1], c.u[6 * n + 2]); if (d > value) { value = d; node = n; } }
  return { value, node };
}
/** Total structural mass [kg] from line and shell elements. */
export function modelMass(m: FEModel): number {
  let mass = 0;
  m.beams.forEach((b, e) => { mass += m.materials[b.mat].rho * m.sections[b.sec].A * kinOf(m, e).L; });
  for (const s of m.shells) mass += m.materials[s.mat].rho * s.t * shellGeometry(s.n.map(i => nodeXYZ(m, i))).area;
  return mass;
}

export type ShellQuantity = 'disp' | 'ux' | 'uy' | 'uz' | 'Nx' | 'Ny' | 'Nxy' | 'Mx' | 'My' | 'Mxy' | 'Qx' | 'Qy' | 's1' | 's2' | 'vonMises' | 'N1' | 'N2' | 'M1' | 'M2';
/** One value per shell element (stress quantities) for contour plots. */
export function shellElementValue(m: FEModel, c: CaseResult, s: number, q: ShellQuantity, layer: 'top' | 'mid' | 'bottom' = 'top'): number {
  const o = 8 * s, S = c.shellS, t = m.shells[s].t;
  const st = { N: [S[o], S[o + 1], S[o + 2]], M: [S[o + 3], S[o + 4], S[o + 5]], Q: [S[o + 6], S[o + 7]] };
  switch (q) {
    case 'Nx': return st.N[0]; case 'Ny': return st.N[1]; case 'Nxy': return st.N[2];
    case 'Mx': return st.M[0]; case 'My': return st.M[1]; case 'Mxy': return st.M[2];
    case 'Qx': return st.Q[0]; case 'Qy': return st.Q[1];
    case 'N1': return principal2D(st.N[0], st.N[1], st.N[2]).s1; case 'N2': return principal2D(st.N[0], st.N[1], st.N[2]).s2;
    case 'M1': return principal2D(st.M[0], st.M[1], st.M[2]).s1; case 'M2': return principal2D(st.M[0], st.M[1], st.M[2]).s2;
    case 's1': case 's2': case 'vonMises': {
      const [sx, sy, sxy] = surfaceStress(st, t, layer);
      if (q === 'vonMises') return vonMises2D(sx, sy, sxy);
      const p = principal2D(sx, sy, sxy); return q === 's1' ? p.s1 : p.s2;
    }
    default: {
      let sum = 0;
      for (const n of m.shells[s].n) sum += q === 'disp' ? Math.hypot(c.u[6 * n], c.u[6 * n + 1], c.u[6 * n + 2]) : c.u[6 * n + (q === 'ux' ? 0 : q === 'uy' ? 1 : 2)];
      return sum / m.shells[s].n.length;
    }
  }
}
/** Nodal values for smooth contours: displacements directly, stresses averaged from the adjoining elements. */
export function shellNodalValues(m: FEModel, c: CaseResult, q: ShellQuantity, layer: 'top' | 'mid' | 'bottom' = 'top'): Float64Array {
  const nn = nodeCount(m), out = new Float64Array(nn);
  if (q === 'disp' || q === 'ux' || q === 'uy' || q === 'uz') {
    for (let n = 0; n < nn; n++) out[n] = q === 'disp' ? Math.hypot(c.u[6 * n], c.u[6 * n + 1], c.u[6 * n + 2]) : c.u[6 * n + (q === 'ux' ? 0 : q === 'uy' ? 1 : 2)];
    return out;
  }
  const cnt = new Uint16Array(nn);
  m.shells.forEach((sh, s) => { const val = shellElementValue(m, c, s, q, layer); for (const n of sh.n) { out[n] += val; cnt[n]++; } });
  for (let n = 0; n < nn; n++) if (cnt[n]) out[n] /= cnt[n];
  return out;
}
/** Principal direction (global unit vector) of the surface stress at the shell center, with its two principal values. */
export function shellPrincipal(m: FEModel, c: CaseResult, s: number, layer: 'top' | 'mid' | 'bottom' = 'top'): { o: V3; d1: V3; d2: V3; s1: number; s2: number } {
  const g = shellGeometry(m.shells[s].n.map(i => nodeXYZ(m, i))), o = 8 * s, S = c.shellS;
  const [sx, sy, sxy] = surfaceStress({ N: [S[o], S[o + 1], S[o + 2]], M: [S[o + 3], S[o + 4], S[o + 5]], Q: [0, 0] }, m.shells[s].t, layer);
  const p = principal2D(sx, sy, sxy), cs = Math.cos(p.angle), sn = Math.sin(p.angle), R = g.R;
  const dir = (a: number, b: number) => v(a * R[0] + b * R[3], a * R[1] + b * R[4], a * R[2] + b * R[5]);
  return { o: g.origin, d1: dir(cs, sn), d2: dir(-sn, cs), s1: p.s1, s2: p.s2 };
}
