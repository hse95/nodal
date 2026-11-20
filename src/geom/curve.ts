/**
 * Curves: lines, polylines, circular arcs, NURBS curves and joined poly-curves.
 *
 * Every curve is evaluated over a normalized parameter t in [0, 1]. For lines,
 * polylines, arcs and poly-curves made of those, t is proportional to arc
 * length. For NURBS curves t maps linearly onto the knot domain, and arc-length
 * queries go through a sampled length table.
 *
 * NURBS algorithms follow Piegl & Tiller, "The NURBS Book" (2nd ed., 1997):
 * span search and basis functions (A2.1, A2.2), rational curve evaluation
 * (A4.1), knot insertion (A5.1) and global interpolation (section 9.2.1).
 */
import { V3, Plane, Xform, add, sub, mul, dot, cross, len, dist, unit, lerp, v, planePoint, planeFromAxes, xPoint, xPlane, xIsSimilarity, xUniformScale, WORLD_XY, perp } from './vec';

export interface Line { k: 'line'; a: V3; b: V3 }
export interface Polyline { k: 'polyline'; pts: V3[]; closed?: boolean }
/** Circular arc in `plane`, from angle a0 to a1 (radians, a1 > a0). A full circle has a1 - a0 = 2*pi. */
export interface Arc { k: 'arc'; plane: Plane; r: number; a0: number; a1: number }
/** Rational B-spline curve. `knots` has cps.length + deg + 1 entries. */
export interface Nurbs { k: 'nurbs'; deg: number; cps: V3[]; w: number[]; knots: number[] }
export interface PolyCurve { k: 'poly'; segs: Curve[] }
export type Curve = Line | Polyline | Arc | Nurbs | PolyCurve;

export const isCurve = (c: any): c is Curve => !!c && (c.k === 'line' || c.k === 'polyline' || c.k === 'arc' || c.k === 'nurbs' || c.k === 'poly');
export const line = (a: V3, b: V3): Line => ({ k: 'line', a, b });
export const polyline = (pts: V3[], closed = false): Polyline => ({ k: 'polyline', pts, closed });
export const circle = (plane: Plane, r: number): Arc => ({ k: 'arc', plane, r, a0: 0, a1: 2 * Math.PI });

/** Polyline vertices including the closing vertex when closed. */
export function plPts(c: Polyline): V3[] { return c.closed && c.pts.length > 1 ? [...c.pts, c.pts[0]] : c.pts; }

// ---- NURBS kernel ---------------------------------------------------------
export function findSpan(n: number, p: number, u: number, U: number[]): number {
  if (u >= U[n + 1]) return n;
  if (u <= U[p]) return p;
  let lo = p, hi = n + 1, mid = (lo + hi) >> 1;
  while (u < U[mid] || u >= U[mid + 1]) { if (u < U[mid]) hi = mid; else lo = mid; mid = (lo + hi) >> 1; }
  return mid;
}
/** The p+1 non-zero basis functions at u (The NURBS Book A2.2). */
export function basisFuns(span: number, u: number, p: number, U: number[]): number[] {
  const N = new Array<number>(p + 1).fill(0), left = new Array<number>(p + 1), right = new Array<number>(p + 1);
  N[0] = 1;
  for (let j = 1; j <= p; j++) {
    left[j] = u - U[span + 1 - j]; right[j] = U[span + j] - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const den = right[r + 1] + left[j - r];
      const temp = den !== 0 ? N[r] / den : 0;
      N[r] = saved + right[r + 1] * temp;
      saved = left[j - r] * temp;
    }
    N[j] = saved;
  }
  return N;
}
export function clampedKnots(nCps: number, deg: number): number[] {
  const U: number[] = [];
  const spans = nCps - deg;
  for (let i = 0; i <= deg; i++) U.push(0);
  for (let i = 1; i < spans; i++) U.push(i / spans);
  for (let i = 0; i <= deg; i++) U.push(1);
  return U;
}
export function nurbsFromControlPoints(cps: V3[], deg = 3, weights?: number[]): Nurbs {
  const p = Math.max(1, Math.min(deg, cps.length - 1));
  return { k: 'nurbs', deg: p, cps, w: weights ?? cps.map(() => 1), knots: clampedKnots(cps.length, p) };
}
export function nurbsPoint(c: Nurbs, u: number): V3 {
  const n = c.cps.length - 1, span = findSpan(n, c.deg, u, c.knots), N = basisFuns(span, u, c.deg, c.knots);
  let x = 0, y = 0, z = 0, w = 0;
  for (let j = 0; j <= c.deg; j++) {
    const i = span - c.deg + j, wj = N[j] * c.w[i], p = c.cps[i];
    x += wj * p.x; y += wj * p.y; z += wj * p.z; w += wj;
  }
  return { x: x / w, y: y / w, z: z / w };
}
export const nurbsDomain = (c: Nurbs): [number, number] => [c.knots[c.deg], c.knots[c.cps.length]];

