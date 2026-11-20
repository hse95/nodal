/**
 * Assembly of the global system and the linear static solution.
 *
 * DOF layout: 6 per node [ux, uy, uz, rx, ry, rz]. Nodes with a rotated
 * support carry their DOFs in the support's own axes; the rotation is folded
 * into each element's B matrix so the rest of the code does not need to know.
 *
 * DOFs that receive no stiffness from any element (for example the rotations
 * of a node that only truss bars meet at) are switched off automatically and
 * reported in the statistics. Everything else that is singular is reported as
 * a mechanism with the node and direction concerned.
 */
import { FEModel, FEBeam, nodeXYZ, nodeCount } from './model';
import { BeamKin, beamKinematics, Mat, matVec, tMatVec, congruence, lineLoadVector, localDisplacements, endForces, zeros, localGeometric, localMass } from './beam';
import { ShellGeom, shellGeometry, shellLocalK, shellTransform, shellNodalAreas, shellStress, shellGeometric, shellMass } from './shell';
import { SymCSC, buildPattern, minDegreeOrder, rcmOrder, fillCount, factorLDL, Factor } from './sparse';
import { v, len, V3 } from '../geom/vec';

export interface SolveStats {
  nodes: number; lineElements: number; shellElements: number; dofs: number; freeDofs: number; inactiveDofs: number;
  nnzK: number; nnzL: number; ordering: string;
  tAssemble: number; tFactor: number; tSolve: number; tTotal: number;
}
export interface Equilibrium { applied: number[]; reactions: number[]; error: number; relError: number; maxResidual: number }
export interface CaseResult {
  name: string;
  u: Float64Array;          // 6 per node, global axes
  reactions: Float64Array;  // 6 per node, global axes (zero where unsupported)
  beamQ: Float64Array;      // 12 local end forces per line element
  beamD: Float64Array;      // 12 local end displacements per line element
  beamW: Float64Array;      // 6 per line element: local distributed load at start (3) and end (3)
  shellS: Float64Array;     // 8 per shell: Nx, Ny, Nxy, Mx, My, Mxy, Qx, Qy (local, center)
  equilibrium: Equilibrium;
  /** 0 where a tension-/compression-only member is slack in this case. */
  active: Uint8Array | null;
  iterations: number;
}
export interface ModeResult { value: number; shape: Float64Array; label: string }
export interface FEResult {
  k: 'result';
  kind: 'static' | 'second-order' | 'buckling' | 'modal' | 'nonlinear';
  model: FEModel;
  cases: CaseResult[];
  modes: ModeResult[];
  stats: SolveStats;
  /** Warnings that the user should read. */
  messages: string[];
  /** Informational remarks (not warnings). */
  notes: string[];
  /** Load-displacement history for nonlinear runs: [load factor, displacement norm]. */
  path?: number[][];
  summary: string;
}
export class ModelError extends Error {}

const DOF_NAMES = ['translation in X', 'translation in Y', 'translation in Z', 'rotation about X', 'rotation about Y', 'rotation about Z'];
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export interface CaseLoads { F: Float64Array; feq: Float64Array; w: Float64Array }

export class FESystem {
  readonly nn: number; readonly nb: number; readonly ns: number;
  readonly kin: BeamKin[] = [];
  readonly sgeom: ShellGeom[] = [];
  /** local <- solver-DOF transformation per element (beams first, then shells). */
  readonly B: Mat[] = [];
  /** local stiffness per element (beams: before release condensation). */
  readonly kl: Mat[] = [];
  /** element stiffness in solver DOFs. */
  readonly Ke: Mat[] = [];
  readonly elNodes: number[][] = [];
  readonly nodeAxes = new Map<number, number[]>();
  readonly fixed: Uint8Array;          // 0 free, 1 supported, 2 inactive (no stiffness)
  readonly presc: Float64Array;
  readonly spring: Float64Array;
  eq!: Int32Array;
  neq = 0;
  pattern!: SymCSC;
  readonly stats: SolveStats;
  readonly messages: string[] = [];
  readonly notes: string[] = [];
  readonly unilateral: number[] = [];

