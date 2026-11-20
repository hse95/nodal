/**
 * Form-finding of pin-jointed networks (cable nets, membranes as edge
 * networks, hanging-chain gridshells).
 *
 *  - Force density method: with a force density q = T / l on each branch the
 *    equilibrium equations become linear in the node coordinates
 *    (Schek, "The force density method for form finding and computation of
 *    general networks", CMAME 3 (1974) 115-134).
 *  - Dynamic relaxation with kinetic damping: nodes are given fictitious
 *    masses and moved by the out-of-balance forces; whenever the kinetic
 *    energy passes a peak all velocities are reset to zero
 *    (Barnes, "Form finding and analysis of tension structures by dynamic
 *    relaxation", Int. J. Space Structures 14 (1999) 89-104).
 */
import { V3, v, dist, sub, add, mul } from './vec';
import { buildPattern, factorLDL } from '../fe/sparse';

export interface Net { pts: V3[]; edges: [number, number][]; fixed: boolean[] }

/** Merge line end points into a node/edge network; nodes within `tol` of an anchor point are fixed. */
export function buildNet(lines: { a: V3; b: V3 }[], anchors: V3[], tol = 1e-6): Net {
  const pts: V3[] = [], cells = new Map<string, number[]>(), h = Math.max(tol, 1e-9);
  const find = (p: V3): number => {
    const cx = Math.floor(p.x / h), cy = Math.floor(p.y / h), cz = Math.floor(p.z / h);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
      for (const j of cells.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) if (dist(pts[j], p) <= tol) return j;
    pts.push(p);
    const key = `${cx},${cy},${cz}`, c = cells.get(key);
    if (c) c.push(pts.length - 1); else cells.set(key, [pts.length - 1]);
    return pts.length - 1;
  };
  const edges = lines.map(l => [find(l.a), find(l.b)] as [number, number]).filter(e => e[0] !== e[1]);
  const fixed = pts.map(p => anchors.some(a => dist(a, p) <= Math.max(tol, 1e-6)));
  return { pts, edges, fixed };
}

/** Force density method. q: one value per edge; loads: one vector per node. */
export function forceDensity(net: Net, q: number[], loads: V3[]): V3[] {
  const n = net.pts.length, eq = new Int32Array(n).fill(-1);
  let nf = 0;
  for (let i = 0; i < n; i++) if (!net.fixed[i]) eq[i] = nf++;
  if (nf === 0) return net.pts.map(p => ({ ...p }));
  const D = buildPattern(nf, net.edges.map(e => Int32Array.from([eq[e[0]], eq[e[1]]])));
  const rhs = [new Float64Array(nf), new Float64Array(nf), new Float64Array(nf)];
  for (let i = 0; i < n; i++) if (eq[i] >= 0) { rhs[0][eq[i]] = loads[i].x; rhs[1][eq[i]] = loads[i].y; rhs[2][eq[i]] = loads[i].z; }
  net.edges.forEach(([a, b], k) => {
    const qe = q[k];
    D.add(eq[a], eq[a], qe); D.add(eq[b], eq[b], qe);
    if (eq[a] >= 0 && eq[b] >= 0) D.add(eq[a], eq[b], -qe);
    // Fixed neighbors move to the right-hand side.
    for (const [f, c] of [[a, b], [b, a]]) if (eq[f] >= 0 && eq[c] < 0) { const p = net.pts[c]; rhs[0][eq[f]] += qe * p.x; rhs[1][eq[f]] += qe * p.y; rhs[2][eq[f]] += qe * p.z; }
  });
  const f = factorLDL(D);
  if (f.zeroPivots.length) throw new Error('The network is not held in place: every connected part needs at least one anchor, and force densities must not be zero.');
  const xs = rhs.map(r => f.solve(r));
  return net.pts.map((p, i) => (eq[i] >= 0 ? v(xs[0][eq[i]], xs[1][eq[i]], xs[2][eq[i]]) : { ...p }));
}

