/**
 * Application state: the open project, selection, undo history, autosave and
 * the bridge to the graph engine. UI components read from here and change the
 * project only through `mutate`, which records undo steps and schedules a solve.
 */
import { createSignal } from 'solid-js';
import { createStore, produce, unwrap, reconcile } from 'solid-js/store';
import { Engine, emptyProject, makeNode, newId, portsOf, wouldCycle, registry } from '../core/graph';
import { SCHEMA_VERSION } from '../core/types';
import type { ClusterDef, GraphDoc, NodeData, ProjectFile, WireData } from '../core/types';
import '../components';

export const engine = new Engine();
export const [project, setProject] = createStore<ProjectFile>(emptyProject());
export const [selection, setSelection] = createSignal<string[]>([]);
export const [selectedWire, setSelectedWire] = createSignal<string | null>(null);
/** Increments after every engine run; read it to re-evaluate anything that depends on results. */
export const [runTick, setRunTick] = createSignal(0);
export const [solvingNode, setSolvingNode] = createSignal<string | null>(null);
export const [dirty, setDirty] = createSignal(false);
/** Increments whenever a project is opened (the views use it to zoom to fit once). */
export const [openTick, setOpenTick] = createSignal(0);
export interface Pick { kind: 'node' | 'beam' | 'shell'; index: number; nodeId: string }
/** Available text sizes (View > Text size). */
export const TEXT_SCALES: [number, string][] = [[0.9, 'Small'], [1, 'Normal'], [1.15, 'Large'], [1.3, 'Larger'], [1.5, 'Largest']];
function readTextScale(): number { const x = Number(localStorage.getItem('nodal.textScale')); return TEXT_SCALES.some(t => t[0] === x) ? x : 1; }
export const [ui, setUi] = createStore({
  theme: (localStorage.getItem('nodal.theme') as 'light' | 'dark') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  layout: 'split' as 'split' | 'canvas' | 'view' | 'stack', swap: false, split: 0.56,
  panX: 60, panY: 60, zoom: 1,
  /** Text size chosen in the View menu: scales the interface text and the base size of canvas components. */
  textScale: readTextScale(),
  /** The ribbon (components, templates, examples) is open, and which of its tabs is shown. */
  ribbon: localStorage.getItem('nodal.ribbon') !== '0', ribbonTab: 'Structure',
  /** The panel on the right: the inspector, the optional AI assistant, or hidden (a slim rail remains). */
  side: (['inspector', 'assistant', 'hidden'].includes(localStorage.getItem('nodal.side') ?? '') ? localStorage.getItem('nodal.side') : 'inspector') as 'inspector' | 'assistant' | 'hidden',
  sideWidth: Math.min(640, Math.max(240, Number(localStorage.getItem('nodal.sideWidth')) || 0)) || 0,
  /** Shadows on the ground in the realistic display. */
  shadows: localStorage.getItem('nodal.shadows') !== '0',
  /** Soft contact shading where surfaces meet (ambient occlusion). 'auto' = on unless the graphics are drawn in software. */
  ao: (localStorage.getItem('nodal.ao') ?? 'auto') as 'auto' | '1' | '0',
  dialog: null as null | 'examples' | 'verification' | 'about' | 'shortcuts' | 'help' | 'render' | 'teach' | 'share' | 'grasshopper',
  toast: '', tour: -1,
  pick: null as Pick | null,
  /** How the 3D view draws: realistic solids with shadows, simple lines, wireframe, or see-through. */
  display: 'shaded' as 'shaded' | 'lines' | 'wireframe' | 'ghosted',
  /** Keep the 3D view fitted to the model whenever the model changes. */
  autoFit: localStorage.getItem('nodal.autoFit') !== '0',
  sectionOn: false, sectionAxis: 'x' as 'x' | 'y' | 'z', sectionPos: 0.5, grid: true,
});
/**
 * Change the text size. Interface text follows the CSS variable --ts. Canvas components keep their
 * proportions and are enlarged through the canvas zoom, so wires and layouts stay intact.
 */
export function setTextScale(next: number): void {
  const ratio = next / ui.textScale;
  if (ratio === 1) return;
  setUi({ textScale: next, zoom: Math.min(2.5 * next, ui.zoom * ratio) });
  document.documentElement.style.setProperty('--ts', String(next));
  try { localStorage.setItem('nodal.textScale', String(next)); } catch { /* storage unavailable */ }
}
export function stepTextScale(dir: 1 | -1): void { const i = TEXT_SCALES.findIndex(t => t[0] === ui.textScale), j = Math.min(TEXT_SCALES.length - 1, Math.max(0, i + dir)); setTextScale(TEXT_SCALES[j][0]); }
export function toast(msg: string, ms = 3500): void { setUi('toast', msg); if (msg) setTimeout(() => { if (ui.toast === msg) setUi('toast', ''); }, ms); }

