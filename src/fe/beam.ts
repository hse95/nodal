/**
 * 3D line elements: frame (Euler–Bernoulli or Timoshenko) and truss/cable.
 *
 * Local DOF order (12): [u, v, w, rx, ry, rz] at the start node, then the end
 * node. u, v, w are translations along local x, y, z; rx, ry, rz are rotations
 * about them (right-hand rule), so ry = -dw/dx and rz = +dv/dx.
 *
 * Stiffness: the exact stiffness of a prismatic Timoshenko beam, written with
 * the shear parameters
 *      Phi_y = 12 E Iz / (G Asy L^2)   (bending in the x-y plane)
 *      Phi_z = 12 E Iy / (G Asz L^2)   (bending in the x-z plane)
 * Setting Phi = 0 recovers the Euler–Bernoulli element. See Przemieniecki,
 * "Theory of Matrix Structural Analysis" (1968), section 5.6, and Friedman &
 * Kosmatka, Computers & Structures 47 (1993) for the matching shape functions.
 *
 * Geometric stiffness and consistent mass use the cubic Hermite shape
 * functions (McGuire, Gallagher & Ziemian, "Matrix Structural Analysis", 2nd
 * ed., chapter 9 and appendix A). Shear deformation is NOT included in those
 * two matrices; with Timoshenko elements this is a small inconsistency that
 * disappears with mesh refinement (stated in the theory manual).
 *
 * End releases are applied by static condensation of the released local DOFs,
 * expressed as a transformation Tc so that stiffness, geometric stiffness,
 * mass and loads are all reduced consistently (Guyan reduction).
 */
import type { FEBeam, FEModel, Material, Section } from './model';
import { beamEnds, memberAxes } from './model';
import { dist } from '../geom/vec';

export type Mat = number[][];
export const zeros = (n: number, m = n): Mat => Array.from({ length: n }, () => new Array<number>(m).fill(0));
export function matMul(A: Mat, B: Mat): Mat {
  const n = A.length, m = B[0].length, k = B.length, C = zeros(n, m);
  for (let i = 0; i < n; i++) for (let l = 0; l < k; l++) { const a = A[i][l]; if (a !== 0) for (let j = 0; j < m; j++) C[i][j] += a * B[l][j]; }
  return C;
}
export const transpose = (A: Mat): Mat => A[0].map((_, j) => A.map(r => r[j]));
/** B^T K B */
export const congruence = (K: Mat, B: Mat): Mat => matMul(transpose(B), matMul(K, B));
export function matVec(A: Mat, x: ArrayLike<number>): number[] {
  return A.map(r => { let s = 0; for (let j = 0; j < r.length; j++) s += r[j] * x[j]; return s; });
}
export function tMatVec(A: Mat, x: ArrayLike<number>): number[] {
  const out = new Array<number>(A[0].length).fill(0);
  for (let i = 0; i < A.length; i++) { const xi = x[i]; if (xi !== 0) for (let j = 0; j < out.length; j++) out[j] += A[i][j] * xi; }
  return out;
}
const sym = (k: Mat): Mat => { for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) k[j][i] = k[i][j]; return k; };
/** Inverse of a small symmetric positive-definite matrix by Gauss–Jordan; throws when singular. */
export function invert(A: Mat): Mat {
  const n = A.length, M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  const scale = Math.max(...A.map((r, i) => Math.abs(r[i])), 1e-300);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12 * scale) throw new Error('singular');
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; if (f !== 0) for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map(r => r.slice(n));
}

