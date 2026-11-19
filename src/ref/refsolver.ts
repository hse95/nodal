/**
 * Independent reference solver for 3D frames and trusses.
 *
 * Purpose: cross-check the main solver on arbitrary small models. To make the
 * check meaningful this file shares NO code with src/fe and uses a different
 * derivation throughout:
 *   - member stiffness comes from numerically inverting the 6x6 flexibility
 *     matrix of the member treated as a cantilever, then expanding it with the
 *     static equilibrium (transfer) matrix, instead of a closed-form 12x12;
 *   - matrices are dense arrays;
 *   - supports are imposed by row/column elimination and the system is solved
 *     by Gaussian elimination with partial pivoting;
 *   - uniformly distributed loads use the textbook fixed-end forces directly.
 * It is deliberately simple and slow. Euler–Bernoulli members only.
 */
export interface RefMember {
  i: number; j: number;
  E: number; G: number; A: number; Iy: number; Iz: number; J: number;
  truss?: boolean;
  /** Uniform load per unit length in global axes. */
  w?: [number, number, number];
}
export interface RefModel {
  nodes: [number, number, number][];
  members: RefMember[];
  supports: { node: number; fix: boolean[] }[];
  loads: { node: number; f: number[] }[];
}
export interface RefResult { u: number[]; reactions: number[]; axial: number[] }

type M = number[][];
const zero = (n: number, m = n): M => Array.from({ length: n }, () => new Array<number>(m).fill(0));
const mul = (A: M, B: M): M => A.map(r => B[0].map((_, j) => r.reduce((s, a, k) => s + a * B[k][j], 0)));
const tr = (A: M): M => A[0].map((_, j) => A.map(r => r[j]));

function gauss(Ain: M, bin: number[]): number[] {
  const n = bin.length, A = Ain.map(r => [...r]), b = [...bin];
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-9 * Math.abs(Ain[c][c] || 1)) throw new Error('Reference solver: singular system');
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      if (f === 0) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  return x;
}
function inverse(A: M): M {
  const n = A.length, cols: number[][] = [];
  for (let j = 0; j < n; j++) cols.push(gauss(A, Array.from({ length: n }, (_, i) => (i === j ? 1 : 0))));
  return tr(cols);
}

/** Local axes: x along the member; z = global Z made perpendicular to x; vertical members use y = global Y. */
function axes(a: number[], b: number[]): { L: number; R: M } {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]);
  const x = d.map(q => q / L);
  let y: number[], z: number[];
  const horiz = Math.hypot(x[0], x[1]);
  if (horiz < 1e-6) {
    y = [0, 1, 0];
    z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  } else {
    const dz = x[2];
    z = [-dz * x[0], -dz * x[1], 1 - dz * x[2]];
    const lz = Math.hypot(z[0], z[1], z[2]); z = z.map(q => q / lz);
    y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  }
  return { L, R: [x, y, z] };
}

/** 12x12 local stiffness from the cantilever flexibility of end j with end i clamped. */
function memberK(m: RefMember, L: number): M {
  if (m.truss) {
    const k = zero(12), ea = m.E * m.A / L;
    k[0][0] = ea; k[6][6] = ea; k[0][6] = -ea; k[6][0] = -ea;
    return k;
  }
  // Tip flexibility for tip actions [Fx, Fy, Fz, Mx, My, Mz] -> [u, v, w, rx, ry, rz].
  const F = zero(6);
  F[0][0] = L / (m.E * m.A);
  F[3][3] = L / (m.G * m.J);
  F[1][1] = L ** 3 / (3 * m.E * m.Iz); F[5][5] = L / (m.E * m.Iz); F[1][5] = F[5][1] = L * L / (2 * m.E * m.Iz);
  F[2][2] = L ** 3 / (3 * m.E * m.Iy); F[4][4] = L / (m.E * m.Iy); F[2][4] = F[4][2] = -L * L / (2 * m.E * m.Iy);
  const kjj = inverse(F);
  // Equilibrium: forces at i balance forces at j, f_i = -H f_j with the lever arm L along x.
  const H = zero(6);
  for (let a = 0; a < 6; a++) H[a][a] = 1;
  H[4][2] = -L;   // My_i picks up -L * Fz_j
  H[5][1] = L;    // Mz_i picks up +L * Fy_j
  const kij = mul(H, kjj).map(r => r.map(q => -q)), kii = mul(mul(H, kjj), tr(H));
  const k = zero(12);
  for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) { k[a][b] = kii[a][b]; k[a][b + 6] = kij[a][b]; k[a + 6][b] = kij[b][a]; k[a + 6][b + 6] = kjj[a][b]; }
  return k;
}