/** Dense Gaussian elimination with partial pivoting for several right-hand sides (small systems only). */
export function solveDense(A: number[][], B: number[][]): number[][] {
  const n = A.length, m = B[0].length;
  const a = A.map(r => [...r]), b = B.map(r => [...r]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
    if (Math.abs(a[piv][c]) < 1e-14) throw new Error('Singular system');
    [a[c], a[piv]] = [a[piv], a[c]]; [b[c], b[piv]] = [b[piv], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = a[r][c] / a[c][c];
      if (f === 0) continue;
      for (let k = c; k < n; k++) a[r][k] -= f * a[c][k];
      for (let k = 0; k < m; k++) b[r][k] -= f * b[c][k];
    }
  }
  for (let r = n - 1; r >= 0; r--) for (let k = 0; k < m; k++) {
    let s = b[r][k];
    for (let c = r + 1; c < n; c++) s -= a[r][c] * b[c][k];
    b[r][k] = s / a[r][r];
  }
  return b;
}

/** Parameters and knots for global interpolation (chord length + knot averaging). */
export function interpParams(pts: V3[], deg: number): { ub: number[]; U: number[] } {
  const n = pts.length - 1, ub = new Array<number>(n + 1).fill(0);
  let total = 0;
  for (let i = 1; i <= n; i++) total += dist(pts[i], pts[i - 1]);
  if (total < 1e-14) for (let i = 0; i <= n; i++) ub[i] = i / n;
  else { let acc = 0; for (let i = 1; i <= n; i++) { acc += dist(pts[i], pts[i - 1]); ub[i] = acc / total; } }
  ub[n] = 1;
  const U: number[] = [];
  for (let i = 0; i <= deg; i++) U.push(0);
  for (let j = 1; j <= n - deg; j++) { let s = 0; for (let i = j; i < j + deg; i++) s += ub[i]; U.push(s / deg); }
  for (let i = 0; i <= deg; i++) U.push(1);
  return { ub, U };
}
/** Control points of the degree-`deg` B-spline with knots U that passes through pts at parameters ub. */
export function interpSolve(pts: V3[], deg: number, ub: number[], U: number[]): V3[] {
  const n = pts.length - 1;
  const A: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const row = new Array<number>(n + 1).fill(0);
    const span = findSpan(n, deg, ub[i], U), N = basisFuns(span, ub[i], deg, U);
    for (let j = 0; j <= deg; j++) row[span - deg + j] = N[j];
    A.push(row);
  }
  return solveDense(A, pts.map(p => [p.x, p.y, p.z])).map(r => v(r[0], r[1], r[2]));
}
export function interpolateCurve(pts: V3[], deg = 3): Curve {
  if (pts.length < 2) throw new Error('Interpolation needs at least two points');
  if (pts.length === 2) return line(pts[0], pts[1]);
  const p = Math.min(deg, pts.length - 1);
  const { ub, U } = interpParams(pts, p);
  return { k: 'nurbs', deg: p, cps: interpSolve(pts, p, ub, U), w: pts.map(() => 1), knots: U };
}