export function localStiffness(m: Material, s: Section, L: number, shear: boolean, axialOnly: boolean): Mat {
  const k = zeros(12);
  const ea = m.E * s.A / L;
  k[0][0] = ea; k[6][6] = ea; k[0][6] = -ea;
  if (axialOnly) return sym(k);
  const gj = m.G * s.J / L;
  k[3][3] = gj; k[9][9] = gj; k[3][9] = -gj;
  const phiY = shear && s.Asy > 0 ? 12 * m.E * s.Iz / (m.G * s.Asy * L * L) : 0;
  const phiZ = shear && s.Asz > 0 ? 12 * m.E * s.Iy / (m.G * s.Asz * L * L) : 0;
  // Bending in the x-y plane: v (1, 7) and rz (5, 11), EI = E*Iz.
  const a = m.E * s.Iz / ((1 + phiY) * L ** 3);
  k[1][1] = 12 * a; k[1][5] = 6 * L * a; k[1][7] = -12 * a; k[1][11] = 6 * L * a;
  k[5][5] = (4 + phiY) * L * L * a; k[5][7] = -6 * L * a; k[5][11] = (2 - phiY) * L * L * a;
  k[7][7] = 12 * a; k[7][11] = -6 * L * a; k[11][11] = (4 + phiY) * L * L * a;
  // Bending in the x-z plane: w (2, 8) and ry (4, 10), EI = E*Iy. Signs differ because ry = -dw/dx.
  const b = m.E * s.Iy / ((1 + phiZ) * L ** 3);
  k[2][2] = 12 * b; k[2][4] = -6 * L * b; k[2][8] = -12 * b; k[2][10] = -6 * L * b;
  k[4][4] = (4 + phiZ) * L * L * b; k[4][8] = 6 * L * b; k[4][10] = (2 - phiZ) * L * L * b;
  k[8][8] = 12 * b; k[8][10] = 6 * L * b; k[10][10] = (4 + phiZ) * L * L * b;
  return sym(k);
}
/** Geometric stiffness for axial force N (tension positive). */
export function localGeometric(N: number, s: Section, L: number, axialOnly: boolean): Mat {
  const k = zeros(12);
  if (axialOnly) {
    // String stiffness of a pin-ended bar.
    const c = N / L;
    for (const d of [1, 2]) { k[d][d] = c; k[d + 6][d + 6] = c; k[d][d + 6] = -c; }
    return sym(k);
  }
  const c = N / (30 * L);
  k[1][1] = 36 * c; k[1][5] = 3 * L * c; k[1][7] = -36 * c; k[1][11] = 3 * L * c;
  k[5][5] = 4 * L * L * c; k[5][7] = -3 * L * c; k[5][11] = -L * L * c;
  k[7][7] = 36 * c; k[7][11] = -3 * L * c; k[11][11] = 4 * L * L * c;
  k[2][2] = 36 * c; k[2][4] = -3 * L * c; k[2][8] = -36 * c; k[2][10] = -3 * L * c;
  k[4][4] = 4 * L * L * c; k[4][8] = 3 * L * c; k[4][10] = -L * L * c;
  k[8][8] = 36 * c; k[8][10] = 3 * L * c; k[10][10] = 4 * L * L * c;
  // Twist term N*(Iy+Iz)/A/L (uniform torsion of a doubly symmetric section under axial force).
  const t = N * (s.Iy + s.Iz) / (s.A * L);
  k[3][3] = t; k[9][9] = t; k[3][9] = -t;
  return sym(k);
}
export function localMass(m: Material, s: Section, L: number, consistent: boolean, axialOnly: boolean): Mat {
  const k = zeros(12), mt = m.rho * s.A * L, ip = m.rho * (s.Iy + s.Iz) * L;
  if (!consistent) {
    for (const d of [0, 1, 2, 6, 7, 8]) k[d][d] = mt / 2;
    if (!axialOnly) { k[3][3] = ip / 2; k[9][9] = ip / 2; }
    return k;
  }
  if (axialOnly) {
    for (const d of [0, 1, 2]) { k[d][d] = mt / 3; k[d + 6][d + 6] = mt / 3; k[d][d + 6] = mt / 6; }
    return sym(k);
  }
  k[0][0] = mt / 3; k[6][6] = mt / 3; k[0][6] = mt / 6;
  k[3][3] = ip / 3; k[9][9] = ip / 3; k[3][9] = ip / 6;
  const c = mt / 420;
  k[1][1] = 156 * c; k[1][5] = 22 * L * c; k[1][7] = 54 * c; k[1][11] = -13 * L * c;
  k[5][5] = 4 * L * L * c; k[5][7] = 13 * L * c; k[5][11] = -3 * L * L * c;
  k[7][7] = 156 * c; k[7][11] = -22 * L * c; k[11][11] = 4 * L * L * c;
  k[2][2] = 156 * c; k[2][4] = -22 * L * c; k[2][8] = 54 * c; k[2][10] = 13 * L * c;
  k[4][4] = 4 * L * L * c; k[4][8] = -13 * L * c; k[4][10] = -3 * L * L * c;
  k[8][8] = 156 * c; k[8][10] = 22 * L * c; k[10][10] = 4 * L * L * c;
  return sym(k);
}

