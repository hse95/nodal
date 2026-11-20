/**
 * 3D viewport: WebGL2 rendering with Three.js, orbit navigation, standard
 * views, display modes, a section plane, labels, legend, picking and image
 * export. The scene is rebuilt after every graph solve; rendering happens on
 * demand (and continuously only while a mode shape or deformation animates).
 */
import { createEffect, createSignal, For, onCleanup, onMount, Show, JSX } from 'solid-js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { project, selection, runTick, engine, ui, setUi, registry, portsOf, unwrap, download, toast } from './store';
import { SceneBuilder, Label, Legend } from './scene';
import { unitSystem } from '../fe/units';
import { fmtNum } from '../core/graph';
import { rampColor } from '../components/geometry';

const PREVIEW_TYPES = new Set(['point', 'curve', 'surface', 'mesh', 'brep', 'geometry', 'model', 'result', 'element', 'support', 'load', 'plane']);
type ViewName = 'perspective' | 'top' | 'front' | 'right';
/** Handle used by export commands elsewhere in the app. */
export const viewportApi: { png?: () => string; svg?: () => string; fit?: () => void } = {};

export function Viewport(): JSX.Element {
  let host!: HTMLDivElement, labelLayer!: HTMLDivElement;
  const [legend, setLegend] = createSignal<Legend | null>(null);
  const [info, setInfo] = createSignal<string[]>([]);
  const [viewName, setViewName] = createSignal<ViewName>('perspective');
  const [failed, setFailed] = createSignal('');
  let renderer: THREE.WebGLRenderer, scene: THREE.Scene, persp: THREE.PerspectiveCamera, ortho: THREE.OrthographicCamera, camera: THREE.Camera, controls: OrbitControls;
  let builder: SceneBuilder | null = null, grid: THREE.GridHelper | null = null, labels: Label[] = [], labelEls: HTMLDivElement[] = [];
  let needsRender = true, raf = 0, firstFit = true;
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
  const fit = (animate = false) => {
    void animate;
    if (!builder) return;
    const box = builder.bounds();
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, -5, 0), new THREE.Vector3(5, 5, 5));
    const c = box.getCenter(new THREE.Vector3()), r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.5);
    const dir = viewName() === 'top' ? new THREE.Vector3(0, 0, 1) : viewName() === 'front' ? new THREE.Vector3(0, -1, 0) : viewName() === 'right' ? new THREE.Vector3(1, 0, 0) : camera.position.clone().sub(controls.target).normalize();
    if (dir.lengthSq() < 1e-9) dir.set(1, -1.4, 0.9).normalize();
    controls.target.copy(c);
    // The bounding sphere must fit the narrower of the vertical and horizontal fields of view.
    const vHalf = (persp.fov * Math.PI / 180) / 2, hHalf = Math.atan(Math.tan(vHalf) * Math.max(0.2, host.clientWidth / Math.max(1, host.clientHeight)));
    const dist = r / Math.sin(Math.min(vHalf, hHalf)) * 1.02;
    camera.position.copy(c).addScaledVector(dir, camera === persp ? dist : r * 4);
    ortho.userData.half = r * 1.15 / Math.min(1, host.clientWidth / Math.max(1, host.clientHeight)); ortho.zoom = 1;
    persp.near = dist / 500; persp.far = dist * 50; ortho.near = -r * 50; ortho.far = r * 50;
    resize(); controls.update(); invalidate();
  };
  const setView = (name: ViewName) => {
    setViewName(name);
    const target = controls.target.clone(), d = camera.position.distanceTo(target) || 20;
    camera = name === 'perspective' ? persp : ortho;
    camera.up.set(0, name === 'top' ? 1 : 0, name === 'top' ? 0 : 1);
    const dir = name === 'top' ? new THREE.Vector3(0, 0, 1) : name === 'front' ? new THREE.Vector3(0, -1, 0) : name === 'right' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(1, -1.4, 0.9).normalize();
    camera.position.copy(target).addScaledVector(dir, d);
    controls.object = camera as any; controls.enableRotate = true;
    fit();
  };

  const rebuild = () => {
    if (!scene) return;
    const u = unitSystem(project.units), sel = new Set(selection()), proj = unwrap(project);
    const next = new SceneBuilder(u, ui.theme === 'dark');
    for (const n of project.graph.nodes) {
      const def = registry.get(n.type);
      const st = engine.status(n.id);
      if (!def || n.enabled === false || st.state === 'error') continue;
      const hi = sel.has(n.id);
      if (!hi && (n.preview === false || (def.noPreview && n.preview !== true))) continue;
      if (hi && def.noPreview && def.category !== 'Structure') continue;
      const outs = engine.outputs(n.id), ports = portsOf(n, proj).outputs;
      // A node whose result already feeds a Result View should not draw the raw result underneath it.
      ports.forEach((p, i) => {
        if (!PREVIEW_TYPES.has(p.type) && p.type !== 'any') return;
        if ((p.type === 'result' || p.type === 'model') && !hi && project.graph.wires.some(w => w.from === n.id && w.out === i && ['fe.view', 'fe.static', 'fe.second', 'fe.buckling', 'fe.modal', 'fe.nonlinear', 'fe.sizing'].includes(project.graph.nodes.find(x => x.id === w.to)?.type ?? ''))) return;
        const t = outs[i]; if (!t) return;
        let count = 0;
        for (const b of t.branches) for (const item of b.items) { if (count++ > 20000) break; try { next.draw(item, hi && p.type !== 'result' && (item as any)?.k !== 'feview', undefined, n.id); } catch (e) { console.warn('Preview failed', e); } }
      });
    }
    if (builder) { scene.remove(builder.group); builder.dispose(); }
    builder = next; scene.add(next.group);
    labels = next.labels; setLegend(next.legend); setInfo(next.info.filter(Boolean));
    while (labelEls.length < labels.length) { const el = document.createElement('div'); labelLayer.appendChild(el); labelEls.push(el); }
    labelEls.forEach((el, i) => { const l = labels[i]; el.style.display = l ? '' : 'none'; if (l) { el.className = 'v-label ' + l.cls; el.textContent = l.text; el.style.fontSize = l.size ? l.size + 'px' : ''; } });
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
    if (firstFit && !next.bounds().isEmpty()) { firstFit = false; fit(); }
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
    const ro = new ResizeObserver(resize); ro.observe(host);
    const tmp = new THREE.Vector3();
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (builder?.animated) { builder.setFactor(Math.sin(t / 380)); needsRender = true; }
      if (!needsRender) return;
      needsRender = false;
      renderer.render(scene, camera);
      const w = host.clientWidth, h = host.clientHeight;
      for (let i = 0; i < labels.length; i++) {
        tmp.copy(labels[i].p).project(camera);
        const el = labelEls[i], vis = tmp.z < 1 && tmp.z > -1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05;
        el.style.display = vis ? '' : 'none';
        if (vis) el.style.transform = `translate(${((tmp.x + 1) / 2 * w).toFixed(1)}px, ${((1 - tmp.y) / 2 * h).toFixed(1)}px) translate(-50%, -120%)`;
      }
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
      const hits = ray.intersectObjects(builder.pickables, false);
      // Prefer nodes, then line elements, then shells when several are close to the cursor.
      const rank = (h: THREE.Intersection) => (h.object.userData.pick.kind === 'node' ? 0 : h.object.userData.pick.kind === 'beam' ? 1 : 2);
      const hit = hits.sort((a, b) => rank(a) - rank(b) || a.distance - b.distance)[0];
      if (!hit) { setUi('pick', null); return; }
      const pk = hit.object.userData.pick;
      const index = pk.kind === 'node' ? hit.index ?? 0 : pk.kind === 'beam' ? pk.ids[Math.floor((hit.index ?? 0) / 2)] : pk.tri[hit.faceIndex ?? 0];
      setUi('pick', { kind: pk.kind, index, nodeId: pk.nodeId }); setUi('inspector', true);
    });
    viewportApi.png = () => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); };
    viewportApi.fit = () => fit();
    viewportApi.svg = () => {
      // Vector export of every line object, projected with the current camera.
      const w = host.clientWidth, h = host.clientHeight, parts: string[] = [], p = new THREE.Vector3();
      builder?.group.traverse(o => {
        if (!(o instanceof THREE.LineSegments)) return;
        const pos = o.geometry.getAttribute('position'), color = '#' + ((o.material as THREE.LineBasicMaterial).color?.getHexString?.() ?? '333333');
        let d = '';
        for (let i = 0; i + 1 < pos.count; i += 2) { const a = p.fromBufferAttribute(pos, i).project(camera).clone(), b = p.fromBufferAttribute(pos, i + 1).project(camera).clone(); if (Math.abs(a.z) > 1 || Math.abs(b.z) > 1) continue; d += `M${((a.x + 1) / 2 * w).toFixed(1)},${((1 - a.y) / 2 * h).toFixed(1)}L${((b.x + 1) / 2 * w).toFixed(1)},${((1 - b.y) / 2 * h).toFixed(1)}`; }
        if (d) parts.push(`<path d="${d}" stroke="${color}" fill="none" stroke-width="1"/>`);
      });
      for (const l of labels) { p.copy(l.p).project(camera); if (Math.abs(p.z) < 1) parts.push(`<text x="${((p.x + 1) / 2 * w).toFixed(1)}" y="${((1 - p.y) / 2 * h).toFixed(1)}" font-family="sans-serif" font-size="11" text-anchor="middle">${l.text.replace(/[<&>]/g, '')}</text>`); }
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="white"/>${parts.join('')}</svg>`;
    };
    const onFit = () => { firstFit = true; };
    window.addEventListener('nodal:fit', onFit);
    onCleanup(() => { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); window.removeEventListener('nodal:fit', onFit); });
    resize(); rebuild();
  });
  createEffect(() => { runTick(); selection(); void ui.theme; void ui.grid; void project.units; void project.graph.nodes.length; project.graph.nodes.forEach(n => { void n.preview; void n.enabled; }); rebuild(); });
  createEffect(() => { void ui.display; void ui.sectionOn; void ui.sectionAxis; void ui.sectionPos; if (renderer) applyDisplay(); });

  const Btn = (p: { label: string; title: string; on?: boolean; onClick: () => void }) => <button classList={{ on: !!p.on }} title={p.title} aria-label={p.title} aria-pressed={p.on} onClick={p.onClick}>{p.label}</button>;
  return (
    <div class="viewport" ref={host}>
      <div class="v-labels" ref={labelLayer} />
      <Show when={failed()}><div class="empty-state">{failed()}</div></Show>
      <div class="v-toolbar" role="toolbar" aria-label="3D view">
        <div class="seg"><For each={['perspective', 'top', 'front', 'right'] as ViewName[]}>{n => <Btn label={n === 'perspective' ? '3D' : n[0].toUpperCase() + n.slice(1)} title={`${n[0].toUpperCase() + n.slice(1)} view`} on={viewName() === n} onClick={() => setView(n)} />}</For></div>
        <Btn label="Fit" title="Zoom to fit" onClick={() => fit()} />
        <div class="seg"><For each={['shaded', 'wireframe', 'ghosted'] as const}>{d => <Btn label={d[0].toUpperCase() + d.slice(1)} title={`${d} display`} on={ui.display === d} onClick={() => setUi('display', d)} />}</For></div>
        <Btn label="Grid" title="Show or hide the ground grid" on={ui.grid} onClick={() => setUi('grid', !ui.grid)} />
        <Btn label="Section" title="Cut the view with a section plane" on={ui.sectionOn} onClick={() => setUi('sectionOn', !ui.sectionOn)} />
        <Show when={ui.sectionOn}><select value={ui.sectionAxis} onChange={e => setUi('sectionAxis', e.currentTarget.value as 'x')} aria-label="Section axis"><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select>
          <input type="range" min="0" max="1" step="0.005" value={ui.sectionPos} onInput={e => setUi('sectionPos', Number(e.currentTarget.value))} aria-label="Section position" /></Show>
        <Btn label="PNG" title="Save the view as an image" onClick={() => { const url = viewportApi.png?.(); if (url) { const a = document.createElement('a'); a.href = url; a.download = 'nodal-view.png'; a.click(); } else toast('The 3D view is not available.'); }} />
        <Btn label="SVG" title="Save the view as vector lines" onClick={() => { const s = viewportApi.svg?.(); if (s) download('nodal-view.svg', s, 'image/svg+xml'); }} />
      </div>
      <Show when={info().length}><div class="v-info"><For each={info()}>{l => <div>{l}</div>}</For></div></Show>
      <Show when={legend()}>{lg => <div class="v-legend" aria-label="Legend"><b>{lg().title}</b>
        <div class="ramp" style={{ background: `linear-gradient(to top, ${[0, 0.25, 0.5, 0.75, 1].map(rampColor).join(', ')})` }} />
        <div class="ticks"><For each={[1, 0.75, 0.5, 0.25, 0]}>{t => <span>{fmtNum(lg().min + (lg().max - lg().min) * t, 4)} {lg().unit}</span>}</For></div></div>}</Show>
      <div class="v-axes" aria-hidden="true"><span style={{ color: '#d1495b' }}>X</span> <span style={{ color: '#3fae6b' }}>Y</span> <span style={{ color: '#2f6fd6' }}>Z up</span> · {unitSystem(project.units).len.label}</div>
    </div>
  );
}