  /**
   * @param keepBarTranslations nonlinear analyses keep the translations of truss/cable nodes active even when the
   *        linear stiffness in that direction is zero, because geometric stiffness appears once the bars carry force.
   */
  constructor(readonly model: FEModel, readonly cancelled: () => boolean = () => false, keepBarTranslations = false) {
    const t0 = now();
    this.nn = nodeCount(model); this.nb = model.beams.length; this.ns = model.shells.length;
    const ndof = 6 * this.nn;
    this.fixed = new Uint8Array(ndof); this.presc = new Float64Array(ndof); this.spring = new Float64Array(ndof);
    for (const s of model.supports) {
      if (s.axes) this.nodeAxes.set(s.node, s.axes);
      for (let d = 0; d < 6; d++) {
        if (s.fix[d]) { this.fixed[6 * s.node + d] = 1; if (s.disp) this.presc[6 * s.node + d] = s.disp[d]; }
        else if (s.spring && s.spring[d] > 0) this.spring[6 * s.node + d] = s.spring[d];
      }
    }
    // Element kinematics and stiffness.
    model.beams.forEach((b, i) => {
      const kin = beamKinematics(model, b);
      this.kin.push(kin);
      const B = this.foldAxes(kin.B, b.n);
      this.B.push(B); this.kl.push(kin.k); this.Ke.push(congruence(kin.k, B)); this.elNodes.push(b.n);
      if (b.type === 'cable' || b.type === 'tension' || b.type === 'compression') this.unilateral.push(i);
    });
    model.shells.forEach((s) => {
      const g = shellGeometry(s.n.map(i => nodeXYZ(model, i)));
      this.sgeom.push(g);
      const Kl = shellLocalK(g, model.materials[s.mat], s.t), B = this.foldAxes(shellTransform(g), s.n);
      this.B.push(B); this.kl.push(Kl); this.Ke.push(congruence(Kl, B)); this.elNodes.push(s.n);
    });
    // Switch off DOFs without stiffness.
    const diag = new Float64Array(ndof);
    this.Ke.forEach((K, e) => { const nd = this.elNodes[e]; nd.forEach((n, a) => { for (let d = 0; d < 6; d++) diag[6 * n + d] += Math.abs(K[6 * a + d][6 * a + d]); }); });
    for (let i = 0; i < ndof; i++) diag[i] += this.spring[i];
    let maxDiag = 0; for (let i = 0; i < ndof; i++) maxDiag = Math.max(maxDiag, diag[i]);
    let inactive = 0;
    const barNode = new Uint8Array(this.nn);
    if (keepBarTranslations) for (const b of model.beams) if (b.type !== 'beam') { barNode[b.n[0]] = 1; barNode[b.n[1]] = 1; }
    for (let i = 0; i < ndof; i++) {
      if (this.fixed[i] || diag[i] > 1e-14 * maxDiag) continue;
      if (i % 6 < 3 && barNode[Math.floor(i / 6)]) continue;
      this.fixed[i] = 2; inactive++;
    }
    // Fill-reducing node ordering, then equation numbers.
    const adjSets: Set<number>[] = Array.from({ length: this.nn }, () => new Set<number>());
    for (const nd of this.elNodes) for (const a of nd) for (const b of nd) if (a !== b) adjSets[a].add(b);
    const adj = adjSets.map(s => [...s]);
    let perm = minDegreeOrder(this.nn, adj), ordering = 'minimum degree';
    if (this.nn > 2) {
      const r = rcmOrder(this.nn, adj);
      if (fillCount(this.nn, adj, r) < fillCount(this.nn, adj, perm)) { perm = r; ordering = 'reverse Cuthill-McKee'; }
    }
    this.eq = new Int32Array(ndof).fill(-1);
    for (let k = 0; k < this.nn; k++) { const n = perm[k]; for (let d = 0; d < 6; d++) if (!this.fixed[6 * n + d]) this.eq[6 * n + d] = this.neq++; }
    this.pattern = buildPattern(this.neq, this.elNodes.map((_, e) => this.elementEqs(e)));
    this.stats = {
      nodes: this.nn, lineElements: this.nb, shellElements: this.ns, dofs: ndof, freeDofs: this.neq, inactiveDofs: inactive,
      nnzK: this.pattern.nnz, nnzL: 0, ordering, tAssemble: now() - t0, tFactor: 0, tSolve: 0, tTotal: 0,
    };
  }

