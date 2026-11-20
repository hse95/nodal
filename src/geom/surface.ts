/**
 * Untrimmed NURBS surfaces.
 *
 * Every surface in Nodal is a tensor-product rational B-spline patch evaluated
 * over normalized (u, v) in [0,1] x [0,1]. Planes, four-point patches,
 * extrusions and surfaces of revolution are exact. Lofts, sweeps, point-grid
 * surfaces and offsets are built by interpolating sampled points, so they are
 * approximations of the "true" skinned surface (stated in the user guide).
 * Trimmed surfaces are not supported in this version.
 */
import { V3, Plane, Xform, add, sub, mul, cross, unit, len, dot, v, planePoint, xPoint, xRotate, planeFromNormal, xOrient, perp, dist } from './vec';
import { Curve, Nurbs, toNurbs, findSpan, basisFuns, clampedKnots, interpParams, interpSolve, curvePoint, curveLength, paramsAtLengths, curveTangent, xformCurve, curveClosed } from './curve';
import type { Mesh } from './mesh';

export interface Surface {
  k: 'srf';
  du: number; dv: number;
  nu: number; nv: number;      // control net size
  cps: V3[];                   // row-major: index = i * nv + j, i along u
  w: number[];
  ku: number[]; kv: number[];
}
export const isSurface = (s: any): s is Surface => !!s && s.k === 'srf';

export function srfPoint(s: Surface, u: number, vv: number): V3 {
  const uu = s.ku[s.du] + Math.min(1, Math.max(0, u)) * (s.ku[s.nu] - s.ku[s.du]);
  const vw = s.kv[s.dv] + Math.min(1, Math.max(0, vv)) * (s.kv[s.nv] - s.kv[s.dv]);
  const su = findSpan(s.nu - 1, s.du, uu, s.ku), Nu = basisFuns(su, uu, s.du, s.ku);
  const sv = findSpan(s.nv - 1, s.dv, vw, s.kv), Nv = basisFuns(sv, vw, s.dv, s.kv);
  let x = 0, y = 0, z = 0, w = 0;
  for (let a = 0; a <= s.du; a++) for (let b = 0; b <= s.dv; b++) {
    const idx = (su - s.du + a) * s.nv + (sv - s.dv + b), f = Nu[a] * Nv[b] * s.w[idx], p = s.cps[idx];
    x += f * p.x; y += f * p.y; z += f * p.z; w += f;
  }
  return { x: x / w, y: y / w, z: z / w };
}
/** Unit normal (du x dv) by central differences. */
export function srfNormal(s: Surface, u: number, vv: number): V3 {
  const h = 1e-5;
  const u0 = Math.max(0, u - h), u1 = Math.min(1, u + h), v0 = Math.max(0, vv - h), v1 = Math.min(1, vv + h);
  const n = cross(sub(srfPoint(s, u1, vv), srfPoint(s, u0, vv)), sub(srfPoint(s, u, v1), srfPoint(s, u, v0)));
  return unit(n);
}
function make(du: number, dv: number, nu: number, nv: number, cps: V3[], w?: number[], ku?: number[], kv?: number[]): Surface {
  return { k: 'srf', du, dv, nu, nv, cps, w: w ?? cps.map(() => 1), ku: ku ?? clampedKnots(nu, du), kv: kv ?? clampedKnots(nv, dv) };
}
/** Rectangle in `plane` with one corner at the plane origin. */
export function planeSurface(plane: Plane, w: number, h: number): Surface {
  return make(1, 1, 2, 2, [planePoint(plane, 0, 0), planePoint(plane, 0, h), planePoint(plane, w, 0), planePoint(plane, w, h)]);
}
/** Bilinear patch through corners given in loop order a-b-c-d (u runs a->b, v runs a->d). */
export function fourPointSurface(a: V3, b: V3, c: V3, d: V3): Surface { return make(1, 1, 2, 2, [a, d, b, c]); }

