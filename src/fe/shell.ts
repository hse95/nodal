/**
 * Flat shell elements: 4-node quadrilateral and 3-node triangle.
 *
 * Each element is the superposition, in its own local plane, of
 *
 *  Membrane
 *   quad      bilinear displacements enriched with four incompatible modes
 *             (Wilson et al. 1973) in the patch-test-passing form of Taylor,
 *             Beresford & Wilson (1976), usually called QM6. The internal
 *             modes are condensed out element by element.
 *   triangle  constant-strain triangle (CST). It is robust but stiff in
 *             in-plane bending, so triangles need finer meshes than quads.
 *   drilling  the rotation about the normal is tied to the in-plane rotation
 *             0.5*(dv/dx - du/dy) by a penalty term in the manner of Hughes &
 *             Brezzi (1989) with penalty ALPHA_DRILL * G * t. The value is
 *             small on purpose: it removes the singularity of the drilling
 *             DOF and lets beams transfer torque into a shell, without
 *             noticeably stiffening the membrane.
 *
 *  Plate bending
 *   quad      MITC4: Reissner–Mindlin kinematics with the transverse shear
 *             strains interpolated from the edge mid-points (Dvorkin & Bathe
 *             1984; Bathe & Dvorkin 1985), which removes shear locking.
 *   triangle  DKT: discrete Kirchhoff triangle (Batoz, Bathe & Ho 1980),
 *             built here directly from its defining constraints (see dktBeta).
 *
 * Warped quadrilaterals are projected onto their mean plane and connected to
 * the true nodes by rigid links (MacNeal 1978), which restores rigid-body
 * invariance for curved surfaces such as the pinched hemisphere.
 *
 * Local DOF order per node: [u, v, w, rx, ry, rz], rotations as right-handed
 * vectors. The plate formulation uses the rotations of the normal
 *      beta_x = ry,   beta_y = -rx      (so u = z*beta_x, v = z*beta_y),
 * curvatures  kx = d(beta_x)/dx, ky = d(beta_y)/dy, kxy = d(beta_x)/dy + d(beta_y)/dx,
 * moments     M = D * k   (Mx > 0 puts the +z, "top", surface in tension),
 * membrane forces N = t * C * e (per unit width), tension positive.
 */
import type { Material } from './model';
import { Mat, zeros, matMul, transpose, invert, congruence } from './beam';
import { V3, sub, cross, unit, dot, len, mul, add, v } from '../geom/vec';

export const ALPHA_DRILL = 1e-2;
const KAPPA_SHEAR = 5 / 6;
const GP = 1 / Math.sqrt(3);
const GAUSS2: [number, number][] = [[-GP, -GP], [GP, -GP], [GP, GP], [-GP, GP]];
const XI = [-1, 1, 1, -1], ETA = [-1, -1, 1, 1];

export interface ShellGeom {
  nn: number;                 // 3 or 4
  R: number[];                // 3x3, rows = local axes e1, e2, e3 (e3 = normal)
  origin: V3;
  x: number[]; y: number[];   // local in-plane node coordinates
  z: number[];                // warp offsets along e3 (zero for triangles)
  area: number;
}

/**
 * Local frame: e3 is the mean normal; e1 is global X projected onto the
 * element plane (global Y if X is nearly normal to it), so that local stress
 * components have a consistent direction over a whole surface.
 */
export function shellGeometry(p: V3[]): ShellGeom {
  const nn = p.length;
  const n = nn === 4 ? cross(sub(p[2], p[0]), sub(p[3], p[1])) : cross(sub(p[1], p[0]), sub(p[2], p[0]));
  if (len(n) < 1e-300) throw new Error('Shell element has zero area');
  const e3 = unit(n);
  let ref = v(1, 0, 0);
  if (Math.abs(dot(ref, e3)) > 0.95) ref = v(0, 1, 0);
  const e1 = unit(sub(ref, mul(e3, dot(ref, e3)))), e2 = cross(e3, e1);
  let o = v();
  for (const q of p) o = add(o, q);
  o = mul(o, 1 / nn);
  const x: number[] = [], y: number[] = [], z: number[] = [];
  for (const q of p) { const d = sub(q, o); x.push(dot(d, e1)); y.push(dot(d, e2)); z.push(dot(d, e3)); }
  let area = 0;
  for (let i = 0; i < nn; i++) { const j = (i + 1) % nn; area += x[i] * y[j] - x[j] * y[i]; }
  return { nn, R: [e1.x, e1.y, e1.z, e2.x, e2.y, e2.z, e3.x, e3.y, e3.z], origin: o, x, y, z, area: area / 2 };
}