// ---- solving ------------------------------------------------------------------
let runQueued = false;
engine.onProgress = (id) => setSolvingNode(id);
engine.onUpdate = () => { setSolvingNode(null); setRunTick(t => t + 1); };
/** Run the graph on a snapshot of the project (coalesced to once per animation frame). */
export function scheduleRun(): void {
  if (runQueued) return;
  runQueued = true;
  requestAnimationFrame(() => {
    runQueued = false;
    void engine.run(JSON.parse(JSON.stringify(unwrap(project))));
  });
}
/** Resolves when the engine has finished everything that is currently queued. */
export async function settled(): Promise<void> {
  await new Promise<void>(r => requestAnimationFrame(() => r()));
  await new Promise<void>(r => requestAnimationFrame(() => r()));
  await engine.run(JSON.parse(JSON.stringify(unwrap(project))));
}

// ---- undo / redo -----------------------------------------------------------------
const undoStack: string[] = [], redoStack: string[] = [];
const snapshot = (): string => JSON.stringify(unwrap(project));
let groupDepth = 0, groupPushed = false;
export function pushUndo(): void {
  if (groupDepth > 0) { if (groupPushed) return; groupPushed = true; }
  undoStack.push(snapshot()); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0;
}
/** Between these two calls every change is folded into one undo step (used for one assistant turn). */
export function beginUndoGroup(): void { if (groupDepth++ === 0) groupPushed = false; }
export function endUndoGroup(): void { groupDepth = Math.max(0, groupDepth - 1); }
/** How many undo steps exist; with undoTo this lets a caller revert exactly what it did. */
export const undoDepth = (): number => undoStack.length;
export function undoTo(depth: number): void { while (undoStack.length > Math.max(0, depth)) undo(); }
/** Show the right-hand panel as the inspector or the assistant, or hide it. */
export function setSide(side: 'inspector' | 'assistant' | 'hidden'): void { setUi('side', side); try { localStorage.setItem('nodal.side', side); } catch { /* storage unavailable */ } }
/** Components the assistant has just added or changed (briefly highlighted on the canvas). */
export const [aiTouched, setAiTouched] = createSignal<ReadonlySet<string>>(new Set());
function restore(json: string): void { setProject(reconcile(JSON.parse(json))); setSelection(s => s.filter(id => project.graph.nodes.some(n => n.id === id))); afterChange(); }
export function undo(): void { const s = undoStack.pop(); if (!s) return; redoStack.push(snapshot()); restore(s); }
export function redo(): void { const s = redoStack.pop(); if (!s) return; undoStack.push(snapshot()); restore(s); }

let saveTimer = 0;
function afterChange(run = true): void {
  setDirty(true);
  if (run) scheduleRun();
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void autosave(), 700);
}
/** Change the project. By default the change is undoable and triggers a solve. */
export function mutate(fn: (p: ProjectFile) => void, opt: { undo?: boolean; run?: boolean } = {}): void {
  if (opt.undo !== false) pushUndo();
  setProject(produce(fn));
  afterChange(opt.run !== false);
}