export function extrudeCurve(c: Curve, dir: V3): Surface {
  const n = toNurbs(c), cps: V3[] = [], w: number[] = [];
  n.cps.forEach((p, i) => { cps.push(p, add(p, dir)); w.push(n.w[i], n.w[i]); });
  return make(n.deg, 1, n.cps.length, 2, cps, w, n.knots, [0, 0, 1, 1]);
}
/** Exact surface of revolution of `profile` about the axis (o, dir) through `angle` radians. */
export function revolve(profile: Curve, o: V3, dir: V3, angle = 2 * Math.PI): Surface {
  const n = toNurbs(profile), ax = unit(dir);
  const nSeg = Math.max(1, Math.ceil(Math.abs(angle) / (Math.PI / 2) - 1e-9)), d = angle / nSeg, wm = Math.cos(d / 2);
  const nv = 2 * nSeg + 1, kv = [0, 0, 0];
  for (let i = 1; i < nSeg; i++) kv.push(i / nSeg, i / nSeg);
  kv.push(1, 1, 1);
  const cps: V3[] = [], w: number[] = [];
  n.cps.forEach((p, i) => {
    const foot = add(o, mul(ax, dot(sub(p, o), ax)));       // projection of p on the axis
    for (let j = 0; j < nv; j++) {
      const q = xPoint(xRotate(o, ax, (j / 2) * d), p);
      if (j % 2 === 0) { cps.push(q); w.push(n.w[i]); }
      else { cps.push(add(foot, mul(sub(q, foot), 1 / wm))); w.push(n.w[i] * wm); }   // off-curve control point
    }
  });
  return make(n.deg, 2, n.cps.length, nv, cps, w, n.knots, kv);
}
/** Interpolating surface through a grid of points (nu points per row along u; rows stacked along v). */
export function surfaceFromGrid(grid: V3[][], degU = 3, degV = 3): Surface {
  const nv = grid.length, nu = grid[0].length;
  if (nu < 2 || nv < 2) throw new Error('A surface needs at least a 2 x 2 grid of points');
  const pu = Math.min(degU, nu - 1), pv = Math.min(degV, nv - 1);
  // Average the chord-length parameters over rows / columns so one knot vector serves the whole net.
  const avg = (lists: number[][]) => lists[0].map((_, i) => lists.reduce((s, l) => s + l[i], 0) / lists.length);
  const ub = avg(grid.map(row => interpParams(row, pu).ub));
  const cols = Array.from({ length: nu }, (_, i) => grid.map(row => row[i]));
  const vb = avg(cols.map(col => interpParams(col, pv).ub));
  const knotsFrom = (pb: number[], p: number) => {
    const n = pb.length - 1, U: number[] = [];
    for (let i = 0; i <= p; i++) U.push(0);
    for (let j = 1; j <= n - p; j++) { let s = 0; for (let i = j; i < j + p; i++) s += pb[i]; U.push(s / p); }
    for (let i = 0; i <= p; i++) U.push(1);
    return U;
  };
  const ku = knotsFrom(ub, pu), kv = knotsFrom(vb, pv);
  const rowsC = grid.map(row => interpSolve(row, pu, ub, ku));                  // nv rows of nu control points
  const colsC = Array.from({ length: nu }, (_, i) => interpSolve(rowsC.map(r => r[i]), pv, vb, kv));
  const cps: V3[] = [];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) cps.push(colsC[i][j]);
  return make(pu, pv, nu, nv, cps, undefined, ku, kv);
}
/** Sample a curve at n+1 points equally spaced by arc length. */
export function sampleCurve(c: Curve, n: number): V3[] {
  const L = curveLength(c);
  return paramsAtLengths(c, Array.from({ length: n + 1 }, (_, i) => L * i / n)).map(t => curvePoint(c, t));
}
/** Loft through section curves (interpolated; each section is sampled by arc length). */
export function loft(sections: Curve[], samples = 16, degree = 3): Surface {
  if (sections.length < 2) throw new Error('Loft needs at least two section curves');
  return surfaceFromGrid(sections.map(c => sampleCurve(c, samples)), 3, Math.min(degree, sections.length - 1));
}
/**
 * Sweep a profile along a rail. Frames along the rail are propagated by
 * rotation-minimizing (parallel) transport, so the profile does not twist.
 */