  /** Express the columns of B that belong to rotated-support nodes in the support axes (u_global = Q^T u_support). */
  private foldAxes(B: Mat, nodes: number[]): Mat {
    if (!nodes.some(n => this.nodeAxes.has(n))) return B;
    const out = B.map(r => [...r]);
    nodes.forEach((n, a) => {
      const Q = this.nodeAxes.get(n);
      if (!Q) return;
      for (const off of [6 * a, 6 * a + 3]) for (let i = 0; i < B.length; i++) {
        const r = [B[i][off], B[i][off + 1], B[i][off + 2]];
        for (let j = 0; j < 3; j++) out[i][off + j] = r[0] * Q[3 * j] + r[1] * Q[3 * j + 1] + r[2] * Q[3 * j + 2];
      }
    });
    return out;
  }
  elementDofs(e: number): number[] { const out: number[] = []; for (const n of this.elNodes[e]) for (let d = 0; d < 6; d++) out.push(6 * n + d); return out; }
  elementEqs(e: number): Int32Array { return Int32Array.from(this.elementDofs(e), i => this.eq[i]); }
  /** Vector between global axes and solver axes at rotated nodes (in place). */
  toSolverAxes(f: Float64Array): void { for (const [n, Q] of this.nodeAxes) for (const o of [6 * n, 6 * n + 3]) { const a = f[o], b = f[o + 1], c = f[o + 2]; for (let i = 0; i < 3; i++) f[o + i] = Q[3 * i] * a + Q[3 * i + 1] * b + Q[3 * i + 2] * c; } }
  toGlobalAxes(f: Float64Array): void { for (const [n, Q] of this.nodeAxes) for (const o of [6 * n, 6 * n + 3]) { const a = f[o], b = f[o + 1], c = f[o + 2]; for (let i = 0; i < 3; i++) f[o + i] = Q[i] * a + Q[3 + i] * b + Q[6 + i] * c; } }

  /** Assemble sum of element matrices in solver DOFs; `get` may return null to skip an element. */
  assemble(get: (e: number) => Mat | null): SymCSC {
    const K = this.pattern.like();
    for (let e = 0; e < this.elNodes.length; e++) {
      const M = get(e);
      if (!M) continue;
      const eqs = this.elementEqs(e), n = eqs.length;
      for (let a = 0; a < n; a++) { const ia = eqs[a]; if (ia < 0) continue; const row = M[a]; for (let b = a; b < n; b++) { const ib = eqs[b]; if (ib >= 0 && row[b] !== 0) K.add(ia, ib, row[b]); } }
    }
    return K;
  }
  /** Elastic stiffness with supports springs; `scale` reduces the stiffness of slack unilateral members. */
  assembleK(scale?: Float64Array): SymCSC {
    const K = this.assemble(e => {
      if (scale && e < this.nb && scale[e] !== 1) return this.Ke[e].map(r => r.map(x => x * scale[e]));
      return this.Ke[e];
    });
    for (let i = 0; i < this.spring.length; i++) if (this.spring[i] > 0 && this.eq[i] >= 0) K.add(this.eq[i], this.eq[i], this.spring[i]);
    return K;
  }
  /** Geometric stiffness for given member axial forces (tension positive) and shell membrane forces. */
  assembleKg(axial: ArrayLike<number>, shellN?: ArrayLike<number>): SymCSC {
    return this.assemble(e => {
      if (e < this.nb) {
        if (axial[e] === 0) return null;
        const b = this.model.beams[e], kin = this.kin[e];
        return congruence(localGeometric(axial[e], this.model.sections[b.sec], kin.L, kin.axialOnly), this.B[e]);
      }
      if (!shellN) return null;
      const s = e - this.nb, Nm = [shellN[8 * s], shellN[8 * s + 1], shellN[8 * s + 2]];
      if (Nm[0] === 0 && Nm[1] === 0 && Nm[2] === 0) return null;
      return this.rotateShellGlobal(shellGeometric(this.sgeom[s], Nm), this.model.shells[s].n);
    });
  }
  assembleM(consistent: boolean): SymCSC {
    return this.assemble(e => {
      if (e < this.nb) {
        const b = this.model.beams[e], kin = this.kin[e];
        return congruence(localMass(this.model.materials[b.mat], this.model.sections[b.sec], kin.L, consistent, kin.axialOnly), this.B[e]);
      }
      const s = this.model.shells[e - this.nb];
      return this.rotateShellGlobal(shellMass(this.sgeom[e - this.nb], this.model.materials[s.mat], s.t, consistent), s.n);
    });
  }
  /** Shell matrices that are produced directly in global axes still need the support-axes rotation. */
  private rotateShellGlobal(K: Mat, nodes: number[]): Mat {
    if (!nodes.some(n => this.nodeAxes.has(n))) return K;
    const I = zeros(K.length); for (let i = 0; i < K.length; i++) I[i][i] = 1;
    return congruence(K, this.foldAxes(I, nodes));
  }

