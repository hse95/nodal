/**
 * Polygon meshes (triangles and quads) and the mesh algorithms used by the
 * component library and by shell meshing.
 *
 * Solids are represented as closed meshes (`solid: true`). There is no B-rep
 * kernel in this version; see DECISIONS.md.
 */
import { V3, Plane, Xform, add, sub, mul, cross, unit, len, dot, v, planePoint, planeCoords, xPoint, WORLD_XY, dist } from './vec';
import { Curve, line, curveToPoints, curveClosed, newellNormal } from './curve';

export interface Mesh { k: 'mesh'; v: number[]; f: number[][]; solid?: boolean }
export const isMesh = (m: any): m is Mesh => !!m && m.k === 'mesh';

export const mv = (m: Mesh, i: number): V3 => ({ x: m.v[3 * i], y: m.v[3 * i + 1], z: m.v[3 * i + 2] });
export const meshVertices = (m: Mesh): V3[] => Array.from({ length: m.v.length / 3 }, (_, i) => mv(m, i));
export function meshFromPointsFaces(pts: V3[], faces: number[][]): Mesh {
  return { k: 'mesh', v: pts.flatMap(p => [p.x, p.y, p.z]), f: faces.map(f => [...f]) };
}
export function faceNormal(m: Mesh, f: number[]): V3 { return newellNormal(f.map(i => mv(m, i))); }
export function faceCenter(m: Mesh, f: number[]): V3 {
  let c = v();
  for (const i of f) c = add(c, mv(m, i));
  return mul(c, 1 / f.length);
}
export function faceArea(m: Mesh, f: number[]): number {
  const p = f.map(i => mv(m, i));
  let a = 0;
  for (let i = 1; i + 1 < p.length; i++) a += len(cross(sub(p[i], p[0]), sub(p[i + 1], p[0]))) / 2;
  return a;
}
export const meshArea = (m: Mesh): number => m.f.reduce((s, f) => s + faceArea(m, f), 0);
/** Signed volume by the divergence theorem (meaningful for closed, consistently oriented meshes). */
export function meshVolume(m: Mesh): number {
  let vol = 0;
  for (const f of m.f) for (let i = 1; i + 1 < f.length; i++) vol += dot(mv(m, f[0]), cross(mv(m, f[i]), mv(m, f[i + 1]))) / 6;
  return vol;
}
export function triangulate(m: Mesh): Mesh {
  const f: number[][] = [];
  for (const q of m.f) {
    if (q.length === 3) f.push([...q]);
    else if (q.length === 4) {
      // Split along the shorter diagonal for better-shaped triangles.
      if (dist(mv(m, q[0]), mv(m, q[2])) <= dist(mv(m, q[1]), mv(m, q[3]))) f.push([q[0], q[1], q[2]], [q[0], q[2], q[3]]);
      else f.push([q[0], q[1], q[3]], [q[1], q[2], q[3]]);
    } else for (let i = 1; i + 1 < q.length; i++) f.push([q[0], q[i], q[i + 1]]);
  }
  return { k: 'mesh', v: [...m.v], f, solid: m.solid };
}
export function joinMeshes(ms: Mesh[]): Mesh {
  const out: Mesh = { k: 'mesh', v: [], f: [] };
  for (const m of ms) { const off = out.v.length / 3; out.v.push(...m.v); for (const f of m.f) out.f.push(f.map(i => i + off)); }
  return out;
}
export function explodeMesh(m: Mesh): Mesh[] { return m.f.map(f => meshFromPointsFaces(f.map(i => mv(m, i)), [f.map((_, i) => i)])); }

