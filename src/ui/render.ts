/**
 * Two ways out of the live 3D view, both loaded only when used:
 *  - a path-traced still picture of what is shown, for papers and slides;
 *  - a binary glTF (.glb) of the solids that are shown, for Blender, Unreal and other renderers.
 */
import * as THREE from 'three';

/**
 * A geometry in the one layout every solid here uses: unindexed triangles with position, normal, a blank
 * texture coordinate and an RGBA color. The path tracer merges all meshes into one buffer and needs the
 * layouts to match exactly; a mesh that differs (for instance a plain ground plane) breaks the merge.
 */
function plainGeometry(position: Float32Array, color?: Float32Array, normal?: Float32Array): THREE.BufferGeometry {
  const n = position.length / 3, g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  g.setAttribute('color', new THREE.BufferAttribute(color ?? new Float32Array(n * 4).fill(1), 4));
  if (normal) g.setAttribute('normal', new THREE.BufferAttribute(normal, 3)); else g.computeVertexNormals();
  return g;
}
/** The solids of the scene (members, supports, shells, geometry), without lines, overlays and helpers. */
export function solidsOf(root: THREE.Object3D): THREE.Group {
  const out = new THREE.Group();
  root.updateWorldMatrix(true, true);
  root.traverse(o => {
    const m = o as THREE.Mesh, mat = m.material as THREE.MeshStandardMaterial | undefined;
    if (!m.isMesh || (o as any).isLine2 || (o as any).isLineSegments2 || !mat || Array.isArray(mat)) return;
    if (!o.visible || o.userData.annotation || mat.depthTest === false || (mat as any).isShadowMaterial || (mat as any).isLineMaterial || (mat as any).isShaderMaterial) return;
    for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
    // Every solid is rebuilt with the same plain layout (unindexed position, normal, color), which the
    // path tracer and the glTF writer both handle without surprises.
    const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry, pos = src.getAttribute('position');
    if (!pos || pos.count < 3) return;
    const n = pos.count - (pos.count % 3), P = new Float32Array(n * 3), Cc = new Float32Array(n * 4).fill(1), col = mat.vertexColors ? src.getAttribute('color') : undefined, nor = mat.flatShading ? undefined : src.getAttribute('normal');
    for (let i = 0; i < n; i++) { P[3 * i] = pos.getX(i); P[3 * i + 1] = pos.getY(i); P[3 * i + 2] = pos.getZ(i); if (col) { Cc[4 * i] = col.getX(i); Cc[4 * i + 1] = col.getY(i); Cc[4 * i + 2] = col.getZ(i); } }
    if (P.some(x => !Number.isFinite(x))) return;
    let N: Float32Array | undefined;
    if (nor && nor.count >= n) { N = new Float32Array(n * 3); for (let i = 0; i < n; i++) { N[3 * i] = nor.getX(i); N[3 * i + 1] = nor.getY(i); N[3 * i + 2] = nor.getZ(i); } }
    const g = plainGeometry(P, Cc, N);
    const std = new THREE.MeshStandardMaterial({ color: (mat.color ?? new THREE.Color(0xffffff)).clone(), vertexColors: true, roughness: mat.roughness ?? 0.7, metalness: mat.metalness ?? 0, side: THREE.DoubleSide, transparent: !!mat.transparent && mat.opacity < 1, opacity: mat.opacity ?? 1 });
    const c = new THREE.Mesh(g, std);
    c.applyMatrix4(o.matrixWorld); c.name = o.name || (o.userData.solid ? 'members' : 'solid');
    out.add(c);
  });
  return out;
}

/** The solids shown in the 3D view as a binary glTF, turned so that Y is up as the format expects. */
export async function exportGLB(root: THREE.Object3D): Promise<ArrayBuffer> {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const solids = solidsOf(root);
  if (!solids.children.length) throw new Error('There are no solids in the 3D view to export. Use the Realistic display, or export the geometry from the File menu.');
  const holder = new THREE.Group(); holder.name = 'Nodal model'; holder.rotation.x = -Math.PI / 2; holder.add(solids);
  const scene = new THREE.Scene(); scene.add(holder);
  return new Promise((resolve, reject) => new GLTFExporter().parse(scene, r => resolve(r as ArrayBuffer), e => reject(e), { binary: true }));
}

