/**
 * File import and export for geometry and data.
 * Implemented natively: STL (binary and ASCII), OBJ, DXF (lines, polylines,
 * circles, arcs, 3D faces), CSV, glTF 2.0 (export). 3DM goes through rhino3dm
 * (WebAssembly, loaded on demand). STEP and IGES need a B-rep kernel and are
 * not available in this version (see DECISIONS.md).
 */
import { V3, v, isV3, WORLD_XY, planeFromNormal } from '../geom/vec';
import * as cv from '../geom/curve';
import * as sf from '../geom/surface';
import * as ms from '../geom/mesh';

export interface GeometrySet { meshes: ms.Mesh[]; curves: cv.Curve[]; points: V3[] }
/** Sort any mixture of geometry values into meshes, curves and points (surfaces are tessellated). */
export function collect(items: any[], set: GeometrySet = { meshes: [], curves: [], points: [] }): GeometrySet {
  for (const g of items) {
    if (g === null || g === undefined) continue;
    if (Array.isArray(g)) collect(g, set);
    else if (isV3(g)) set.points.push(g);
    else if (cv.isCurve(g)) set.curves.push(g);
    else if (sf.isSurface(g)) set.meshes.push(ms.weld(sf.surfaceToMesh(g, 24, 24), 1e-9));
    else if (ms.isMesh(g)) set.meshes.push(g);
    else if (g.k === 'styled') collect([g.g], set);
  }
  return set;
}

// ---- STL ----------------------------------------------------------------------
export function exportSTL(meshes: ms.Mesh[]): ArrayBuffer {
  const tris: V3[][] = [];
  for (const m of meshes) { const t = ms.triangulate(m); for (const f of t.f) tris.push(f.map(i => ms.mv(t, i))); }
  const buf = new ArrayBuffer(84 + 50 * tris.length), dv = new DataView(buf);
  new TextEncoder().encodeInto('Nodal STL export', new Uint8Array(buf, 0, 80));
  dv.setUint32(80, tris.length, true);
  tris.forEach((t, k) => {
    const o = 84 + 50 * k, n = cv.newellNormal(t);
    [n, ...t].forEach((p, i) => { dv.setFloat32(o + 12 * i, p.x, true); dv.setFloat32(o + 12 * i + 4, p.y, true); dv.setFloat32(o + 12 * i + 8, p.z, true); });
  });
  return buf;
}
export function parseSTL(buf: ArrayBuffer): ms.Mesh {
  const dv = new DataView(buf), n = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  const vs: number[] = [], f: number[][] = [];
  if (buf.byteLength === 84 + 50 * n && n > 0) {
    for (let k = 0; k < n; k++) { const o = 84 + 50 * k + 12, base = vs.length / 3; for (let i = 0; i < 9; i++) vs.push(dv.getFloat32(o + 4 * i, true)); f.push([base, base + 1, base + 2]); }
  } else {
    const text = new TextDecoder().decode(buf), re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) vs.push(Number(m[1]), Number(m[2]), Number(m[3]));
    for (let i = 0; i + 2 < vs.length / 3; i += 3) f.push([i, i + 1, i + 2]);
    if (!f.length) throw new Error('No triangles found in the STL file');
  }
  return ms.weld({ k: 'mesh', v: vs, f }, 1e-9);
}

// ---- OBJ ----------------------------------------------------------------------
export function exportOBJ(set: GeometrySet): string {
  const out: string[] = ['# Nodal OBJ export'];
  let off = 1;
  for (const m of set.meshes) { for (let i = 0; i < m.v.length; i += 3) out.push(`v ${m.v[i]} ${m.v[i + 1]} ${m.v[i + 2]}`); for (const f of m.f) out.push('f ' + f.map(i => i + off).join(' ')); off += m.v.length / 3; }
  for (const c of set.curves) { const p = cv.curveToPoints(c, 2); p.forEach(q => out.push(`v ${q.x} ${q.y} ${q.z}`)); out.push('l ' + p.map((_, i) => i + off).join(' ')); off += p.length; }
  for (const p of set.points) { out.push(`v ${p.x} ${p.y} ${p.z}`, `p ${off++}`); }
  return out.join('\n') + '\n';
}
export function parseOBJ(text: string): any[] {
  const vs: V3[] = [], f: number[][] = [], curves: cv.Curve[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim().split(/\s+/);
    if (t[0] === 'v') vs.push(v(Number(t[1]), Number(t[2]), Number(t[3])));
    else if (t[0] === 'f') f.push(t.slice(1).map(s => { const i = parseInt(s.split('/')[0], 10); return i < 0 ? vs.length + i : i - 1; }));
    else if (t[0] === 'l') { const pts = t.slice(1).map(s => vs[parseInt(s, 10) - 1]).filter(Boolean); if (pts.length >= 2) curves.push(pts.length === 2 ? cv.line(pts[0], pts[1]) : cv.polyline(pts)); }
  }
  const out: any[] = [...curves];
  if (f.length) out.unshift(ms.meshFromPointsFaces(vs, f));
  if (!out.length && vs.length) out.push(...vs);
  if (!out.length) throw new Error('No geometry found in the OBJ file');
  return out;
}