/** Merge vertices closer than tol (spatial hash) and drop degenerate faces. */
export function weld(m: Mesh, tol = 1e-6): Mesh {
  const inv = 1 / Math.max(tol, 1e-12), map = new Map<string, number[]>(), remap: number[] = [], vs: number[] = [];
  const n = m.v.length / 3;
  for (let i = 0; i < n; i++) {
    const p = mv(m, i), cx = Math.floor(p.x * inv), cy = Math.floor(p.y * inv), cz = Math.floor(p.z * inv);
    let found = -1;
    for (let dx = -1; dx <= 1 && found < 0; dx++) for (let dy = -1; dy <= 1 && found < 0; dy++) for (let dz = -1; dz <= 1 && found < 0; dz++) {
      for (const j of map.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
        if (Math.hypot(vs[3 * j] - p.x, vs[3 * j + 1] - p.y, vs[3 * j + 2] - p.z) <= tol) { found = j; break; }
      }
    }
    if (found < 0) {
      found = vs.length / 3; vs.push(p.x, p.y, p.z);
      const key = `${cx},${cy},${cz}`; const cell = map.get(key); if (cell) cell.push(found); else map.set(key, [found]);
    }
    remap.push(found);
  }
  const f: number[][] = [];
  for (const q of m.f) {
    const r = q.map(i => remap[i]).filter((x, i, arr) => x !== arr[(i + arr.length - 1) % arr.length]);
    if (new Set(r).size >= 3) f.push(r);
  }
  return { k: 'mesh', v: vs, f, solid: m.solid };
}
/** Edges that belong to exactly one face. */
export function nakedEdges(m: Mesh): Curve[] {
  const count = new Map<string, [number, number, number]>();
  for (const f of m.f) for (let i = 0; i < f.length; i++) {
    const a = f[i], b = f[(i + 1) % f.length], key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const e = count.get(key); if (e) e[2]++; else count.set(key, [a, b, 1]);
  }
  return [...count.values()].filter(e => e[2] === 1).map(e => line(mv(m, e[0]), mv(m, e[1])));
}
export function meshEdges(m: Mesh): [number, number][] {
  const seen = new Set<string>(), out: [number, number][] = [];
  for (const f of m.f) for (let i = 0; i < f.length; i++) {
    const a = f[i], b = f[(i + 1) % f.length], key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (!seen.has(key)) { seen.add(key); out.push([a, b]); }
  }
  return out;
}
export function xformMesh(m: Mesh, x: Xform): Mesh {
  const vs: number[] = [];
  for (let i = 0; i < m.v.length / 3; i++) { const p = xPoint(x, mv(m, i)); vs.push(p.x, p.y, p.z); }
  // A mirror reverses orientation; flip the faces so normals keep pointing outward.
  const det = x[0] * (x[5] * x[10] - x[6] * x[9]) - x[1] * (x[4] * x[10] - x[6] * x[8]) + x[2] * (x[4] * x[9] - x[5] * x[8]);
  return { k: 'mesh', v: vs, f: det < 0 ? m.f.map(f => [...f].reverse()) : m.f.map(f => [...f]), solid: m.solid };
}