  /** Member distributed load in local axes for one load record. */
  private localLineLoad(e: number, w1g: number[], w2g: number[], sys: string): [number[], number[]] {
    const R = this.kin[e].R;
    if (sys === 'local') return [w1g, w2g];
    let f = 1;
    if (sys === 'projected') {
      // Load given per unit length measured perpendicular to its own direction (e.g. snow on plan).
      const d = v(w1g[0] + w2g[0], w1g[1] + w2g[1], w1g[2] + w2g[2]), l = len(d);
      if (l > 0) { const c = (R[0] * d.x + R[1] * d.y + R[2] * d.z) / l; f = Math.sqrt(Math.max(0, 1 - c * c)); }
    }
    const rot = (w: number[]) => [0, 1, 2].map(i => f * (R[3 * i] * w[0] + R[3 * i + 1] * w[1] + R[3 * i + 2] * w[2]));
    return [rot(w1g), rot(w2g)];
  }

  /** Load vector (solver axes) and member load records for each load case. */
  buildLoads(includePretension: boolean): CaseLoads[] {
    const m = this.model, ndof = 6 * this.nn;
    const out: CaseLoads[] = m.cases.map(() => ({ F: new Float64Array(ndof), feq: new Float64Array(12 * this.nb), w: new Float64Array(6 * this.nb) }));
    const nodal = m.cases.map(() => new Float64Array(ndof));     // loads given in global axes
    const addLine = (c: CaseLoads, e: number, w1: number[], w2: number[]) => {
      const kin = this.kin[e], f = lineLoadVector(w1, w2, kin.L, kin.phiY, kin.phiZ, kin.axialOnly);
      for (let i = 0; i < 12; i++) c.feq[12 * e + i] += f[i];
      for (let i = 0; i < 3; i++) { c.w[6 * e + i] += w1[i]; c.w[6 * e + 3 + i] += w2[i]; }
    };
    for (const l of m.loads) {
      const c = out[l.lc];
      switch (l.t) {
        case 'node': for (let d = 0; d < 6; d++) nodal[l.lc][6 * l.node + d] += l.f[d]; break;
        case 'line': { const [a, b] = this.localLineLoad(l.el, l.w1, l.w2, l.sys); addLine(c, l.el, a, b); break; }
        case 'gravity': {
          m.beams.forEach((b, e) => {
            const q = m.materials[b.mat].rho * m.sections[b.sec].A * m.g, wg = l.dir.map(x => x * q);
            const [a, bb] = this.localLineLoad(e, wg, wg, 'global'); addLine(c, e, a, bb);
          });
          m.shells.forEach((s, i) => {
            const q = m.materials[s.mat].rho * s.t * m.g, areas = shellNodalAreas(this.sgeom[i]);
            s.n.forEach((n, a) => { for (let d = 0; d < 3; d++) nodal[l.lc][6 * n + d] += q * areas[a] * l.dir[d]; });
          });
          break;
        }
        case 'temp': {
          const b = m.beams[l.el], mat = m.materials[b.mat], sec = m.sections[b.sec], o = 12 * l.el;
          const fa = mat.E * sec.A * mat.alpha * l.dT;
          c.feq[o] -= fa; c.feq[o + 6] += fa;
          if (!this.kin[l.el].axialOnly) {
            // Free thermal curvature: hotter +z fiber bows the member towards +z (w'' = -alpha*gz).
            const my = mat.E * sec.Iy * mat.alpha * l.gz, mz = mat.E * sec.Iz * mat.alpha * l.gy;
            c.feq[o + 4] -= my; c.feq[o + 10] += my; c.feq[o + 5] += mz; c.feq[o + 11] -= mz;
          }
          break;
        }
        case 'pressure': {
          const g = this.sgeom[l.el], s = m.shells[l.el], areas = shellNodalAreas(g), nrm = [g.R[6], g.R[7], g.R[8]];
          let dir = nrm, f = 1;
          if (l.dir) {
            const dl = Math.hypot(l.dir[0], l.dir[1], l.dir[2]) || 1;
            dir = l.dir.map(x => x / dl);
            if (l.projected) f = Math.abs(dir[0] * nrm[0] + dir[1] * nrm[1] + dir[2] * nrm[2]);
          }
          s.n.forEach((n, a) => { for (let d = 0; d < 3; d++) nodal[l.lc][6 * n + d] += l.p * f * areas[a] * dir[d]; });
          break;
        }
      }
    }
    out.forEach((c, lc) => {
      if (includePretension) m.beams.forEach((_b, e) => { const pre = this.effPre(e); if (pre !== 0) { c.feq[12 * e] += pre; c.feq[12 * e + 6] -= pre; } });
      this.toSolverAxes(nodal[lc]);
      c.F.set(nodal[lc]);
      for (let e = 0; e < this.nb; e++) {
        const f = tMatVec(this.B[e], c.feq.subarray(12 * e, 12 * e + 12)), dofs = this.elementDofs(e);
        for (let i = 0; i < 12; i++) c.F[dofs[i]] += f[i];
      }
      // A load on a direction that no element stiffens cannot be carried: report it instead of dropping it silently.
      let maxF = 0; for (let i = 0; i < ndof; i++) maxF = Math.max(maxF, Math.abs(c.F[i]));
      for (let i = 0; i < ndof; i++) if (this.fixed[i] === 2 && Math.abs(c.F[i]) > 1e-9 * maxF) {
        const n = Math.floor(i / 6), p = nodeXYZ(m, n);
        throw new ModelError(`Load case "${m.cases[lc]}" loads node ${n} at (${+p.x.toFixed(3)}, ${+p.y.toFixed(3)}, ${+p.z.toFixed(3)}) in ${DOF_NAMES[i % 6]}, but no element provides stiffness in that direction. For example, a truss node cannot take a moment, and a planar truss cannot take out-of-plane load.`);
      }
    });
    return out;
  }
  /**
   * Pretension used by the linear analyses: the explicit value plus the force
   * EA*(1/l0 - 1) implied by an unstressed length of l0 times the drawn length.
   */
  effPre(e: number): number {
    const b = this.model.beams[e];
    if (b.l0 === 1 || !(b.l0 > 0)) return b.pre;
    return b.pre + this.model.materials[b.mat].E * this.model.sections[b.sec].A * (1 / b.l0 - 1);
  }
  combine(loads: CaseLoads[], factors: number[]): CaseLoads {
    const c: CaseLoads = { F: new Float64Array(loads[0].F.length), feq: new Float64Array(loads[0].feq.length), w: new Float64Array(loads[0].w.length) };
    factors.forEach((f, i) => { if (f === 0) return; for (const key of ['F', 'feq', 'w'] as const) { const src = loads[i][key], dst = c[key]; for (let j = 0; j < src.length; j++) dst[j] += f * src[j]; } });
    return c;
  }