export interface RenderJob { canvas: HTMLCanvasElement; samples: () => number; stop(): void; free(): void; done: Promise<void> }
/**
 * Path-trace the solids of the scene from the given camera into a new canvas. The picture refines
 * sample by sample; `onProgress` is called after each one.
 */
export async function pathTrace(o: { root: THREE.Object3D; camera: THREE.Camera; width: number; height: number; samples: number; dark: boolean; ground: boolean; sun: THREE.Vector3; onProgress(done: number, of: number): void }): Promise<RenderJob> {
  const { WebGLPathTracer, GradientEquirectTexture } = await import('three-gpu-pathtracer');
  const canvas = document.createElement('canvas'); canvas.width = o.width; canvas.height = o.height;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(o.width, o.height, false); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene(), solids = solidsOf(o.root);
  if (!solids.children.length) { renderer.dispose(); throw new Error('There are no solids in the 3D view to render. Switch the display to Realistic first.'); }
  scene.add(solids);
  const box = new THREE.Box3().setFromObject(solids), size = box.getSize(new THREE.Vector3()).length() || 1;
  const sky = new GradientEquirectTexture();
  sky.topColor.set(o.dark ? 0x3b4656 : 0xffffff); sky.bottomColor.set(o.dark ? 0x14181e : 0xe9edf2); sky.update();
  scene.environment = sky; scene.background = sky; (scene as any).environmentIntensity = o.dark ? 0.7 : 0.95;
  if (o.ground) {
    const h = size * 30, cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2, z = box.min.z - size * 0.002;
    const quad = new Float32Array([cx - h, cy - h, z, cx + h, cy - h, z, cx + h, cy + h, z, cx - h, cy - h, z, cx + h, cy + h, z, cx - h, cy + h, z]);
    scene.add(new THREE.Mesh(plainGeometry(quad), new THREE.MeshStandardMaterial({ color: o.dark ? 0x1b2027 : 0xeef0f3, vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide })));
  }
  const sun = new THREE.DirectionalLight(0xfff4e6, 2.6); sun.position.copy(box.getCenter(new THREE.Vector3())).addScaledVector(o.sun.clone().normalize(), size * 3); sun.target.position.copy(box.getCenter(new THREE.Vector3())); scene.add(sun, sun.target);
  const camera = o.camera.clone() as THREE.PerspectiveCamera | THREE.OrthographicCamera;
  if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) (camera as THREE.PerspectiveCamera).aspect = o.width / o.height;
  else { const c = camera as THREE.OrthographicCamera, half = (c.top - c.bottom) / 2; c.left = -half * o.width / o.height; c.right = half * o.width / o.height; }
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  // three's asynchronous shader compile polls a program that the path tracer may already have replaced, which
  // stalls the render for good on slow graphics. Compiling at once avoids that; it only delays the first sample.
  renderer.compileAsync = ((scene: THREE.Object3D, cam: THREE.Camera, target?: THREE.Scene | null) => { renderer.compile(scene, cam, target ?? undefined); return Promise.resolve(scene); }) as typeof renderer.compileAsync;
  const tracer = new WebGLPathTracer(renderer);
  tracer.bounces = 5; tracer.filterGlossyFactor = 0.5; tracer.renderScale = 1; tracer.tiles.set(2, 2); tracer.minSamples = 1; tracer.dynamicLowRes = false; tracer.fadeDuration = 0; tracer.renderDelay = 0;
  tracer.setScene(scene, camera);
  let running = true, finish!: () => void;
  const done = new Promise<void>(r => { finish = r; });
  const step = () => {
    if (!running) return;
    try { tracer.renderSample(); } catch { running = false; finish(); return; }     // the context was released, or the device cannot do this
    const n = Math.floor(tracer.samples);
    o.onProgress(Math.min(n, o.samples), o.samples);
    if (n >= o.samples) { running = false; finish(); return; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  // free() releases the graphics context; call it only when the picture is no longer shown.
  return { canvas, samples: () => Math.floor(tracer.samples), stop: () => { running = false; finish(); }, done, free: () => { running = false; finish(); try { renderer.dispose(); } catch { /* already gone */ } } };
}