export interface DROptions {
  stiffness: number[];        // axial stiffness EA of each edge (force units)
  rest: number[];             // rest (unstressed) length of each edge
  loads: V3[];                // load on each node
  tensionOnly?: boolean;      // edges go slack instead of taking compression
  anchorSpring?: number;      // optional spring tying every free node to its start position
  maxIter?: number; tol?: number;
  cancelled?: () => boolean;
}
export interface DRResult { pts: V3[]; forces: number[]; iterations: number; residual: number; converged: boolean }

export function dynamicRelaxation(net: Net, o: DROptions): DRResult {
  const n = net.pts.length, m = net.edges.length, maxIter = o.maxIter ?? 20000, tol = o.tol ?? 1e-6;
  const x = net.pts.map(p => ({ ...p })), vel = net.pts.map(() => v()), x0 = net.pts.map(p => ({ ...p }));
  const forces = new Array<number>(m).fill(0), ks = o.anchorSpring ?? 0;
  let scale = 0;
  for (const l of o.loads) scale = Math.max(scale, Math.hypot(l.x, l.y, l.z));
  for (let k = 0; k < m; k++) scale = Math.max(scale, o.stiffness[k] * Math.abs(dist(x[net.edges[k][0]], x[net.edges[k][1]]) - o.rest[k]) / Math.max(o.rest[k], 1e-12));
  scale = Math.max(scale, 1e-12);
  const residuals = (): { R: V3[]; S: number[]; max: number } => {
    const R = o.loads.map(l => ({ ...l })), S = new Array<number>(n).fill(ks);
    for (let k = 0; k < m; k++) {
      const [a, b] = net.edges[k], d = sub(x[b], x[a]), l = Math.hypot(d.x, d.y, d.z) || 1e-12, k0 = o.stiffness[k] / Math.max(o.rest[k], 1e-12);
      let T = k0 * (l - o.rest[k]);
      if (o.tensionOnly && T < 0) T = 0;
      forces[k] = T;
      const f = mul(d, T / l);
      R[a] = add(R[a], f); R[b] = sub(R[b], f);
      // Largest direct stiffness a node can see: elastic plus geometric part.
      const s = k0 + Math.abs(T) / l;
      S[a] += s; S[b] += s;
    }
    let max = 0;
    for (let i = 0; i < n; i++) {
      if (ks > 0) R[i] = add(R[i], mul(sub(x0[i], x[i]), ks));
      if (net.fixed[i]) R[i] = v(); else max = Math.max(max, Math.hypot(R[i].x, R[i].y, R[i].z));
    }
    return { R, S, max };
  };
  let keOld = 0, it = 0, res = residuals();
  for (it = 0; it < maxIter && res.max > tol * scale; it++) {
    if ((it & 255) === 0 && o.cancelled?.()) throw new Error('Form-finding cancelled');
    let ke = 0;
    for (let i = 0; i < n; i++) {
      if (net.fixed[i]) continue;
      // Fictitious mass for a unit time step: m = S / 2 keeps the explicit integration stable (with a 10 % margin).
      const mass = Math.max(0.55 * res.S[i], 1e-12);
      vel[i] = add(vel[i], mul(res.R[i], 1 / mass));
      ke += 0.5 * mass * (vel[i].x ** 2 + vel[i].y ** 2 + vel[i].z ** 2);
    }
    if (ke < keOld) {
      // Kinetic energy peak passed: step back half a step and restart from rest.
      for (let i = 0; i < n; i++) { if (!net.fixed[i]) x[i] = sub(x[i], mul(vel[i], 0.5)); vel[i] = v(); }
      keOld = 0;
    } else {
      for (let i = 0; i < n; i++) if (!net.fixed[i]) x[i] = add(x[i], vel[i]);
      keOld = ke;
    }
    res = residuals();
  }
  return { pts: x, forces: [...forces], iterations: it, residual: res.max, converged: res.max <= tol * scale };
}