// ---- DXF ----------------------------------------------------------------------
export function exportDXF(set: GeometrySet): string {
  const e: string[] = ['0', 'SECTION', '2', 'ENTITIES'];
  const ln = (a: V3, b: V3) => e.push('0', 'LINE', '8', '0', '10', String(a.x), '20', String(a.y), '30', String(a.z), '11', String(b.x), '21', String(b.y), '31', String(b.z));
  for (const c of set.curves) { const p = cv.curveToPoints(c, 2); for (let i = 0; i + 1 < p.length; i++) ln(p[i], p[i + 1]); }
  for (const m of set.meshes) for (const f of ms.triangulate(m).f) { const p = f.map(i => ms.mv(m, i)); e.push('0', '3DFACE', '8', '0'); [p[0], p[1], p[2], p[2]].forEach((q, i) => e.push(String(10 + i), String(q.x), String(20 + i), String(q.y), String(30 + i), String(q.z))); }
  for (const p of set.points) e.push('0', 'POINT', '8', '0', '10', String(p.x), '20', String(p.y), '30', String(p.z));
  e.push('0', 'ENDSEC', '0', 'EOF');
  return e.join('\n') + '\n';
}
export function parseDXF(text: string): any[] {
  const lines = text.split(/\r?\n/), pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  const out: any[] = [];
  let i = pairs.findIndex((p, k) => p[0] === 2 && p[1] === 'ENTITIES' && pairs[k - 1]?.[1] === 'SECTION');
  if (i < 0) i = 0;
  let poly: { pts: V3[]; closed: boolean } | null = null;
  while (i < pairs.length) {
    if (pairs[i][0] !== 0) { i++; continue; }
    const type = pairs[i][1], g: Record<number, number[]> = {};
    let j = i + 1;
    for (; j < pairs.length && pairs[j][0] !== 0; j++) (g[pairs[j][0]] ??= []).push(Number(pairs[j][1]));
    const P = (k: number, idx = 0) => v(g[10 + k]?.[idx] ?? 0, g[20 + k]?.[idx] ?? 0, g[30 + k]?.[idx] ?? 0);
    if (type === 'ENDSEC' && out.length) break;
    if (type === 'LINE') out.push(cv.line(P(0), P(1)));
    else if (type === 'LWPOLYLINE') { const pts = (g[10] ?? []).map((_, k) => v(g[10][k], g[20]?.[k] ?? 0, g[38]?.[0] ?? 0)); if (pts.length >= 2) out.push(cv.polyline(pts, ((g[70]?.[0] ?? 0) & 1) === 1)); }
    else if (type === 'POLYLINE') poly = { pts: [], closed: ((g[70]?.[0] ?? 0) & 1) === 1 };
    else if (type === 'VERTEX' && poly) poly.pts.push(P(0));
    else if (type === 'SEQEND' && poly) { if (poly.pts.length >= 2) out.push(cv.polyline(poly.pts, poly.closed)); poly = null; }
    else if (type === 'CIRCLE') out.push(cv.circle({ ...WORLD_XY, o: P(0) }, g[40]?.[0] ?? 1));
    else if (type === 'ARC') { let a0 = (g[50]?.[0] ?? 0) * Math.PI / 180, a1 = (g[51]?.[0] ?? 90) * Math.PI / 180; if (a1 <= a0) a1 += 2 * Math.PI; out.push({ k: 'arc', plane: planeFromNormal(P(0), v(0, 0, 1)), r: g[40]?.[0] ?? 1, a0, a1 } as cv.Arc); }
    else if (type === '3DFACE') out.push(ms.meshFromPointsFaces([P(0), P(1), P(2), P(3)], [[0, 1, 2, 3]]));
    else if (type === 'POINT') out.push(P(0));
    i = j;
  }
  if (!out.length) throw new Error('No supported entities (LINE, POLYLINE, CIRCLE, ARC, 3DFACE, POINT) found in the DXF file');
  return out;
}

