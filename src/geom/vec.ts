/**
 * Points, vectors, planes and affine transforms.
 * Right-handed coordinates with Z up. All geometry values are plain objects so
 * they can be saved to JSON and passed to workers unchanged.
 */
export interface V3 { x: number; y: number; z: number }
/** A frame: origin and three orthonormal axes (z is the plane normal). */
export interface Plane { k: 'plane'; o: V3; x: V3; y: V3; z: V3 }
/** Row-major 4x4 affine matrix. */
export type Xform = number[];

export const v = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mul = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const len = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export const dist = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const unit = (a: V3): V3 => { const l = len(a); return l > 1e-300 ? mul(a, 1 / l) : v(0, 0, 0); };
export const lerp = (a: V3, b: V3, t: number): V3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
export const neg = (a: V3): V3 => ({ x: -a.x, y: -a.y, z: -a.z });
export const isV3 = (p: any): p is V3 => !!p && typeof p === 'object' && typeof p.x === 'number' && typeof p.y === 'number' && typeof p.z === 'number' && p.k === undefined;
export const X: V3 = v(1, 0, 0), Y: V3 = v(0, 1, 0), Z: V3 = v(0, 0, 1), O: V3 = v(0, 0, 0);

/** Angle between two vectors in radians, in [0, pi]. */
export function angle(a: V3, b: V3): number {
  const d = dot(unit(a), unit(b));
  return Math.acos(Math.min(1, Math.max(-1, d)));
}
/** Any unit vector perpendicular to `a`. */
export function perp(a: V3): V3 {
  const n = unit(a);
  const ref = Math.abs(n.z) < 0.9 ? Z : X;
  return unit(cross(ref, n));
}

export const WORLD_XY: Plane = { k: 'plane', o: O, x: X, y: Y, z: Z };
export function planeFromNormal(o: V3, n: V3): Plane {
  const z = unit(n);
  // Keep the plane X axis as close to world X as possible so results look predictable.
  let x = sub(X, mul(z, dot(X, z)));
  if (len(x) < 1e-9) x = sub(Y, mul(z, dot(Y, z)));
  x = unit(x);
  return { k: 'plane', o, x, y: cross(z, x), z };
}
export function planeFromAxes(o: V3, xAxis: V3, yHint: V3): Plane {
  const x = unit(xAxis);
  const z = unit(cross(x, yHint));
  return { k: 'plane', o, x, y: cross(z, x), z };
}
export function planeFrom3Points(a: V3, b: V3, c: V3): Plane { return planeFromAxes(a, sub(b, a), sub(c, a)); }
export const planePoint = (p: Plane, u: number, w: number, h = 0): V3 =>
  add(p.o, add(add(mul(p.x, u), mul(p.y, w)), mul(p.z, h)));
/** Coordinates of a point in the plane's frame. */
export const planeCoords = (p: Plane, q: V3): V3 => { const d = sub(q, p.o); return v(dot(d, p.x), dot(d, p.y), dot(d, p.z)); };
export const isPlane = (p: any): p is Plane => !!p && p.k === 'plane';

// ---- transforms ---------------------------------------------------------
export const xIdentity = (): Xform => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export const xTranslate = (t: V3): Xform => [1, 0, 0, t.x, 0, 1, 0, t.y, 0, 0, 1, t.z, 0, 0, 0, 1];
export function xMul(a: Xform, b: Xform): Xform {
  const m = new Array<number>(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[i * 4 + k] * b[k * 4 + j];
    m[i * 4 + j] = s;
  }
  return m;
}
/** Rotation by `ang` radians about the axis through `o` (Rodrigues formula). */
export function xRotate(o: V3, axis: V3, ang: number): Xform {
  const a = unit(axis), c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  const r: Xform = [
    t * a.x * a.x + c, t * a.x * a.y - s * a.z, t * a.x * a.z + s * a.y, 0,
    t * a.x * a.y + s * a.z, t * a.y * a.y + c, t * a.y * a.z - s * a.x, 0,
    t * a.x * a.z - s * a.y, t * a.y * a.z + s * a.x, t * a.z * a.z + c, 0,
    0, 0, 0, 1];
  return xMul(xTranslate(o), xMul(r, xTranslate(neg(o))));
}
export function xScale(o: V3, sx: number, sy = sx, sz = sx): Xform {
  return xMul(xTranslate(o), xMul([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1], xTranslate(neg(o))));
}
/** Reflection through a plane. */
export function xMirror(p: Plane): Xform {
  const n = p.z;
  const r: Xform = [
    1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.z, 0,
    -2 * n.x * n.y, 1 - 2 * n.y * n.y, -2 * n.y * n.z, 0,
    -2 * n.x * n.z, -2 * n.y * n.z, 1 - 2 * n.z * n.z, 0,
    0, 0, 0, 1];
  return xMul(xTranslate(p.o), xMul(r, xTranslate(neg(p.o))));
}
/** Map frame `a` onto frame `b` (rigid change of basis). */
export function xOrient(a: Plane, b: Plane): Xform {
  const toLocal: Xform = [a.x.x, a.x.y, a.x.z, -dot(a.x, a.o), a.y.x, a.y.y, a.y.z, -dot(a.y, a.o), a.z.x, a.z.y, a.z.z, -dot(a.z, a.o), 0, 0, 0, 1];
  const toWorld: Xform = [b.x.x, b.y.x, b.z.x, b.o.x, b.x.y, b.y.y, b.z.y, b.o.y, b.x.z, b.y.z, b.z.z, b.o.z, 0, 0, 0, 1];
  return xMul(toWorld, toLocal);
}
export const xPoint = (m: Xform, p: V3): V3 => ({
  x: m[0] * p.x + m[1] * p.y + m[2] * p.z + m[3],
  y: m[4] * p.x + m[5] * p.y + m[6] * p.z + m[7],
  z: m[8] * p.x + m[9] * p.y + m[10] * p.z + m[11],
});
export const xVector = (m: Xform, p: V3): V3 => ({
  x: m[0] * p.x + m[1] * p.y + m[2] * p.z,
  y: m[4] * p.x + m[5] * p.y + m[6] * p.z,
  z: m[8] * p.x + m[9] * p.y + m[10] * p.z,
});
/** True when the linear part is a rotation times a uniform scale (arcs stay arcs). */
export function xIsSimilarity(m: Xform): boolean {
  const c0 = v(m[0], m[4], m[8]), c1 = v(m[1], m[5], m[9]), c2 = v(m[2], m[6], m[10]);
  const l0 = len(c0), l1 = len(c1), l2 = len(c2), tol = 1e-9 * Math.max(l0, 1);
  return Math.abs(l0 - l1) < tol && Math.abs(l0 - l2) < tol && Math.abs(dot(c0, c1)) < tol && Math.abs(dot(c0, c2)) < tol && Math.abs(dot(c1, c2)) < tol;
}
export const xUniformScale = (m: Xform): number => Math.hypot(m[0], m[4], m[8]);
export function xPlane(m: Xform, p: Plane): Plane {
  const o = xPoint(m, p.o), x = unit(xVector(m, p.x));
  let y = xVector(m, p.y);
  y = unit(sub(y, mul(x, dot(x, y))));
  // A mirror flips handedness; keep z consistent with the transformed normal direction.
  const zt = xVector(m, p.z);
  let z = cross(x, y);
  if (dot(z, zt) < 0) z = neg(z);
  return { k: 'plane', o, x, y, z };
}