/** Bilinear shape functions and their Cartesian derivatives at (xi, eta). */
function quadShape(g: ShellGeom, xi: number, eta: number) {
  const N: number[] = [], dxi: number[] = [], deta: number[] = [];
  for (let i = 0; i < 4; i++) {
    N.push(0.25 * (1 + XI[i] * xi) * (1 + ETA[i] * eta));
    dxi.push(0.25 * XI[i] * (1 + ETA[i] * eta));
    deta.push(0.25 * ETA[i] * (1 + XI[i] * xi));
  }
  let j11 = 0, j12 = 0, j21 = 0, j22 = 0;
  for (let i = 0; i < 4; i++) { j11 += dxi[i] * g.x[i]; j12 += dxi[i] * g.y[i]; j21 += deta[i] * g.x[i]; j22 += deta[i] * g.y[i]; }
  const det = j11 * j22 - j12 * j21;
  if (!(det > 0)) throw new Error('Shell quadrilateral is too distorted (non-convex or folded)');
  const dx = dxi.map((_, i) => (j22 * dxi[i] - j12 * deta[i]) / det);
  const dy = dxi.map((_, i) => (-j21 * dxi[i] + j11 * deta[i]) / det);
  return { N, dx, dy, det, J: [j11, j12, j21, j22] };
}
function planeStress(m: Material, t: number): Mat {
  const c = m.E * t / (1 - m.nu * m.nu);
  return [[c, c * m.nu, 0], [c * m.nu, c, 0], [0, 0, c * (1 - m.nu) / 2]];
}
function bendingD(m: Material, t: number): Mat {
  const d = m.E * t ** 3 / (12 * (1 - m.nu * m.nu));
  return [[d, d * m.nu, 0], [d * m.nu, d, 0], [0, 0, d * (1 - m.nu) / 2]];
}
/** K += B^T C B * w */
function addBtCB(K: Mat, B: Mat, C: Mat, w: number): void {
  const CB = matMul(C, B), n = B[0].length;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    let s = 0;
    for (let r = 0; r < B.length; r++) s += B[r][i] * CB[r][j];
    K[i][j] += s * w;
  }
}

// ---- membrane -----------------------------------------------------------------
/** Membrane strain-displacement matrix (3 x 2n) for DOFs [u1, v1, u2, v2, ...]. */
function membraneB(dx: number[], dy: number[]): Mat {
  const n = dx.length, B = zeros(3, 2 * n);
  for (let i = 0; i < n; i++) { B[0][2 * i] = dx[i]; B[1][2 * i + 1] = dy[i]; B[2][2 * i] = dy[i]; B[2][2 * i + 1] = dx[i]; }
  return B;
}
/** QM6 membrane stiffness (8 x 8) with the incompatible modes condensed. */
function quadMembraneK(g: ShellGeom, C: Mat): Mat {
  const Kuu = zeros(8), Kua = zeros(8, 4), Kaa = zeros(4);
  const c0 = quadShape(g, 0, 0);
  const [a11, a12, a21, a22] = c0.J;
  for (const [xi, eta] of GAUSS2) {
    const s = quadShape(g, xi, eta), B = membraneB(s.dx, s.dy);
    // Incompatible modes (1 - xi^2) and (1 - eta^2): derivatives taken with the centre Jacobian and
    // scaled by det(J0)/det(J) so that constant-stress states are reproduced exactly (patch test).
    const f = c0.det / s.det;
    const d1x = f * (a22 * (-2 * xi)) / c0.det, d1y = f * (-a21 * (-2 * xi)) / c0.det;
    const d2x = f * (-a12 * (-2 * eta)) / c0.det, d2y = f * (a11 * (-2 * eta)) / c0.det;
    const G: Mat = [[d1x, 0, d2x, 0], [0, d1y, 0, d2y], [d1y, d1x, d2y, d2x]];
    const CB = matMul(C, B), CG = matMul(C, G);
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) { let t = 0; for (let r = 0; r < 3; r++) t += B[r][i] * CB[r][j]; Kuu[i][j] += t * s.det; }
      for (let j = 0; j < 4; j++) { let t = 0; for (let r = 0; r < 3; r++) t += B[r][i] * CG[r][j]; Kua[i][j] += t * s.det; }
    }
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let t = 0; for (let r = 0; r < 3; r++) t += G[r][i] * CG[r][j]; Kaa[i][j] += t * s.det; }
  }
  const X = matMul(Kua, matMul(invert(Kaa), transpose(Kua)));
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) Kuu[i][j] -= X[i][j];
  return Kuu;
}