// ---- primitives -----------------------------------------------------------
export function meshBox(plane: Plane, sx: number, sy: number, sz: number): Mesh {
  const p = (x: number, y: number, z: number) => planePoint(plane, x, y, z);
  const pts = [p(0, 0, 0), p(sx, 0, 0), p(sx, sy, 0), p(0, sy, 0), p(0, 0, sz), p(sx, 0, sz), p(sx, sy, sz), p(0, sy, sz)];
  const m = meshFromPointsFaces(pts, [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]);
  m.solid = true;
  return m;
}
export function meshSphere(o: V3, r: number, nu = 24, nv = 12): Mesh {
  const pts: V3[] = [add(o, v(0, 0, -r))], f: number[][] = [];
  for (let j = 1; j < nv; j++) for (let i = 0; i < nu; i++) {
    const th = 2 * Math.PI * i / nu, ph = -Math.PI / 2 + Math.PI * j / nv;
    pts.push(add(o, v(r * Math.cos(ph) * Math.cos(th), r * Math.cos(ph) * Math.sin(th), r * Math.sin(ph))));
  }
  pts.push(add(o, v(0, 0, r)));
  const top = pts.length - 1, ring = (j: number, i: number) => 1 + (j - 1) * nu + (i % nu);
  for (let i = 0; i < nu; i++) {
    f.push([0, ring(1, i + 1), ring(1, i)]);
    for (let j = 1; j < nv - 1; j++) f.push([ring(j, i), ring(j, i + 1), ring(j + 1, i + 1), ring(j + 1, i)]);
    f.push([top, ring(nv - 1, i), ring(nv - 1, i + 1)]);
  }
  const m = meshFromPointsFaces(pts, f); m.solid = true; return m;
}
export function meshCylinder(plane: Plane, r: number, h: number, n = 24): Mesh {
  const pts: V3[] = [], f: number[][] = [];
  for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; pts.push(planePoint(plane, r * Math.cos(a), r * Math.sin(a), 0)); }
  for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; pts.push(planePoint(plane, r * Math.cos(a), r * Math.sin(a), h)); }
  pts.push(planePoint(plane, 0, 0, 0), planePoint(plane, 0, 0, h));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    f.push([i, j, n + j, n + i], [2 * n, j, i], [2 * n + 1, n + i, n + j]);
  }
  const m = meshFromPointsFaces(pts, f); m.solid = true; return m;
}
/** Close planar holes: every loop of naked edges gets a triangle fan from its centroid. */
export function capMesh(m: Mesh): Mesh {
  const w = weld(m, 1e-9);
  const next = new Map<number, number>();
  const dirCount = new Map<string, number>();
  for (const f of w.f) for (let i = 0; i < f.length; i++) { const a = f[i], b = f[(i + 1) % f.length]; dirCount.set(`${a}_${b}`, 1); }
  for (const key of dirCount.keys()) {
    const [a, b] = key.split('_').map(Number);
    if (!dirCount.has(`${b}_${a}`)) next.set(b, a);       // boundary traversed opposite to the face winding
  }
  const out: Mesh = { k: 'mesh', v: [...w.v], f: w.f.map(f => [...f]), solid: true };
  const visited = new Set<number>();
  for (const start of next.keys()) {
    if (visited.has(start)) continue;
    const loop: number[] = [];
    let cur: number | undefined = start;
    while (cur !== undefined && !visited.has(cur)) { visited.add(cur); loop.push(cur); cur = next.get(cur); }
    if (loop.length < 3) continue;
    if (loop.length === 3 || loop.length === 4) { out.f.push(loop); continue; }
    let c = v();
    for (const i of loop) c = add(c, mv(out, i));
    c = mul(c, 1 / loop.length);
    const ci = out.v.length / 3; out.v.push(c.x, c.y, c.z);
    for (let i = 0; i < loop.length; i++) out.f.push([ci, loop[i], loop[(i + 1) % loop.length]]);
  }
  return out;
}
/** Extrude a closed planar curve into a capped solid mesh. */
export function extrudeSolid(c: Curve, dir: V3): Mesh {
  if (!curveClosed(c)) throw new Error('A solid extrusion needs a closed curve');
  const base = curveToPoints(c, 1).slice(0, -1), n = base.length;
  const nrm = newellNormal(base), flip = dot(nrm, dir) < 0;
  const ring = flip ? [...base].reverse() : base;
  const pts = [...ring, ...ring.map(p => add(p, dir))], f: number[][] = [];
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; f.push([i, j, n + j, n + i]); }
  return capMesh(meshFromPointsFaces(pts, f));
}