const GAUSS4: [number, number][] = [[0.0694318442029737, 0.1739274225687269], [0.3300094782075719, 0.3260725774312731], [0.6699905217924281, 0.3260725774312731], [0.9305681557970263, 0.1739274225687269]];
/** Transverse shape functions of the Timoshenko beam (Friedman & Kosmatka 1993); phi = 0 gives the Hermite cubics. */
export function shapeV(xi: number, L: number, phi: number): [number, number, number, number] {
  const d = 1 + phi;
  return [
    (1 - 3 * xi * xi + 2 * xi ** 3 + phi * (1 - xi)) / d,
    L * (xi - 2 * xi * xi + xi ** 3 + phi * (xi - xi * xi) / 2) / d,
    (3 * xi * xi - 2 * xi ** 3 + phi * xi) / d,
    L * (-xi * xi + xi ** 3 - phi * (xi - xi * xi) / 2) / d,
  ];
}
/**
 * Equivalent nodal loads (local) for a load varying linearly from w1 at the
 * start to w2 at the end; w1, w2 are force per unit length in local x, y, z.
 * The transverse terms integrate the load against the element's own shape
 * functions, so nodal displacements are exact for prismatic members.
 */
export function lineLoadVector(w1: number[], w2: number[], L: number, phiY: number, phiZ: number, axialOnly: boolean): number[] {
  const f = new Array<number>(12).fill(0);
  for (const d of [0, 1, 2]) {
    if (d === 0 || axialOnly) { f[d] = L * (2 * w1[d] + w2[d]) / 6; f[d + 6] = L * (w1[d] + 2 * w2[d]) / 6; }
  }
  if (axialOnly) return f;
  for (const [xi, wt] of GAUSS4) {
    const wy = w1[1] + (w2[1] - w1[1]) * xi, wz = w1[2] + (w2[2] - w1[2]) * xi;
    const Ny = shapeV(xi, L, phiY), Nz = shapeV(xi, L, phiZ), c = wt * L;
    f[1] += c * Ny[0] * wy; f[5] += c * Ny[1] * wy; f[7] += c * Ny[2] * wy; f[11] += c * Ny[3] * wy;
    f[2] += c * Nz[0] * wz; f[4] -= c * Nz[1] * wz; f[8] += c * Nz[2] * wz; f[10] -= c * Nz[3] * wz;
  }
  return f;
}

/** Everything the solver needs to know about one line element. */
export interface BeamKin {
  L: number;
  R: number[];          // 3x3 rotation, rows = local axes
  axialOnly: boolean;
  phiY: number; phiZ: number;
  k: Mat;               // 12x12 local stiffness before releases
  Tc: Mat | null;       // release condensation: d_local = Tc * d_ends (+ particular part)
  kccInv: Mat | null;   // inverse of the released block, for recovering released DOFs under member loads
  released: number[];
  Tg: Mat;              // local end displacements = Tg * global nodal displacements (rotation and rigid offsets)
  B: Mat;               // Tc * Tg (or Tg when there are no releases)
}
export function beamKinematics(model: FEModel, b: FEBeam): BeamKin {
  const [pa, pb] = beamEnds(model, b), L = dist(pa, pb);
  const mat = model.materials[b.mat], sec = model.sections[b.sec];
  const axialOnly = b.type !== 'beam';
  const R = L > 0 ? memberAxes(pa, pb, b.ref, b.angle) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const k = localStiffness(mat, sec, Math.max(L, 1e-300), b.shear, axialOnly);
  const phiY = !axialOnly && b.shear && sec.Asy > 0 ? 12 * mat.E * sec.Iz / (mat.G * sec.Asy * L * L) : 0;
  const phiZ = !axialOnly && b.shear && sec.Asz > 0 ? 12 * mat.E * sec.Iy / (mat.G * sec.Asz * L * L) : 0;
  // Tg = Lambda * E, where E moves nodal displacements to the member ends through the rigid offsets:
  //   u_end = u_node + theta x o   and   theta_end = theta_node.
  const Tg = zeros(12);
  for (let e = 0; e < 2; e++) {
    const o = b.off ? b.off[e] : [0, 0, 0];
    // theta x o written as a matrix acting on theta: [[0, oz, -oy], [-oz, 0, ox], [oy, -ox, 0]]
    const S = [[0, o[2], -o[1]], [-o[2], 0, o[0]], [o[1], -o[0], 0]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      Tg[6 * e + i][6 * e + j] = R[3 * i + j];
      Tg[6 * e + 3 + i][6 * e + 3 + j] = R[3 * i + j];
      let s = 0;
      for (let l = 0; l < 3; l++) s += R[3 * i + l] * S[l][j];
      Tg[6 * e + i][6 * e + 3 + j] = s;
    }
  }
  const released = axialOnly ? [] : b.rel.map((r, i) => (r ? i : -1)).filter(i => i >= 0);
  let Tc: Mat | null = null, kccInv: Mat | null = null;
  if (released.length) {
    const kcc = released.map(i => released.map(j => k[i][j]));
    try { kccInv = invert(kcc); } catch {
      throw new Error(`Member "${b.id}" is unstable on its own: the combination of end releases removes all stiffness in one direction (for example the same release at both ends).`);
    }
    // d_c = -kcc^-1 kcr d_r, so Tc has identity rows for kept DOFs and the condensation rows for released ones.
    Tc = zeros(12);
    const isRel = new Set(released);
    for (let i = 0; i < 12; i++) if (!isRel.has(i)) Tc[i][i] = 1;
    released.forEach((ci, a) => {
      for (let j = 0; j < 12; j++) {
        if (isRel.has(j)) continue;
        let s = 0;
        released.forEach((cj, bb) => { s += kccInv![a][bb] * k[cj][j]; });
        Tc![ci][j] = -s;
      }
    });
  }
  return { L, R, axialOnly, phiY, phiZ, k, Tc, kccInv, released, Tg, B: Tc ? matMul(Tc, Tg) : Tg };
}

