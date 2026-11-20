/**
 * Builds Three.js objects from graph outputs: plain geometry, structural
 * models, and analysis results (deformed shape, diagrams, contours, reactions).
 * Everything is drawn in model units (m or ft); solver data is converted here.
 */
import * as THREE from 'three';
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

export interface Label { p: THREE.Vector3; text: string; cls: string; size?: number }
export interface Legend { title: string; min: number; max: number; unit: string }
export interface ViewOptions { caseIndex: number; scale: number; deformed: boolean; undeformed: boolean; diagram: string; contour: string; layer: 'top' | 'mid' | 'bottom'; reactions: boolean; loads: boolean; supports: boolean; utilization: boolean; mode: number; animate: boolean; values: boolean; sections: boolean; localAxes: boolean; principal: boolean }
/** Vertex buffers that move with the animation factor: position = base + factor * delta. */
interface Morph { attr: THREE.BufferAttribute; base: Float32Array; delta: Float32Array }

const C = { ink: 0x2b3440, beam: 0x3a4757, truss: 0x2f6fd6, cable: 0xd9822b, shell: 0xb9c2cc, support: 0x2a9d8f, load: 0xd1495b, react: 0x7b2cbf, hi: 0x19c37d, pos: 0x2f6fd6, neg: 0xd1495b, ghost: 0x9aa4b1 };
const DIAGRAM_INDEX: Record<string, number> = { N: 0, Vy: 1, Vz: 2, T: 3, My: 4, Mz: 5 };

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
  constructor(private u: UnitSystem, private dark: boolean) {}

  private track(p: V3): void { this.box.expandByPoint(new THREE.Vector3(p.x, p.y, p.z)); }
  get size(): number { return this.box.isEmpty() ? 10 : Math.max(this.box.getSize(new THREE.Vector3()).length(), 1e-6); }

  // ---- primitives -------------------------------------------------------------
  points(pts: V3[], color: number | string, size = 6): THREE.Points {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap(p => [p.x, p.y, p.z]), 3));
    const o = new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: false }));
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
  arrow(from: V3, to: V3, color: number, head = 0.22): void {
    const d = sub(to, from), L = len(d);
    if (L < 1e-12) return;
    const n = unit(d), side = unit(cross(n, Math.abs(n.z) < 0.9 ? v(0, 0, 1) : v(1, 0, 0))), side2 = cross(n, side), h = L * head, b = add(to, mul(n, -h));
    const s = [from, to, to, add(b, mul(side, h * 0.4)), to, add(b, mul(side, -h * 0.4)), to, add(b, mul(side2, h * 0.4)), to, add(b, mul(side2, -h * 0.4))];
    this.lines(s.flatMap(p => [p.x, p.y, p.z]), color);
  }
  label(p: V3, text: string, cls = '', size?: number): void { if (this.labels.length < 500) this.labels.push({ p: new THREE.Vector3(p.x, p.y, p.z), text, cls, size }); }

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
      case 'tag': this.label(g.p, g.text, 'tag', g.size); this.track(g.p); return;
      case 'model': this.model(g as FEModel, { supports: true, loads: true, sections: true, caseIndex: 0, values: true, localAxes: false } as ViewOptions, hi, nodeId); return;
      case 'result': this.result(g as FEResult, { caseIndex: 0, scale: -1, deformed: true, undeformed: true, diagram: 'none', contour: (g as FEResult).model.shells.length ? 'disp' : 'none', layer: 'top', reactions: true, loads: false, supports: true, utilization: false, mode: 0, animate: false, values: true, sections: false, localAxes: false, principal: false }, nodeId); return;
      case 'feview': this.result(g.result, g.opts, nodeId); return;
      case 'element': this.element(g, col); return;
      case 'support': { const p = mul(g.p, 1 / this.u.len.f); this.points([p], C.support, 10); return; }
      case 'load': if (g.kind === 'point') { const p = mul(g.p, 1 / this.u.len.f); this.points([p], C.load, 8); } return;
    }
  }
  private element(e: any, col: number | string): void {
    const f = 1 / this.u.len.f;
    if (e.kind === 'beam') this.polyline([mul(e.a, f), mul(e.b, f)], e.type === 'beam' ? col : e.type === 'cable' ? C.cable : C.truss);
    else this.mesh(ms.meshFromPointsFaces(e.pts.map((p: V3) => mul(p, f)), [e.pts.map((_: V3, i: number) => i)]), C.shell, { opacity: 0.9 });
  }

  // ---- structural model -------------------------------------------------------------
  private P(m: FEModel, i: number): V3 { return mul(nodeXYZ(m, i), 1 / this.u.len.f); }
  model(m: FEModel, o: ViewOptions, hi = false, nodeId = '', ghost = false): void {
    const f = 1 / this.u.len.f, nn = nodeCount(m);
    for (let i = 0; i < nn; i++) this.track(this.P(m, i));
    const size = this.size;
    // Line elements, grouped by type so each group is one draw call.
    const groups: Record<string, { seg: number[]; ids: number[] }> = {};
    m.beams.forEach((b, e) => { const [a, c] = beamEnds(m, b), key = ghost ? 'ghost' : b.type === 'beam' ? 'beam' : b.type === 'cable' ? 'cable' : 'truss'; (groups[key] ??= { seg: [], ids: [] }); groups[key].seg.push(a.x * f, a.y * f, a.z * f, c.x * f, c.y * f, c.z * f); groups[key].ids.push(e); });
    for (const [key, g] of Object.entries(groups)) {
      const o3 = this.lines(g.seg, hi ? C.hi : key === 'ghost' ? C.ghost : key === 'beam' ? (this.dark ? 0xdfe5ec : C.beam) : key === 'cable' ? C.cable : C.truss, key === 'ghost' ? 0.55 : 1);
      if (!ghost) { o3.userData.pick = { kind: 'beam', ids: g.ids, nodeId }; this.pickables.push(o3); }
    }
    if (o.sections && !ghost && m.beams.length <= 4000) this.sectionSolids(m, hi);
    if (m.shells.length) {
      const mesh: ms.Mesh = { k: 'mesh', v: m.nodes.map(x => x * f), f: m.shells.map(s => s.n) };
      if (ghost) { const s: number[] = []; for (const [a, b] of ms.meshEdges(mesh)) s.push(mesh.v[3 * a], mesh.v[3 * a + 1], mesh.v[3 * a + 2], mesh.v[3 * b], mesh.v[3 * b + 1], mesh.v[3 * b + 2]); this.lines(s, C.ghost, 0.35); }
      else { const o3 = this.mesh(mesh, hi ? C.hi : C.shell, { opacity: 0.95 }); o3.userData.pick = { kind: 'shell', tri: this.triMap(mesh), nodeId }; this.pickables.push(o3); }
    }
    if (ghost) return;
    if (nn <= 5000) { const pts = this.points(Array.from({ length: nn }, (_, i) => this.P(m, i)), this.dark ? 0xdfe5ec : C.ink, 4); pts.userData.pick = { kind: 'node', nodeId }; this.pickables.push(pts); }
    if (o.supports !== false) this.supports(m, size);
    if (o.loads !== false) this.loads(m, o.caseIndex, size, o.values !== false);
    if (o.localAxes) m.beams.forEach((b) => { const [a, c] = beamEnds(m, b), R = memberAxes(a, c, b.ref, b.angle), mid = mul(add(a, c), 0.5 * f), s = size * 0.025; this.lines([mid, add(mid, mul(v(R[0], R[1], R[2]), s))].flatMap(p => [p.x, p.y, p.z]), 0xd1495b); this.lines([mid, add(mid, mul(v(R[3], R[4], R[5]), s))].flatMap(p => [p.x, p.y, p.z]), 0x3fae6b); this.lines([mid, add(mid, mul(v(R[6], R[7], R[8]), s))].flatMap(p => [p.x, p.y, p.z]), 0x2f6fd6); });
  }
  /** For each triangle of a triangulated mesh, the index of the face it came from. */
  private triMap(m: ms.Mesh): number[] { const map: number[] = []; m.f.forEach((q, i) => { for (let k = 0; k < Math.max(1, q.length - 2); k++) map.push(i); }); return map; }
  /** Extruded cross-section outlines so that member sizes and orientations are visible. */
  private sectionSolids(m: FEModel, hi: boolean): void {
    const f = 1 / this.u.len.f, vs: number[] = [], idx: number[] = [];
    m.beams.forEach((b) => {
      const outline = m.sections[b.sec].shape?.outer;
      if (!outline || b.type === 'cable') return;
      const [a, c] = beamEnds(m, b), R = memberAxes(a, c, b.ref, b.angle), y = v(R[3], R[4], R[5]), z = v(R[6], R[7], R[8]), base = vs.length / 3, n = outline.length;
      for (const end of [a, c]) for (const [py, pz] of outline) { const p = mul(add(end, add(mul(y, py), mul(z, pz))), f); vs.push(p.x, p.y, p.z); }
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(base + i, base + j, base + n + j, base + i, base + n + j, base + n + i); }
    });
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vs, 3)); g.setIndex(idx); g.computeVertexNormals();
    const o = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: hi ? C.hi : 0x8996a8, side: THREE.DoubleSide, roughness: 0.7, metalness: 0.15, flatShading: true }));
    o.userData.shaded = true;
    this.group.add(o);
  }
  private supports(m: FEModel, size: number): void {
    const s = size * 0.022, seg: number[] = [];
    for (const sp of m.supports) {
      const p = this.P(m, sp.node), tr = sp.fix.slice(0, 3).some(Boolean), rot = sp.fix.slice(3).some(Boolean);
      if (tr) { // pyramid under the node
        const b = [v(p.x - s, p.y - s, p.z - 1.6 * s), v(p.x + s, p.y - s, p.z - 1.6 * s), v(p.x + s, p.y + s, p.z - 1.6 * s), v(p.x - s, p.y + s, p.z - 1.6 * s)];
        for (let i = 0; i < 4; i++) seg.push(p.x, p.y, p.z, b[i].x, b[i].y, b[i].z, b[i].x, b[i].y, b[i].z, b[(i + 1) % 4].x, b[(i + 1) % 4].y, b[(i + 1) % 4].z);
      }
      if (rot) { const h = s * 0.55; for (const [a, b] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]].map(q => [v(p.x + q[0] * h, p.y + q[1] * h, p.z), v(p.x + q[2] * h, p.y + q[3] * h, p.z)])) seg.push(a.x, a.y, a.z, b.x, b.y, b.z); }
      if (!tr && !rot && sp.spring) { for (let k = 0; k < 6; k++) seg.push(p.x + (k % 2 ? s : -s) * 0.5, p.y, p.z - k * s * 0.3, p.x + (k % 2 ? -s : s) * 0.5, p.y, p.z - (k + 1) * s * 0.3); }
    }
    if (seg.length) this.lines(seg, C.support);
  }
  private loads(m: FEModel, lc: number, size: number, values: boolean): void {
    const f = 1 / this.u.len.f, caseIdx = Math.min(lc, m.cases.length - 1), list = m.loads.filter(l => l.lc === caseIdx);
    let maxP = 0, maxW = 0, maxQ = 0;
    for (const l of list) { if (l.t === 'node') maxP = Math.max(maxP, Math.hypot(l.f[0], l.f[1], l.f[2])); if (l.t === 'line') maxW = Math.max(maxW, Math.hypot(...l.w1), Math.hypot(...l.w2)); if (l.t === 'pressure') maxQ = Math.max(maxQ, Math.abs(l.p)); }
    const L = size * 0.09;
    let shown = 0;
    for (const l of list) {
      if (l.t === 'node') {
        const p = this.P(m, l.node), mag = Math.hypot(l.f[0], l.f[1], l.f[2]);
        if (mag > 0) { const d = mul(v(l.f[0], l.f[1], l.f[2]), L * (0.45 + 0.55 * mag / maxP) / mag); this.arrow(sub(p, d), p, C.load); if (values) this.label(sub(p, d), `${fmtNum(mag / this.u.force.f, 4)} ${this.u.force.label}`, 'load'); }
        const mm = Math.hypot(l.f[3], l.f[4], l.f[5]);
        if (mm > 0 && values) this.label(p, `M ${fmtNum(mm / this.u.moment.f, 4)} ${this.u.moment.label}`, 'load');
      } else if (l.t === 'line' && shown < 3000) {
        const b = m.beams[l.el], [a, c] = beamEnds(m, b), R = memberAxes(a, c, b.ref, b.angle);
        const glob = (w: number[]) => (l.sys === 'local' ? v(R[0] * w[0] + R[3] * w[1] + R[6] * w[2], R[1] * w[0] + R[4] * w[1] + R[7] * w[2], R[2] * w[0] + R[5] * w[1] + R[8] * w[2]) : v(w[0], w[1], w[2]));
        const n = 4, tops: V3[] = [];
        for (let i = 0; i <= n; i++) { const t = i / n, w = add(mul(glob(l.w1), 1 - t), mul(glob(l.w2), t)), mag = len(w), p = mul(add(mul(a, 1 - t), mul(c, t)), f); if (mag <= 0) { tops.push(p); continue; } const d = mul(w, L * 0.6 * (mag / maxW) / mag); this.arrow(sub(p, d), p, C.load, 0.3); tops.push(sub(p, d)); shown++; }
        this.polyline(tops, C.load);
      } else if (l.t === 'pressure' && shown < 1500) {
        const s = m.shells[l.el]; let cen = v(); for (const n of s.n) cen = add(cen, this.P(m, n)); cen = mul(cen, 1 / s.n.length);
        const p0 = this.P(m, s.n[0]), p1 = this.P(m, s.n[1]), p2 = this.P(m, s.n[2]);
        const dir = l.dir ? unit(v(l.dir[0], l.dir[1], l.dir[2])) : unit(cross(sub(p1, p0), sub(p2, p0)));
        const d = mul(dir, L * 0.45 * Math.sign(l.p) * Math.abs(l.p) / maxQ);
        if (m.shells.length < 400 || l.el % Math.ceil(m.shells.length / 400) === 0) { this.arrow(sub(cen, d), cen, C.load, 0.3); shown++; }
      }
    }
    const pr = list.find(l => l.t === 'pressure');
    if (pr && pr.t === 'pressure' && values) { const s = m.shells[pr.el]; this.label(this.P(m, s.n[0]), `${fmtNum(Math.abs(pr.p) / this.u.pressure.f, 4)} ${this.u.pressure.label}`, 'load'); }
    const ln = list.find(l => l.t === 'line');
    if (ln && ln.t === 'line' && values) { const b = m.beams[ln.el]; this.label(mul(add(this.P(m, b.n[0]), this.P(m, b.n[1])), 0.5), `${fmtNum(Math.hypot(...ln.w1) / this.u.lineLoad.f, 4)} ${this.u.lineLoad.label}`, 'load'); }
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
    this.info.push(mode ? mode.label : cr ? `Case ${cr.name}` : '');
    if (scale > 0) this.info.push(`Deformation ×${fmtNum(scale, 3)}${mode ? '' : `, max ${fmtNum(umax / this.u.dim.f, 4)} ${this.u.dim.label}`}`);
    if (o.undeformed && scale > 0) this.model(m, o, false, nodeId, true);
    this.animated = !!o.animate && scale > 0;

    // Line elements: sampled deflected curves.
    const nSeg = 8, util = o.utilization && cr ? m.beams.map((_, e) => post.memberUtilization(m, cr, e).util) : null;
    if (m.beams.length) {
      const base: number[] = [], delta: number[] = [], colors: number[] = [], ids: number[] = [];
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
        if (util) col.set(rampColor(Math.min(1, util[e]))); else col.set(b.type === 'beam' ? (this.dark ? 0xdfe5ec : C.beam) : b.type === 'cable' ? C.cable : C.truss);
        if (cr?.active && !cr.active[e]) col.set(0xb8bec7);
        for (let i = 0; i < nSeg; i++) for (const k of [i, i + 1]) { base.push(pts[k].x, pts[k].y, pts[k].z); delta.push(dsp[k].x, dsp[k].y, dsp[k].z); colors.push(col.r, col.g, col.b); }
        for (let i = 0; i < nSeg; i++) ids.push(e);
      });
      const g = new THREE.BufferGeometry(), pos = new Float32Array(base.length);
      for (let i = 0; i < pos.length; i++) pos[i] = base[i] + delta[i];
      const attr = new THREE.BufferAttribute(pos, 3);
      g.setAttribute('position', attr); g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const o3 = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
      o3.userData.pick = { kind: 'beam', ids, nodeId }; this.pickables.push(o3); this.group.add(o3);
      this.morphs.push({ attr, base: Float32Array.from(base), delta: Float32Array.from(delta) });
      for (let i = 0; i < pos.length; i += 3) this.track(v(pos[i], pos[i + 1], pos[i + 2]));
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
      this.morphs.push({ attr: o3.geometry.getAttribute('position') as THREE.BufferAttribute, base, delta });
      if (o.principal && cr && m.shells.length <= 3000) {
        const sp: number[] = [], sn: number[] = [], h = size * 0.012;
        m.shells.forEach((_, s) => { const pr = post.shellPrincipal(m, cr, s, o.layer), c = mul(pr.o, f); for (const [d, val] of [[pr.d1, pr.s1], [pr.d2, pr.s2]] as [V3, number][]) { const a = add(c, mul(d, h)), b = sub(c, mul(d, h)); (val >= 0 ? sp : sn).push(a.x, a.y, a.z, b.x, b.y, b.z); } });
        if (sp.length) this.lines(sp, C.pos); if (sn.length) this.lines(sn, C.neg);
      }
    }
    if (o.supports !== false) this.supports(m, size);
    if (o.loads && cr && !mode) this.loads(m, Math.min(o.caseIndex, m.cases.length - 1), size, o.values);
    if (cr && o.diagram !== 'none' && DIAGRAM_INDEX[o.diagram] !== undefined) this.diagrams(m, cr, o.diagram, size, o.values);
    if (cr && o.reactions) this.reactions(m, cr, size, o.values);
    if (cr) this.info.push(`Equilibrium: ΣR + ΣP = ${cr.equilibrium.error.toExponential(1)} N (relative ${cr.equilibrium.relError.toExponential(1)})`);
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
  private diagrams(m: FEModel, cr: CaseResult, which: string, size: number, values: boolean): void {
    const k = DIAGRAM_INDEX[which], f = 1 / this.u.len.f, n = 10, un = k < 3 ? this.u.force : this.u.moment;
    let maxAbs = 0;
    const st = m.beams.map((_, e) => { const s = post.memberStations(m, cr, e, n); for (const x of s.f) maxAbs = Math.max(maxAbs, Math.abs(x[k])); return s; });
    if (maxAbs <= 0) { this.info.push(`${which} is zero everywhere in this case.`); return; }
    const amp = size * 0.08 / maxAbs, posV: number[] = [], negV: number[] = [], outline: number[] = [];
    let ext = { val: 0, p: v() };
    m.beams.forEach((b, e) => {
      const [a, c] = beamEnds(m, b), R = memberAxes(a, c, b.ref, b.angle);
      // Moments are drawn on the tension side; forces along local z (Vy along local y).
      const dir = which === 'Vy' ? v(R[3], R[4], R[5]) : which === 'Mz' ? mul(v(R[3], R[4], R[5]), -1) : which === 'My' ? mul(v(R[6], R[7], R[8]), -1) : v(R[6], R[7], R[8]);
      const basePts: V3[] = [], tops: V3[] = [];
      for (let i = 0; i <= n; i++) { const p = mul(add(mul(a, 1 - i / n), mul(c, i / n)), f), val = st[e].f[i][k]; basePts.push(p); tops.push(add(p, mul(dir, val * amp))); if (Math.abs(val) > Math.abs(ext.val)) ext = { val, p: tops[i] }; }
      for (let i = 0; i < n; i++) {
        const avg = (st[e].f[i][k] + st[e].f[i + 1][k]) / 2, tgt = avg >= 0 ? posV : negV;
        for (const p of [basePts[i], basePts[i + 1], tops[i + 1], basePts[i], tops[i + 1], tops[i]]) tgt.push(p.x, p.y, p.z);
        outline.push(tops[i].x, tops[i].y, tops[i].z, tops[i + 1].x, tops[i + 1].y, tops[i + 1].z);
      }
      outline.push(basePts[0].x, basePts[0].y, basePts[0].z, tops[0].x, tops[0].y, tops[0].z, basePts[n].x, basePts[n].y, basePts[n].z, tops[n].x, tops[n].y, tops[n].z);
      if (values && m.beams.length <= 150) for (const i of [0, n]) { const val = st[e].f[i][k]; if (Math.abs(val) > 0.02 * maxAbs) this.label(tops[i], fmtNum(val / un.f, 3), 'diag'); }
    });
    for (const [arr, color] of [[posV, C.pos], [negV, C.neg]] as [number[], number][]) {
      if (!arr.length) continue;
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      this.group.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.32, depthWrite: false })));
    }
    this.lines(outline, this.dark ? 0xdfe5ec : C.ink, 0.8);
    if (values) this.label(ext.p, `max |${which}| = ${fmtNum(Math.abs(ext.val) / un.f, 4)} ${un.label}`, 'diag strong');
    this.info.push(`${which} diagram: blue positive, red negative${which.startsWith('M') ? ', drawn on the tension side' : ''}.`);
  }
  private reactions(m: FEModel, cr: CaseResult, size: number, values: boolean): void {
    let maxR = 0;
    for (const s of m.supports) maxR = Math.max(maxR, Math.hypot(cr.reactions[6 * s.node], cr.reactions[6 * s.node + 1], cr.reactions[6 * s.node + 2]));
    if (maxR <= 0) return;
    const L = size * 0.1;
    for (const s of m.supports) {
      const q = post.nodeReaction(cr, s.node), mag = Math.hypot(q[0], q[1], q[2]);
      if (mag < 1e-6 * maxR) continue;
      const p = this.P(m, s.node), d = mul(v(q[0], q[1], q[2]), L * (0.4 + 0.6 * mag / maxR) / mag);
      this.arrow(sub(p, d), p, C.react);
      if (values && m.supports.length <= 80) this.label(sub(p, d), `${fmtNum(mag / this.u.force.f, 4)} ${this.u.force.label}`, 'react');
    }
  }
  /** Move animated geometry: factor in [-1, 1]. */
  setFactor(fac: number): void { for (const mo of this.morphs) { const a = mo.attr.array as Float32Array; for (let i = 0; i < a.length; i++) a[i] = mo.base[i] + fac * mo.delta[i]; mo.attr.needsUpdate = true; } }
  bounds(): THREE.Box3 { return this.box.clone(); }
  dispose(): void { this.group.traverse(o => { const any = o as any; any.geometry?.dispose?.(); if (Array.isArray(any.material)) any.material.forEach((x: any) => x.dispose()); else any.material?.dispose?.(); }); }
}
export const CONTOUR_NAMES: Record<string, string> = { disp: 'Displacement', ux: 'Displacement X', uy: 'Displacement Y', uz: 'Displacement Z', vonMises: 'von Mises stress', s1: 'Principal stress 1', s2: 'Principal stress 2', N1: 'Principal membrane force 1', N2: 'Principal membrane force 2', Nx: 'Membrane force Nx', Ny: 'Membrane force Ny', Nxy: 'Membrane shear Nxy', M1: 'Principal moment 1', M2: 'Principal moment 2', Mx: 'Moment Mx', My: 'Moment My', Mxy: 'Twisting moment Mxy', Qx: 'Shear Qx', Qy: 'Shear Qy' };