// ---- persistence -----------------------------------------------------------------
/** Bring a loaded file up to the current schema. Add a step here whenever SCHEMA_VERSION is raised. */
export function migrate(raw: any): ProjectFile {
  if (!raw || raw.format !== 'nodal' || !raw.graph) throw new Error('This is not a Nodal project file.');
  if (typeof raw.schema !== 'number' || raw.schema > SCHEMA_VERSION) throw new Error(`This file was saved by a newer version of Nodal (schema ${raw.schema}). Please update the app.`);
  const p = raw as ProjectFile;
  p.graph.groups ??= []; p.clusters ??= {}; p.units ??= 'SI'; p.name ??= 'Untitled';
  for (const n of p.graph.nodes) { n.state ??= {}; n.consts ??= {}; }
  p.schema = SCHEMA_VERSION;
  return p;
}
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('nodal', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('projects');
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
export async function autosave(): Promise<void> {
  if (document.documentElement.classList.contains('embed')) return;      // a model shown inside another page never replaces the reader's own work
  try { const db = await idb(); db.transaction('projects', 'readwrite').objectStore('projects').put(snapshot(), 'autosave'); } catch { /* private mode: autosave is simply unavailable */ }
}
export async function loadAutosave(): Promise<ProjectFile | null> {
  try {
    const db = await idb();
    const json = await new Promise<string | undefined>((resolve, reject) => { const r = db.transaction('projects').objectStore('projects').get('autosave'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    return json ? migrate(JSON.parse(json)) : null;
  } catch { return null; }
}
export function openProject(p: ProjectFile, keepUndo = false): void {
  if (!keepUndo) { undoStack.length = 0; redoStack.length = 0; } else pushUndo();
  engine.cancel(); engine.invalidate();
  setProject(reconcile(migrate(JSON.parse(JSON.stringify(p)))));
  setSelection([]); setSelectedWire(null); setUi('pick', null); setOpenTick(t => t + 1);
  const v = (p.view ?? {}) as any;
  setUi({ panX: v.panX ?? 60, panY: v.panY ?? 60, zoom: v.zoom ?? 1 });
  afterChange();
  setDirty(false);
  requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('nodal:fit')));
}
export function download(name: string, data: BlobPart, type = 'application/octet-stream'): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function saveProjectFile(): void {
  const p = JSON.parse(snapshot()) as ProjectFile;
  p.view = { panX: ui.panX, panY: ui.panY, zoom: ui.zoom };
  download(`${p.name.replace(/[^\w\- ]+/g, '').trim() || 'project'}.nodal`, JSON.stringify(p, null, 1), 'application/json');
  setDirty(false);
}
export function pickFile(accept: string): Promise<File | null> {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept;
    inp.onchange = () => resolve(inp.files?.[0] ?? null);
    inp.click();
  });
}

// ---- graph editing helpers ----------------------------------------------------------
export const nodeById = (id: string): NodeData | undefined => project.graph.nodes.find(n => n.id === id);
export function addNode(type: string, x: number, y: number, init: Partial<NodeData> = {}): string {
  const node = makeNode(type, Math.round(x / 10) * 10, Math.round(y / 10) * 10, init);
  mutate(p => { p.graph.nodes.push(node); });
  setSelection([node.id]);
  return node.id;
}
export function connect(from: string, out: number, to: string, inp: number, additive = false): boolean {
  if (wouldCycle(unwrap(project).graph, from, to)) { toast('That wire would create a loop, which a graph cannot evaluate.'); return false; }
  mutate(p => {
    if (!additive) p.graph.wires = p.graph.wires.filter(w => !(w.to === to && w.inp === inp));
    if (!p.graph.wires.some(w => w.from === from && w.out === out && w.to === to && w.inp === inp)) p.graph.wires.push({ id: newId('w'), from, out, to, inp });
  });
  return true;
}
export function deleteSelection(): void {
  const ids = new Set(selection()), wire = selectedWire();
  if (!ids.size && !wire) return;
  mutate(p => {
    p.graph.nodes = p.graph.nodes.filter(n => !ids.has(n.id));
    p.graph.wires = p.graph.wires.filter(w => w.id !== wire && !ids.has(w.from) && !ids.has(w.to));
    p.graph.groups = p.graph.groups.map(g => ({ ...g, nodes: g.nodes.filter(n => !ids.has(n)) })).filter(g => g.nodes.length);
  });
  setSelection([]); setSelectedWire(null);
}
interface Clip { nodes: NodeData[]; wires: WireData[]; clusters: Record<string, ClusterDef> }
export function copySelection(): void {
  const ids = new Set(selection());
  if (!ids.size) return;
  const g = unwrap(project).graph;
  const clip: Clip = { nodes: g.nodes.filter(n => ids.has(n.id)), wires: g.wires.filter(w => ids.has(w.from) && ids.has(w.to)), clusters: {} };
  for (const n of clip.nodes) if (n.type === 'cluster' && project.clusters[n.state.clusterId]) clip.clusters[n.state.clusterId] = unwrap(project).clusters[n.state.clusterId];
  const text = JSON.stringify({ nodalClipboard: 1, ...clip });
  // localStorage carries the clipboard between projects and tabs; the system clipboard is a bonus when permitted.
  try { localStorage.setItem('nodal.clipboard', text); } catch { /* storage full */ }
  navigator.clipboard?.writeText(text).catch(() => undefined);
}
export function paste(at?: { x: number; y: number }): void {
  let clip: Clip;
  try { clip = JSON.parse(localStorage.getItem('nodal.clipboard') ?? ''); } catch { return; }
  if (!clip?.nodes?.length) return;
  const idMap = new Map<string, string>();
  const minX = Math.min(...clip.nodes.map(n => n.x)), minY = Math.min(...clip.nodes.map(n => n.y));
  const dx = at ? at.x - minX : 30, dy = at ? at.y - minY : 30;
  const nodes = clip.nodes.map(n => { const id = newId(); idMap.set(n.id, id); return { ...JSON.parse(JSON.stringify(n)), id, x: Math.round((n.x + dx) / 10) * 10, y: Math.round((n.y + dy) / 10) * 10 } as NodeData; });
  const wires = clip.wires.map(w => ({ ...w, id: newId('w'), from: idMap.get(w.from)!, to: idMap.get(w.to)! }));
  mutate(p => { p.graph.nodes.push(...nodes); p.graph.wires.push(...wires); for (const [k, c] of Object.entries(clip.clusters ?? {})) p.clusters[k] ??= c; });
  setSelection(nodes.map(n => n.id));
}
/**
 * Insert a ready-made group of components (a template) into the current project with its top-left
 * corner at (x, y). Ids are renewed so the same template can be inserted several times.
 */