// ---- DKT triangle ---------------------------------------------------------------
/**
 * Rotations of the normal (beta_x, beta_y) and their derivatives for the DKT
 * triangle at area coordinates L, as 1 x 9 rows over the DOFs
 * [w1, rx1, ry1, w2, rx2, ry2, w3, rx3, ry3].
 *
 * Construction (Batoz, Bathe & Ho 1980): beta varies quadratically, defined by
 * its corner values and by mid-side values that follow from
 *   (a) w cubic along each side with zero shear at the mid-side:
 *       beta_s(mid) = -3/(2l) (w_b - w_a) - (beta_s,a + beta_s,b)/4
 *   (b) the normal component varying linearly along the side:
 *       beta_n(mid) = (beta_n,a + beta_n,b)/2
 */
function dktCurvatureB(x: number[], y: number[], L: number[]): Mat {
  const A2 = (x[1] - x[0]) * (y[2] - y[0]) - (x[2] - x[0]) * (y[1] - y[0]);
  const b = [y[1] - y[2], y[2] - y[0], y[0] - y[1]].map(q => q / A2);   // dL_i/dx
  const c = [x[2] - x[1], x[0] - x[2], x[1] - x[0]].map(q => q / A2);   // dL_i/dy
  // Rows giving beta_x and beta_y at corners and mid-sides in terms of the 9 DOFs.
  const bx: number[][] = [], by: number[][] = [];
  for (let i = 0; i < 3; i++) {
    const rx = new Array<number>(9).fill(0), ry = new Array<number>(9).fill(0);
    rx[3 * i + 2] = 1;        // beta_x = ry
    ry[3 * i + 1] = -1;       // beta_y = -rx
    bx.push(rx); by.push(ry);
  }
  const edges: [number, number][] = [[0, 1], [1, 2], [2, 0]];
  for (const [a, e] of edges) {
    const l = Math.hypot(x[e] - x[a], y[e] - y[a]), sx = (x[e] - x[a]) / l, sy = (y[e] - y[a]) / l, nx = sy, ny = -sx;
    const bs = new Array<number>(9).fill(0), bn = new Array<number>(9).fill(0);
    bs[3 * a] += 3 / (2 * l); bs[3 * e] -= 3 / (2 * l);
    for (const q of [a, e]) {
      // beta_s = sx*beta_x + sy*beta_y = sx*ry - sy*rx ; beta_n likewise
      bs[3 * q + 2] += -0.25 * sx; bs[3 * q + 1] += 0.25 * sy;
      bn[3 * q + 2] += 0.5 * nx; bn[3 * q + 1] += -0.5 * ny;
    }
    bx.push(bs.map((s, i) => s * sx + bn[i] * nx));
    by.push(bs.map((s, i) => s * sy + bn[i] * ny));
  }
  // Quadratic shape-function derivatives: corners L_i(2L_i - 1), mid-sides 4 L_a L_b.
  const dNx: number[] = [], dNy: number[] = [];
  for (let i = 0; i < 3; i++) { dNx.push((4 * L[i] - 1) * b[i]); dNy.push((4 * L[i] - 1) * c[i]); }
  for (const [a, e] of edges) { dNx.push(4 * (b[a] * L[e] + L[a] * b[e])); dNy.push(4 * (c[a] * L[e] + L[a] * c[e])); }
  const B = zeros(3, 9);
  for (let k = 0; k < 6; k++) for (let j = 0; j < 9; j++) {
    B[0][j] += dNx[k] * bx[k][j];
    B[1][j] += dNy[k] * by[k][j];
    B[2][j] += dNy[k] * bx[k][j] + dNx[k] * by[k][j];
  }
  return B;
}