/** Member loads on one element, expressed in local axes, summed over whatever is applied. */
export interface LocalLoad { w1: number[]; w2: number[]; f0: number[] }   // f0 = thermal/pretension equivalent end forces (no distributed part)

/**
 * Local end displacements including released DOFs: d = B * dGlobal + particular
 * part due to member loads acting on the released DOFs.
 */
export function localDisplacements(kin: BeamKin, dGlobal: ArrayLike<number>, feq: number[]): number[] {
  const d = matVec(kin.B, dGlobal);
  if (kin.kccInv) kin.released.forEach((ci, a) => { let s = 0; kin.released.forEach((cj, bb) => { s += kin.kccInv![a][bb] * feq[cj]; }); d[ci] += s; });
  return d;
}
/** Local end forces acting on the element: q = k d - f_eq. */
export function endForces(kin: BeamKin, dLocal: number[], feq: number[]): number[] {
  const q = matVec(kin.k, dLocal);
  for (let i = 0; i < 12; i++) q[i] -= feq[i];
  return q;
}

/**
 * Internal forces at distance x from the start, from equilibrium of the piece
 * [0, x]. Returned as [N, Vy, Vz, T, My, Mz] in the reporting convention:
 *   N   tension positive
 *   Vy, Vz, T   force / torque components acting on the +x face of the cut
 *   My  positive when the -z fiber is in tension (sagging for a beam with z up)
 *   Mz  positive when the -y fiber is in tension
 */
export function sectionForces(q: ArrayLike<number>, w1: number[], w2: number[], L: number, x: number): number[] {
  const i0 = (d: number) => w1[d] * x + (w2[d] - w1[d]) * x * x / (2 * L);           // integral of w
  const i1 = (d: number) => w1[d] * x * x / 2 + (w2[d] - w1[d]) * x ** 3 / (6 * L);  // integral of (x - s) w(s)
  const N = -q[0] - i0(0), Vy = -q[1] - i0(1), Vz = -q[2] - i0(2), T = -q[3];
  const MyVec = -q[4] - x * q[2] - i1(2);
  const MzVec = -q[5] + x * q[1] + i1(1);
  return [N, Vy, Vz, T, -MyVec, MzVec];
}
/**
 * Local displacement (u, v, w) at xi = x/L for drawing the deflected member:
 * shape-function interpolation of the end displacements plus, for elements
 * without bending releases, the fixed-end particular solution of the member
 * load (Euler–Bernoulli), so that a single element shows the true curve.
 */
export function localDeflection(kin: BeamKin, d: number[], w1: number[], w2: number[], mat: Material, sec: Section, xi: number): [number, number, number] {
  const L = kin.L, u = d[0] + (d[6] - d[0]) * xi;
  if (kin.axialOnly) return [u, d[1] + (d[7] - d[1]) * xi, d[2] + (d[8] - d[2]) * xi];
  const Ny = shapeV(xi, L, kin.phiY), Nz = shapeV(xi, L, kin.phiZ);
  let vv = Ny[0] * d[1] + Ny[1] * d[5] + Ny[2] * d[7] + Ny[3] * d[11];
  let ww = Nz[0] * d[2] - Nz[1] * d[4] + Nz[2] * d[8] - Nz[3] * d[10];
  const relBend = (idx: number[]) => idx.some(i => kin.released.includes(i));
  const part = (q1: number, q2: number, EI: number) => L ** 4 * xi * xi * (1 - xi) * (1 - xi) / (120 * EI) * ((3 - xi) * q1 + (2 + xi) * q2);
  if (!relBend([1, 5, 7, 11]) && sec.Iz > 0) vv += part(w1[1], w2[1], mat.E * sec.Iz);
  if (!relBend([2, 4, 8, 10]) && sec.Iy > 0) ww += part(w1[2], w2[2], mat.E * sec.Iy);
  return [u, vv, ww];
}
