/**
 * Analyses: model checks, linear static, second-order (P-Delta and P-delta),
 * linear buckling, modal, and geometrically nonlinear cable analysis.
 * Everything here is synchronous and DOM-free so it runs unchanged inside a
 * Web Worker (the app) and in Node (tests and CI).
 */
import { FEModel, nodeXYZ, nodeCount } from './model';
import { FESystem, FEResult, CaseResult, CaseLoads, ModeResult, ModelError, superpose, now } from './system';
import { SymCSC, Factor, factorLDL, jacobiEigen, denseCholesky } from './sparse';
import { dist, V3 } from '../geom/vec';

export interface AnalysisOptions {
  kind: 'static' | 'second-order' | 'buckling' | 'modal' | 'nonlinear';
  /** Load case or combination used by second-order, buckling and nonlinear runs ('' = every combination, or every case when there are none). */
  loadSet?: string;
  modes?: number;
  consistentMass?: boolean;
  tol?: number;
  maxIter?: number;
  steps?: number;
  arcLength?: boolean;
}

// ---- model checks ---------------------------------------------------------------
/** Checks that can be made before any matrix is built. Throws ModelError for fatal problems; returns warnings. */
export function checkModel(m: FEModel): string[] {
  const warn: string[] = [];
  const nn = nodeCount(m);
  if (m.beams.length + m.shells.length === 0) throw new ModelError('The model has no elements. Connect line or shell elements to the Assemble component.');
  if (m.supports.length === 0) throw new ModelError('The model has no supports, so it can move freely. Add at least one Support component.');
  const zero = m.beams.filter(b => b.n[0] === b.n[1]);
  if (zero.length) throw new ModelError(`${zero.length} line element(s) have zero length (start and end merge into one node), e.g. element "${zero[0].id}". Remove them or reduce the merge tolerance.`);
  const badShell = m.shells.filter(s => new Set(s.n).size !== s.n.length);
  if (badShell.length) throw new ModelError(`${badShell.length} shell element(s) are degenerate (two corners merge into one node), e.g. "${badShell[0].id}". Use a finer merge tolerance or a cleaner mesh.`);
  m.materials.forEach(mat => { if (!(mat.E > 0) || !(mat.G > 0)) throw new ModelError(`Material "${mat.name}" needs a positive Young's modulus and shear modulus.`); });
  for (const b of m.beams) {
    const s = m.sections[b.sec];
    if (!s || !(s.A > 0)) throw new ModelError(`Element "${b.id}" has no valid cross-section (area must be positive).`);
    if (b.type === 'beam' && (!(s.Iy > 0) || !(s.Iz > 0) || !(s.J > 0))) throw new ModelError(`Section "${s.name}" on element "${b.id}" needs positive Iy, Iz and J to act as a beam. Use a truss member if only axial stiffness is wanted.`);
  }
  for (const s of m.shells) if (!(s.t > 0)) throw new ModelError(`Shell element "${s.id}" needs a positive thickness.`);
  const seen = new Map<string, number>();
  let dup = 0;
  for (const b of m.beams) { const key = b.n[0] < b.n[1] ? `${b.n[0]}_${b.n[1]}` : `${b.n[1]}_${b.n[0]}`; seen.set(key, (seen.get(key) ?? 0) + 1); }
  for (const c of seen.values()) if (c > 1) dup += c - 1;
  for (const s of m.shells) { const key = 's' + [...s.n].sort((a, b) => a - b).join('_'); const c = (seen.get(key) ?? 0) + 1; seen.set(key, c); if (c > 1) dup++; }
  if (dup) warn.push(`${dup} duplicate element(s) share exactly the same nodes as another element. Their stiffness is counted twice.`);
  // Connectivity: every separate part needs at least one support.
  const parent = Int32Array.from({ length: nn }, (_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };
  for (const b of m.beams) union(b.n[0], b.n[1]);
  for (const s of m.shells) for (let i = 1; i < s.n.length; i++) union(s.n[0], s.n[i]);
  const supported = new Set(m.supports.map(s => find(s.node)));
  const roots = new Set<number>();
  for (let i = 0; i < nn; i++) roots.add(find(i));
  for (const r of roots) if (!supported.has(r)) {
    const p = nodeXYZ(m, r);
    throw new ModelError(`The model has ${roots.size} separate parts and the part containing the node at (${+p.x.toFixed(3)}, ${+p.y.toFixed(3)}, ${+p.z.toFixed(3)}) has no support. Elements that should meet may be missing each other: check the geometry or increase the merge tolerance.`);
  }
  if (roots.size > 1) warn.push(`The model consists of ${roots.size} separate parts that are not connected to each other.`);
  return warn;
}

const axialOf = (c: CaseResult, nb: number): Float64Array => { const N = new Float64Array(nb); for (let e = 0; e < nb; e++) N[e] = (c.beamQ[12 * e + 6] - c.beamQ[12 * e]) / 2; return N; };

/** Load sets to analyse one at a time: named set, else all combinations, else all cases. */
function loadSets(sys: FESystem, loads: CaseLoads[], name?: string): { name: string; loads: CaseLoads }[] {
  const m = sys.model;
  const all = [...m.cases.map((n, i) => ({ name: n, loads: loads[i] })), ...m.combos.map(c => ({ name: c.name, loads: sys.combine(loads, c.factors) }))];
  if (name) {
    const hit = all.find(s => s.name === name);
    if (!hit) throw new ModelError(`Load case or combination "${name}" is not in the model. Available: ${all.map(s => s.name).join(', ')}.`);
    return [hit];
  }
  return m.combos.length ? all.slice(m.cases.length) : all;
}

// ---- linear static ----------------------------------------------------------------
/** Effective pretension of a cable: explicit pretension plus the force implied by an unstressed-length factor. */
function addPretension(sys: FESystem, c: CaseLoads, scale?: Float64Array): CaseLoads {
  const out: CaseLoads = { F: Float64Array.from(c.F), feq: Float64Array.from(c.feq), w: c.w };
  sys.model.beams.forEach((_b, e) => {
    const pre = sys.effPre(e);
    if (pre === 0 || (scale && scale[e] !== 1)) return;
    const f = new Array<number>(12).fill(0); f[0] = pre; f[6] = -pre;
    out.feq[12 * e] += pre; out.feq[12 * e + 6] -= pre;
    const B = sys.B[e], dofs = sys.elementDofs(e);
    for (let j = 0; j < 12; j++) out.F[dofs[j]] += B[0][j] * f[0] + B[6][j] * f[6];
  });
  return out;
}
const SLACK = 1e-9;
/** One load set with tension-/compression-only members: iterate on the set of active members. */
function solveUnilateral(sys: FESystem, name: string, base: CaseLoads, maxIter = 60): CaseResult {
  const scale = new Float64Array(sys.nb).fill(1);
  let last: { u: Float64Array; loads: CaseLoads } | null = null, it = 0;
  for (it = 1; it <= maxIter; it++) {
    const loads = addPretension(sys, base, scale);
    const f = sys.factor(sys.assembleK(scale), 'With the slack members removed, the structure');
    const u = sys.expand(f.solve(sys.rhs(loads.F)));
    last = { u, loads };
    let changed = false;
    for (const e of sys.unilateral) {
      const b = sys.model.beams[e], kin = sys.kin[e], dofs = sys.elementDofs(e);
      // Axial force the member would carry if it were active.
      let ext = 0;
      for (let j = 0; j < 12; j++) ext += (sys.B[e][6][j] - sys.B[e][0][j]) * u[dofs[j]];
      const N = kin.k[0][0] * ext + sys.effPre(e) - (base.feq[12 * e + 6] - base.feq[12 * e]) / 2;
      const want = b.type === 'compression' ? N < 0 : N > 0;
      if (want !== (scale[e] === 1)) { scale[e] = want ? 1 : SLACK; changed = true; }
    }
    if (!changed) break;
  }
  if (it > maxIter) sys.messages.push(`Load set "${name}": the set of active tension/compression-only members did not settle after ${maxIter} iterations; results are from the last iteration.`);
  return sys.recover(name, last!.u, last!.loads, { scale, iterations: Math.min(it, maxIter) });
}

export function solveStatic(model: FEModel, cancelled?: () => boolean): FEResult {
  const t0 = now(), warn = checkModel(model);
  const sys = new FESystem(model, cancelled);
  sys.messages.push(...warn);
  const loads = sys.buildLoads(false);
  let cases: CaseResult[];
  if (sys.unilateral.length === 0) {
    const f = sys.factor(sys.assembleK());
    const ts = now();
    cases = loads.map((c, i) => sys.recover(model.cases[i], sys.expand(f.solve(sys.rhs(c.F))), c));
    for (const cb of model.combos) cases.push(superpose(cb.name, cases.slice(0, model.cases.length), cb.factors));
    sys.stats.tSolve = now() - ts;
  } else {
    // Unilateral members make the problem nonlinear, so superposition is not valid: each set is solved on its own.
    const sets = [...model.cases.map((n, i) => ({ name: n, loads: loads[i] })), ...model.combos.map(c => ({ name: c.name, loads: sys.combine(loads, c.factors) }))];
    cases = sets.map(s => solveUnilateral(sys, s.name, s.loads));
    sys.messages.push('The model contains tension-only, compression-only or cable members: every load case and combination was solved separately (no superposition).');
  }
  if (sys.stats.inactiveDofs) sys.messages.push(`${sys.stats.inactiveDofs} degrees of freedom without any stiffness (e.g. rotations at pure truss nodes) were switched off automatically.`);
  for (const c of cases) if (c.equilibrium.relError > 1e-6) sys.messages.push(`Load set "${c.name}": equilibrium check is off by ${(c.equilibrium.relError * 100).toExponential(2)} %. The model may be ill-conditioned.`);
  return sys.finish('static', cases, [], t0);
}

// ---- second-order -------------------------------------------------------------------
/**
 * Second-order elastic analysis: K + Kg(N) is re-formed with the current
 * member axial forces (and shell membrane forces) until the displacements
 * stop changing. Because Kg is the consistent matrix built on cubic shape
 * functions it captures both sway (P-Delta) and member-curvature (P-delta)
 * effects; the latter improves with more elements per member.
 */
export function solveSecondOrder(model: FEModel, opt: AnalysisOptions, cancelled?: () => boolean): FEResult {
  const t0 = now(), warn = checkModel(model);
  const sys = new FESystem(model, cancelled);
  sys.messages.push(...warn);
  if (sys.unilateral.length) sys.messages.push('Tension/compression-only members are treated as ordinary two-way truss members in second-order analysis.');
  const loads = sys.buildLoads(true), K = sys.assembleK(), f0 = sys.factor(K);
  const tol = opt.tol ?? 1e-8, maxIter = opt.maxIter ?? 50;
  const cases: CaseResult[] = [];
  for (const set of loadSets(sys, loads, opt.loadSet)) {
    const b = sys.rhs(set.loads.F);
    let u = sys.expand(f0.solve(b));
    let res = sys.recover(set.name, u, set.loads), it = 0, converged = false;
    for (it = 1; it <= maxIter; it++) {
      const N = axialOf(res, sys.nb);
      const Kt = K.axpy(1, sys.assembleKg(N, res.shellS));
      const f = factorLDL(Kt, { cancelled });
      if (f.zeroPivots.length || f.negativePivots > 0) {
        throw new ModelError(`Load set "${set.name}" is at or above the elastic buckling load of the structure, so a second-order equilibrium state does not exist. Run a buckling analysis to see the critical load factor.`);
      }
      const un = sys.expand(f.solve(b));
      let dn = 0, nn = 0;
      for (let i = 0; i < un.length; i++) { dn += (un[i] - u[i]) ** 2; nn += un[i] ** 2; }
      u = un;
      res = sys.recover(set.name, u, set.loads, { axial: N, iterations: it });
      if (Math.sqrt(dn) <= tol * Math.sqrt(nn) + 1e-300) { converged = true; break; }
    }
    if (!converged) sys.messages.push(`Load set "${set.name}": second-order iteration did not converge in ${maxIter} iterations.`);
    cases.push(res);
  }
  return sys.finish('second-order', cases, [], t0);
}

// ---- eigenvalue problems ---------------------------------------------------------------
/**
 * Subspace iteration for the smallest eigenvalues of K x = lambda B x with K
 * positive definite and B symmetric (mass, or minus the geometric stiffness).
 * Each sweep applies K^-1 B to a block of vectors, orthonormalises it, and
 * solves the projected problem exactly (Bathe, "Finite Element Procedures",
 * section 11.6). Returned eigenvalues are the smallest positive ones.
 */
export function subspaceIteration(K: SymCSC, fK: Factor, B: SymCSC, p: number, cancelled?: () => boolean): { values: number[]; vectors: Float64Array[]; iterations: number } {
  const n = K.n;
  if (n === 0) return { values: [], vectors: [], iterations: 0 };
  let q = Math.min(n, Math.max(2 * p, p + 8));
  // Start block: B * ones, unit vectors on the largest B/K diagonal ratios, then pseudo-random fill.
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  let X: Float64Array[] = [];
  for (let j = 0; j < q; j++) { const x = new Float64Array(n); for (let i = 0; i < n; i++) x[i] = j === 0 ? 1 : rnd(); X.push(x); }
  let prev: number[] = [], values: number[] = [], it = 0;
  const dotv = (a: Float64Array, b: Float64Array) => { let s = 0; for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; };
  for (it = 1; it <= 80; it++) {
    if (cancelled?.()) throw new Error('Analysis cancelled');
    // Inverse iteration step and orthonormalisation (modified Gram–Schmidt, twice for stability).
    const Q: Float64Array[] = [];
    for (const x of X) {
      const y = fK.solve(B.mul(x));
      const n0 = Math.sqrt(dotv(y, y));
      for (let pass = 0; pass < 2; pass++) for (const qv of Q) { const c = dotv(qv, y); for (let i = 0; i < n; i++) y[i] -= c * qv[i]; }
      const nrm = Math.sqrt(dotv(y, y));
      if (nrm > 1e-10 * n0 && nrm > 0) { for (let i = 0; i < n; i++) y[i] /= nrm; Q.push(y); }
    }
    q = Q.length;
    if (q === 0) return { values: [], vectors: [], iterations: it };
    const KQ = Q.map(x => K.mul(x)), BQ = Q.map(x => B.mul(x));
    const Kr = Q.map(a => KQ.map(kb => dotv(a, kb))), Br = Q.map(a => BQ.map(bb => dotv(a, bb)));
    for (let i = 0; i < q; i++) for (let j = i + 1; j < q; j++) { Kr[i][j] = Kr[j][i] = (Kr[i][j] + Kr[j][i]) / 2; Br[i][j] = Br[j][i] = (Br[i][j] + Br[j][i]) / 2; }
    // Reduced problem via Cholesky of Kr:  (L^-1 Br L^-T) y = mu y,  mu = 1/lambda.
    const L = denseCholesky(Kr);
    const fwd = (M: number[][]) => { // solve L * Z = M (columns)
      const Z = M.map(r => [...r]);
      for (let c = 0; c < q; c++) for (let i = 0; i < q; i++) { let s = Z[i][c]; for (let k = 0; k < i; k++) s -= L[i][k] * Z[k][c]; Z[i][c] = s / L[i][i]; }
      return Z;
    };
    const T1 = fwd(Br), T1t = T1[0].map((_, j) => T1.map(r => r[j])), C = fwd(T1t);
    for (let i = 0; i < q; i++) for (let j = i + 1; j < q; j++) C[i][j] = C[j][i] = (C[i][j] + C[j][i]) / 2;
    const eig = jacobiEigen(C);
    const order = eig.values.map((mu, i) => ({ mu, i })).sort((a, b) => b.mu - a.mu);     // largest mu first
    const Xn: Float64Array[] = [];
    values = [];
    for (const { mu, i } of order) {
      // z = L^-T y
      const z = new Array<number>(q).fill(0);
      for (let r = q - 1; r >= 0; r--) { let s = eig.vectors[r][i]; for (let k = r + 1; k < q; k++) s -= L[k][r] * z[k]; z[r] = s / L[r][r]; }
      const x = new Float64Array(n);
      for (let k = 0; k < q; k++) { const c = z[k], qk = Q[k]; if (c !== 0) for (let r = 0; r < n; r++) x[r] += c * qk[r]; }
      Xn.push(x); values.push(mu > 0 ? 1 / mu : Infinity);
    }
    X = Xn;
    const m = Math.min(p, values.length);
    let done = prev.length >= m;
    for (let i = 0; i < m && done; i++) if (!(Math.abs(values[i] - prev[i]) <= 1e-10 * Math.abs(values[i]))) done = false;
    prev = values.slice();
    if (done) break;
  }
  const keep = values.map((val, i) => ({ val, i })).filter(o => Number.isFinite(o.val)).slice(0, p);
  return { values: keep.map(o => o.val), vectors: keep.map(o => X[o.i]), iterations: it };
}

/** Scale a mode so that its largest translation is 1 and return it in global axes. */
function modeShape(sys: FESystem, x: Float64Array): Float64Array {
  const u = sys.expand(x);
  for (let i = 0; i < u.length; i++) if (sys.fixed[i]) u[i] = 0;
  sys.toGlobalAxes(u);
  let mx = 0, sign = 1;
  for (let nIdx = 0; nIdx < sys.nn; nIdx++) for (let d = 0; d < 3; d++) { const a = u[6 * nIdx + d]; if (Math.abs(a) > mx) { mx = Math.abs(a); sign = Math.sign(a) || 1; } }
  if (mx === 0) for (let i = 0; i < u.length; i++) mx = Math.max(mx, Math.abs(u[i]));
  if (mx > 0) for (let i = 0; i < u.length; i++) u[i] *= sign / mx;
  return u;
}

/** Linear buckling: (K + lambda Kg(N_ref)) phi = 0 with N_ref from a linear static solution of the reference load set. */
export function solveBuckling(model: FEModel, opt: AnalysisOptions, cancelled?: () => boolean): FEResult {
  const t0 = now(), warn = checkModel(model);
  const sys = new FESystem(model, cancelled);
  sys.messages.push(...warn);
  const loads = sys.buildLoads(true), K = sys.assembleK(), f = sys.factor(K);
  const set = loadSets(sys, loads, opt.loadSet)[0];
  const ref = sys.recover(set.name, sys.expand(f.solve(sys.rhs(set.loads.F))), set.loads);
  const Kg = sys.assembleKg(axialOf(ref, sys.nb), ref.shellS);
  let any = false; for (let i = 0; i < Kg.val.length; i++) if (Kg.val[i] !== 0) { any = true; break; }
  if (!any) throw new ModelError(`Load set "${set.name}" produces no axial or membrane forces, so there is nothing to buckle.`);
  const B = K.like(); for (let i = 0; i < B.val.length; i++) B.val[i] = -Kg.val[i];
  const ts = now();
  const eig = subspaceIteration(K, f, B, opt.modes ?? 6, cancelled);
  sys.stats.tSolve = now() - ts;
  if (!eig.values.length) throw new ModelError(`Load set "${set.name}" only puts the structure in tension: no positive buckling load factor exists.`);
  const modes: ModeResult[] = eig.values.map((val, i) => ({ value: val, shape: modeShape(sys, eig.vectors[i]), label: `Mode ${i + 1}: load factor ${val.toPrecision(6)}` }));
  if (modes[0].value < 1) sys.messages.push(`The first buckling load factor is ${modes[0].value.toPrecision(4)} (< 1): load set "${set.name}" exceeds the elastic critical load.`);
  return sys.finish('buckling', [ref], modes, t0, `, reference load set "${set.name}"`);
}

/** Natural frequencies and mode shapes: K phi = omega^2 M phi. */
export function solveModal(model: FEModel, opt: AnalysisOptions, cancelled?: () => boolean): FEResult {
  const t0 = now(), warn = checkModel(model);
  const sys = new FESystem(model, cancelled);
  sys.messages.push(...warn);
  const K = sys.assembleK(), f = sys.factor(K), M = sys.assembleM(opt.consistentMass !== false);
  let any = false; for (let i = 0; i < M.val.length; i++) if (M.val[i] !== 0) { any = true; break; }
  if (!any) throw new ModelError('The model has no mass. Give the materials a density greater than zero.');
  const ts = now();
  const eig = subspaceIteration(K, f, M, opt.modes ?? 6, cancelled);
  sys.stats.tSolve = now() - ts;
  const modes: ModeResult[] = eig.values.map((val, i) => {
    const hz = Math.sqrt(val) / (2 * Math.PI);
    return { value: hz, shape: modeShape(sys, eig.vectors[i]), label: `Mode ${i + 1}: ${hz.toPrecision(5)} Hz (T = ${(1 / hz).toPrecision(4)} s)` };
  });
  return sys.finish('modal', [], modes, t0, opt.consistentMass !== false ? ', consistent mass' : ', lumped mass');
}

// ---- geometrically nonlinear analysis ------------------------------------------------------
/**
 * Large-displacement analysis by Newton–Raphson with load steps, or by the
 * cylindrical arc-length method (Crisfield 1981) when `arcLength` is set.
 *
 * Kinematics: truss, cable and tension/compression-only members use an exact
 * co-rotational bar (engineering strain on the current chord), so cable
 * structures and snap-through of bar assemblies are followed correctly. Frame
 * and shell elements are kept geometrically LINEAR in this analysis; use the
 * second-order analysis for sway and member-buckling effects in frames. This
 * limitation is stated in the theory manual and returned as a message.
 *
 * Robustness: slack cables give a singular tangent. The Newton step is then
 * regularised (K + mu*I, Levenberg–Marquardt style) and accepted only if it
 * lowers the total potential energy, which makes the iteration behave like a
 * safeguarded energy minimisation for cable nets.
 */
export function solveNonlinear(model: FEModel, opt: AnalysisOptions, cancelled?: () => boolean): FEResult {
  const t0 = now(), warn = checkModel(model);
  const sys = new FESystem(model, cancelled, true);
  sys.messages.push(...warn);
  const bars: number[] = [], linear: number[] = [];
  model.beams.forEach((b, e) => (b.type === 'beam' ? linear : bars).push(e));
  if (linear.length || sys.ns) sys.messages.push('Frame and shell elements are geometrically linear in this analysis; only truss and cable members follow large displacements.');
  if (bars.length === 0) sys.messages.push('The model has no truss or cable members, so the nonlinear analysis reduces to a linear one.');
  const loads = sys.buildLoads(false);
  const nSteps = Math.max(1, Math.round(opt.steps ?? 10)), tol = opt.tol ?? 1e-8, maxIter = opt.maxIter ?? 200;
  const ndof = 6 * sys.nn, neq = sys.neq;
  // Linear part of the stiffness (frames, shells, springs).
  const Klin = sys.assemble(e => (e >= sys.nb || model.beams[e].type === 'beam' ? sys.Ke[e] : null));
  for (let i = 0; i < ndof; i++) if (sys.spring[i] > 0 && sys.eq[i] >= 0) Klin.add(sys.eq[i], sys.eq[i], sys.spring[i]);
  const barData = bars.map(e => {
    const b = model.beams[e], mat = model.materials[b.mat], sec = model.sections[b.sec];
    const L0 = dist(nodeXYZ(model, b.n[0]), nodeXYZ(model, b.n[1])), EA = mat.E * sec.A;
    // Natural (unstressed) length: the drawn length times the slack factor, shortened by any pretension.
    return { e, n: b.n, EA, Ln: L0 * (b.l0 > 0 ? b.l0 : 1) / (1 + b.pre / EA), type: b.type };
  });
  const X0 = model.nodes;

  /** Internal force (solver axes are assumed global here), bar tangent, strain energy and bar forces at displacement u. */
  const evaluate = (u: Float64Array, wantK: boolean) => {
    const fint = new Float64Array(ndof), Kt = wantK ? Klin.axpy(0, Klin) : null, Nbar = new Float64Array(barData.length);
    let energy = 0;
    // Linear elements: f = Ke u, energy = 0.5 u^T Ke u.
    for (let e = 0; e < sys.elNodes.length; e++) {
      if (e < sys.nb && model.beams[e].type !== 'beam') continue;
      const dofs = sys.elementDofs(e), Ke = sys.Ke[e];
      for (let i = 0; i < dofs.length; i++) { let s = 0; for (let j = 0; j < dofs.length; j++) s += Ke[i][j] * u[dofs[j]]; fint[dofs[i]] += s; energy += 0.5 * s * u[dofs[i]]; }
    }
    for (let i = 0; i < ndof; i++) if (sys.spring[i] > 0) { fint[i] += sys.spring[i] * u[i]; energy += 0.5 * sys.spring[i] * u[i] * u[i]; }
    barData.forEach((bd, k) => {
      const [a, b] = bd.n;
      const d = [0, 1, 2].map(i => X0[3 * b + i] + u[6 * b + i] - X0[3 * a + i] - u[6 * a + i]);
      const l = Math.hypot(d[0], d[1], d[2]), ex = d.map(x => x / l);
      let N = bd.EA * (l - bd.Ln) / bd.Ln, active = true;
      if ((bd.type === 'cable' || bd.type === 'tension') && N < 0) { N = 0; active = false; }
      if (bd.type === 'compression' && N > 0) { N = 0; active = false; }
      Nbar[k] = N;
      if (active) energy += 0.5 * bd.EA * (l - bd.Ln) ** 2 / bd.Ln;
      for (let i = 0; i < 3; i++) { fint[6 * a + i] -= N * ex[i]; fint[6 * b + i] += N * ex[i]; }
      if (Kt) {
        const km = active ? bd.EA / bd.Ln : 0, kgeo = N / l;
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
          const val = km * ex[i] * ex[j] + kgeo * ((i === j ? 1 : 0) - ex[i] * ex[j]);
          if (val === 0) continue;
          const ai = sys.eq[6 * a + i], aj = sys.eq[6 * a + j], bi = sys.eq[6 * b + i], bj = sys.eq[6 * b + j];
          if (j >= i) { Kt.add(ai, aj, val); Kt.add(bi, bj, val); }
          Kt.add(ai, bj, -val);
        }
      }
    });
    return { fint, Kt, energy, Nbar };
  };
  if (sys.nodeAxes.size && bars.length) sys.messages.push('Rotated supports are treated as global-axis supports for truss and cable members in nonlinear analysis.');

  const freeOf = (full: Float64Array) => { const b = new Float64Array(neq); for (let i = 0; i < ndof; i++) if (sys.eq[i] >= 0) b[sys.eq[i]] = full[i]; return b; };
  const norm = (a: Float64Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s); };
  const cases: CaseResult[] = [];
  const path: number[][] = [[0, 0]];

  for (const set of loadSets(sys, loads, opt.loadSet)) {
    const Fext = set.loads.F, Ff = freeOf(Fext), fn = Math.max(norm(Ff), 1e-12);
    const u = new Float64Array(ndof);
    let totalIt = 0, lambda = 0;
    const addTo = (x: Float64Array, s: number) => { for (let i = 0; i < ndof; i++) if (sys.eq[i] >= 0) u[i] += s * x[sys.eq[i]]; };
    const trial = (x: Float64Array, s: number) => { const t = Float64Array.from(u); for (let i = 0; i < ndof; i++) if (sys.eq[i] >= 0) t[i] += s * x[sys.eq[i]]; return t; };
    const potential = (uu: Float64Array, lam: number, energy: number) => { let w = 0; for (let i = 0; i < ndof; i++) w += Fext[i] * uu[i]; return energy - lam * w; };
    const factorReg = (Kt: SymCSC, mu0: number): { f: Factor; mu: number } => {
      const dg = Kt.diagonal(); let avg = 0; for (let i = 0; i < neq; i++) avg += Math.abs(dg[i]);
      avg = Math.max(avg / Math.max(neq, 1), 1e-6 * (barData[0]?.EA ?? 1));
      let mu = mu0;
      for (let k = 0; k < 60; k++) {
        const A = mu > 0 ? Kt.axpy(0, Kt) : Kt;
        if (mu > 0) for (let i = 0; i < neq; i++) A.add(i, i, mu * avg);
        const f = factorLDL(A, { cancelled });
        if (!f.zeroPivots.length && f.negativePivots === 0) return { f, mu };
        if (opt.arcLength && !f.zeroPivots.length) return { f, mu };       // negative pivots are expected past a limit point
        mu = mu === 0 ? 1e-8 : mu * 10;
      }
      throw new ModelError('The tangent stiffness stays singular: the structure is a mechanism even when loaded. Check supports and connectivity.');
    };

    if (!opt.arcLength) {
      let mu = 0;
      for (let step = 1; step <= nSteps; step++) {
        lambda = step / nSteps;
        let converged = false;
        for (let it = 0; it < maxIter; it++) {
          totalIt++;
          const st = evaluate(u, true);
          const r = new Float64Array(neq); const fi = freeOf(st.fint);
          for (let i = 0; i < neq; i++) r[i] = lambda * Ff[i] - fi[i];
          if (norm(r) <= tol * fn && it > 0) { converged = true; break; }
          if (norm(r) <= 1e-13 * fn) { converged = true; break; }
          const fr = factorReg(st.Kt!, mu); mu = fr.mu;
          const du = fr.f.solve(r);
          // Backtracking on the total potential energy.
          const P0 = potential(u, lambda, st.energy);
          let alpha = 1, ok = false;
          for (let ls = 0; ls < 30; ls++) {
            const ut = trial(du, alpha), et = evaluate(ut, false);
            if (potential(ut, lambda, et.energy) <= P0 + 1e-14 * Math.abs(P0)) { ok = true; break; }
            alpha /= 2;
          }
          if (!ok) { mu = mu === 0 ? 1e-8 : mu * 10; continue; }
          addTo(du, alpha);
          if (alpha === 1) mu = mu < 1e-12 ? 0 : mu / 10; else if (alpha < 0.25) mu = mu === 0 ? 1e-8 : mu * 2;
        }
        if (!converged) { sys.messages.push(`Load set "${set.name}": Newton iteration did not converge at load step ${step} of ${nSteps}. Try more load steps.`); break; }
        path.push([lambda, norm(freeOf(u))]);
      }
    } else {
      // Cylindrical arc-length: constraint |du_step| = dl, root choice by the angle with the previous step.
      let dl = 0; let prevStep: Float64Array | null = null;
      const maxSteps = nSteps * 4;
      for (let step = 1; step <= maxSteps && lambda < 1 - 1e-12; step++) {
        const st = evaluate(u, true), fr = factorReg(st.Kt!, 0);
        const ut = fr.f.solve(Ff);
        if (step === 1) dl = norm(ut) / nSteps;
        let dlam = dl / norm(ut);
        // Follow the path direction: keep the sign that continues the previous step (or the stiffness sign at the start).
        const sgn = prevStep ? Math.sign(dotN(prevStep, ut)) || 1 : (fr.f.negativePivots % 2 === 0 ? 1 : -1);
        dlam *= sgn;
        const dU = ut.map(x => x * dlam) as Float64Array;
        let lam = lambda + dlam, ok = false;
        const uStart = Float64Array.from(u);
        for (let it = 0; it < maxIter; it++) {
          totalIt++;
          for (let i = 0; i < ndof; i++) if (sys.eq[i] >= 0) u[i] = uStart[i] + dU[sys.eq[i]];
          const s2 = evaluate(u, true), fi = freeOf(s2.fint);
          const r = new Float64Array(neq); for (let i = 0; i < neq; i++) r[i] = lam * Ff[i] - fi[i];
          if (norm(r) <= tol * fn) { ok = true; break; }
          const f2 = factorReg(s2.Kt!, 0).f, dr = f2.solve(r), dt = f2.solve(Ff);
          // Quadratic for the load increment: |dU + dr + x*dt|^2 = dl^2.
          const a = dotN(dt, dt), b = 2 * (dotN(dU, dt) + dotN(dr, dt)), c = dotN(dU, dU) + 2 * dotN(dU, dr) + dotN(dr, dr) - dl * dl;
          const disc = b * b - 4 * a * c;
          let x: number;
          if (disc < 0) x = -b / (2 * a);
          else {
            const x1 = (-b + Math.sqrt(disc)) / (2 * a), x2 = (-b - Math.sqrt(disc)) / (2 * a);
            const ang = (xx: number) => { let s = 0; for (let i = 0; i < neq; i++) s += dU[i] * (dU[i] + dr[i] + xx * dt[i]); return s; };
            x = ang(x1) >= ang(x2) ? x1 : x2;
          }
          for (let i = 0; i < neq; i++) dU[i] += dr[i] + x * dt[i];
          lam += x;
        }
        if (!ok) { for (let i = 0; i < ndof; i++) u[i] = uStart[i]; dl /= 2; if (dl < 1e-12) break; continue; }
        prevStep = Float64Array.from(dU); lambda = lam;
        path.push([lambda, norm(freeOf(u))]);
      }
      if (lambda < 1 - 1e-6) sys.messages.push(`Load set "${set.name}": the arc-length path was followed to load factor ${lambda.toPrecision(4)} in ${maxSteps} steps (the full load was not reached). The path may contain a limit point below the applied load; see the load-displacement history.`);
    }
    // Recover results: linear elements through the standard route, bars from the co-rotational state.
    const scaled: CaseLoads = { F: Fext.map(x => x * (opt.arcLength ? lambda : 1)) as Float64Array, feq: set.loads.feq.map(x => x * (opt.arcLength ? lambda : 1)) as Float64Array, w: set.loads.w };
    const res = sys.recover(set.name, u, scaled);
    const fin = evaluate(u, false);
    barData.forEach((bd, k) => { const o = 12 * bd.e; res.beamQ.fill(0, o, o + 12); res.beamQ[o] = -fin.Nbar[k]; res.beamQ[o + 6] = fin.Nbar[k]; });
    const react = [0, 0, 0], applied = [0, 0, 0];
    res.reactions.fill(0);
    for (let i = 0; i < ndof; i++) {
      if (sys.fixed[i] === 1) res.reactions[i] = fin.fint[i] - scaled.F[i];
      else if (sys.spring[i] > 0) res.reactions[i] = -sys.spring[i] * u[i];
      if (i % 6 < 3) { applied[i % 6] += scaled.F[i]; react[i % 6] += res.reactions[i]; }
    }
    const err = Math.hypot(applied[0] + react[0], applied[1] + react[1], applied[2] + react[2]);
    res.equilibrium = { applied, reactions: react, error: err, relError: err / Math.max(Math.hypot(...applied), 1e-300), maxResidual: 0 };
    res.iterations = totalIt;
    cases.push(res);
  }
  const out = sys.finish('nonlinear', cases, [], t0);
  out.path = path;
  return out;
}
function dotN(a: Float64Array, b: Float64Array): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

export function runAnalysis(model: FEModel, opt: AnalysisOptions, cancelled?: () => boolean): FEResult {
  switch (opt.kind) {
    case 'static': return solveStatic(model, cancelled);
    case 'second-order': return solveSecondOrder(model, opt, cancelled);
    case 'buckling': return solveBuckling(model, opt, cancelled);
    case 'modal': return solveModal(model, opt, cancelled);
    case 'nonlinear': return solveNonlinear(model, opt, cancelled);
  }
}
export { ModelError };
export type { V3 };