// ---- MITC4 ----------------------------------------------------------------------
/** Curvature B (3 x 12) and assumed shear B (2 x 12) at a point, DOFs [w, rx, ry] per node. */
function mitc4B(g: ShellGeom, xi: number, eta: number) {
  const s = quadShape(g, xi, eta);
  const Bb = zeros(3, 12);
  for (let i = 0; i < 4; i++) {
    Bb[0][3 * i + 2] = s.dx[i];                 // kx  = d(ry)/dx
    Bb[1][3 * i + 1] = -s.dy[i];                // ky  = -d(rx)/dy
    Bb[2][3 * i + 2] = s.dy[i]; Bb[2][3 * i + 1] = -s.dx[i];
  }
  // Covariant shear strain along the edge a->b at its mid-point:
  //   (w_b - w_a)/2 + (x_b - x_a)/4 * (bx_a + bx_b) + (y_b - y_a)/4 * (by_a + by_b)
  const tie = (a: number, b: number): number[] => {
    const r = new Array<number>(12).fill(0), dxe = g.x[b] - g.x[a], dye = g.y[b] - g.y[a];
    r[3 * a] = -0.5; r[3 * b] = 0.5;
    for (const q of [a, b]) { r[3 * q + 2] += dxe / 4; r[3 * q + 1] += -dye / 4; }
    return r;
  };
  const gA = tie(0, 1), gC = tie(3, 2), gD = tie(0, 3), gB = tie(1, 2);
  const [j11, j12, j21, j22] = s.J;
  const Bs = zeros(2, 12);
  for (let j = 0; j < 12; j++) {
    const gxi = 0.5 * (1 - eta) * gA[j] + 0.5 * (1 + eta) * gC[j];
    const get = 0.5 * (1 - xi) * gD[j] + 0.5 * (1 + xi) * gB[j];
    // [g_xi; g_eta] = J [gxz; gyz]  ->  solve for the Cartesian components.
    Bs[0][j] = (j22 * gxi - j12 * get) / s.det;
    Bs[1][j] = (-j21 * gxi + j11 * get) / s.det;
  }
  return { s, Bb, Bs };
}

// ---- element matrices in local coordinates ---------------------------------------
const MEMB = (i: number) => [6 * i, 6 * i + 1];
const BEND = (i: number) => [6 * i + 2, 6 * i + 3, 6 * i + 4];
function scatter(K: Mat, k: Mat, map: number[]): void {
  for (let i = 0; i < map.length; i++) for (let j = 0; j < map.length; j++) K[map[i]][map[j]] += k[i][j];
}
/** Drilling penalty rows: rz - 0.5*(dv/dx - du/dy) over [u, v, rz] per node. */
function drillRow(N: number[], dx: number[], dy: number[]): Mat {
  const n = N.length, r = new Array<number>(3 * n).fill(0);
  for (let i = 0; i < n; i++) { r[3 * i] = 0.5 * dy[i]; r[3 * i + 1] = -0.5 * dx[i]; r[3 * i + 2] = N[i]; }
  return [r];
}
function triShape(g: ShellGeom) {
  const { x, y } = g, A2 = 2 * g.area;
  return { dx: [y[1] - y[2], y[2] - y[0], y[0] - y[1]].map(q => q / A2), dy: [x[2] - x[1], x[0] - x[2], x[1] - x[0]].map(q => q / A2) };
}
const TRI3: number[][] = [[0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]];