/** Insert knot u once (Boehm's algorithm, The NURBS Book A5.1 with r = 1), in homogeneous coordinates. */
function insertKnot(c: Nurbs, u: number): Nurbs {
  const p = c.deg, n = c.cps.length - 1, kk = findSpan(n, p, u, c.knots);
  const P = c.cps.map((q, i) => [q.x * c.w[i], q.y * c.w[i], q.z * c.w[i], c.w[i]]);
  const Q: number[][] = [];
  for (let i = 0; i <= n + 1; i++) {
    if (i <= kk - p) Q.push(P[i]);
    else if (i > kk) Q.push(P[i - 1]);
    else {
      const a = (u - c.knots[i]) / (c.knots[i + p] - c.knots[i]);
      Q.push(P[i].map((x, d) => a * x + (1 - a) * P[i - 1][d]));
    }
  }
  const knots = [...c.knots.slice(0, kk + 1), u, ...c.knots.slice(kk + 1)];
  return { k: 'nurbs', deg: p, knots, w: Q.map(q => q[3]), cps: Q.map(q => v(q[0] / q[3], q[1] / q[3], q[2] / q[3])) };
}
/** Portion of a NURBS curve between knot values u0 < u1 (exact, by knot insertion). */
function nurbsSub(c: Nurbs, u0: number, u1: number): Nurbs {
  let cur = c;
  const mult = (cc: Nurbs, u: number) => cc.knots.filter(kv => Math.abs(kv - u) < 1e-12).length;
  const [d0, d1] = nurbsDomain(c);
  for (const u of [u0, u1]) {
    if (u <= d0 + 1e-12 || u >= d1 - 1e-12) continue;
    while (mult(cur, u) < cur.deg) cur = insertKnot(cur, u);
  }
  // After insertion each interior cut has multiplicity p, so the curve passes
  // through control point (first index of the cut knot) - 1 at that parameter.
  const p = cur.deg;
  let first = 0, last = cur.cps.length - 1;
  if (u0 > d0 + 1e-12) first = cur.knots.findIndex(kv => Math.abs(kv - u0) < 1e-12) - 1;
  if (u1 < d1 - 1e-12) last = cur.knots.findIndex(kv => Math.abs(kv - u1) < 1e-12) - 1;
  const interior = cur.knots.filter(kv => kv > u0 + 1e-12 && kv < u1 - 1e-12);
  const ends = (val: number) => new Array<number>(p + 1).fill(val);
  const knots = [...ends(u0), ...interior, ...ends(u1)].map(kv => (kv - u0) / (u1 - u0));
  return { k: 'nurbs', deg: p, cps: cur.cps.slice(first, last + 1), w: cur.w.slice(first, last + 1), knots };
}

// ---- generic curve queries -------------------------------------------------
function cumLengths(pts: V3[]): number[] {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + dist(pts[i], pts[i - 1]));
  return acc;
}
/** 16-point composite Gauss–Legendre is overkill; 4 points on 8 sub-intervals per knot span is ample. */
const GL4 = [[-0.8611363115940526, 0.3478548451374538], [-0.3399810435848563, 0.6521451548625461], [0.3399810435848563, 0.6521451548625461], [0.8611363115940526, 0.3478548451374538]];
function nurbsDeriv(c: Nurbs, u: number): V3 {
  const [d0, d1] = nurbsDomain(c), h = (d1 - d0) * 1e-6;
  const a = Math.max(d0, u - h), b = Math.min(d1, u + h);
  return mul(sub(nurbsPoint(c, b), nurbsPoint(c, a)), 1 / (b - a));
}
function nurbsLengthBetween(c: Nurbs, u0: number, u1: number): number {
  const breaks = [u0, ...c.knots.filter(kv => kv > u0 + 1e-12 && kv < u1 - 1e-12).filter((kv, i, arr) => i === 0 || kv - arr[i - 1] > 1e-12), u1];
  let L = 0;
  for (let s = 0; s + 1 < breaks.length; s++) {
    const sub8 = 8, a = breaks[s], b = breaks[s + 1];
    for (let q = 0; q < sub8; q++) {
      const x0 = a + (b - a) * q / sub8, x1 = a + (b - a) * (q + 1) / sub8, hm = (x1 - x0) / 2, xm = (x0 + x1) / 2;
      for (const [gx, gw] of GL4) L += gw * hm * len(nurbsDeriv(c, xm + hm * gx));
    }
  }
  return L;
}

