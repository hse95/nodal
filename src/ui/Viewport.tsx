/**
 * 3D viewport: WebGL2 rendering with Three.js, orbit navigation, standard
 * views, display modes, a section plane, labels, legend, picking and image
 * export. The scene is rebuilt after every graph solve; rendering happens on
 * demand (and continuously only while a mode shape or deformation animates).
 */
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, JSX } from 'solid-js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { project, selection, setSelection, runTick, openTick, engine, ui, setUi, registry, portsOf, unwrap, download, toast, mutate, addNode, connect } from './store';
import { SceneBuilder, Label, Legend, CONTOUR_NAMES } from './scene';
import { previewPlan, PREVIEW_TYPES, firstResult } from './preview';
import { layouts } from './Canvas';
import type { NodeData } from '../core/types';
import { unitSystem } from '../fe/units';
import { fmtNum } from '../core/graph';
import { rampColor } from '../components/geometry';

type ViewName = 'perspective' | 'top' | 'front' | 'right';
/** Handle used by export commands elsewhere in the app. */
export const viewportApi: { png?: () => string; svg?: () => string; fit?: () => void } = {};

export function Viewport(): JSX.Element {
  let host!: HTMLDivElement, labelLayer!: HTMLDivElement;
  const [legend, setLegend] = createSignal<Legend | null>(null);
  const [info, setInfo] = createSignal<string[]>([]);
  const [viewName, setViewName] = createSignal<ViewName>('perspective');
  /** True after the user has turned a top, front or right view by hand, so that no view button claims to be current. */
  const [turned, setTurned] = createSignal(false);
  const [failed, setFailed] = createSignal('');
  let renderer: THREE.WebGLRenderer, scene: THREE.Scene, persp: THREE.PerspectiveCamera, ortho: THREE.OrthographicCamera, camera: THREE.Camera, controls: OrbitControls;
  let builder: SceneBuilder | null = null, grid: THREE.GridHelper | null = null, labels: Label[] = [], labelEls: HTMLDivElement[] = [];
  let labelSize: { w: number; h: number }[] = [], labelOrder: number[] = [];
  let needsRender = true, raf = 0, firstFit = true;
  /** After a zoom to fit, the view keeps following the model as it changes, until the user moves the view. */
  let follow = false;
  const fitted = new THREE.Box3();
  const clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);

  const invalidate = () => { needsRender = true; };
  const resize = () => {
    if (!renderer) return;
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    persp.aspect = w / h; persp.updateProjectionMatrix();
    const half = ortho.userData.half ?? 10;
    ortho.left = -half * w / h; ortho.right = half * w / h; ortho.top = half; ortho.bottom = -half; ortho.updateProjectionMatrix();
    invalidate();
  };
  const viewDir = (name: ViewName) => (name === 'top' ? new THREE.Vector3(0, 0, 1) : name === 'front' ? new THREE.Vector3(0, -1, 0) : name === 'right' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(1, -1.4, 0.9).normalize());
  /**
   * Zoom so that everything drawn fits the view. The eight corners of the bounding box are tested
   * against the view pyramid, which fits long, flat models (a beam, a bridge) much more tightly than
   * a bounding sphere does. A margin is left for value labels.
   */
  const fit = () => {
    if (!builder) return;
    const box = builder.bounds();
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, -5, 0), new THREE.Vector3(5, 5, 5));
    const c = box.getCenter(new THREE.Vector3()), r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.5);
    const name = viewName(), dir = name === 'perspective' ? camera.position.clone().sub(controls.target).normalize() : viewDir(name);
    if (dir.lengthSq() < 1e-9) dir.copy(viewDir('perspective'));
    const right = new THREE.Vector3().crossVectors(name === 'top' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1), dir);
    if (right.lengthSq() < 1e-9) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight), aspect = w / h;
    const tanV = Math.tan((persp.fov * Math.PI / 180) / 2), tanH = tanV * aspect, rel = new THREE.Vector3();
    // Test the drawn points themselves; when there were too many to keep, add the corners of the bounding box.
    const pts = builder.cloud.slice();
    if (pts.length >= 90000 || !pts.length) for (let k = 0; k < 8; k++) pts.push(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z);
    let dist = 0, halfH = 0;
    // Two passes: the first finds the middle of what is seen from this direction, the second the distance.
    for (let pass = 0; pass < 2; pass++) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      dist = 0; halfH = 0;
      for (let i = 0; i < pts.length; i += 3) {
        rel.set(pts[i], pts[i + 1], pts[i + 2]).sub(c);
        const x = rel.dot(right), y = rel.dot(up), z = rel.dot(dir);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        dist = Math.max(dist, z + Math.max(Math.abs(x) / tanH, Math.abs(y) / tanV)); halfH = Math.max(halfH, Math.abs(y), Math.abs(x) / aspect);
      }
      if (pass === 0) c.addScaledVector(right, (x0 + x1) / 2).addScaledVector(up, (y0 + y1) / 2);
    }
    // Room for labels, the toolbar and the notes at the bottom: more in a short pane.
    const pad = 1.1 + Math.min(0.2, 70 / h);
    dist = Math.max(dist * pad, r * 0.4); halfH = Math.max(halfH * pad, r * 0.05);
    controls.target.copy(c);
    camera.position.copy(c).addScaledVector(dir, camera === persp ? dist : r * 4);
    ortho.userData.half = halfH; ortho.zoom = 1;
    persp.near = Math.max(dist - r * 2, dist / 500); persp.far = dist + r * 20; ortho.near = -r * 50; ortho.far = r * 50;
    resize(); controls.update(); invalidate();
    follow = true; fitted.copy(builder.bounds());
  };
  /** Whether the drawn extent has changed enough since the last fit to be worth fitting again (2 % of its size). */
  const outgrown = (): boolean => {
    if (!builder) return false;
    const b = builder.bounds();
    if (b.isEmpty() || fitted.isEmpty()) return !b.isEmpty();
    const tol = 0.02 * Math.max(fitted.getSize(new THREE.Vector3()).length(), 1e-9);
    return b.min.distanceTo(fitted.min) > tol || b.max.distanceTo(fitted.max) > tol;
  };
  const setView = (name: ViewName) => {
    setViewName(name); setTurned(false);
    const target = controls.target.clone(), d = camera.position.distanceTo(target) || 20;
    camera = name === 'perspective' ? persp : ortho;
    camera.up.set(0, name === 'top' ? 1 : 0, name === 'top' ? 0 : 1);
    camera.position.copy(target).addScaledVector(viewDir(name), d);
    controls.object = camera as any; controls.enableRotate = true;
    fit();
  };

  const rebuild = () => {
    if (!scene) return;
    const u = unitSystem(project.units), sel = new Set(selection()), proj = unwrap(project);
    const next = new SceneBuilder(u, ui.theme === 'dark');
    const plan = previewPlan();
    for (const n of project.graph.nodes) {
      const def = registry.get(n.type);
      const st = engine.status(n.id);
      if (!def || n.enabled === false || st.state === 'error') continue;
      const hi = sel.has(n.id);
      if (hi && def.noPreview && def.category !== 'Structure') continue;
      const outs = engine.outputs(n.id), ports = portsOf(n, proj).outputs;
      ports.forEach((p, i) => {
        if (!PREVIEW_TYPES.has(p.type) && p.type !== 'any') return;
        // Only the last stage of a structural chain is drawn (see preview.ts). Selecting one component draws it
        // anyway, highlighted; a larger selection (a box selection, a template just inserted) does not, because
        // that would put the model back on top of its results.
        if (!plan.draws(n.id, i) && !(hi && sel.size === 1 && n.preview !== false)) return;
        const t = outs[i]; if (!t) return;
        let count = 0;
        for (const b of t.branches) for (const item of b.items) { if (count++ > 20000) break; try { next.draw(item, hi && p.type !== 'result' && (item as any)?.k !== 'feview', undefined, n.id); } catch (e) { console.warn('Preview failed', e); } }
      });
    }
    if (builder) { scene.remove(builder.group); builder.dispose(); }
    builder = next; scene.add(next.group);
    labels = next.labels; setLegend(next.legend); setInfo(next.info.filter(Boolean));
    while (labelEls.length < labels.length) { const el = document.createElement('div'); labelLayer.appendChild(el); labelEls.push(el); }
    labelEls.forEach((el, i) => { const l = labels[i]; el.style.display = l ? '' : 'none'; if (l) { el.className = 'v-label ' + l.cls; el.textContent = l.text; el.style.fontSize = l.size ? `calc(${l.size}px * var(--ts))` : ''; } });
    // Sizes are read once here (after all the text is set) so that placing labels each frame needs no layout work.
    labelSize = labels.map((_, i) => ({ w: labelEls[i].offsetWidth, h: labelEls[i].offsetHeight }));
    labelOrder = labels.map((_, i) => i).sort((a, b) => labels[b].pri - labels[a].pri);
    applyDisplay();
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid = null; }
    if (ui.grid) {
      const size = Math.pow(10, Math.ceil(Math.log10(Math.max(next.size, 1)))) * 2;
      grid = new THREE.GridHelper(size, 20, ui.theme === 'dark' ? 0x3a4350 : 0xb9c0c9, ui.theme === 'dark' ? 0x252b33 : 0xdfe3e8);
      grid.rotation.x = Math.PI / 2;
      const b = next.bounds(); grid.position.set(0, 0, b.isEmpty() ? 0 : Math.min(0, b.min.z));
      (grid.material as THREE.Material).depthWrite = false;
      scene.add(grid);
    }
    scene.background = new THREE.Color(ui.theme === 'dark' ? 0x171b21 : 0xf3f4f6);
    if (firstFit && !next.bounds().isEmpty()) {
      firstFit = false;
      // A model that lies in the vertical X-Z plane (a beam, a plane truss or frame) opens in the front view,
      // where its loads and diagrams are seen square-on. Anything else opens in the 3D view.
      const b = next.coreBounds(), sz = b.isEmpty() ? new THREE.Vector3() : b.getSize(new THREE.Vector3()), flat = Math.max(sz.x, sz.z) > 0 && sz.y < 1e-6 * Math.max(sz.x, sz.z);
      const want: ViewName = flat ? 'front' : 'perspective';
      if (want !== viewName() || want === 'perspective') setView(want); else fit();
    } else if (follow && outgrown()) fit();
    invalidate();
  };
  const applyDisplay = () => {
    if (!builder) return;
    builder.group.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!m || !o.userData.shaded) return;
      m.wireframe = ui.display === 'wireframe';
      if (ui.display === 'ghosted') { m.transparent = true; m.opacity = 0.3; m.depthWrite = false; } else if (m.userData.baseOpacity !== undefined || ui.display === 'shaded') { m.opacity = m.userData.baseOpacity ?? m.opacity; m.depthWrite = true; }
      m.userData.baseOpacity ??= m.opacity; m.needsUpdate = true;
    });
    if (ui.sectionOn) {
      const b = builder.bounds(), axis = ui.sectionAxis, lo = b.min[axis], hi = b.max[axis];
      clipPlane.normal.set(axis === 'x' ? -1 : 0, axis === 'y' ? -1 : 0, axis === 'z' ? -1 : 0);
      clipPlane.constant = lo + (hi - lo) * ui.sectionPos;
      renderer.clippingPlanes = [clipPlane];
    } else renderer.clippingPlanes = [];
    invalidate();
  };

  onMount(() => {
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); }
    catch { setFailed('This browser could not start WebGL, so the 3D view is unavailable. The node canvas and the analyses still work.'); return; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    host.prepend(renderer.domElement);
    scene = new THREE.Scene();
    persp = new THREE.PerspectiveCamera(40, 1, 0.05, 5000); persp.up.set(0, 0, 1); persp.position.set(14, -18, 11);
    ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, -1000, 1000); ortho.up.set(0, 0, 1);
    camera = persp;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa0a8, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(6, -9, 14); scene.add(sun);
    controls = new OrbitControls(persp, renderer.domElement);
    controls.enableDamping = false; controls.screenSpacePanning = true; controls.zoomToCursor = true;
    controls.addEventListener('change', invalidate);
    controls.addEventListener('start', () => { follow = false; });
    controls.addEventListener('end', () => { if (viewName() !== 'perspective') setTurned(camera.position.clone().sub(controls.target).normalize().dot(viewDir(viewName())) < 0.9998); });
    const ro = new ResizeObserver(resize); ro.observe(host);
    const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
    /**
     * Put each label next to its point, pushed outward along its own direction (away from the member for a
     * diagram value, behind the tail of an arrow for a load). Labels are kept inside the view, and where two
     * would overlap only the more important one is shown.
     */
    const placeLabels = () => {
      const w = host.clientWidth, h = host.clientHeight, step = (builder?.size ?? 1) * 0.01, placed: number[][] = [];
      for (const i of labelOrder) {
        const l = labels[i], el = labelEls[i], sz = labelSize[i];
        if (!l || !el) continue;
        tmp.copy(l.p).project(camera);
        let vis = tmp.z < 1 && tmp.z > -1 && Math.abs(tmp.x) < 1.02 && Math.abs(tmp.y) < 1.02;
        if (vis) {
          const px = (tmp.x + 1) / 2 * w, py = (1 - tmp.y) / 2 * h;
          let dx = 0, dy = -1;
          if (l.off) { tmp2.copy(l.p).addScaledVector(l.off, step).project(camera); const ex = (tmp2.x - tmp.x) * w / 2, ey = -(tmp2.y - tmp.y) * h / 2, n = Math.hypot(ex, ey); if (n > 0.05) { dx = ex / n; dy = ey / n; } }
          const cx = Math.min(Math.max(px + dx * (sz.w / 2 + 5), sz.w / 2 + 3), w - sz.w / 2 - 3), cy = Math.min(Math.max(py + dy * (sz.h / 2 + 5), sz.h / 2 + 3), h - sz.h / 2 - 3);
          const r = [cx - sz.w / 2 - 2, cy - sz.h / 2 - 1, cx + sz.w / 2 + 2, cy + sz.h / 2 + 1];
          if (placed.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) vis = false;
          else { placed.push(r); el.style.transform = `translate(${(cx - sz.w / 2).toFixed(1)}px, ${(cy - sz.h / 2).toFixed(1)}px)`; }
        }
        el.style.visibility = vis ? '' : 'hidden';
      }
    };
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (builder?.animated) { builder.setFactor(Math.sin(t / 380)); needsRender = true; }
      if (!needsRender) return;
      needsRender = false;
      renderer.render(scene, camera);
      placeLabels();
    };
    raf = requestAnimationFrame(loop);
    // Picking: a click without a drag selects the structural node / element under the cursor.
    let down = { x: 0, y: 0 };
    renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener('pointerup', e => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || !builder) return;
      const r = renderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      ray.params.Line = { threshold: builder.size * 0.006 }; ray.params.Points = { threshold: builder.size * 0.008 };
      (ray.params as any).Line2 = { threshold: 7 };       // thick member lines: distance in screen pixels
      const hits = ray.intersectObjects(builder.pickables, false);
      // Prefer nodes, then line elements, then shells when several are close to the cursor.
      const rank = (h: THREE.Intersection) => (h.object.userData.pick.kind === 'node' ? 0 : h.object.userData.pick.kind === 'beam' ? 1 : 2);
      const hit = hits.sort((a, b) => rank(a) - rank(b) || a.distance - b.distance)[0];
      if (!hit) { setUi('pick', null); return; }
      const pk = hit.object.userData.pick;
      const index = pk.kind === 'node' ? hit.index ?? 0 : pk.kind === 'beam' ? pk.ids[(hit.object as any).isLineSegments2 ? hit.faceIndex ?? 0 : Math.floor((hit.index ?? 0) / 2)] : pk.tri[hit.faceIndex ?? 0];
      setUi('pick', { kind: pk.kind, index, nodeId: pk.nodeId }); setUi('inspector', true);
    });
    viewportApi.png = () => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); };
    viewportApi.fit = () => fit();
    viewportApi.svg = () => {
      // Vector export of every line object, projected with the current camera.
      const w = host.clientWidth, h = host.clientHeight, parts: string[] = [], p = new THREE.Vector3();
      const X = (q: THREE.Vector3) => ((q.x + 1) / 2 * w).toFixed(1), Y = (q: THREE.Vector3) => ((1 - q.y) / 2 * h).toFixed(1), a = new THREE.Vector3(), b = new THREE.Vector3();
      builder?.group.traverse(o => {
        const any = o as any, mat = any.material as any;
        if (o instanceof THREE.LineSegments || any.isLineSegments2) {
          // Thin lines keep their points in "position"; thick lines keep start and end points of each segment side by side.
          const thick = !!any.isLineSegments2, pos = thick ? null : (o as THREE.LineSegments).geometry.getAttribute('position'), arr = thick ? (any.geometry.getAttribute('instanceStart').data.array as Float32Array) : null, count = thick ? arr!.length / 6 : pos!.count / 2;
          const cols = thick && mat.vertexColors ? (any.geometry.getAttribute('instanceColorStart')?.data.array as Float32Array | undefined) : undefined;
          const paths = new Map<string, string>();
          for (let i = 0; i < count; i++) {
            if (thick) { a.set(arr![6 * i], arr![6 * i + 1], arr![6 * i + 2]); b.set(arr![6 * i + 3], arr![6 * i + 4], arr![6 * i + 5]); } else { a.fromBufferAttribute(pos!, 2 * i); b.fromBufferAttribute(pos!, 2 * i + 1); }
            a.project(camera); b.project(camera);
            if (Math.abs(a.z) > 1 || Math.abs(b.z) > 1) continue;
            const color = cols ? '#' + new THREE.Color(cols[6 * i], cols[6 * i + 1], cols[6 * i + 2]).getHexString() : '#' + (mat.color?.getHexString?.() ?? '333333');
            paths.set(color, (paths.get(color) ?? '') + `M${X(a)},${Y(a)}L${X(b)},${Y(b)}`);
          }
          for (const [color, d] of paths) parts.push(`<path d="${d}" stroke="${color}" fill="none" stroke-width="${thick ? mat.linewidth : 1}" stroke-linecap="round" opacity="${mat.opacity ?? 1}"/>`);
        } else if (o instanceof THREE.Mesh && mat instanceof THREE.MeshBasicMaterial && !o.geometry.index) {
          // Filled force diagrams.
          const pos = o.geometry.getAttribute('position'); let d = '';
          for (let i = 0; i + 2 < pos.count; i += 3) { const q = [0, 1, 2].map(k => p.fromBufferAttribute(pos, i + k).project(camera).clone()); if (q.some(t => Math.abs(t.z) > 1)) continue; d += `M${X(q[0])},${Y(q[0])}L${X(q[1])},${Y(q[1])}L${X(q[2])},${Y(q[2])}Z`; }
          if (d) parts.push(`<path d="${d}" fill="#${mat.color.getHexString()}" fill-opacity="${mat.opacity}" stroke="none"/>`);
        }
      });
      // Labels go where they are on screen (after the overlap rule), so the drawing matches the view.
      const hr = host.getBoundingClientRect();
      labels.forEach((l, i) => { const el = labelEls[i]; if (!el || el.style.visibility === 'hidden' || el.style.display === 'none') return; const r = el.getBoundingClientRect(); parts.push(`<text x="${(r.left - hr.left + r.width / 2).toFixed(1)}" y="${(r.top - hr.top + r.height * 0.75).toFixed(1)}" font-family="sans-serif" font-size="11" text-anchor="middle"${l.cls.includes('strong') ? ' font-weight="bold"' : ''}>${l.text.replace(/[<&>]/g, '')}</text>`); });
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="white"/>${parts.join('')}</svg>`;
    };
    onCleanup(() => { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); });
    resize(); rebuild();
  });
  // A newly opened project is fitted to the view once its first results are drawn.
  createEffect(() => { openTick(); firstFit = true; });
  createEffect(() => { runTick(); selection(); void ui.theme; void ui.textScale; void ui.grid; void project.units; void project.graph.nodes.length; project.graph.nodes.forEach(n => { void n.preview; void n.enabled; }); rebuild(); });
  createEffect(() => { void ui.display; void ui.sectionOn; void ui.sectionAxis; void ui.sectionPos; if (renderer) applyDisplay(); });

  const Btn = (p: { label: string; title: string; on?: boolean; onClick: () => void }) => <button classList={{ on: !!p.on }} title={p.title} aria-label={p.title} aria-pressed={p.on} onClick={p.onClick}>{p.label}</button>;
  return (
    <div class="viewport" ref={host}>
      <div class="v-labels" ref={labelLayer} />
      <Show when={failed()}><div class="empty-state">{failed()}</div></Show>
      <div class="v-bars">
        <div class="v-toolbar" role="toolbar" aria-label="3D view">
          <div class="seg"><For each={['perspective', 'top', 'front', 'right'] as ViewName[]}>{n => <Btn label={n === 'perspective' ? '3D' : n[0].toUpperCase() + n.slice(1)} title={`${n[0].toUpperCase() + n.slice(1)} view`} on={viewName() === n && !turned()} onClick={() => setView(n)} />}</For></div>
          <Btn label="Fit" title="Zoom to fit. The view then follows the model as it changes, until you move the view yourself." onClick={() => fit()} />
          <select value={ui.display} title="How surfaces and solids are drawn" aria-label="Display mode" onChange={e => setUi('display', e.currentTarget.value as 'shaded')}><option value="shaded">Shaded</option><option value="wireframe">Wireframe</option><option value="ghosted">Ghosted</option></select>
          <Btn label="Grid" title="Show or hide the ground grid" on={ui.grid} onClick={() => setUi('grid', !ui.grid)} />
          <Btn label="Section" title="Cut the view with a section plane" on={ui.sectionOn} onClick={() => setUi('sectionOn', !ui.sectionOn)} />
          <Show when={ui.sectionOn}><select value={ui.sectionAxis} onChange={e => setUi('sectionAxis', e.currentTarget.value as 'x')} aria-label="Section axis"><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select>
            <input type="range" min="0" max="1" step="0.005" value={ui.sectionPos} onInput={e => setUi('sectionPos', Number(e.currentTarget.value))} aria-label="Section position" /></Show>
          <select title="Save the view as an image" aria-label="Save image" onChange={e => { const kind = e.currentTarget.value; e.currentTarget.value = ''; if (kind === 'png') { const url = viewportApi.png?.(); if (url) { const a = document.createElement('a'); a.href = url; a.download = 'nodal-view.png'; a.click(); } else toast('The 3D view is not available.'); } else if (kind === 'svg') { const svg = viewportApi.svg?.(); if (svg) download('nodal-view.svg', svg, 'image/svg+xml'); } }}>
            <option value="">Save image…</option><option value="png">PNG picture</option><option value="svg">SVG drawing (lines and values)</option></select>
        </div>
        <ResultBar />
      </div>
      <Show when={info().length}><div class="v-info"><For each={info()}>{l => <div>{l}</div>}</For></div></Show>
      <Show when={legend()}>{lg => <div class="v-legend" aria-label="Legend"><b>{lg().title}</b>
        <div class="ramp" style={{ background: `linear-gradient(to top, ${[0, 0.25, 0.5, 0.75, 1].map(rampColor).join(', ')})` }} />
        <div class="ticks"><For each={[1, 0.75, 0.5, 0.25, 0]}>{t => <span>{fmtNum(lg().min + (lg().max - lg().min) * t, 4)} {lg().unit}</span>}</For></div></div>}</Show>
      <div class="v-axes" aria-hidden="true"><span style={{ color: '#d1495b' }}>X</span> <span style={{ color: '#3fae6b' }}>Y</span> <span style={{ color: '#2f6fd6' }}>Z up</span> · {unitSystem(project.units).len.label}</div>
    </div>
  );
}

const DIAGRAMS: [string, string][] = [['none', 'No diagram'], ['N', 'Axial force N'], ['Vz', 'Shear Vz'], ['My', 'Moment My'], ['Vy', 'Shear Vy'], ['Mz', 'Moment Mz'], ['T', 'Torsion T']];
/**
 * Quick result controls in the 3D view. They change the settings of a Result View component (the
 * selected one, or the first one that is shown), so the same choices are also in its inspector.
 * When a result is on screen without a Result View, one button adds and wires it.
 */
function ResultBar(): JSX.Element {
  const views = createMemo(() => project.graph.nodes.filter(n => n.type === 'fe.view' && n.enabled !== false));
  const active = createMemo<NodeData | null>(() => { const sel = selection(); return views().find(n => sel.includes(n.id)) ?? views().find(n => n.preview !== false) ?? null; });
  const res = createMemo(() => { runTick(); const n = active(); return n ? firstResult(n.id) : null; });
  /** An analysis component whose result is not wired to any Result View yet. */
  const loose = createMemo(() => { runTick(); if (views().length) return null; const proj = unwrap(project); for (const n of project.graph.nodes) { if (n.enabled === false || !registry.get(n.type)) continue; const out = portsOf(n, proj).outputs.findIndex(p => p.type === 'result'); if (out >= 0 && firstResult(n.id)) return { n, out }; } return null; });
  const set = (k: string, val: unknown) => { const id = active()?.id; if (id) mutate(p => { const x = p.graph.nodes.find(q => q.id === id); if (x) x.state[k] = val; }); };
  const Tog = (p: { k: string; label: string; title: string }) => <button classList={{ on: !!active()?.state[p.k] }} aria-pressed={!!active()?.state[p.k]} title={p.title} onClick={() => set(p.k, !active()?.state[p.k])}>{p.label}</button>;
  const addView = () => { const l = loose(); if (!l) return; const w = layouts().get(l.n.id)?.w ?? 150; const id = addNode('fe.view', l.n.x + w + 60, l.n.y); connect(l.n.id, l.out, id, 0); setSelection([id]); };
  return <>
    <Show when={!active() && loose()}><div class="v-toolbar v-results"><button class="hint" title="Adds a Result View component and connects it to the analysis" onClick={addView}>Show diagrams and result options…</button></div></Show>
    <Show when={active() && res()}>{r => <div class="v-toolbar v-results" role="toolbar" aria-label="Results">
      <Show when={views().length > 1}><select value={active()!.id} title="Which Result View these controls change" aria-label="Result view" onChange={e => setSelection([e.currentTarget.value])}><For each={views()}>{n => <option value={n.id}>{n.label ?? 'Result View'}</option>}</For></select></Show>
      <Show when={r().modes.length} fallback={<Show when={r().cases.length > 1}><select value={active()!.state.caseIndex} title="Load case or combination" aria-label="Load case" onChange={e => set('caseIndex', Number(e.currentTarget.value))}><For each={r().cases}>{(c, i) => <option value={i()}>{c.name}</option>}</For></select></Show>}>
        <select value={active()!.state.mode} title="Mode shape" aria-label="Mode" onChange={e => set('mode', Number(e.currentTarget.value))}><For each={r().modes}>{(m, i) => <option value={i()}>{m.label}</option>}</For></select></Show>
      <Show when={r().model.beams.length && !r().modes.length}><select value={active()!.state.diagram} title="Member force diagram" aria-label="Member diagram" onChange={e => set('diagram', e.currentTarget.value)}><For each={DIAGRAMS}>{([k, name]) => <option value={k}>{name}</option>}</For></select></Show>
      <Show when={r().model.shells.length}><select value={active()!.state.contour} title="Shell contour" aria-label="Shell contour" onChange={e => set('contour', e.currentTarget.value)}><option value="none">No contour</option><For each={Object.entries(CONTOUR_NAMES)}>{([k, name]) => <option value={k}>{name}</option>}</For></select></Show>
      <div class="seg"><Tog k="deformed" label="Deformed" title="Draw the deflected shape" /><Tog k="loads" label="Loads" title="Draw the loads of this case" /><Tog k="reactions" label="Reactions" title="Draw the support reactions" /><Tog k="values" label="Values" title="Write values next to diagrams, loads and reactions" /><Show when={r().model.beams.length}><Tog k="sections" label="Sections" title="Draw the cross-section shapes" /></Show><Tog k="animate" label="Animate" title="Animate the deformation" /></div>
    </div>}</Show>
  </>;
}