export function refSolve(model: RefModel): RefResult {
  const n = model.nodes.length, N = 6 * n;
  const K = zero(N), P = new Array<number>(N).fill(0);
  const store: { T: M; k: M; fef: number[]; dofs: number[] }[] = [];
  for (const m of model.members) {
    const { L, R } = axes(model.nodes[m.i], model.nodes[m.j]);
    const T = zero(12);
    for (let blk = 0; blk < 4; blk++) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) T[3 * blk + a][3 * blk + b] = R[a][b];
    const k = memberK(m, L), kg = mul(mul(tr(T), k), T);
    const dofs = [...Array.from({ length: 6 }, (_, d) => 6 * m.i + d), ...Array.from({ length: 6 }, (_, d) => 6 * m.j + d)];
    for (let a = 0; a < 12; a++) for (let b = 0; b < 12; b++) K[dofs[a]][dofs[b]] += kg[a][b];
    // Fixed-end forces for a uniform load (local components): wL/2 and wL^2/12.
    const fef = new Array<number>(12).fill(0);
    if (m.w) {
      const wl = R.map(r => r[0] * m.w![0] + r[1] * m.w![1] + r[2] * m.w![2]);
      fef[0] = fef[6] = wl[0] * L / 2;
      fef[1] = fef[7] = wl[1] * L / 2; fef[2] = fef[8] = wl[2] * L / 2;
      if (!m.truss) { fef[5] = wl[1] * L * L / 12; fef[11] = -wl[1] * L * L / 12; fef[4] = -wl[2] * L * L / 12; fef[10] = wl[2] * L * L / 12; }
      const fg = mul(tr(T), fef.map(q => [q])).map(r => r[0]);
      for (let a = 0; a < 12; a++) P[dofs[a]] += fg[a];
    }
    store.push({ T, k, fef, dofs });
  }
  for (const l of model.loads) for (let d = 0; d < 6; d++) P[6 * l.node + d] += l.f[d];
  const fixed = new Array<boolean>(N).fill(false);
  for (const s of model.supports) for (let d = 0; d < 6; d++) if (s.fix[d]) fixed[6 * s.node + d] = true;
  // DOFs with no stiffness at all (rotations at truss-only nodes) are removed.
  for (let i = 0; i < N; i++) if (!fixed[i] && Math.abs(K[i][i]) < 1e-12) fixed[i] = true;
  const free = fixed.map((f, i) => (f ? -1 : i)).filter(i => i >= 0);
  const x = gauss(free.map(i => free.map(j => K[i][j])), free.map(i => P[i]));
  const u = new Array<number>(N).fill(0);
  free.forEach((i, a) => { u[i] = x[a]; });
  const reactions = new Array<number>(N).fill(0);
  const supported = new Array<boolean>(N).fill(false);
  for (const s of model.supports) for (let d = 0; d < 6; d++) if (s.fix[d]) supported[6 * s.node + d] = true;
  for (let i = 0; i < N; i++) if (supported[i]) { let s = -P[i]; for (let j = 0; j < N; j++) s += K[i][j] * u[j]; reactions[i] = s; }
  const axial = store.map(({ T, k, fef, dofs }) => {
    const dl = mul(T, dofs.map(i => [u[i]])).map(r => r[0]);
    const q = mul(k, dl.map(v => [v])).map((r, a) => r[0] - fef[a]);
    return (q[6] - q[0]) / 2;
  });
  return { u, reactions, axial };
}