export function curveLength(c: Curve): number {
  switch (c.k) {
    case 'line': return dist(c.a, c.b);
    case 'polyline': { const p = plPts(c); return cumLengths(p)[p.length - 1] ?? 0; }
    case 'arc': return Math.abs(c.r * (c.a1 - c.a0));
    case 'nurbs': { const [a, b] = nurbsDomain(c); return nurbsLengthBetween(c, a, b); }
    case 'poly': return c.segs.reduce((s, x) => s + curveLength(x), 0);
  }
}
export function curvePoint(c: Curve, t: number): V3 {
  switch (c.k) {
    case 'line': return lerp(c.a, c.b, t);
    case 'polyline': {
      const p = plPts(c);
      if (p.length === 1) return p[0];
      const acc = cumLengths(p), L = acc[acc.length - 1], s = t * L;
      let i = 1;
      while (i < acc.length - 1 && acc[i] < s) i++;
      const seg = acc[i] - acc[i - 1];
      return lerp(p[i - 1], p[i], seg > 0 ? (s - acc[i - 1]) / seg : 0);
    }
    case 'arc': { const a = c.a0 + t * (c.a1 - c.a0); return planePoint(c.plane, c.r * Math.cos(a), c.r * Math.sin(a)); }
    case 'nurbs': { const [a, b] = nurbsDomain(c); return nurbsPoint(c, a + Math.min(1, Math.max(0, t)) * (b - a)); }
    case 'poly': {
      const Ls = c.segs.map(curveLength), L = Ls.reduce((a, b) => a + b, 0);
      let s = Math.min(1, Math.max(0, t)) * L;
      for (let i = 0; i < c.segs.length; i++) {
        if (s <= Ls[i] || i === c.segs.length - 1) return curvePoint(c.segs[i], Ls[i] > 0 ? Math.min(1, s / Ls[i]) : 0);
        s -= Ls[i];
      }
      return curvePoint(c.segs[0], 0);
    }
  }
}
export function curveTangent(c: Curve, t: number): V3 {
  if (c.k === 'line') return unit(sub(c.b, c.a));
  if (c.k === 'arc') { const a = c.a0 + t * (c.a1 - c.a0); return unit(add(mul(c.plane.x, -Math.sin(a)), mul(c.plane.y, Math.cos(a)))); }
  const h = 1e-5, a = Math.max(0, t - h), b = Math.min(1, t + h);
  return unit(sub(curvePoint(c, b), curvePoint(c, a)));
}
/** Curvature (1/radius) at t. Exact for lines and arcs, finite differences otherwise. */
export function curveCurvature(c: Curve, t: number): { k: number; center: V3 | null } {
  if (c.k === 'line') return { k: 0, center: null };
  if (c.k === 'arc') return { k: 1 / c.r, center: c.plane.o };
  const h = 1e-3, tc = Math.min(1 - h, Math.max(h, t));
  const p0 = curvePoint(c, tc - h), p1 = curvePoint(c, tc), p2 = curvePoint(c, tc + h);
  const d1 = mul(sub(p2, p0), 1 / (2 * h)), d2 = mul(add(sub(p2, mul(p1, 2)), p0), 1 / (h * h));
  const cr = cross(d1, d2), l1 = len(d1);
  const kappa = l1 > 0 ? len(cr) / (l1 * l1 * l1) : 0;
  if (kappa < 1e-12) return { k: 0, center: null };
  const n = unit(cross(cr, d1));
  return { k: kappa, center: add(p1, mul(n, 1 / kappa)) };
}
export const curveStart = (c: Curve): V3 => curvePoint(c, 0);
export const curveEnd = (c: Curve): V3 => curvePoint(c, 1);
export function curveClosed(c: Curve): boolean {
  if (c.k === 'polyline') return !!c.closed;
  if (c.k === 'arc') return Math.abs(c.a1 - c.a0) >= 2 * Math.PI - 1e-9;
  return dist(curveStart(c), curveEnd(c)) < 1e-9;
}

/** True when t is proportional to arc length for this curve. */
function uniformSpeed(c: Curve): boolean {
  return c.k === 'line' || c.k === 'polyline' || c.k === 'arc' || (c.k === 'poly' && c.segs.every(uniformSpeed));
}
/** Parameters t at the given arc lengths (ascending). */
export function paramsAtLengths(c: Curve, lengths: number[]): number[] {
  const L = curveLength(c);
  if (L <= 0) return lengths.map(() => 0);
  if (uniformSpeed(c)) return lengths.map(s => Math.min(1, Math.max(0, s / L)));
  // Sampled length table with linear inversion; the table is dense enough for 1e-6 relative accuracy on smooth curves.
  const N = 2000, pts: V3[] = [];
  for (let i = 0; i <= N; i++) pts.push(curvePoint(c, i / N));
  const acc = cumLengths(pts), tot = acc[N];
  return lengths.map(s => {
    const target = Math.min(tot, Math.max(0, s * tot / L));
    let lo = 0, hi = N;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (acc[mid] < target) lo = mid; else hi = mid; }
    const seg = acc[hi] - acc[lo];
    return (lo + (seg > 0 ? (target - acc[lo]) / seg : 0)) / N;
  });
}
/** n equal-length segments -> n+1 parameters (n for closed curves). */
export function divideByCount(c: Curve, n: number): number[] {
  const L = curveLength(c), closed = curveClosed(c);
  const ss: number[] = [];
  for (let i = 0; i <= n - (closed ? 1 : 0); i++) ss.push(L * i / n);
  return paramsAtLengths(c, ss);
}
export function divideByLength(c: Curve, segLength: number): number[] {
  const L = curveLength(c);
  if (segLength <= 0) throw new Error('Segment length must be positive');
  const ss: number[] = [];
  for (let s = 0; s <= L + 1e-9 * L; s += segLength) ss.push(Math.min(s, L));
  return paramsAtLengths(c, ss);
}