  /** Right-hand side on free DOFs, including the effect of prescribed support displacements. */
  rhs(F: Float64Array, extra?: (e: number) => Mat): Float64Array {
    const b = new Float64Array(this.neq);
    for (let i = 0; i < F.length; i++) if (this.eq[i] >= 0) b[this.eq[i]] = F[i];
    let any = false; for (let i = 0; i < this.presc.length; i++) if (this.presc[i] !== 0) { any = true; break; }
    if (any) for (let e = 0; e < this.elNodes.length; e++) {
      const dofs = this.elementDofs(e), K = extra ? extra(e) : this.Ke[e];
      for (let j = 0; j < dofs.length; j++) { const up = this.presc[dofs[j]]; if (up === 0 || this.fixed[dofs[j]] !== 1) continue; for (let i = 0; i < dofs.length; i++) { const q = this.eq[dofs[i]]; if (q >= 0) b[q] -= K[i][j] * up; } }
    }
    return b;
  }
  /** Full solver-axes displacement vector from the free-DOF solution. */
  expand(x: Float64Array): Float64Array {
    const u = new Float64Array(6 * this.nn);
    for (let i = 0; i < u.length; i++) u[i] = this.eq[i] >= 0 ? x[this.eq[i]] : (this.fixed[i] === 1 ? this.presc[i] : 0);
    return u;
  }

