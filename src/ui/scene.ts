/**
 * Builds Three.js objects from graph outputs: plain geometry, structural
 * models, and analysis results (deformed shape, diagrams, contours, reactions).
 * Everything is drawn in model units (m or ft); solver data is converted here.
 */
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { V3, v, add, sub, mul, isV3, isPlane, unit, cross, len } from '../geom/vec';
import * as cv from '../geom/curve';
import * as sf from '../geom/surface';
import * as ms from '../geom/mesh';
import { FEModel, nodeXYZ, nodeCount, beamEnds, memberAxes } from '../fe/model';
import type { FEResult, CaseResult } from '../fe/system';
import * as post from '../fe/post';
import { rampColor } from '../components/geometry';
import { UnitSystem } from '../fe/units';
import { fmtNum } from '../core/graph';

/** A text label in the 3D view. `pri` decides which label stays when two would overlap (higher wins). */
export interface Label { p: THREE.Vector3; text: string; cls: string; size?: number; pri: number; /** World direction in which the label is pushed away from its point (default: straight up on screen). */ off?: THREE.Vector3 }
export interface Legend { title: string; min: number; max: number; unit: string }
export interface ViewOptions { caseIndex: number; scale: number; deformed: boolean; undeformed: boolean; diagram: string; contour: string; layer: 'top' | 'mid' | 'bottom'; reactions: boolean; loads: boolean; supports: boolean; utilization: boolean; mode: number; animate: boolean; values: boolean; sections: boolean; localAxes: boolean; principal: boolean }
/** Vertex buffers that move with the animation factor: position = base + factor * delta. */
interface Morph { array: Float32Array; touch: () => void; base: Float32Array; delta: Float32Array }

const C = { ink: 0x2b3440, beam: 0x2f3b4a, truss: 0x2f6fd6, cable: 0x8a5a2b, shell: 0xb9c2cc, support: 0x2a9d8f, load: 0xd9730d, react: 0x7b2cbf, hi: 0x19c37d, pos: 0x2f6fd6, neg: 0xd1495b, ghost: 0x9aa4b1 };
const DIAGRAM_INDEX: Record<string, number> = { N: 0, Vy: 1, Vz: 2, T: 3, My: 4, Mz: 5 };

let disc: THREE.Texture | null = null;
/** A small round sprite so that points are drawn as dots instead of squares. */
function discTexture(): THREE.Texture {
  if (disc) return disc;
  const n = 32, data = new Uint8Array(4 * n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const d = Math.hypot(x - 15.5, y - 15.5), k = 4 * (y * n + x); data[k] = data[k + 1] = data[k + 2] = 255; data[k + 3] = Math.round(255 * Math.min(1, Math.max(0, 14.5 - d))); }
  disc = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  disc.magFilter = disc.minFilter = THREE.LinearFilter; disc.needsUpdate = true;
  return disc;
}

/**
 * Collects triangles with a color per vertex, so that many small solids (member sections, support
 * symbols, arrow heads) become one mesh and one draw call. `owner` records, per triangle, which
 * structural element it belongs to, for picking.
 */
class Batch {
  pos: number[] = []; col: number[] = []; idx: number[] = []; owner: number[] = [];
  private c = new THREE.Color();
  get empty(): boolean { return !this.idx.length; }
  color(hex: number | string | THREE.Color): this { this.c.set(hex as any); return this; }
  vert(p: V3): number { this.pos.push(p.x, p.y, p.z); this.col.push(this.c.r, this.c.g, this.c.b); return this.pos.length / 3 - 1; }
  tri(a: number, b: number, c: number, owner = -1): void { this.idx.push(a, b, c); this.owner.push(owner); }
  quad(a: number, b: number, c: number, d: number, owner = -1): void { this.tri(a, b, c, owner); this.tri(a, c, d, owner); }
  /** Box from its center and three half-edge vectors. */
  box(c: V3, x: V3, y: V3, z: V3): void {
    const q: number[] = [];
    for (const sz of [-1, 1]) for (const sy of [-1, 1]) for (const sx of [-1, 1]) q.push(this.vert(add(c, add(mul(x, sx), add(mul(y, sy), mul(z, sz))))));
    for (const [a, b, d, e] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) this.quad(q[a], q[b], q[d], q[e]);
  }
  /** Cone (or pyramid when n = 4): apex, center of the base, and two radius vectors of the base. */
  cone(apex: V3, base: V3, u: V3, w: V3, n = 10): void {
    const a = this.vert(apex), c0 = this.vert(base), ring: number[] = [];
    for (let i = 0; i < n; i++) { const t = 2 * Math.PI * (i + (n === 4 ? 0.5 : 0)) / n; ring.push(this.vert(add(base, add(mul(u, Math.cos(t)), mul(w, Math.sin(t)))))); }
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.tri(a, ring[i], ring[j]); this.tri(c0, ring[j], ring[i]); }
  }
  /** Cylinder between two points, with two radius vectors perpendicular to its axis. */
  cylinder(a: V3, b: V3, u: V3, w: V3, n = 12): void {
    const ra: number[] = [], rb: number[] = [], ca = this.vert(a), cb = this.vert(b);
    for (let i = 0; i < n; i++) { const t = 2 * Math.PI * i / n, r = add(mul(u, Math.cos(t)), mul(w, Math.sin(t))); ra.push(this.vert(add(a, r))); rb.push(this.vert(add(b, r))); }
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.quad(ra[i], ra[j], rb[j], rb[i]); this.tri(ca, ra[j], ra[i]); this.tri(cb, rb[i], rb[j]); }
  }
  build(opt: { opacity?: number; metalness?: number; roughness?: number } = {}): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    const opacity = opt.opacity ?? 1;
    const o = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, roughness: opt.roughness ?? 0.62, metalness: opt.metalness ?? 0.12, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }));
    o.castShadow = opacity >= 1;
    return o;
  }
}

/** A plausible surface color for a material, judged by its density and stiffness. */
function materialColor(mat: { rho: number; E: number } | undefined): number {
  if (!mat) return 0x8b98ab;
  if (mat.rho > 7000) return 0x93a1b5;                       // steel
  if (mat.rho > 2600 && mat.E > 5e10) return 0xc2c8d0;       // aluminum
  if (mat.rho > 1500) return 0xbcb8ae;                       // concrete, masonry
  if (mat.rho > 0) return 0xb98d5a;                          // timber
  return 0x8b98ab;
}

export class SceneBuilder {
  group = new THREE.Group();
  labels: Label[] = [];
  legend: Legend | null = null;
  morphs: Morph[] = [];
  animated = false;
  /** Objects that can be clicked, with the element index per primitive. */
  pickables: THREE.Object3D[] = [];
  info: string[] = [];
  private box = new THREE.Box3();
  private labelKeys = new Set<string>();
  /** `solid` = draw members with their cross-sections as solids (the realistic display); false = lines only. */
  constructor(private u: UnitSystem, private dark: boolean, private solid = true) {}
  /** Support symbols and arrow heads of everything drawn; built into one mesh by finish(). */
  private glyphs = new Batch();
  private shafts = new Map<number, number[]>();
  /** Call once after the last draw: builds the batched symbols. */
  finish(): void {
    for (const [color, seg] of this.shafts) { const g = new LineSegmentsGeometry(); g.setPositions(seg); this.group.add(new LineSegments2(g, new LineMaterial({ color, linewidth: 1.7 }))); }
    this.shafts.clear();
    if (!this.glyphs.empty) { const o = this.glyphs.build(); o.userData.shaded = true; this.group.add(o); this.glyphs = new Batch(); }
  }

  /** Bounds of the geometry and structure only, without arrows, support symbols, diagrams and other annotation. */
  private core = new THREE.Box3();
  private decor = 0;
  /** Points of everything drawn (up to a limit), used to zoom to fit more tightly than the bounding box allows. */
  cloud: number[] = [];
  private track(p: V3): void { const q = new THREE.Vector3(p.x, p.y, p.z); this.box.expandByPoint(q); if (!this.decor) this.core.expandByPoint(q); if (this.cloud.length < 90000) this.cloud.push(p.x, p.y, p.z); }
  /** Run a drawing step whose output is annotation (it widens the view bounds but not the core bounds). */
  private annotate(fn: () => void): void { this.decor++; try { fn(); } finally { this.decor--; } }
  coreBounds(): THREE.Box3 { return this.core.clone(); }
  get size(): number { return this.box.isEmpty() ? 10 : Math.max(this.box.getSize(new THREE.Vector3()).length(), 1e-6); }