/** Points along a curve for display and for sampling-based algorithms. */
export function curveToPoints(c: Curve, density = 1): V3[] {
  switch (c.k) {
    case 'line': return [c.a, c.b];
    case 'polyline': return plPts(c);
    case 'arc': {
      const n = Math.max(2, Math.ceil(Math.abs(c.a1 - c.a0) / (Math.PI / 32) * density));
      return Array.from({ length: n + 1 }, (_, i) => curvePoint(c, i / n));
    }
    case 'nurbs': {
      if (c.deg === 1) return c.cps;
      const n = Math.max(8, Math.ceil((c.cps.length - c.deg) * 12 * density));
      return Array.from({ length: n + 1 }, (_, i) => curvePoint(c, i / n));
    }
    case 'poly': {
      const out: V3[] = [];
      for (const s of c.segs) { const p = curveToPoints(s, density); out.push(...(out.length ? p.slice(1) : p)); }
      return out;
    }
  }
}

export function closestPointOnSegment(p: V3, a: V3, b: V3): { t: number; q: V3 } {
  const ab = sub(b, a), d = dot(ab, ab);
  const t = d > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / d)) : 0;
  return { t, q: lerp(a, b, t) };
}
export function curveClosestPoint(c: Curve, p: V3): { t: number; point: V3; dist: number } {
  if (c.k === 'line') { const r = closestPointOnSegment(p, c.a, c.b); return { t: r.t, point: r.q, dist: dist(p, r.q) }; }
  const N = c.k === 'polyline' ? Math.max(64, c.pts.length * 8) : 256;
  let best = 0, bd = Infinity;
  for (let i = 0; i <= N; i++) { const d = dist(p, curvePoint(c, i / N)); if (d < bd) { bd = d; best = i; } }
  // Golden-section refinement around the best sample.
  let lo = Math.max(0, (best - 1) / N), hi = Math.min(1, (best + 1) / N);
  const g = (Math.sqrt(5) - 1) / 2;
  for (let it = 0; it < 60; it++) {
    const m1 = hi - g * (hi - lo), m2 = lo + g * (hi - lo);
    if (dist(p, curvePoint(c, m1)) < dist(p, curvePoint(c, m2))) hi = m2; else lo = m1;
  }
  const t = (lo + hi) / 2, point = curvePoint(c, t);
  return { t, point, dist: dist(p, point) };
}