/** Local stiffness (6n x 6n) of the flat element lying in its mean plane. */
export function shellLocalK(g: ShellGeom, m: Material, t: number): Mat {
  const n = g.nn, K = zeros(6 * n);
  const C = planeStress(m, t), D = bendingD(m, t), Gs = KAPPA_SHEAR * m.G * t, drill = ALPHA_DRILL * m.G * t;
  const mMap = Array.from({ length: n }, (_, i) => MEMB(i)).flat();
  const bMap = Array.from({ length: n }, (_, i) => BEND(i)).flat();
  const dMap = Array.from({ length: n }, (_, i) => [6 * i, 6 * i + 1, 6 * i + 5]).flat();
  if (n === 4) {
    scatter(K, quadMembraneK(g, C), mMap);
    const Kb = zeros(12), Kd = zeros(12);
    for (const [xi, eta] of GAUSS2) {
      const { s, Bb, Bs } = mitc4B(g, xi, eta);
      addBtCB(Kb, Bb, D, s.det);
      addBtCB(Kb, Bs, [[Gs, 0], [0, Gs]], s.det);
      addBtCB(Kd, drillRow(s.N, s.dx, s.dy), [[drill]], s.det);
    }
    scatter(K, Kb, bMap); scatter(K, Kd, dMap);
  } else {
    const { dx, dy } = triShape(g), A = g.area;
    const Km = zeros(6); addBtCB(Km, membraneB(dx, dy), C, A); scatter(K, Km, mMap);
    const Kb = zeros(9), Kd = zeros(9);
    for (const L of TRI3) {
      addBtCB(Kb, dktCurvatureB(g.x, g.y, L), D, A / 3);
      addBtCB(Kd, drillRow(L, dx, dy), [[drill]], A / 3);
    }
    scatter(K, Kb, bMap); scatter(K, Kd, dMap);
  }
  return K;
}

/**
 * Transformation from global nodal DOFs to the local DOFs of the projected
 * (flat) element: rotation into the local frame followed by the rigid-link
 * correction for the warp offset z_i of each node:
 *      u' = u - z*ry,   v' = v + z*rx.
 */
export function shellTransform(g: ShellGeom): Mat {
  const n = g.nn, T = zeros(6 * n), R = g.R;
  for (let a = 0; a < n; a++) {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { T[6 * a + i][6 * a + j] = R[3 * i + j]; T[6 * a + 3 + i][6 * a + 3 + j] = R[3 * i + j]; }
    const z = g.z[a];
    if (z !== 0) for (let j = 0; j < 3; j++) {
      T[6 * a][6 * a + 3 + j] += -z * R[3 + j];      // -z * ry_local
      T[6 * a + 1][6 * a + 3 + j] += z * R[j];       // +z * rx_local
    }
  }
  return T;
}
export function shellGlobalK(g: ShellGeom, m: Material, t: number): { K: Mat; T: Mat; Kl: Mat } {
  const Kl = shellLocalK(g, m, t), T = shellTransform(g);
  return { K: congruence(Kl, T), T, Kl };
}

/** Nodal weights: integral of each shape function over the element (tributary areas). */
export function shellNodalAreas(g: ShellGeom): number[] {
  if (g.nn === 3) return [g.area / 3, g.area / 3, g.area / 3];
  const a = [0, 0, 0, 0];
  for (const [xi, eta] of GAUSS2) { const s = quadShape(g, xi, eta); for (let i = 0; i < 4; i++) a[i] += s.N[i] * s.det; }
  return a;
}
/**
 * Mass matrix in global DOFs. Lumped: tributary mass on the translations plus
 * a small rotary inertia rho*t^3/12 so that no DOF is massless. Consistent:
 * bilinear/linear shape functions for the translations, rotations lumped.
 */
export function shellMass(g: ShellGeom, m: Material, t: number, consistent: boolean): Mat {
  const n = g.nn, M = zeros(6 * n), areas = shellNodalAreas(g);
  for (let a = 0; a < n; a++) for (let d = 3; d < 6; d++) M[6 * a + d][6 * a + d] = m.rho * t ** 3 / 12 * areas[a];
  if (!consistent) { for (let a = 0; a < n; a++) for (let d = 0; d < 3; d++) M[6 * a + d][6 * a + d] = m.rho * t * areas[a]; return M; }
  const mm = zeros(n);
  if (n === 4) for (const [xi, eta] of GAUSS2) { const s = quadShape(g, xi, eta); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) mm[i][j] += s.N[i] * s.N[j] * s.det; }
  else for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) mm[i][j] = g.area * (i === j ? 1 / 6 : 1 / 12);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let d = 0; d < 3; d++) M[6 * i + d][6 * j + d] = m.rho * t * mm[i][j];
  return M;
}