  // ---- primitives -------------------------------------------------------------
  points(pts: V3[], color: number | string, size = 6): THREE.Points {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap(p => [p.x, p.y, p.z]), 3));
    const o = new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, map: discTexture(), alphaTest: 0.5, transparent: true }));
    pts.forEach(p => this.track(p)); this.group.add(o);
    return o;
  }
  lines(segs: number[], color: number | string, opacity = 1): THREE.LineSegments {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    const o = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
    for (let i = 0; i < segs.length; i += 3) this.track(v(segs[i], segs[i + 1], segs[i + 2]));
    this.group.add(o);
    return o;
  }
  polyline(pts: V3[], color: number | string): void { const s: number[] = []; for (let i = 0; i + 1 < pts.length; i++) s.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z); if (s.length) this.lines(s, color); }
  mesh(m: ms.Mesh, color: number | string, opt: { opacity?: number; edges?: boolean; colors?: Float32Array } = {}): THREE.Mesh {
    const tri = ms.triangulate(m), g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(m.v, 3));
    g.setIndex(tri.f.flat());
    if (opt.colors) g.setAttribute('color', new THREE.BufferAttribute(opt.colors, 3));
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: opt.colors ? 0xffffff : color, vertexColors: !!opt.colors, side: THREE.DoubleSide, roughness: 0.85, metalness: 0.02, transparent: (opt.opacity ?? 1) < 1, opacity: opt.opacity ?? 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const o = new THREE.Mesh(g, mat);
    o.userData.shaded = true;
    for (let i = 0; i < m.v.length; i += 3) this.track(v(m.v[i], m.v[i + 1], m.v[i + 2]));
    this.group.add(o);
    if (opt.edges !== false) { const s: number[] = []; for (const [a, b] of ms.meshEdges(m)) s.push(m.v[3 * a], m.v[3 * a + 1], m.v[3 * a + 2], m.v[3 * b], m.v[3 * b + 1], m.v[3 * b + 2]); const e = this.lines(s, this.dark ? 0x10141a : 0x3a4350, 0.35); e.userData.edgeOf = o; }
    return o;
  }
  /** Arrow with a solid cone head. Shafts and heads of all arrows are batched (see finish()). */
  arrow(from: V3, to: V3, color: number, head = 0.22): void {
    const d = sub(to, from), L = len(d);
    if (L < 1e-12) return;
    const n = unit(d), side = unit(cross(n, Math.abs(n.z) < 0.9 ? v(0, 0, 1) : v(1, 0, 0))), side2 = cross(n, side), h = L * head, b = add(to, mul(n, -h));
    const seg = this.shafts.get(color) ?? []; if (!seg.length) this.shafts.set(color, seg);
    seg.push(from.x, from.y, from.z, b.x, b.y, b.z);
    this.glyphs.color(color).cone(to, b, mul(side, h * 0.34), mul(side2, h * 0.34), 8);
    this.track(from); this.track(to);
  }
  /**
   * Curved arrow for a moment: three quarters of a circle around the moment vector, turning the way the
   * moment acts (right-hand rule). Returns a point on the arc where its value can be written.
   */
  private momentArc(p: V3, m: V3, color: number, r: number): V3 {
    const n = unit(m), a = unit(cross(Math.abs(n.z) < 0.9 ? v(0, 0, 1) : v(1, 0, 0), n)), b = cross(n, a), N = 20, t0 = -0.25 * Math.PI, t1 = 1.25 * Math.PI;
    const at = (t: number) => add(p, add(mul(a, r * Math.cos(t)), mul(b, r * Math.sin(t)))), seg: number[] = [];
    for (let i = 0; i < N; i++) { const q0 = at(t0 + (t1 - t0) * i / N), q1 = at(t0 + (t1 - t0) * (i + 1) / N); seg.push(q0.x, q0.y, q0.z, q1.x, q1.y, q1.z); this.track(q0); }
    const list = this.shafts.get(color) ?? []; if (!list.length) this.shafts.set(color, list);
    list.push(...seg);
    const end = at(t1), tan = add(mul(a, -Math.sin(t1)), mul(b, Math.cos(t1))), h = r * 0.55;
    this.glyphs.color(color).cone(add(end, mul(tan, h)), end, mul(n, h * 0.36), mul(unit(sub(end, p)), h * 0.36), 8);
    return at(0.5 * Math.PI);
  }
  /** Add a label; an identical label at the same place is added only once (members meeting at a node report the same value). */
  label(p: V3, text: string, cls = '', size?: number, pri = 1, off?: V3): void {
    const key = `${text}|${cls}|${p.x.toFixed(4)}|${p.y.toFixed(4)}|${p.z.toFixed(4)}`;
    if (this.labelKeys.has(key) || this.labels.length >= 600) return;
    this.labelKeys.add(key);
    const d = off && len(off) > 1e-12 ? unit(off) : null;
    this.labels.push({ p: new THREE.Vector3(p.x, p.y, p.z), text, cls, size, pri, off: d ? new THREE.Vector3(d.x, d.y, d.z) : undefined });
  }
  /**
   * Thick line segments with a width in screen pixels, used for structural members so that they read
   * clearly at any zoom. (Plain WebGL lines are always one pixel wide.)
   */
  fat(segs: number[], opt: { color?: number | string; colors?: number[]; width?: number; opacity?: number; dash?: number; overlay?: boolean } = {}): LineSegments2 {
    const g = new LineSegmentsGeometry();
    g.setPositions(segs);
    if (opt.colors) g.setColors(opt.colors);
    const mat = new LineMaterial({ color: opt.colors ? 0xffffff : opt.color ?? C.beam, vertexColors: !!opt.colors, linewidth: opt.width ?? 2.6, transparent: (opt.opacity ?? 1) < 1, opacity: opt.opacity ?? 1 });
    const o = new LineSegments2(g, mat);
    if (opt.dash) {
      // Dash lengths run on along consecutive segments (a curve drawn as many short pieces), and start again where a new line begins.
      mat.dashed = true; mat.dashSize = opt.dash; mat.gapSize = opt.dash * 0.65; mat.defines.USE_DASH = ''; mat.needsUpdate = true;
      const n = segs.length / 6, dist = new Float32Array(2 * n);
      let run = 0;
      for (let i = 0; i < n; i++) {
        const k = 6 * i, joined = i > 0 && Math.abs(segs[k] - segs[k - 3]) + Math.abs(segs[k + 1] - segs[k - 2]) + Math.abs(segs[k + 2] - segs[k - 1]) < 1e-9;
        if (!joined) run = 0;
        dist[2 * i] = run; run += Math.hypot(segs[k + 3] - segs[k], segs[k + 4] - segs[k + 1], segs[k + 5] - segs[k + 2]); dist[2 * i + 1] = run;
      }
      const buf = new THREE.InstancedInterleavedBuffer(dist, 2, 1);
      g.setAttribute('instanceDistanceStart', new THREE.InterleavedBufferAttribute(buf, 1, 0));
      g.setAttribute('instanceDistanceEnd', new THREE.InterleavedBufferAttribute(buf, 1, 1));
    }
    if (opt.overlay) { mat.depthTest = false; o.renderOrder = 6; }
    for (let i = 0; i < segs.length; i += 3) this.track(v(segs[i], segs[i + 1], segs[i + 2]));
    this.group.add(o);
    return o;
  }

  // ---- generic geometry ----------------------------------------------------------
  /** Draw any value produced by a component. `hi` draws it in the selection color. */
  draw(g: any, hi: boolean, color?: string, nodeId = ''): void {
    if (g === null || g === undefined) return;
    const col = hi ? C.hi : color ?? (this.dark ? 0xdfe5ec : C.ink);
    if (Array.isArray(g)) { g.forEach(x => this.draw(x, hi, color, nodeId)); return; }
    if (isV3(g)) { this.points([g], col, hi ? 9 : 7); return; }
    if (isPlane(g)) { const s = 1; this.lines([g.o, add(g.o, mul(g.x, s))].flatMap(p => [p.x, p.y, p.z]), 0xd1495b); this.lines([g.o, add(g.o, mul(g.y, s))].flatMap(p => [p.x, p.y, p.z]), 0x3fae6b); return; }
    if (cv.isCurve(g)) { this.polyline(cv.curveToPoints(g, 2), col); return; }
    if (sf.isSurface(g)) { this.mesh(sf.surfaceToMesh(g, 20, 20), hi ? C.hi : color ?? 0x8fb3d9, { edges: false, opacity: 0.92 }); for (const c of [sf.isoCurve(g, 'u', 0), sf.isoCurve(g, 'u', 1), sf.isoCurve(g, 'v', 0), sf.isoCurve(g, 'v', 1)]) this.polyline(cv.curveToPoints(c, 2), this.dark ? 0x10141a : 0x3a4350); return; }
    if (ms.isMesh(g)) { this.mesh(g, hi ? C.hi : color ?? (g.solid ? 0xc9b79c : 0xa9c1a6)); return; }
    switch (g.k) {
      case 'styled': this.draw(g.g, hi, g.color, nodeId); return;
      case 'tag': this.label(g.p, g.text, 'tag', g.size, 4); this.track(g.p); return;
      case 'model': this.model(g as FEModel, { supports: true, loads: true, sections: true, caseIndex: 0, values: true, localAxes: false } as ViewOptions, hi, nodeId); return;
      case 'result': this.result(g as FEResult, { caseIndex: 0, scale: -1, deformed: true, undeformed: true, diagram: 'none', contour: (g as FEResult).model.shells.length ? 'disp' : 'none', layer: 'top', reactions: true, loads: false, supports: true, utilization: false, mode: 0, animate: false, values: true, sections: false, localAxes: false, principal: false }, nodeId); return;
      case 'feview': this.result(g.result, g.opts, nodeId); return;
      case 'element': this.element(g, col); return;
      case 'support': { const p = mul(g.p, 1 / this.u.len.f); this.track(p); this.annotate(() => this.supportSymbol(p, g.fix, !!g.spring, v(0, 0, 1), this.size * 0.03, false)); return; }
      case 'load': if (g.kind === 'point') { const p = mul(g.p, 1 / this.u.len.f), mag = len(g.f); this.track(p); if (mag > 0) this.annotate(() => this.arrow(sub(p, mul(g.f, this.size * 0.09 / mag)), p, C.load)); else this.points([p], C.load, 8); } return;
    }
  }
  private element(e: any, col: number | string): void {
    const f = 1 / this.u.len.f;
    if (e.kind === 'beam') this.polyline([mul(e.a, f), mul(e.b, f)], e.type === 'beam' ? col : e.type === 'cable' ? C.cable : C.truss);
    else this.mesh(ms.meshFromPointsFaces(e.pts.map((p: V3) => mul(p, f)), [e.pts.map((_: V3, i: number) => i)]), C.shell, { opacity: 0.9 });
  }

  // ---- structural model -------------------------------------------------------------
  private P(m: FEModel, i: number): V3 { return mul(nodeXYZ(m, i), 1 / this.u.len.f); }
  private memberColor(type: string): number { return type === 'beam' ? (this.dark ? 0xdfe5ec : C.beam) : type === 'cable' ? C.cable : C.truss; }
  model(m: FEModel, o: ViewOptions, hi = false, nodeId = '', ghost = false): void {
    const f = 1 / this.u.len.f, nn = nodeCount(m);
    for (let i = 0; i < nn; i++) this.track(this.P(m, i));
    const size = this.size;
    // Line elements, grouped by type so each group is one draw call.
    const groups: Record<string, { seg: number[]; ids: number[] }> = {};
    m.beams.forEach((b, e) => { const [a, c] = beamEnds(m, b), key = ghost ? 'ghost' : b.type; (groups[key] ??= { seg: [], ids: [] }); groups[key].seg.push(a.x * f, a.y * f, a.z * f, c.x * f, c.y * f, c.z * f); groups[key].ids.push(e); });
    for (const [key, g] of Object.entries(groups)) {
      if (key === 'ghost') { this.lines(g.seg, C.ghost, 0.75); continue; }
      const o3 = this.fat(g.seg, { color: hi ? C.hi : this.memberColor(key), width: key === 'beam' ? 2.8 : 2.4 });
      o3.userData.pick = { kind: 'beam', ids: g.ids, nodeId }; this.pickables.push(o3);
    }
    this.skin = false;
    if (o.sections && !ghost) this.sectionSolids(m, hi, nodeId);
    if (m.shells.length) {
      const mesh: ms.Mesh = { k: 'mesh', v: m.nodes.map(x => x * f), f: m.shells.map(s => s.n) };
      if (ghost) { const s: number[] = []; for (const [a, b] of ms.meshEdges(mesh)) s.push(mesh.v[3 * a], mesh.v[3 * a + 1], mesh.v[3 * a + 2], mesh.v[3 * b], mesh.v[3 * b + 1], mesh.v[3 * b + 2]); this.lines(s, C.ghost, 0.35); }
      else { const o3 = this.mesh(mesh, hi ? C.hi : C.shell, { opacity: 0.95 }); o3.userData.pick = { kind: 'shell', tri: this.triMap(mesh), nodeId }; this.pickables.push(o3); }
    }
    if (ghost) return;
    this.nodeDots(m, nodeId);
    this.annotate(() => {
      if (o.supports !== false) this.supports(m, size);
      if (o.loads !== false) this.loads(m, o.caseIndex, size, o.values !== false);
      if (o.localAxes) this.localAxes(m, size);
    });
  }
  private nodeDots(m: FEModel, nodeId: string): void {
    const nn = nodeCount(m);
    if (nn > 5000) return;
    const pts = this.points(Array.from({ length: nn }, (_, i) => this.P(m, i)), this.dark ? 0xdfe5ec : C.ink, nn > 400 ? 4 : 6);
    pts.userData.pick = { kind: 'node', nodeId }; this.pickables.push(pts);
  }
  private localAxes(m: FEModel, size: number): void {
    const f = 1 / this.u.len.f, s = size * 0.025, seg: number[][] = [[], [], []];
    m.beams.forEach((b) => { const [a, c] = beamEnds(m, b), R = memberAxes(a, c, b.ref, b.angle), mid = mul(add(a, c), 0.5 * f); for (let k = 0; k < 3; k++) { const q = add(mid, mul(v(R[3 * k], R[3 * k + 1], R[3 * k + 2]), s)); seg[k].push(mid.x, mid.y, mid.z, q.x, q.y, q.z); } });
    [0xd1495b, 0x3fae6b, 0x2f6fd6].forEach((col, k) => { if (seg[k].length) this.lines(seg[k], col); });
  }
  /** For each triangle of a triangulated mesh, the index of the face it came from. */
  private triMap(m: ms.Mesh): number[] { const map: number[] = []; m.f.forEach((q, i) => { for (let k = 0; k < Math.max(1, q.length - 2); k++) map.push(i); }); return map; }
  /**
   * Members drawn as solids: each cross-section outline is extruded along its member, with end caps,
   * the hole of a hollow section, and thin edge lines. The color follows the material (steel, concrete,
   * timber, aluminum), or `colors` per member when given (utilization).
   */
  /** True while the model being drawn has its members shown as solids, so loads and supports are placed on the surface. */
  private skin = false;
  /** Distance from a member's axis to its surface in the direction `dir` (model units); zero when members are drawn as lines. */
  private surface(m: FEModel, e: number, dir: V3): number {
    const b = m.beams[e], shape = m.sections[b.sec].shape;
    if (!this.skin || !shape?.outer || b.type === 'cable') return 0;
    const [a, c] = beamEnds(m, b), R = memberAxes(a, c, b.ref, b.angle), dy = dir.x * R[3] + dir.y * R[4] + dir.z * R[5], dz = dir.x * R[6] + dir.y * R[7] + dir.z * R[8];
    let r = 0; for (const q of shape.outer) r = Math.max(r, q[0] * dy + q[1] * dz);
    return r;
  }
  private sectionSolids(m: FEModel, hi: boolean, nodeId: string, colors?: (number | string)[]): void {
    if (!this.solid || !m.beams.length || m.beams.length > 4000) return;
    const f = 1 / this.u.len.f, batch = new Batch(), edges: number[] = [];
    const caps = new Map<number, number[][]>();
    // A member split into several elements is drawn as one piece: the outline is drawn at an element end
    // only where the member really ends or changes direction or section.
    const at = new Map<number, { e: number; sec: number; d: V3 }[]>();
    m.beams.forEach((b, e) => { const [a, c] = beamEnds(m, b), d = unit(sub(c, a)); for (const n of b.n) { const l = at.get(n); if (l) l.push({ e, sec: b.sec, d }); else at.set(n, [{ e, sec: b.sec, d }]); } });
    const runsOn = (n: number, e: number, sec: number, d: V3) => (at.get(n) ?? []).some(o => o.e !== e && o.sec === sec && Math.abs(o.d.x * d.x + o.d.y * d.y + o.d.z * d.z) > 0.9995);
    m.beams.forEach((b, e) => {
      const shape = m.sections[b.sec].shape;
      if (!shape?.outer || b.type === 'cable') return;
      const [a, c] = beamEnds(m, b), R = memberAxes(a, c, b.ref, b.angle), y = v(R[3], R[4], R[5]), z = v(R[6], R[7], R[8]);
      const dir = unit(sub(c, a)), ring0 = !runsOn(b.n[0], e, b.sec, dir), ring1 = !runsOn(b.n[1], e, b.sec, dir);
      batch.color(hi ? C.hi : colors ? colors[e] : materialColor(m.materials[b.mat]));
      const rings = [shape.outer, ...(shape.inner ? [shape.inner] : [])], first: number[][] = [];
      for (const ring of rings) {
        const n = ring.length, i0: number[] = [], i1: number[] = [], p0: V3[] = [], p1: V3[] = [];
        for (const [py, pz] of ring) { const off = add(mul(y, py), mul(z, pz)); p0.push(mul(add(a, off), f)); p1.push(mul(add(c, off), f)); i0.push(batch.vert(p0[p0.length - 1])); i1.push(batch.vert(p1[p1.length - 1])); }
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n, h = (i + n - 1) % n;
          batch.quad(i0[i], i0[j], i1[j], i1[i], e);
          if (ring0) edges.push(p0[i].x, p0[i].y, p0[i].z, p0[j].x, p0[j].y, p0[j].z);
          if (ring1) edges.push(p1[i].x, p1[i].y, p1[i].z, p1[j].x, p1[j].y, p1[j].z);
          // A line along the member at each sharp corner of the outline (not along the facets of a round section).
          const ax = ring[i][0] - ring[h][0], ay = ring[i][1] - ring[h][1], bx = ring[j][0] - ring[i][0], by = ring[j][1] - ring[i][1];
          if (Math.abs(ax * by - ay * bx) > 0.5 * Math.hypot(ax, ay) * Math.hypot(bx, by)) edges.push(p0[i].x, p0[i].y, p0[i].z, p1[i].x, p1[i].y, p1[i].z);
        }
        first.push(i0, i1);
      }
      // End caps: the outline triangulated once per section, holes included.
      let tris = caps.get(b.sec);
      if (!tris) { tris = THREE.ShapeUtils.triangulateShape(shape.outer.map(q => new THREE.Vector2(q[0], q[1])), shape.inner ? [shape.inner.map(q => new THREE.Vector2(q[0], q[1]))] : []); caps.set(b.sec, tris); }
      const nOut = shape.outer.length, idx = (end: 0 | 1, k: number) => (k < nOut ? first[end][k] : first[2 + end][k - nOut]);
      for (const t of tris) { batch.tri(idx(0, t[0]), idx(0, t[1]), idx(0, t[2]), e); batch.tri(idx(1, t[0]), idx(1, t[2]), idx(1, t[1]), e); }
    });
    if (batch.empty) return;
    this.skin = true;
    const o = batch.build({ metalness: 0.05, roughness: 0.6 });
    o.userData.shaded = true; o.userData.pick = { kind: 'beam', tri: batch.owner, nodeId }; this.pickables.push(o);
    this.group.add(o);
    if (edges.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3)); this.group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: this.dark ? 0x0d1116 : 0x2b3440, transparent: true, opacity: 0.55 }))); }
  }
  /**
   * Support symbols, drawn as small solids so that the kind of support is clear at a glance:
   *
   *   fixed    a block with ground hatching behind it, placed against the end of the member
   *            (a wall for a beam, a footing for a column)
   *   pinned   a pyramid under the node standing on a base plate with hatching
   *   roller   the same pyramid on two rollers
   *   spring   a zigzag down to a base plate
   *
   * A node that is held only sideways gets a short bar along each held direction instead, which keeps
   * models with many such restraints readable.
   */
  private supports(m: FEModel, size: number): void {
    const many = m.supports.length > 24, s = size * (many ? 0.011 : 0.026);
    // Direction from each supported node into the structure, so that a fixed support sits behind the member end.
    const into = new Map<number, V3>();
    // Half the largest section dimension meeting each node, so that a symbol is never hidden inside a deep member.
    const half = new Map<number, number>(), ext = new Map<number, number>(), f = 1 / this.u.len.f;
    for (const b of m.beams) {
      const [a, c] = beamEnds(m, b), d = unit(sub(c, a)); into.set(b.n[0], add(into.get(b.n[0]) ?? v(), d)); into.set(b.n[1], sub(into.get(b.n[1]) ?? v(), d));
      if (!this.skin || b.type === 'cable') continue;
      let r = ext.get(b.sec);
      if (r === undefined) { r = 0; for (const q of m.sections[b.sec].shape?.outer ?? []) r = Math.max(r, Math.abs(q[0]), Math.abs(q[1])); r *= f; ext.set(b.sec, r); }
      for (const n of b.n) half.set(n, Math.max(half.get(n) ?? 0, r));
    }
    for (const sp of m.supports) {
      const sum = into.get(sp.node), d = sum && len(sum) > 0.5 ? unit(sum) : v(0, 0, 1);
      this.supportSymbol(this.P(m, sp.node), sp.fix, !!sp.spring, d, s, many, Math.min(half.get(sp.node) ?? 0, size * 0.12));
    }
  }
  private supportSymbol(p: V3, fix: boolean[], spring: boolean, d: V3, s0: number, simple: boolean, member = 0): void {
    const s = Math.max(s0, member * 0.75);
    const g = this.glyphs, [fx, fy, fz] = fix, allT = fx && fy && fz, allR = fix[3] && fix[4] && fix[5];
    const X = v(1, 0, 0), Y = v(0, 1, 0), Z = v(0, 0, 1), body = C.support, plate = this.dark ? 0x5c6877 : 0x6b7684;
    const seg: number[] = [], line = (a: V3, b: V3) => seg.push(a.x, a.y, a.z, b.x, b.y, b.z);
    /** Ground hatching: short slanted strokes leaving a plate on the side away from the structure. */
    const hatch = (c: V3, along: V3, away: V3, half: number, n = 2) => { const k = half / (n + 0.2); line(add(c, mul(along, -half)), add(c, mul(along, half))); for (let i = -n; i <= n; i++) { const q = add(c, mul(along, i * k)); line(q, add(q, add(mul(away, 0.8 * k), mul(along, -0.65 * k)))); } };
    if (allT && allR) {
      // Fixed: a plate square to the member, with its face on the node.
      const u1 = unit(cross(Math.abs(d.z) < 0.9 ? Y : X, d)), u2 = cross(d, u1), h = Math.max(1.8 * s0, 1.7 * member), t = Math.max(0.3 * s0, 0.14 * h), c = add(p, mul(d, -t));
      g.color(body).box(c, mul(d, t), mul(u1, h), mul(u2, simple ? h * 0.6 : h));
      if (!simple) { const back = add(p, mul(d, -2 * t)); hatch(back, u1, mul(d, -1), h, 4); if (Math.abs(d.z) > 0.9) hatch(back, u2, mul(d, -1), h, 4); }
    } else if (fz) {
      const hgt = 1.5 * s, base = add(p, mul(Z, -hgt)), w = 0.95 * s * Math.SQRT2;
      g.color(body).cone(p, base, mul(X, w), mul(Y, w), 4);
      let under = base;
      if (!(fx && fy)) {
        // Roller: two rollers under the pyramid, with their axes across the direction that is free to move.
        const axis = fx ? X : Y, roll = fx ? Y : X, r = 0.24 * s;
        g.color(plate);
        for (const q of [-0.5, 0.5]) { const c = add(base, add(mul(roll, q * s), mul(Z, -r))); g.cylinder(add(c, mul(axis, -0.9 * s)), add(c, mul(axis, 0.9 * s)), mul(roll, r), mul(Z, r), 10); }
        under = add(base, mul(Z, -2 * r));
      }
      if (!simple) { g.color(plate).box(add(under, mul(Z, -0.1 * s)), mul(X, 1.35 * s), mul(Y, 1.35 * s), mul(Z, 0.1 * s)); hatch(add(under, mul(Z, -0.2 * s)), X, mul(Z, -1), 1.35 * s); }
      if (allR) g.color(body).box(p, mul(X, 0.35 * s), mul(Y, 0.35 * s), mul(Z, 0.35 * s));
    } else {
      if (fx) { line(add(p, mul(X, -s)), add(p, mul(X, s))); for (const q of [-1, 1]) line(add(p, v(q * s, 0, -0.4 * s)), add(p, v(q * s, 0, 0.4 * s))); }
      if (fy) { line(add(p, mul(Y, -s)), add(p, mul(Y, s))); for (const q of [-1, 1]) line(add(p, v(0, q * s, -0.4 * s)), add(p, v(0, q * s, 0.4 * s))); }
      if (allR && (fx || fy)) g.color(body).box(p, mul(X, 0.3 * s), mul(Y, 0.3 * s), mul(Z, 0.3 * s));
      if (!fix.some(Boolean) && spring) {
        for (let k = 0; k < 6; k++) line(add(p, v((k % 2 ? 1 : -1) * 0.45 * s, 0, -k * 0.3 * s)), add(p, v((k % 2 ? -1 : 1) * 0.45 * s, 0, -(k + 1) * 0.3 * s)));
        g.color(plate).box(add(p, mul(Z, -1.9 * s)), mul(X, s), mul(Y, s), mul(Z, 0.1 * s));
      }
    }
    const reach = Math.max(1.6 * s, 1.9 * member);
    for (const q of [add(p, v(-reach, -reach, -Math.max(2.4 * s, reach))), add(p, v(reach, reach, Math.max(0.4 * s, reach)))]) this.track(q);
    if (seg.length) { const list = this.shafts.get(plate) ?? []; if (!list.length) this.shafts.set(plate, list); list.push(...seg); }
  }
  private loads(m: FEModel, lc: number, size: number, values: boolean): void {
    const f = 1 / this.u.len.f, caseIdx = Math.min(lc, m.cases.length - 1), list = m.loads.filter(l => l.lc === caseIdx);
    let maxP = 0, maxW = 0, maxQ = 0;
    for (const l of list) { if (l.t === 'node') maxP = Math.max(maxP, Math.hypot(l.f[0], l.f[1], l.f[2])); if (l.t === 'line') maxW = Math.max(maxW, Math.hypot(...l.w1), Math.hypot(...l.w2)); if (l.t === 'pressure') maxQ = Math.max(maxQ, Math.abs(l.p)); }
    const band: number[] = [];
    const L = size * 0.09, lineLabels = new Map<string, { mid: V3; base: V3 }[]>(), pointLabels = new Map<string, { mid: V3; base: V3 }[]>();
    let shown = 0, byNode: Map<number, number[]> | null = null;
    const atNode = () => { if (!byNode) { byNode = new Map(); if (this.skin) m.beams.forEach((b, e) => { for (const n of b.n) { const q = byNode!.get(n); if (q) q.push(e); else byNode!.set(n, [e]); } }); } return byNode; };
    for (const l of list) {
      if (l.t === 'node') {
        const p0 = this.P(m, l.node), p = p0, mag = Math.hypot(l.f[0], l.f[1], l.f[2]);
        if (mag > 0) { const back = mul(v(l.f[0], l.f[1], l.f[2]), -1 / mag); let off = 0; for (const e of atNode().get(l.node) ?? []) off = Math.max(off, this.surface(m, e, back)); const p = add(p0, mul(back, off * f)); const d = mul(v(l.f[0], l.f[1], l.f[2]), L * (0.45 + 0.55 * mag / maxP) / mag), text = `${fmtNum(mag / this.u.force.f, 4)} ${this.u.force.label}`; this.arrow(sub(p, d), p, C.load); if (values) { const l2 = pointLabels.get(text); if (l2) l2.push({ mid: sub(p, d), base: p }); else pointLabels.set(text, [{ mid: sub(p, d), base: p }]); } }
        const mm = Math.hypot(l.f[3], l.f[4], l.f[5]);
        if (mm > 0) { const at = this.momentArc(p, v(l.f[3], l.f[4], l.f[5]), C.load, L * 0.42); if (values) this.label(at, `${fmtNum(mm / this.u.moment.f, 4)} ${this.u.moment.label}`, 'load', undefined, 2, sub(at, p)); }
      } else if (l.t === 'line' && shown < 3000) {
        const b = m.beams[l.el], [a, c] = beamEnds(m, b), R = memberAxes(a, c, b.ref, b.angle);
        const glob = (w: number[]) => (l.sys === 'local' ? v(R[0] * w[0] + R[3] * w[1] + R[6] * w[2], R[1] * w[0] + R[4] * w[1] + R[7] * w[2], R[2] * w[0] + R[5] * w[1] + R[8] * w[2]) : v(w[0], w[1], w[2]));
        const n = 4, tops: V3[] = [], feet: V3[] = [];
        for (let i = 0; i <= n; i++) { const t = i / n, w = add(mul(glob(l.w1), 1 - t), mul(glob(l.w2), t)), mag = len(w), p = mul(add(mul(a, 1 - t), mul(c, t)), f); feet[i] = p; if (mag <= 0) { tops.push(p); continue; } const d = mul(w, L * 0.6 * (mag / maxW) / mag), q = add(p, mul(w, -this.surface(m, l.el, mul(w, -1 / mag)) * f / mag)); feet[i] = q; this.arrow(sub(q, d), q, C.load, 0.3); tops.push(sub(q, d)); shown++; }
        this.polyline(tops, C.load);
        // A light band between the member and the tops of the arrows, so a distributed load reads as one block.
        for (let i = 0; i < n; i++) { const p0 = feet[i], p1 = feet[i + 1]; for (const q of [p0, p1, tops[i + 1], p0, tops[i + 1], tops[i]]) band.push(q.x, q.y, q.z); }
        const w0 = Math.hypot(...l.w1), w1 = Math.hypot(...l.w2), text = (Math.abs(w0 - w1) < 1e-9 * Math.max(w0, w1, 1) ? fmtNum(w0 / this.u.lineLoad.f, 4) : `${fmtNum(w0 / this.u.lineLoad.f, 4)} to ${fmtNum(w1 / this.u.lineLoad.f, 4)}`) + ' ' + this.u.lineLoad.label;
        if (values && Math.max(w0, w1) > 0) { const mid = tops[n / 2], base = mul(add(a, c), 0.5 * f); const l2 = lineLabels.get(text); if (l2) l2.push({ mid, base }); else lineLabels.set(text, [{ mid, base }]); }
      } else if (l.t === 'pressure' && shown < 1500) {
        const s = m.shells[l.el]; let cen = v(); for (const n of s.n) cen = add(cen, this.P(m, n)); cen = mul(cen, 1 / s.n.length);
        const p0 = this.P(m, s.n[0]), p1 = this.P(m, s.n[1]), p2 = this.P(m, s.n[2]);
        const dir = l.dir ? unit(v(l.dir[0], l.dir[1], l.dir[2])) : unit(cross(sub(p1, p0), sub(p2, p0)));
        const d = mul(dir, L * 0.45 * Math.sign(l.p) * Math.abs(l.p) / maxQ);
        // A sample of the loaded elements is enough to show a pressure; an arrow on every element hides the surface.
        if (m.shells.length <= 150 || l.el % Math.ceil(m.shells.length / 150) === 0) { this.arrow(sub(cen, d), cen, C.load, 0.3); shown++; }
      }
    }
    // Each distinct line-load value is labelled once, on the middle one of the members that carry it.
    if (band.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(band, 3)); const o3 = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: C.load, side: THREE.DoubleSide, transparent: true, opacity: 0.12, depthWrite: false })); o3.renderOrder = 1; this.group.add(o3); }
    // Equal point loads on many nodes (a loaded chord, a roof grid) are labelled once as well.
    for (const [text, at] of pointLabels) for (const q of at.length > 2 ? [at[Math.floor(at.length / 2)]] : at) this.label(q.mid, at.length > 2 ? `${text} each` : text, 'load', undefined, 2, sub(q.mid, q.base));
    for (const [text, at] of lineLabels) { const q = at[Math.floor(at.length / 2)]; this.label(q.mid, text, 'load', undefined, 2, sub(q.mid, q.base)); }
    const pr = list.find(l => l.t === 'pressure');
    if (pr && pr.t === 'pressure' && values) { const s = m.shells[pr.el]; this.label(this.P(m, s.n[0]), `${fmtNum(Math.abs(pr.p) / this.u.pressure.f, 4)} ${this.u.pressure.label}`, 'load', undefined, 2); }
    if (list.some(l => l.t === 'gravity')) this.info.push('Self-weight is included in this load case.');
  }

  // ---- results -------------------------------------------------------------------------
  result(r: FEResult, o: ViewOptions, nodeId = ''): void {
    const m = r.model, f = 1 / this.u.len.f, nn = nodeCount(m);
    for (let i = 0; i < nn; i++) this.track(this.P(m, i));
    const size = this.size;
    const isMode = r.modes.length > 0 && (r.kind === 'modal' || r.kind === 'buckling');
    const mode = isMode ? r.modes[Math.min(Math.max(0, o.mode), r.modes.length - 1)] : null;
    const cr: CaseResult | null = mode ? null : r.cases[Math.min(Math.max(0, o.caseIndex), r.cases.length - 1)] ?? null;
    const U = mode ? mode.shape : cr ? cr.u : new Float64Array(6 * nn);
    let umax = 0; for (let i = 0; i < nn; i++) umax = Math.max(umax, Math.hypot(U[6 * i], U[6 * i + 1], U[6 * i + 2]));
    // Automatic scale: the largest displacement is drawn as 5 % of the model size.
    const scale = !o.deformed ? 0 : o.scale > 0 ? o.scale : umax > 0 ? (0.05 * size * this.u.len.f) / umax : 0;
    this.info.push((mode ? mode.label : cr ? `Case ${cr.name}` : '') + (scale > 0 ? ` · deformation ×${fmtNum(scale, 3)}${mode ? '' : `, largest ${fmtNum(umax / this.u.dim.f, 4)} ${this.u.dim.label}`}` : ''));
    this.animated = !!o.animate && scale > 0;
    const diagram = !!cr && o.diagram !== 'none' && DIAGRAM_INDEX[o.diagram] !== undefined;
    // The structure itself is drawn as it was built (bold lines, or solid sections); the deflected shape is a
    // dashed line on top of it. Shells are the exception: their deflected surface carries the contour colors.
    if (o.undeformed && scale > 0 && m.shells.length) {
      const g: ms.Mesh = { k: 'mesh', v: m.nodes.map(x => x * f), f: m.shells.map(s => s.n) }, seg: number[] = [];
      for (const [a, b] of ms.meshEdges(g)) seg.push(g.v[3 * a], g.v[3 * a + 1], g.v[3 * a + 2], g.v[3 * b], g.v[3 * b + 1], g.v[3 * b + 2]);
      this.lines(seg, C.ghost, 0.35);
    }

    // Line elements: sampled deflected curves.
    const nSeg = 8, util = o.utilization && cr ? m.beams.map((_, e) => post.memberUtilization(m, cr, e).util) : null;
    if (m.beams.length) {
      const base: number[] = [], delta: number[] = [], colors: number[] = [], ids: number[] = [], straight: number[] = [], straightColors: number[] = [];
      const col = new THREE.Color();
      m.beams.forEach((b, e) => {
        const [a, c] = beamEnds(m, b);
        const pts: V3[] = [], dsp: V3[] = [];
        for (let i = 0; i <= nSeg; i++) {
          const t = i / nSeg, p0 = add(mul(a, 1 - t), mul(c, t));
          let d: V3;
          if (cr) d = sub(post.memberDeflected(m, cr, e, t, 1), p0);
          else { const n1 = b.n[0], n2 = b.n[1]; d = add(mul(v(U[6 * n1], U[6 * n1 + 1], U[6 * n1 + 2]), 1 - t), mul(v(U[6 * n2], U[6 * n2 + 1], U[6 * n2 + 2]), t)); d = this.hermite(m, b, U, t) ?? d; }
          pts.push(mul(p0, f)); dsp.push(mul(d, scale * f));
        }
        if (util) col.set(rampColor(Math.min(1, util[e]))); else col.set(this.memberColor(b.type));
        if (cr?.active && !cr.active[e]) col.set(0xb8bec7);
        for (let i = 0; i < nSeg; i++) for (const k of [i, i + 1]) { base.push(pts[k].x, pts[k].y, pts[k].z); delta.push(dsp[k].x, dsp[k].y, dsp[k].z); colors.push(col.r, col.g, col.b); }
        for (let i = 0; i < nSeg; i++) ids.push(e);
        straight.push(pts[0].x, pts[0].y, pts[0].z, pts[nSeg].x, pts[nSeg].y, pts[nSeg].z); straightColors.push(col.r, col.g, col.b, col.r, col.g, col.b);
      });
      const pos = new Float32Array(base.length);
      for (let i = 0; i < pos.length; i++) pos[i] = base[i] + delta[i];
      const members = this.fat(straight, { colors: straightColors, width: 2.8 });
      members.userData.pick = { kind: 'beam', ids: m.beams.map((_, e) => e), nodeId }; this.pickables.push(members);
      this.skin = false;
      if (o.sections) this.sectionSolids(m, false, nodeId, util || cr?.active ? m.beams.map((b, e) => (cr?.active && !cr.active[e] ? 0xb8bec7 : util ? rampColor(Math.min(1, util[e])) : materialColor(m.materials[b.mat]))) : undefined);
      if (scale > 0) {
        const o3 = this.fat(Array.from(pos), { color: this.dark ? 0x9fc0ff : 0x1d4ed8, width: 1.9, dash: size * 0.011, overlay: true });
        o3.frustumCulled = false;
        o3.userData.pick = { kind: 'beam', ids, nodeId }; this.pickables.push(o3);
        const buf = (o3.geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data;
        this.morphs.push({ array: buf.array as Float32Array, touch: () => { buf.needsUpdate = true; }, base: Float32Array.from(base), delta: Float32Array.from(delta) });
      }
      if (util) this.legend = { title: 'Utilization (stress-based, simplified)', min: 0, max: 1, unit: '' };
    }
    // Shells: deformed mesh, optionally colored by a result quantity.
    if (m.shells.length) {
      const base = new Float32Array(3 * nn), delta = new Float32Array(3 * nn);
      for (let i = 0; i < nn; i++) for (let d = 0; d < 3; d++) { base[3 * i + d] = m.nodes[3 * i + d] * f; delta[3 * i + d] = U[6 * i + d] * scale * f; }
      const pos = new Float32Array(3 * nn); for (let i = 0; i < pos.length; i++) pos[i] = base[i] + delta[i];
      const mesh: ms.Mesh = { k: 'mesh', v: Array.from(pos), f: m.shells.map(s => s.n) };
      let colors: Float32Array | undefined;
      if (o.contour !== 'none' && (cr || mode)) {
        const q = o.contour as post.ShellQuantity;
        const vals = cr ? post.shellNodalValues(m, cr, q, o.layer) : Float64Array.from({ length: nn }, (_, i) => Math.hypot(U[6 * i], U[6 * i + 1], U[6 * i + 2]));
        const used = new Uint8Array(nn); for (const s of m.shells) for (const n of s.n) used[n] = 1;
        let lo = Infinity, hi = -Infinity; for (let i = 0; i < nn; i++) if (used[i]) { lo = Math.min(lo, vals[i]); hi = Math.max(hi, vals[i]); }
        colors = new Float32Array(3 * nn); const col = new THREE.Color();
        for (let i = 0; i < nn; i++) { col.set(rampColor(hi > lo ? (vals[i] - lo) / (hi - lo) : 0.5)); colors[3 * i] = col.r; colors[3 * i + 1] = col.g; colors[3 * i + 2] = col.b; }
        const kind = ['disp', 'ux', 'uy', 'uz'].includes(q) ? 'dim' : ['vonMises', 's1', 's2'].includes(q) ? 'stress' : /^M/.test(q) ? 'momentPerLen' : 'forcePerLen';
        const un = (this.u as any)[kind];
        if (cr) this.legend = { title: `${CONTOUR_NAMES[q] ?? q}${kind === 'stress' ? ` (${o.layer})` : ''}`, min: lo / un.f, max: hi / un.f, unit: un.label };
      }
      const o3 = this.mesh(mesh, C.shell, { colors, edges: m.shells.length < 20000 });
      o3.userData.pick = { kind: 'shell', tri: this.triMap(mesh), nodeId }; this.pickables.push(o3);
      const attr = o3.geometry.getAttribute('position') as THREE.BufferAttribute;
      this.morphs.push({ array: attr.array as Float32Array, touch: () => { attr.needsUpdate = true; }, base, delta });
      if (o.principal && cr && m.shells.length <= 3000) {
        const sp: number[] = [], sn: number[] = [], h = size * 0.012;
        m.shells.forEach((_, s) => { const pr = post.shellPrincipal(m, cr, s, o.layer), c = mul(pr.o, f); for (const [d, val] of [[pr.d1, pr.s1], [pr.d2, pr.s2]] as [V3, number][]) { const a = add(c, mul(d, h)), b = sub(c, mul(d, h)); (val >= 0 ? sp : sn).push(a.x, a.y, a.z, b.x, b.y, b.z); } });
        if (sp.length) this.lines(sp, C.pos); if (sn.length) this.lines(sn, C.neg);
      }
    }
    this.annotate(() => {
      if (o.supports !== false) this.supports(m, size);
      if (o.loads && cr && !mode) this.loads(m, Math.min(o.caseIndex, m.cases.length - 1), size, o.values);
      if (cr && diagram) this.diagrams(m, cr, o.diagram, size, o.values);
      if (cr && o.reactions) this.reactions(m, cr, size, o.values);
      if (o.localAxes) this.localAxes(m, size);
    });
    // The equilibrium check is always in the inspector; it is only repeated here when it is not satisfied.
    if (cr && cr.equilibrium.relError > 1e-6) this.info.push(`Check the model: applied loads and reactions differ by ${fmtNum(cr.equilibrium.error / this.u.force.f, 3)} ${this.u.force.label}.`);
  }
  /** Cubic interpolation of a mode shape along a beam from its nodal translations and rotations. */
  private hermite(m: FEModel, b: FEModel['beams'][number], U: ArrayLike<number>, t: number): V3 | null {
    if (b.type !== 'beam') return null;
    const [a, c] = beamEnds(m, b), L = len(sub(c, a)), R = memberAxes(a, c, b.ref, b.angle);
    const loc = (n: number, off: number) => [0, 1, 2].map(i => R[3 * i] * U[6 * n + off] + R[3 * i + 1] * U[6 * n + off + 1] + R[3 * i + 2] * U[6 * n + off + 2]);
    const u1 = loc(b.n[0], 0), r1 = loc(b.n[0], 3), u2 = loc(b.n[1], 0), r2 = loc(b.n[1], 3);
    const N1 = 1 - 3 * t * t + 2 * t ** 3, N2 = L * (t - 2 * t * t + t ** 3), N3 = 3 * t * t - 2 * t ** 3, N4 = L * (-t * t + t ** 3);
    const ul = u1[0] + (u2[0] - u1[0]) * t, vl = N1 * u1[1] + N2 * r1[2] + N3 * u2[1] + N4 * r2[2], wl = N1 * u1[2] - N2 * r1[1] + N3 * u2[2] - N4 * r2[1];
    return v(R[0] * ul + R[3] * vl + R[6] * wl, R[1] * ul + R[4] * vl + R[7] * wl, R[2] * ul + R[5] * vl + R[8] * wl);
  }
  /**
   * Member force diagram: a filled band along each member, blue where the value is positive and red
   * where it is negative, split exactly at the zero crossings. Values are written at member ends and
   * at an extreme inside a member; the largest one is bold.
   */
  private diagrams(m: FEModel, cr: CaseResult, which: string, size: number, values: boolean): void {
    const k = DIAGRAM_INDEX[which], f = 1 / this.u.len.f, n = 10, un = k < 3 ? this.u.force : this.u.moment;
    let maxAbs = 0, lo = Infinity, hi = -Infinity;
    const st = m.beams.map((_, e) => { const s = post.memberStations(m, cr, e, n); for (const x of s.f) { maxAbs = Math.max(maxAbs, Math.abs(x[k])); lo = Math.min(lo, x[k]); hi = Math.max(hi, x[k]); } return s; });
    if (maxAbs <= 0) { this.info.push(`${which} is zero everywhere in this case.`); return; }
    const amp = size * 0.085 / maxAbs, tiny = 1e-9 * maxAbs;
    const fill: Record<'pos' | 'neg', number[]> = { pos: [], neg: [] }, edge: Record<'pos' | 'neg', number[]> = { pos: [], neg: [] }, ord: Record<'pos' | 'neg', number[]> = { pos: [], neg: [] };
    const push = (arr: number[], ...ps: V3[]) => { for (const p of ps) arr.push(p.x, p.y, p.z); };
    const ordinates = m.beams.length * n <= 4000;
    const cands: { p: V3; val: number; off: V3 }[] = [];
    // Where two elements of one straight member meet, the value is written only if it is a local peak;
    // otherwise a member split into many elements would be covered in numbers.
    const atNode = new Map<number, number[]>(), supported = new Set(m.supports.map(sp => sp.node));
    m.beams.forEach((b, e) => { for (const nd of b.n) { const l = atNode.get(nd); if (l) l.push(e); else atNode.set(nd, [e]); } });
    const axis = (e: number) => { const [a, c] = beamEnds(m, m.beams[e]); return unit(sub(c, a)); };
    /** For an element end inside a straight chain: the value at the far end of the neighbouring element; otherwise null. */
    const neighbourFar = (e: number, end: 0 | 1): number | null => {
      const nd = m.beams[e].n[end], list = atNode.get(nd)!;
      if (list.length !== 2 || supported.has(nd)) return null;
      const o = list[0] === e ? list[1] : list[0], d1 = axis(e), d2 = axis(o);
      if (Math.abs(d1.x * d2.x + d1.y * d2.y + d1.z * d2.z) < 0.999) return null;
      return st[o].f[m.beams[o].n[0] === nd ? n : 0][k];
    };
    // Axial force in bars (truss and cable members) is shown by color and line weight instead of a band:
    // blue for tension, red for compression, in three weights. Bands on every diagonal of a truss overlap.
    const bars: Record<string, number[]> = {};
    m.beams.forEach((b, e) => {
      const [a, c] = beamEnds(m, b), R = memberAxes(a, c, b.ref, b.angle);
      if (which === 'N' && b.type !== 'beam') {
        const x = st[e].f[n / 2][k];
        if (Math.abs(x) <= tiny) return;
        const key = (x >= 0 ? 'pos' : 'neg') + (Math.abs(x) > 0.66 * maxAbs ? 3 : Math.abs(x) > 0.33 * maxAbs ? 2 : 1), pa = mul(a, f), pc = mul(c, f);
        (bars[key] ??= []).push(pa.x, pa.y, pa.z, pc.x, pc.y, pc.z);
        cands.push({ p: mul(add(pa, pc), 0.5), val: x, off: v(R[6], R[7], R[8]) });
        return;
      }
      // Moments are drawn on the tension side; forces along local z (Vy along local y).
      const dir = which === 'Vy' ? v(R[3], R[4], R[5]) : which === 'Mz' ? mul(v(R[3], R[4], R[5]), -1) : which === 'My' ? mul(v(R[6], R[7], R[8]), -1) : v(R[6], R[7], R[8]);
      const val = (i: number) => st[e].f[i][k], at = (t: number) => mul(add(mul(a, 1 - t), mul(c, t)), f), top = (t: number, x: number) => add(at(t), mul(dir, x * amp));
      for (let i = 0; i < n; i++) {
        const v0 = val(i), v1 = val(i + 1), t0 = i / n, t1 = (i + 1) / n;
        const piece = (ta: number, va: number, tb: number, vb: number) => { const key = va + vb >= 0 ? 'pos' : 'neg', pa = at(ta), pb = at(tb), qa = top(ta, va), qb = top(tb, vb); push(fill[key], pa, pb, qb, pa, qb, qa); push(edge[key], qa, qb); };
        if (v0 * v1 < 0 && Math.abs(v0) > tiny && Math.abs(v1) > tiny) { const tz = t0 + (t1 - t0) * v0 / (v0 - v1); piece(t0, v0, tz, 0); piece(tz, 0, t1, v1); } else piece(t0, v0, t1, v1);
      }
      for (let i = 0; i <= n; i++) { const x = val(i); if (Math.abs(x) <= tiny) continue; if (ordinates || i === 0 || i === n) push(ord[x >= 0 ? 'pos' : 'neg'], at(i / n), top(i / n, x)); }
      // Label candidates: both ends, and the largest value inside the member when it exceeds both ends.
      let im = 0, vmin = Infinity, vmax = -Infinity; for (let i = 0; i <= n; i++) { if (Math.abs(val(i)) > Math.abs(val(im))) im = i; vmin = Math.min(vmin, val(i)); vmax = Math.max(vmax, val(i)); }
      // A value that is constant along the member (an axial force in a truss bar) is written once, at mid-length.
      if (vmax - vmin < 0.01 * maxAbs) { const x = val(n / 2); if (Math.abs(x) > 0.02 * maxAbs) cands.push({ p: top(0.5, x), val: x, off: mul(dir, Math.sign(x)) }); return; }
      for (const i of new Set([0, n, im])) {
        const x = val(i);
        if (Math.abs(x) <= 0.02 * maxAbs) continue;
        if (i === 0 || i === n) { const far = neighbourFar(e, i === 0 ? 0 : 1); if (far !== null && !(Math.abs(x) >= Math.abs(far) && Math.abs(x) >= Math.abs(val(n - i)) && Math.abs(x) > 1.005 * Math.min(Math.abs(far), Math.abs(val(n - i))))) continue; }
        else if (Math.abs(x) <= 1.02 * Math.max(Math.abs(val(0)), Math.abs(val(n)))) continue;
        cands.push({ p: top(i / n, x), val: x, off: mul(dir, Math.sign(x)) });
      }
    });
    for (const key of ['pos', 'neg'] as const) {
      const color = key === 'pos' ? C.pos : C.neg;
      if (fill[key].length) {
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(fill[key], 3));
        // Diagrams are an overlay: they are not hidden by the solid members they start from.
        const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.22, depthWrite: false, depthTest: false }));
        mesh.renderOrder = 4; this.group.add(mesh);
        for (let i = 0; i < fill[key].length; i += 3) this.track(v(fill[key][i], fill[key][i + 1], fill[key][i + 2]));
      }
      if (edge[key].length) this.fat(edge[key], { color, width: 1.6, overlay: true });
      if (ord[key].length) { const o3 = this.lines(ord[key], color, 0.45); (o3.material as THREE.Material).depthTest = false; o3.renderOrder = 5; }
    }
    for (const [key, seg] of Object.entries(bars)) { const o3 = this.fat(seg, { color: key.startsWith('pos') ? C.pos : C.neg, width: 1.2 + 1.5 * Number(key.slice(3)) }); o3.material.depthTest = false; o3.renderOrder = 3; }
    if (values && cands.length && m.beams.length <= 150) {
      const peak = cands.reduce((best, c) => (Math.abs(c.val) > Math.abs(best.val) ? c : best), cands[0]);
      for (const c of cands) { const strong = Math.abs(c.val) >= 0.999 * Math.abs(peak.val); this.label(c.p, fmtNum(c.val / un.f, 3), strong ? 'diag strong' : 'diag', undefined, strong ? 3 : 1 + Math.abs(c.val) / maxAbs, c.off); }
    }
    const name: Record<string, string> = { N: 'Axial force N', Vy: 'Shear force Vy', Vz: 'Shear force Vz', T: 'Torsion T', My: 'Bending moment My', Mz: 'Bending moment Mz' };
    const clean = (x: number) => (Math.abs(x) < 1e-9 * maxAbs ? 0 : x / un.f);
    this.info.push(`${name[which]}: ${fmtNum(clean(lo), 4)} to ${fmtNum(clean(hi), 4)} ${un.label} (${which === 'N' ? 'blue tension, red compression' : 'blue +, red −'}${which.startsWith('M') ? ', drawn on the tension side' : ''}${Object.keys(bars).length ? '; a heavier line is a larger force' : ''})`);
  }
  private reactions(m: FEModel, cr: CaseResult, size: number, values: boolean): void {
    let maxR = 0, maxM = 0;
    for (const s of m.supports) { const k = 6 * s.node, r = cr.reactions; maxR = Math.max(maxR, Math.hypot(r[k], r[k + 1], r[k + 2])); maxM = Math.max(maxM, Math.hypot(r[k + 3], r[k + 4], r[k + 5])); }
    const L = size * 0.1, few = m.supports.length <= 80;
    for (const s of m.supports) {
      const q = post.nodeReaction(cr, s.node), mag = Math.hypot(q[0], q[1], q[2]), mm = Math.hypot(q[3], q[4], q[5]), p = this.P(m, s.node);
      if (maxR > 0 && mag > 1e-6 * maxR) {
        // The arrow points at the node from the side the reaction pushes from, clear of the support symbol.
        const d = mul(v(q[0], q[1], q[2]), L * (0.4 + 0.6 * mag / maxR) / mag), tip = sub(p, mul(d, 0.42 * size * 0.1 / len(d)));
        this.arrow(sub(tip, d), tip, C.react);
        if (values && few) this.label(sub(tip, d), `${fmtNum(mag / this.u.force.f, 4)} ${this.u.force.label}`, 'react', undefined, 2, mul(d, -1));
      }
      // Moment reactions (fixed supports): a curved arrow with its value. Tiny values from in-plane restraints are skipped.
      if (maxM > 0 && mm > 1e-6 * maxM && mm > 1e-9 * Math.max(maxR, 1) && few) {
        const at = this.momentArc(p, v(q[3], q[4], q[5]), C.react, L * 0.5);
        if (values) this.label(at, `${fmtNum(mm / this.u.moment.f, 4)} ${this.u.moment.label}`, 'react', undefined, 2, sub(at, p));
      }
    }
  }
  /** Move animated geometry: factor in [-1, 1]. */
  setFactor(fac: number): void { for (const mo of this.morphs) { const a = mo.array; for (let i = 0; i < a.length; i++) a[i] = mo.base[i] + fac * mo.delta[i]; mo.touch(); } }
  bounds(): THREE.Box3 { return this.box.clone(); }
  dispose(): void { this.group.traverse(o => { const any = o as any; any.geometry?.dispose?.(); if (Array.isArray(any.material)) any.material.forEach((x: any) => x.dispose()); else any.material?.dispose?.(); }); }
}
export const CONTOUR_NAMES: Record<string, string> = { disp: 'Displacement', ux: 'Displacement X', uy: 'Displacement Y', uz: 'Displacement Z', vonMises: 'von Mises stress', s1: 'Principal stress 1', s2: 'Principal stress 2', N1: 'Principal membrane force 1', N2: 'Principal membrane force 2', Nx: 'Membrane force Nx', Ny: 'Membrane force Ny', Nxy: 'Membrane shear Nxy', M1: 'Principal moment 1', M2: 'Principal moment 2', Mx: 'Moment Mx', My: 'Moment My', Mxy: 'Twisting moment Mxy', Qx: 'Shear Qx', Qy: 'Shear Qy' };