// ---- Delaunay triangulation (Bowyer–Watson) ---------------------------------
/** 2D Delaunay triangulation of points projected onto `plane`. Returns triangles as index triples. */
export function delaunay(points: V3[], plane: Plane = WORLD_XY): number[][] {
  const P = points.map(p => { const q = planeCoords(plane, p); return [q.x, q.y]; });
  const n = P.length;
  if (n < 3) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of P) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const d = Math.max(maxX - minX, maxY - minY, 1e-9) * 20, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  P.push([cx - d, cy - d], [cx + d, cy - d], [cx, cy + d]);          // super-triangle
  interface Tri { a: number; b: number; c: number; x: number; y: number; r2: number }
  const mk = (a: number, b: number, c: number): Tri => {
    const [ax, ay] = P[a], [bx, by] = P[b], [qx, qy] = P[c];
    const D = 2 * (ax * (by - qy) + bx * (qy - ay) + qx * (ay - by));
    const ux = ((ax * ax + ay * ay) * (by - qy) + (bx * bx + by * by) * (qy - ay) + (qx * qx + qy * qy) * (ay - by)) / D;
    const uy = ((ax * ax + ay * ay) * (qx - bx) + (bx * bx + by * by) * (ax - qx) + (qx * qx + qy * qy) * (bx - ax)) / D;
    return { a, b, c, x: ux, y: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 };
  };
  let tris: Tri[] = [mk(n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const [px, py] = P[i], bad: Tri[] = [], keep: Tri[] = [];
    for (const t of tris) ((px - t.x) ** 2 + (py - t.y) ** 2 < t.r2 * (1 + 1e-12) ? bad : keep).push(t);
    const edges = new Map<string, [number, number]>();
    for (const t of bad) for (const [a, b] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as [number, number][]) {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (edges.has(key)) edges.delete(key); else edges.set(key, [a, b]);
    }
    tris = keep;
    for (const [a, b] of edges.values()) {
      const area = (P[b][0] - P[a][0]) * (py - P[a][1]) - (P[b][1] - P[a][1]) * (px - P[a][0]);
      if (Math.abs(area) > 1e-300) tris.push(area > 0 ? mk(a, b, i) : mk(b, a, i));
    }
  }
  return tris.filter(t => t.a < n && t.b < n && t.c < n).map(t => [t.a, t.b, t.c]);
}
/** One step of the "split every face into quads" scheme: each n-gon becomes n quads. */
export function quadSplit(m: Mesh): Mesh {
  const vs = [...m.v], f: number[][] = [], mid = new Map<string, number>();
  const push = (p: V3) => { vs.push(p.x, p.y, p.z); return vs.length / 3 - 1; };
  const midpoint = (a: number, b: number) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    let i = mid.get(key);
    if (i === undefined) { i = push(mul(add(mv(m, a), mv(m, b)), 0.5)); mid.set(key, i); }
    return i;
  };
  for (const q of m.f) {
    const c = push(faceCenter(m, q)), n = q.length;
    for (let i = 0; i < n; i++) f.push([q[i], midpoint(q[i], q[(i + 1) % n]), c, midpoint(q[(i + n - 1) % n], q[i])]);
  }
  return { k: 'mesh', v: vs, f };
}
/** Refine a mesh (by quad splitting) until no edge is longer than `size`. */
export function quadRemesh(m: Mesh, size: number, maxIter = 6): Mesh {
  let cur = weld(m, 1e-9);
  const hasTri = cur.f.some(f => f.length !== 4);
  const maxEdge = (mm: Mesh) => Math.max(...meshEdges(mm).map(([a, b]) => dist(mv(mm, a), mv(mm, b))));
  if (hasTri) cur = quadSplit(cur);
  for (let i = 0; i < maxIter && size > 0 && maxEdge(cur) > size; i++) cur = quadSplit(cur);
  return cur;
}
/** Regular grid mesh from a row-major list of points with nu points per row. */
export function meshFromGrid(pts: V3[], nu: number): Mesh {
  const nv = Math.floor(pts.length / nu), f: number[][] = [];
  for (let j = 0; j + 1 < nv; j++) for (let i = 0; i + 1 < nu; i++) { const a = j * nu + i; f.push([a, a + 1, a + nu + 1, a + nu]); }
  return meshFromPointsFaces(pts.slice(0, nu * nv), f);
}
export { unit };