// ---- CSV ----------------------------------------------------------------------
/** Rows of two or three numbers become points; anything else is returned as text rows. */
export function parseCSV(text: string): any[] {
  const rows = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length).map(l => l.split(/[,;\t]/).map(s => s.trim()));
  const numeric = rows.filter(r => (r.length === 2 || r.length === 3) && r.every(s => s !== '' && Number.isFinite(Number(s))));
  if (numeric.length >= rows.length - 1 && numeric.length > 0) return numeric.map(r => v(Number(r[0]), Number(r[1]), Number(r[2] ?? 0)));
  return rows.map(r => r.join(', '));
}
export function toCSV(rows: (string | number)[][]): string {
  return rows.map(r => r.map(c => (typeof c === 'string' && /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : String(c))).join(',')).join('\n') + '\n';
}

// ---- glTF 2.0 -------------------------------------------------------------------
/** A single self-contained .gltf (JSON with embedded base64 buffers): triangles for meshes, line strips for curves. */
export function exportGLTF(set: GeometrySet): string {
  const chunks: Uint8Array[] = [], views: any[] = [], accessors: any[] = [], prims: any[] = [];
  let offset = 0;
  const push = (arr: Float32Array | Uint32Array, target: number) => {
    const bytes = new Uint8Array(arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength));
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target }); chunks.push(bytes); offset += bytes.length;
    return views.length - 1;
  };
  // glTF is Y-up; Nodal is Z-up: (x, y, z) -> (x, z, -y).
  const yUp = (p: number[]) => { const o = new Float32Array(p.length); for (let i = 0; i < p.length; i += 3) { o[i] = p[i]; o[i + 1] = p[i + 2]; o[i + 2] = -p[i + 1]; } return o; };
  const posAccessor = (pos: Float32Array) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i++) { lo[i % 3] = Math.min(lo[i % 3], pos[i]); hi[i % 3] = Math.max(hi[i % 3], pos[i]); }
    accessors.push({ bufferView: push(pos, 34962), componentType: 5126, count: pos.length / 3, type: 'VEC3', min: lo, max: hi });
    return accessors.length - 1;
  };
  for (const m of set.meshes) {
    const t = ms.triangulate(m), idx = Uint32Array.from(t.f.flat()), pa = posAccessor(yUp(t.v));
    accessors.push({ bufferView: push(idx, 34963), componentType: 5125, count: idx.length, type: 'SCALAR' });
    prims.push({ attributes: { POSITION: pa }, indices: accessors.length - 1, mode: 4 });
  }
  for (const c of set.curves) prims.push({ attributes: { POSITION: posAccessor(yUp(cv.curveToPoints(c, 2).flatMap(p => [p.x, p.y, p.z]))) }, mode: 3 });
  if (set.points.length) prims.push({ attributes: { POSITION: posAccessor(yUp(set.points.flatMap(p => [p.x, p.y, p.z]))) }, mode: 0 });
  if (!prims.length) throw new Error('There is no geometry to export');
  const all = new Uint8Array(offset); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  let bin = ''; for (let i = 0; i < all.length; i += 0x8000) bin += String.fromCharCode(...all.subarray(i, i + 0x8000));
  return JSON.stringify({ asset: { version: '2.0', generator: 'Nodal' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'Nodal export' }], meshes: [{ primitives: prims }], buffers: [{ byteLength: all.length, uri: 'data:application/octet-stream;base64,' + btoa(bin) }], bufferViews: views, accessors });
}