  factor(K: SymCSC, what = 'The structure'): Factor {
    const t0 = now();
    const f = factorLDL(K, { cancelled: this.cancelled, regularize: true });
    this.stats.tFactor += now() - t0; this.stats.nnzL = f.nnzL;
    if (f.zeroPivots.length) throw new ModelError(this.mechanismMessage(f.zeroPivots, what));
    return f;
  }
  mechanismMessage(pivots: number[], what: string): string {
    const dofOfEq = new Int32Array(this.neq);
    for (let i = 0; i < this.eq.length; i++) if (this.eq[i] >= 0) dofOfEq[this.eq[i]] = i;
    const items = pivots.slice(0, 4).map(q => {
      const dof = dofOfEq[q], n = Math.floor(dof / 6), p = nodeXYZ(this.model, n);
      return `node ${n} at (${+p.x.toFixed(3)}, ${+p.y.toFixed(3)}, ${+p.z.toFixed(3)}): ${DOF_NAMES[dof % 6]}`;
    });
    return `${what} is not stable (it is a mechanism or is not supported well enough). Unrestrained motion found at ${items.join('; ')}${pivots.length > 4 ? `; and ${pivots.length - 4} more` : ''}. Check the supports, end releases, and that truss-type members form a stable arrangement.`;
  }

  /**
   * Recover element forces, reactions and the equilibrium check for a solved
   * displacement vector (solver axes). `kgLocal` adds the geometric stiffness
   * to the member end forces in second-order analyses.
   */
  recover(name: string, uS: Float64Array, loads: CaseLoads, opt: { scale?: Float64Array; axial?: ArrayLike<number>; iterations?: number } = {}): CaseResult {
    const m = this.model, ndof = 6 * this.nn;
    const beamQ = new Float64Array(12 * this.nb), beamD = new Float64Array(12 * this.nb), shellS = new Float64Array(8 * this.ns);
    const r = new Float64Array(ndof);        // internal minus external, solver axes
    for (let e = 0; e < this.nb; e++) {
      const kin = this.kin[e], dofs = this.elementDofs(e), de = dofs.map(i => uS[i]);
      const feq = Array.from(loads.feq.subarray(12 * e, 12 * e + 12));
      const dl = localDisplacements(kin, de, feq);
      let q = endForces(kin, dl, feq);
      const sc = opt.scale ? opt.scale[e] : 1;
      if (sc !== 1) q = q.map((x, i) => (x + feq[i]) * sc - feq[i]);
      if (opt.axial && opt.axial[e] !== 0) {
        const kg = matVec(localGeometric(opt.axial[e], m.sections[m.beams[e].sec], kin.L, kin.axialOnly), dl);
        for (let i = 0; i < 12; i++) q[i] += kg[i];
      }
      beamQ.set(q, 12 * e); beamD.set(dl, 12 * e);
      // Element contribution to nodal equilibrium: B^T q for unreleased DOFs (released ones carry q = 0 by construction).
      const f = tMatVec(this.B[e], q);
      for (let i = 0; i < 12; i++) r[dofs[i]] += f[i];
    }
    for (let s = 0; s < this.ns; s++) {
      const e = this.nb + s, dofs = this.elementDofs(e), de = dofs.map(i => uS[i]), sh = m.shells[s];
      const dl = matVec(this.B[e], de), f = tMatVec(this.B[e], matVec(this.kl[e], dl));
      for (let i = 0; i < dofs.length; i++) r[dofs[i]] += f[i];
      const st = shellStress(this.sgeom[s], m.materials[sh.mat], sh.t, dl);
      shellS.set([...st.N, ...st.M, ...st.Q], 8 * s);
    }
    // External loads applied directly at nodes = F minus the member-load part already inside q.
    const direct = Float64Array.from(loads.F);
    for (let e = 0; e < this.nb; e++) {
      const f = tMatVec(this.B[e], loads.feq.subarray(12 * e, 12 * e + 12)), dofs = this.elementDofs(e);
      for (let i = 0; i < 12; i++) direct[dofs[i]] -= f[i];
    }
    for (let i = 0; i < ndof; i++) r[i] -= direct[i];
    const reactions = new Float64Array(ndof);
    let maxRes = 0, maxF = 0;
    for (let i = 0; i < ndof; i++) {
      maxF = Math.max(maxF, Math.abs(loads.F[i]));
      if (this.fixed[i] === 1) reactions[i] = r[i];
      else if (this.spring[i] > 0) reactions[i] = -this.spring[i] * uS[i];
      else maxRes = Math.max(maxRes, Math.abs(r[i]));
    }
    if (opt.axial) maxRes = 0;     // the nodal residual of a second-order solution is checked by its own iteration
    const u = Float64Array.from(uS), F = Float64Array.from(loads.F);
    this.toGlobalAxes(u); this.toGlobalAxes(reactions); this.toGlobalAxes(F);
    const applied = [0, 0, 0], react = [0, 0, 0];
    for (let n = 0; n < this.nn; n++) for (let d = 0; d < 3; d++) { applied[d] += F[6 * n + d]; react[d] += reactions[6 * n + d]; }
    const error = Math.hypot(applied[0] + react[0], applied[1] + react[1], applied[2] + react[2]);
    const ref = Math.max(Math.hypot(...applied), Math.hypot(...react), maxF, 1e-300);
    let active: Uint8Array | null = null;
    if (opt.scale) { active = new Uint8Array(this.nb).fill(1); for (const e of this.unilateral) active[e] = opt.scale[e] === 1 ? 1 : 0; }
    return { name, u, reactions, beamQ, beamD, beamW: Float64Array.from(loads.w), shellS, equilibrium: { applied, reactions: react, error, relError: error / ref, maxResidual: maxRes }, active, iterations: opt.iterations ?? 1 };
  }