export interface ShellStress {
  /** Membrane forces [Nx, Ny, Nxy] (N/m), moments [Mx, My, Mxy] (N*m/m), shears [Qx, Qy] (N/m) at the centre, local axes. */
  N: number[]; M: number[]; Q: number[];
}
/** Stress resultants at the element centre from local nodal displacements (6 per node). */
export function shellStress(g: ShellGeom, m: Material, t: number, dl: ArrayLike<number>): ShellStress {
  const n = g.nn, C = planeStress(m, t), D = bendingD(m, t);
  const um: number[] = [], ub: number[] = [];
  for (let i = 0; i < n; i++) { um.push(dl[6 * i], dl[6 * i + 1]); ub.push(dl[6 * i + 2], dl[6 * i + 3], dl[6 * i + 4]); }
  const mulv = (A: Mat, x: number[]) => A.map(r => r.reduce((s, a, j) => s + a * x[j], 0));
  if (n === 4) {
    const { s, Bb, Bs } = mitc4B(g, 0, 0);
    // The incompatible modes have zero gradient at the centre, so the compatible B gives the centre strain.
    const e = mulv(membraneB(s.dx, s.dy), um), k = mulv(Bb, ub), gs = mulv(Bs, ub), Gs = KAPPA_SHEAR * m.G * t;
    return { N: mulv(C, e), M: mulv(D, k), Q: [Gs * gs[0], Gs * gs[1]] };
  }
  const { dx, dy } = triShape(g);
  return { N: mulv(C, mulv(membraneB(dx, dy), um)), M: mulv(D, mulv(dktCurvatureB(g.x, g.y, [1 / 3, 1 / 3, 1 / 3]), ub)), Q: [0, 0] };
}

/**
 * Geometric stiffness in global DOFs for membrane forces N = [Nx, Ny, Nxy]:
 *   Kg = integral of  g^T [[Nx, Nxy], [Nxy, Ny]] g  for each translation,
 * with g the gradient of the (bi)linear shape functions. This is the standard
 * initial-stress matrix of a membrane and governs plate/shell buckling.
 */
export function shellGeometric(g: ShellGeom, Nm: number[]): Mat {
  const n = g.nn, kg = zeros(n);
  const acc = (dx: number[], dy: number[], w: number) => {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++)
      kg[i][j] += w * (dx[i] * Nm[0] * dx[j] + dy[i] * Nm[1] * dy[j] + Nm[2] * (dx[i] * dy[j] + dy[i] * dx[j]));
  };
  if (n === 4) for (const [xi, eta] of GAUSS2) { const s = quadShape(g, xi, eta); acc(s.dx, s.dy, s.det); }
  else { const { dx, dy } = triShape(g); acc(dx, dy, g.area); }
  const Kl = zeros(6 * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let d = 0; d < 3; d++) Kl[6 * i + d][6 * j + d] = kg[i][j];
  // Translations only, so the rotation into global axes is enough (warp links do not matter here).
  const T = zeros(6 * n), R = g.R;
  for (let a = 0; a < n; a++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { T[6 * a + i][6 * a + j] = R[3 * i + j]; T[6 * a + 3 + i][6 * a + 3 + j] = R[3 * i + j]; }
  return congruence(Kl, T);
}

/** Surface stresses [sx, sy, sxy] at z = +t/2 ('top'), 0 ('mid') or -t/2 ('bottom'). */
export function surfaceStress(s: ShellStress, t: number, layer: 'top' | 'mid' | 'bottom'): number[] {
  const f = layer === 'top' ? 6 / (t * t) : layer === 'bottom' ? -6 / (t * t) : 0;
  return [s.N[0] / t + f * s.M[0], s.N[1] / t + f * s.M[1], s.N[2] / t + f * s.M[2]];
}
export function principal2D(sx: number, sy: number, sxy: number): { s1: number; s2: number; angle: number } {
  const c = (sx + sy) / 2, r = Math.hypot((sx - sy) / 2, sxy);
  return { s1: c + r, s2: c - r, angle: 0.5 * Math.atan2(2 * sxy, sx - sy) };
}
export const vonMises2D = (sx: number, sy: number, sxy: number): number => Math.sqrt(sx * sx - sx * sy + sy * sy + 3 * sxy * sxy);