// ---- 3DM (rhino3dm, loaded on demand) ---------------------------------------------
let rhinoPromise: Promise<any> | null = null;
async function rhino(): Promise<any> {
  rhinoPromise ??= (async () => {
    const mod: any = await import('rhino3dm');
    const inBrowser = typeof window !== 'undefined';
    const opts: any = {};
    if (inBrowser) { const url = (await import('rhino3dm/rhino3dm.wasm?url')).default; opts.locateFile = () => url; }
    return await (mod.default ?? mod)(opts);
  })();
  return rhinoPromise;
}
export async function export3dm(set: GeometrySet): Promise<Uint8Array> {
  const rh = await rhino(), doc = new rh.File3dm();
  for (const m of set.meshes) {
    const mesh = new rh.Mesh();
    for (let i = 0; i < m.v.length; i += 3) mesh.vertices().add(m.v[i], m.v[i + 1], m.v[i + 2]);
    for (const f of m.f) { if (f.length === 3) mesh.faces().addTriFace(f[0], f[1], f[2]); else if (f.length === 4) mesh.faces().addQuadFace(f[0], f[1], f[2], f[3]); else for (let i = 1; i + 1 < f.length; i++) mesh.faces().addTriFace(f[0], f[i], f[i + 1]); }
    mesh.normals().computeNormals();
    doc.objects().add(mesh, null);
  }
  for (const c of set.curves) {
    const pts = cv.curveToPoints(c, 2), list = new rh.Point3dList(pts.length);
    for (const p of pts) list.add(p.x, p.y, p.z);
    const crv = pts.length === 2 ? new rh.LineCurve([pts[0].x, pts[0].y, pts[0].z], [pts[1].x, pts[1].y, pts[1].z]) : new rh.PolylineCurve(list);
    doc.objects().add(crv, null);
  }
  for (const p of set.points) doc.objects().addPoint([p.x, p.y, p.z]);
  return doc.toByteArray();
}
export async function parse3dm(buf: ArrayBuffer): Promise<any[]> {
  const rh = await rhino(), doc = rh.File3dm.fromByteArray(new Uint8Array(buf));
  if (!doc) throw new Error('The 3DM file could not be read');
  const out: any[] = [], objects = doc.objects();
  for (let i = 0; i < objects.count; i++) {
    const g = objects.get(i).geometry();
    if (g instanceof rh.Mesh) {
      const vs: number[] = [], f: number[][] = [], V = g.vertices(), F = g.faces();
      for (let k = 0; k < V.count; k++) { const p = V.get(k); vs.push(p[0], p[1], p[2]); }
      for (let k = 0; k < F.count; k++) { const q = F.get(k) as number[]; f.push(q[2] === q[3] ? [q[0], q[1], q[2]] : [q[0], q[1], q[2], q[3]]); }
      out.push({ k: 'mesh', v: vs, f } as ms.Mesh);
    } else if (g instanceof rh.Point) { const p = g.location; out.push(v(p[0], p[1], p[2])); }
    else if (g instanceof rh.Curve) {
      // Curves are sampled along their domain; straight lines stay exact.
      const [t0, t1] = g.domain, n = g.isLinear?.(1e-9) ? 1 : 48, pts: V3[] = [];
      for (let k = 0; k <= n; k++) { const p = g.pointAt(t0 + (t1 - t0) * k / n); pts.push(v(p[0], p[1], p[2])); }
      out.push(pts.length === 2 ? cv.line(pts[0], pts[1]) : n === 48 ? cv.interpolateCurve(pts) : cv.polyline(pts));
    } else if (g instanceof rh.Brep || g instanceof rh.Extrusion) {
      // Bodies come in through their render meshes when the file contains them.
      const faces = g instanceof rh.Brep ? g.faces() : null;
      for (let k = 0; faces && k < faces.count; k++) { const fm = faces.get(k).getMesh(rh.MeshType.Any); if (fm) { const vs: number[] = [], f: number[][] = [], V = fm.vertices(), F = fm.faces(); for (let a = 0; a < V.count; a++) { const p = V.get(a); vs.push(p[0], p[1], p[2]); } for (let a = 0; a < F.count; a++) { const q = F.get(a) as number[]; f.push(q[2] === q[3] ? [q[0], q[1], q[2]] : q); } out.push({ k: 'mesh', v: vs, f } as ms.Mesh); } }
    }
  }
  if (!out.length) throw new Error('No meshes, curves or points could be read from the 3DM file. Surfaces and solids are imported through their saved render meshes: shade the model once before saving it.');
  return out;
}

/** Import by file extension. */
export async function importFile(name: string, buf: ArrayBuffer): Promise<any[]> {
  const ext = name.toLowerCase().split('.').pop() ?? '', text = () => new TextDecoder().decode(buf);
  switch (ext) {
    case 'stl': return [parseSTL(buf)];
    case 'obj': return parseOBJ(text());
    case 'dxf': return parseDXF(text());
    case 'csv': case 'txt': return parseCSV(text());
    case '3dm': return parse3dm(buf);
    case 'step': case 'stp': case 'iges': case 'igs': throw new Error('STEP and IGES import needs a B-rep kernel, which is not included in this version of Nodal. Export the model as STL, OBJ, DXF or 3DM instead.');
    default: throw new Error(`Files of type ".${ext}" are not supported. Supported: STL, OBJ, DXF, 3DM, CSV.`);
  }
}