export function insertFragment(graph: GraphDoc, x: number, y: number): string[] {
  if (!graph.nodes.length) return [];
  const idMap = new Map<string, string>();
  const minX = Math.min(...graph.nodes.map(n => n.x)), minY = Math.min(...graph.nodes.map(n => n.y));
  const snap = (val: number) => Math.round(val / 10) * 10;
  const nodes = graph.nodes.map(n => { const id = newId(); idMap.set(n.id, id); return { ...JSON.parse(JSON.stringify(n)), id, x: snap(n.x - minX + x), y: snap(n.y - minY + y) } as NodeData; });
  // Optimizer components refer to sliders by id.
  for (const n of nodes) if (Array.isArray(n.state?.genes)) n.state.genes = n.state.genes.map((id: string) => idMap.get(id) ?? id);
  const wires = graph.wires.filter(w => idMap.has(w.from) && idMap.has(w.to)).map(w => ({ ...w, id: newId('w'), from: idMap.get(w.from)!, to: idMap.get(w.to)! }));
  const groups = graph.groups.map(g => ({ ...g, id: newId('g'), nodes: g.nodes.map(id => idMap.get(id)!).filter(Boolean) }));
  mutate(p => { p.graph.nodes.push(...nodes); p.graph.wires.push(...wires); p.graph.groups.push(...groups); });
  setSelection(nodes.map(n => n.id)); setSelectedWire(null);
  return nodes.map(n => n.id);
}
/** Free spot for new content: just below everything that is already on the canvas. */
export function freeSpot(): { x: number; y: number } {
  const ns = project.graph.nodes;
  return ns.length ? { x: Math.min(...ns.map(n => n.x)), y: Math.max(...ns.map(n => n.y + 120)) + 60 } : { x: 60, y: 60 };
}
export function deleteWire(id: string): void {
  mutate(p => { p.graph.wires = p.graph.wires.filter(w => w.id !== id); });
  if (selectedWire() === id) setSelectedWire(null);
}
export function groupSelection(): void {
  const ids = selection();
  if (ids.length < 1) return;
  mutate(p => { p.graph.groups.push({ id: newId('g'), label: 'Group', color: '#5b8def', nodes: [...ids] }); }, { run: false });
}
export function alignSelection(mode: 'left' | 'top' | 'hspace' | 'vspace'): void {
  const ids = new Set(selection());
  if (ids.size < 2) return;
  mutate(p => {
    const ns = p.graph.nodes.filter(n => ids.has(n.id));
    if (mode === 'left') { const x = Math.min(...ns.map(n => n.x)); ns.forEach(n => { n.x = x; }); }
    if (mode === 'top') { const y = Math.min(...ns.map(n => n.y)); ns.forEach(n => { n.y = y; }); }
    if (mode === 'hspace') { ns.sort((a, b) => a.x - b.x); const a = ns[0].x, b = ns[ns.length - 1].x; ns.forEach((n, i) => { n.x = Math.round((a + (b - a) * i / (ns.length - 1)) / 10) * 10; }); }
    if (mode === 'vspace') { ns.sort((a, b) => a.y - b.y); const a = ns[0].y, b = ns[ns.length - 1].y; ns.forEach((n, i) => { n.y = Math.round((a + (b - a) * i / (ns.length - 1)) / 10) * 10; }); }
  }, { run: false });
}
/** Replace the selected components by a cluster with inputs/outputs where wires cross the selection boundary. */
export function clusterSelection(): void {
  const ids = new Set(selection());
  if (!ids.size) return;
  const g = unwrap(project).graph as GraphDoc, proj = unwrap(project);
  const inner = g.nodes.filter(n => ids.has(n.id)).map(n => JSON.parse(JSON.stringify(n)) as NodeData);
  const innerWires = g.wires.filter(w => ids.has(w.from) && ids.has(w.to)).map(w => ({ ...w }));
  const entering = g.wires.filter(w => !ids.has(w.from) && ids.has(w.to)), leaving = g.wires.filter(w => ids.has(w.from) && !ids.has(w.to));
  const minX = Math.min(...inner.map(n => n.x)), minY = Math.min(...inner.map(n => n.y)), maxX = Math.max(...inner.map(n => n.x));
  const inKeys: string[] = [], outKeys: string[] = [];
  const usedNames = new Set<string>();
  const unique = (base: string) => { let name = base, i = 2; while (usedNames.has(name)) name = `${base}${i++}`; usedNames.add(name); return name; };
  entering.forEach(w => {
    const key = `${w.from}:${w.out}`;        // one cluster input per outside source
    let idx = inKeys.indexOf(key);
    if (idx < 0) {
      idx = inKeys.length; inKeys.push(key);
      const target = g.nodes.find(n => n.id === w.to)!, port = portsOf(target, proj).inputs[w.inp];
      inner.push({ id: `cin${idx}`, type: 'cluster.in', x: minX - 180, y: minY + idx * 60, state: { name: unique(port?.name ?? 'In') }, consts: {} });
    }
    innerWires.push({ id: newId('w'), from: `cin${idx}`, out: 0, to: w.to, inp: w.inp });
  });
  leaving.forEach(w => {
    const key = `${w.from}:${w.out}`;
    if (outKeys.includes(key)) return;
    const idx = outKeys.length; outKeys.push(key);
    const src = g.nodes.find(n => n.id === w.from)!, port = portsOf(src, proj).outputs[w.out];
    inner.push({ id: `cout${idx}`, type: 'cluster.out', x: maxX + 260, y: minY + idx * 60, state: { name: unique(port?.name ?? 'Out') }, consts: {} });
    innerWires.push({ id: newId('w'), from: w.from, out: w.out, to: `cout${idx}`, inp: 0 });
  });
  // Cluster ports follow the order of the in/out nodes in the definition, so sort them to the front in key order.
  const def: ClusterDef = { id: newId('c'), name: 'Cluster', graph: { nodes: [...inner.filter(n => n.type === 'cluster.in'), ...inner.filter(n => n.type === 'cluster.out'), ...inner.filter(n => !n.type.startsWith('cluster.'))], wires: innerWires, groups: [] } };
  const node = makeNode('cluster', minX, minY, { state: { clusterId: def.id }, label: 'Cluster' });
  mutate(p => {
    p.clusters[def.id] = def;
    p.graph.nodes = p.graph.nodes.filter(n => !ids.has(n.id));
    p.graph.wires = p.graph.wires.filter(w => !ids.has(w.from) && !ids.has(w.to));
    p.graph.nodes.push(node);
    entering.forEach(w => { const i = inKeys.indexOf(`${w.from}:${w.out}`); if (!p.graph.wires.some(x => x.from === w.from && x.out === w.out && x.to === node.id && x.inp === i)) p.graph.wires.push({ id: newId('w'), from: w.from, out: w.out, to: node.id, inp: i }); });
    leaving.forEach(w => { p.graph.wires.push({ id: newId('w'), from: node.id, out: outKeys.indexOf(`${w.from}:${w.out}`), to: w.to, inp: w.inp }); });
  });
  setSelection([node.id]);
  saveClusterToLibrary(def);
  toast('Cluster created. It is also saved to your cluster library, under Tools in the ribbon.');
}
/** User cluster library (kept in this browser), so clusters can be reused in other projects. */
export function clusterLibrary(): ClusterDef[] { try { return JSON.parse(localStorage.getItem('nodal.clusters') ?? '[]'); } catch { return []; } }
export function saveClusterToLibrary(def: ClusterDef): void {
  const lib = clusterLibrary().filter(c => c.id !== def.id); lib.push(def);
  try { localStorage.setItem('nodal.clusters', JSON.stringify(lib)); } catch { /* storage full */ }
}
export function insertCluster(def: ClusterDef, x: number, y: number): void {
  const node = makeNode('cluster', x, y, { state: { clusterId: def.id }, label: def.name });
  mutate(p => { p.clusters[def.id] ??= JSON.parse(JSON.stringify(def)); p.graph.nodes.push(node); });
  setSelection([node.id]);
}
export { registry, portsOf, unwrap };