/** Closest approach of two segments; returns parameters on each and the distance. */
export function segSegClosest(p1: V3, q1: V3, p2: V3, q2: V3): { s: number; t: number; d: number; a: V3; b: V3 } {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s = 0, t = 0;
  if (a <= 1e-30 && e <= 1e-30) { s = 0; t = 0; }
  else if (a <= 1e-30) { t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = dot(d1, r);
    if (e <= 1e-30) { s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-30 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  const pa = add(p1, mul(d1, s)), pb = add(p2, mul(d2, t));
  return { s, t, d: dist(pa, pb), a: pa, b: pb };
}
/** Intersection points of two curves (sampling based; exact for lines and polylines). */
export function curveCurveIntersect(c1: Curve, c2: Curve, tol = 1e-6): { point: V3; t1: number; t2: number }[] {
  const dens = 4, p1 = curveToPoints(c1, dens), p2 = curveToPoints(c2, dens);
  const hits: { point: V3; t1: number; t2: number }[] = [];
  for (let i = 0; i + 1 < p1.length; i++) for (let j = 0; j + 1 < p2.length; j++) {
    const r = segSegClosest(p1[i], p1[i + 1], p2[j], p2[j + 1]);
    if (r.d <= tol) {
      const point = lerp(r.a, r.b, 0.5);
      if (!hits.some(h => dist(h.point, point) < tol * 100 + 1e-9)) {
        hits.push({ point, t1: curveClosestPoint(c1, point).t, t2: curveClosestPoint(c2, point).t });
      }
    }
  }
  return hits.sort((a, b) => a.t1 - b.t1);
}

export function reverseCurve(c: Curve): Curve {
  switch (c.k) {
    case 'line': return line(c.b, c.a);
    case 'polyline': return { k: 'polyline', pts: [...c.pts].reverse(), closed: c.closed };
    case 'arc': {
      // Flip the plane so the sweep runs the other way from the old end point.
      const pl: Plane = { k: 'plane', o: c.plane.o, x: c.plane.x, y: mul(c.plane.y, -1), z: mul(c.plane.z, -1) };
      return { k: 'arc', plane: pl, r: c.r, a0: -c.a1, a1: -c.a0 };
    }
    case 'nurbs': {
      const [a, b] = [c.knots[0], c.knots[c.knots.length - 1]];
      return { k: 'nurbs', deg: c.deg, cps: [...c.cps].reverse(), w: [...c.w].reverse(), knots: c.knots.map(kv => a + b - kv).reverse() };
    }
    case 'poly': return { k: 'poly', segs: c.segs.map(reverseCurve).reverse() };
  }
}

/** Sub-curve between normalized parameters t0 < t1. */
export function subCurve(c: Curve, t0: number, t1: number): Curve {
  switch (c.k) {
    case 'line': return line(curvePoint(c, t0), curvePoint(c, t1));
    case 'arc': return { k: 'arc', plane: c.plane, r: c.r, a0: c.a0 + t0 * (c.a1 - c.a0), a1: c.a0 + t1 * (c.a1 - c.a0) };
    case 'nurbs': { const [a, b] = nurbsDomain(c); return nurbsSub(c, a + t0 * (b - a), a + t1 * (b - a)); }
    case 'polyline': {
      const p = plPts(c), acc = cumLengths(p), L = acc[acc.length - 1];
      const pts = [curvePoint(c, t0)];
      for (let i = 1; i < p.length - 1; i++) if (acc[i] > t0 * L + 1e-12 && acc[i] < t1 * L - 1e-12) pts.push(p[i]);
      pts.push(curvePoint(c, t1));
      return pts.length === 2 ? line(pts[0], pts[1]) : polyline(pts);
    }
    case 'poly': {
      const Ls = c.segs.map(curveLength), L = Ls.reduce((a, b) => a + b, 0);
      const segs: Curve[] = [];
      let s = 0;
      for (let i = 0; i < c.segs.length; i++) {
        const a = Math.max(t0 * L, s), b = Math.min(t1 * L, s + Ls[i]);
        if (b - a > 1e-12 * L) segs.push(subCurve(c.segs[i], (a - s) / Ls[i], (b - s) / Ls[i]));
        s += Ls[i];
      }
      return segs.length === 1 ? segs[0] : { k: 'poly', segs };
    }
  }
}
/** Split a curve at the given parameters. */
export function shatter(c: Curve, ts: number[]): Curve[] {
  const cuts = [0, ...[...ts].filter(t => t > 1e-9 && t < 1 - 1e-9).sort((a, b) => a - b), 1];
  const out: Curve[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) if (cuts[i + 1] - cuts[i] > 1e-9) out.push(subCurve(c, cuts[i], cuts[i + 1]));
  return out;
}
export function explodeCurve(c: Curve): Curve[] {
  if (c.k === 'polyline') { const p = plPts(c); return p.slice(1).map((q, i) => line(p[i], q)); }
  if (c.k === 'poly') return c.segs.flatMap(explodeCurve);
  return [c];
}
/** Join curves whose end points meet (within tol) into poly-curves, flipping pieces when needed. */
export function joinCurves(curves: Curve[], tol = 1e-6): Curve[] {
  const pool = curves.flatMap(c => (c.k === 'poly' ? c.segs : [c]));
  const used = pool.map(() => false), out: Curve[] = [];
  for (let i = 0; i < pool.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const chain: Curve[] = [pool[i]];
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < pool.length; j++) {
        if (used[j]) continue;
        const head = curveStart(chain[0]), tail = curveEnd(chain[chain.length - 1]);
        const s = curveStart(pool[j]), e = curveEnd(pool[j]);
        if (dist(tail, s) <= tol) chain.push(pool[j]);
        else if (dist(tail, e) <= tol) chain.push(reverseCurve(pool[j]));
        else if (dist(head, e) <= tol) chain.unshift(pool[j]);
        else if (dist(head, s) <= tol) chain.unshift(reverseCurve(pool[j]));
        else continue;
        used[j] = true; grew = true;
      }
    }
    if (chain.length === 1) out.push(chain[0]);
    else if (chain.every(s => s.k === 'line' || s.k === 'polyline')) {
      // Straight pieces collapse to a single polyline.
      const pts: V3[] = [];
      for (const s of chain) { const p = curveToPoints(s); pts.push(...(pts.length ? p.slice(1) : p)); }
      const closed = dist(pts[0], pts[pts.length - 1]) <= tol;
      out.push(polyline(closed ? pts.slice(0, -1) : pts, closed));
    } else out.push({ k: 'poly', segs: chain });
  }
  return out;
}