  finish(kind: FEResult['kind'], cases: CaseResult[], modes: ModeResult[], t0: number, extra = ''): FEResult {
    this.stats.tTotal = now() - t0;
    const worst = cases.reduce((mx, c) => Math.max(mx, c.equilibrium.relError), 0);
    return {
      k: 'result', kind, model: this.model, cases, modes, stats: { ...this.stats }, messages: [...this.model.warnings, ...this.messages], notes: [...this.notes],
      summary: `${kind} result: ${cases.length} case${cases.length === 1 ? '' : 's'}${modes.length ? `, ${modes.length} modes` : ''}, ${this.neq} equations${cases.length ? `, equilibrium error ${worst.toExponential(1)}` : ''}${extra}`,
    };
  }
}
export { now };
export type { FEBeam, V3 };

/** Linear combination of solved cases (valid for linear analyses only). */
export function superpose(name: string, cases: CaseResult[], factors: number[]): CaseResult {
  const mix = (key: 'u' | 'reactions' | 'beamQ' | 'beamD' | 'beamW' | 'shellS') => {
    const out = new Float64Array(cases[0][key].length);
    factors.forEach((f, i) => { if (f !== 0) { const src = cases[i][key]; for (let j = 0; j < src.length; j++) out[j] += f * src[j]; } });
    return out;
  };
  const applied = [0, 0, 0], reactions = [0, 0, 0];
  let error = 0, maxResidual = 0;
  factors.forEach((f, i) => {
    const q = cases[i].equilibrium;
    for (let d = 0; d < 3; d++) { applied[d] += f * q.applied[d]; reactions[d] += f * q.reactions[d]; }
    maxResidual += Math.abs(f) * q.maxResidual;
  });
  error = Math.hypot(applied[0] + reactions[0], applied[1] + reactions[1], applied[2] + reactions[2]);
  const ref = Math.max(Math.hypot(...applied), Math.hypot(...reactions), 1e-300);
  return { name, u: mix('u'), reactions: mix('reactions'), beamQ: mix('beamQ'), beamD: mix('beamD'), beamW: mix('beamW'), shellS: mix('shellS'), equilibrium: { applied, reactions, error, relError: error / ref, maxResidual }, active: null, iterations: 1 };
}