export function sweep(rail: Curve, profile: Curve, stations = 24, samples = 16): Surface {
  const L = curveLength(rail), ts = paramsAtLengths(rail, Array.from({ length: stations + 1 }, (_, i) => L * i / stations));
  let t0 = curveTangent(rail, ts[0]), xAxis = perp(t0);
  const base: Plane = { k: 'plane', o: curvePoint(rail, ts[0]), x: xAxis, y: cross(t0, xAxis), z: t0 };
  const sections: Curve[] = [];
  for (const t of ts) {
    const tan = curveTangent(rail, t), axis = cross(t0, tan), s = len(axis);
    if (s > 1e-12) xAxis = unit(xPoint(xRotate(v(), axis, Math.asin(Math.min(1, s))), xAxis));
    xAxis = unit(sub(xAxis, mul(tan, dot(xAxis, tan))));
    t0 = tan;
    const fr: Plane = { k: 'plane', o: curvePoint(rail, t), x: xAxis, y: cross(tan, xAxis), z: tan };
    sections.push(xformCurve(profile, xOrient(base, fr)));
  }
  return loft(sections, samples, 3);
}
/** Exact iso-parametric curve at constant u (dir = 'u') or constant v (dir = 'v'). */
export function isoCurve(s: Surface, dir: 'u' | 'v', t: number): Nurbs {
  const constU = dir === 'u';
  const p = constU ? s.du : s.dv, n = constU ? s.nu : s.nv, K = constU ? s.ku : s.kv;
  const val = K[p] + Math.min(1, Math.max(0, t)) * (K[n] - K[p]);
  const span = findSpan(n - 1, p, val, K), N = basisFuns(span, val, p, K);
  const m = constU ? s.nv : s.nu, cps: V3[] = [], w: number[] = [];
  for (let j = 0; j < m; j++) {
    let x = 0, y = 0, z = 0, ww = 0;
    for (let a = 0; a <= p; a++) {
      const i = span - p + a, idx = constU ? i * s.nv + j : j * s.nv + i, f = N[a] * s.w[idx], q = s.cps[idx];
      x += f * q.x; y += f * q.y; z += f * q.z; ww += f;
    }
    cps.push(v(x / ww, y / ww, z / ww)); w.push(ww);
  }
  return { k: 'nurbs', deg: constU ? s.dv : s.du, cps, w, knots: constU ? s.kv : s.ku };
}
/** Offset by sampling the surface, moving points along the normal and re-interpolating (approximate). */
export function offsetSurface(s: Surface, d: number, samples = 12): Surface {
  const grid: V3[][] = [];
  for (let j = 0; j <= samples; j++) {
    const row: V3[] = [];
    for (let i = 0; i <= samples; i++) row.push(add(srfPoint(s, i / samples, j / samples), mul(srfNormal(s, i / samples, j / samples), d)));
    grid.push(row);
  }
  return surfaceFromGrid(grid);
}
/** Quad mesh on a regular (nu x nv) parameter grid. Coincident seam/pole vertices are left for `weld`. */
export function surfaceToMesh(s: Surface, nu: number, nv: number): Mesh {
  const vs: number[] = [], f: number[][] = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const p = srfPoint(s, i / nu, j / nv); vs.push(p.x, p.y, p.z); }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * (nv + 1) + j, b = (i + 1) * (nv + 1) + j;
    f.push([a, b, b + 1, a + 1]);
  }
  return { k: 'mesh', v: vs, f };
}
/** Edge lengths of the surface along u and v (through the middle), used to pick mesh densities. */
export function srfSize(s: Surface): [number, number] {
  const n = 16;
  let lu = 0, lv = 0;
  for (let i = 0; i < n; i++) {
    lu += dist(srfPoint(s, i / n, 0.5), srfPoint(s, (i + 1) / n, 0.5));
    lv += dist(srfPoint(s, 0.5, i / n), srfPoint(s, 0.5, (i + 1) / n));
  }
  return [lu, lv];
}
export function xformSurface(s: Surface, m: Xform): Surface { return { ...s, cps: s.cps.map(p => xPoint(m, p)) }; }
export { planeFromNormal, curveClosed };