/** Extend a curve tangentially by straight pieces at the start and/or end. */
export function extendCurve(c: Curve, l0: number, l1: number): Curve {
  if (c.k === 'line') { const d = unit(sub(c.b, c.a)); return line(sub(c.a, mul(d, l0)), add(c.b, mul(d, l1))); }
  const segs: Curve[] = [];
  if (l0 > 0) { const p = curveStart(c); segs.push(line(sub(p, mul(curveTangent(c, 0), l0)), p)); }
  segs.push(c);
  if (l1 > 0) { const p = curveEnd(c); segs.push(line(p, add(p, mul(curveTangent(c, 1), l1)))); }
  return segs.length === 1 ? c : joinCurves(segs)[0];
}

/** Best-fit plane normal of a point loop (Newell's method). */
export function newellNormal(pts: V3[]): V3 {
  let n = v();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n = add(n, v((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)));
  }
  return len(n) > 1e-14 ? unit(n) : v(0, 0, 1);
}
/**
 * Planar offset. Arcs and circles are offset exactly; other curves are offset
 * as polylines with mitred corners. Self-intersections that appear for large
 * distances are not removed (a known limitation).
 */
export function offsetCurve(c: Curve, d: number, plane: Plane = WORLD_XY): Curve {
  if (c.k === 'arc' && Math.abs(Math.abs(dot(c.plane.z, plane.z)) - 1) < 1e-9) {
    const sign = dot(c.plane.z, plane.z) > 0 ? 1 : -1;
    const r = c.r + sign * d;
    if (r <= 0) throw new Error('Offset distance collapses the arc');
    return { ...c, r };
  }
  const closed = curveClosed(c);
  let pts = curveToPoints(c, 2);
  if (closed) pts = pts.slice(0, -1);
  const n = pts.length, nz = plane.z;
  const segN = (a: V3, b: V3): V3 => unit(cross(sub(b, a), nz));   // right-hand side of travel
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const prev = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
    const next = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    const n1 = i === 0 && !closed ? segN(pts[i], next) : segN(prev, pts[i]);
    const n2 = i === n - 1 && !closed ? n1 : segN(pts[i], next);
    const den = 1 + dot(n1, n2);
    const m = den > 1e-6 ? mul(add(n1, n2), 1 / den) : n1;       // mitre vector
    out.push(add(pts[i], mul(m, d)));
  }
  return c.k === 'line' ? line(out[0], out[1]) : polyline(out, closed);
}

/** Round the corners of a polyline with arcs of radius r. Returns a poly-curve of lines and arcs. */
export function filletPolyline(c: Polyline | Line, r: number): Curve {
  if (c.k === 'line' || r <= 0) return c;
  const closed = !!c.closed, P = c.pts, n = P.length;
  if (n < 3) return c;
  const segs: Curve[] = [];
  const corner = (i: number) => {
    const p = P[i], a = P[(i - 1 + n) % n], b = P[(i + 1) % n];
    const u1 = unit(sub(a, p)), u2 = unit(sub(b, p));
    const th = Math.acos(Math.min(1, Math.max(-1, dot(u1, u2))));    // interior angle
    if (th < 1e-6 || Math.PI - th < 1e-6) return null;
    let tl = r / Math.tan(th / 2);
    const lim = Math.min(dist(a, p), dist(b, p)) / 2;
    const rr = tl > lim ? r * lim / tl : r;
    tl = Math.min(tl, lim);
    const t1 = add(p, mul(u1, tl)), t2 = add(p, mul(u2, tl));
    const center = add(p, mul(unit(add(u1, u2)), rr / Math.sin(th / 2)));
    const px = unit(sub(t1, center));
    const pl = planeFromAxes(center, px, sub(t2, center));
    return { t1, t2, arc: { k: 'arc', plane: pl, r: rr, a0: 0, a1: Math.PI - th } as Arc };
  };
  const corners = P.map((_, i) => (closed || (i > 0 && i < n - 1) ? corner(i) : null));
  let cursor = closed ? (corners[0]?.t2 ?? P[0]) : P[0];
  const last = closed ? n : n - 1;
  for (let i = 1; i <= last; i++) {
    const ci = corners[i % n], target = ci ? ci.t1 : P[i % n];
    if (dist(cursor, target) > 1e-12) segs.push(line(cursor, target));
    if (ci) { segs.push(ci.arc); cursor = ci.t2; } else cursor = P[i % n];
  }
  return { k: 'poly', segs };
}

export function rectangle(plane: Plane, w: number, h: number): Polyline {
  return polyline([planePoint(plane, -w / 2, -h / 2), planePoint(plane, w / 2, -h / 2), planePoint(plane, w / 2, h / 2), planePoint(plane, -w / 2, h / 2)], true);
}
export function polygon(plane: Plane, r: number, n: number): Polyline {
  return polyline(Array.from({ length: n }, (_, i) => planePoint(plane, r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n))), true);
}
/** Arc through three points. */
export function arc3(a: V3, b: V3, c: V3): Arc {
  const ab = sub(b, a), ac = sub(c, a), n = cross(ab, ac);
  if (len(n) < 1e-12) throw new Error('Arc points are collinear');
  // Circumcenter from the perpendicular-bisector equations.
  const d = 2 * dot(n, n);
  const o = add(a, mul(add(mul(cross(n, ab), dot(ac, ac)), mul(cross(ac, n), dot(ab, ab))), 1 / d));
  const pl = planeFromAxes(o, sub(a, o), sub(b, o));
  const angOf = (p: V3) => { const q = sub(p, o); let t = Math.atan2(dot(q, pl.y), dot(q, pl.x)); if (t < 0) t += 2 * Math.PI; return t; };
  return { k: 'arc', plane: pl, r: dist(a, o), a0: 0, a1: angOf(c) };
}

/** Exact rational-quadratic NURBS form of an arc (pieces of at most 90 degrees). */
export function arcToNurbs(c: Arc): Nurbs {
  const sweep = c.a1 - c.a0, nSeg = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9)), d = sweep / nSeg;
  const wm = Math.cos(d / 2), cps: V3[] = [], w: number[] = [], knots = [0, 0, 0];
  for (let i = 0; i < nSeg; i++) {
    const a = c.a0 + i * d, m = a + d / 2;
    if (i === 0) { cps.push(planePoint(c.plane, c.r * Math.cos(a), c.r * Math.sin(a))); w.push(1); }
    cps.push(planePoint(c.plane, c.r / wm * Math.cos(m), c.r / wm * Math.sin(m))); w.push(wm);
    cps.push(planePoint(c.plane, c.r * Math.cos(a + d), c.r * Math.sin(a + d))); w.push(1);
    if (i < nSeg - 1) knots.push((i + 1) / nSeg, (i + 1) / nSeg);
  }
  knots.push(1, 1, 1);
  return { k: 'nurbs', deg: 2, cps, w, knots };
}
/** NURBS form of any curve. Lines, polylines and arcs are exact; poly-curves are interpolated. */
export function toNurbs(c: Curve): Nurbs {
  switch (c.k) {
    case 'nurbs': return c;
    case 'line': return { k: 'nurbs', deg: 1, cps: [c.a, c.b], w: [1, 1], knots: [0, 0, 1, 1] };
    case 'polyline': {
      const p = plPts(c), acc = cumLengths(p), L = acc[acc.length - 1] || 1;
      return { k: 'nurbs', deg: 1, cps: p, w: p.map(() => 1), knots: [0, ...acc.map(a => a / L), 1] };
    }
    case 'arc': return arcToNurbs(c);
    case 'poly': {
      const n = Math.max(16, c.segs.length * 12);
      return interpolateCurve(Array.from({ length: n + 1 }, (_, i) => curvePoint(c, i / n)), 3) as Nurbs;
    }
  }
}

export function xformCurve(c: Curve, m: Xform): Curve {
  switch (c.k) {
    case 'line': return line(xPoint(m, c.a), xPoint(m, c.b));
    case 'polyline': return { k: 'polyline', pts: c.pts.map(p => xPoint(m, p)), closed: c.closed };
    case 'arc':
      // Arcs stay arcs only under similarity transforms; otherwise fall back to the exact NURBS form.
      if (xIsSimilarity(m)) return { k: 'arc', plane: xPlane(m, c.plane), r: c.r * xUniformScale(m), a0: c.a0, a1: c.a1 };
      return xformCurve(arcToNurbs(c), m);
    case 'nurbs': return { ...c, cps: c.cps.map(p => xPoint(m, p)) };
    case 'poly': return { k: 'poly', segs: c.segs.map(s => xformCurve(s, m)) };
  }
}
export { perp };
