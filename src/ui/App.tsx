/**
 * Application shell: top bar, resizable canvas / viewport layout, dialogs
 * (examples, verification, help, about), the first-run tour and file commands.
 */
import { createMemo, createSignal, For, onCleanup, onMount, Show, JSX } from 'solid-js';
import { project, mutate, ui, setUi, setSide, openProject, saveProjectFile, pickFile, migrate, toast, download, engine, runTick, dirty, solvingNode, selection, setSelection, undo, redo, unwrap, registry, portsOf, loadAutosave, addNode, TEXT_SCALES, setTextScale, stepTextScale } from './store';
import { emptyProject } from '../core/graph';
import type { ProjectFile } from '../core/types';
import { Canvas, layouts, CATEGORY_COLORS } from './Canvas';
import { SidePanel } from './SidePanel';
import { RenderDialog } from './RenderDialog';
import { TeachDialog, ShareDialog, GrasshopperDialog } from './Dialogs';
import { sharedCode, decodeProject } from './share';
import { Ribbon } from './Ribbon';
import { benchmarkAsComponents } from '../verify/explode';

import { Tex, texToPlain } from './Tex';
import { Viewport, viewportApi } from './Viewport';
import { Inspector } from './Inspector';
import { EXAMPLES } from '../examples';
import { BENCHMARKS } from '../verify/load';
import { runBenchmark, BenchmarkResult, fmtSci } from '../verify/runner';
import { collect, exportSTL, exportOBJ, exportDXF, exportGLTF, export3dm, toCSV, importFile, GeometrySet } from '../io/formats';
import { cancelSolver } from './workers';
import { TYPE_COLORS } from '../core/types';
import { formatValue } from '../core/graph';

const VERSION = '0.4.0';
const CREDIT = 'Built by Sam Smith at K-State (email me for feedback: samsmith@ksu.edu)';

/** Geometry currently shown in the 3D view, for the export commands. */
function visibleGeometry(): GeometrySet {
  const items: any[] = [], proj = unwrap(project);
  for (const n of project.graph.nodes) {
    const def = registry.get(n.type);
    if (!def || n.enabled === false || n.preview === false || (def.noPreview && n.preview !== true)) continue;
    portsOf(n, proj).outputs.forEach((p, i) => { if (['point', 'curve', 'surface', 'mesh', 'brep', 'geometry'].includes(p.type)) items.push(...(engine.outputs(n.id)[i]?.allItems() ?? [])); });
  }
  return collect(items);
}
/** The node canvas as an SVG drawing. */
function canvasSVG(): string {
  const L = layouts(), ns = project.graph.nodes;
  if (!ns.length) return '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>';
  const x0 = Math.min(...ns.map(n => n.x)) - 30, y0 = Math.min(...ns.map(n => n.y)) - 30, x1 = Math.max(...ns.map(n => n.x + L.get(n.id)!.w)) + 30, y1 = Math.max(...ns.map(n => n.y + L.get(n.id)!.h)) + 30;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const parts: string[] = [];
  for (const w of project.graph.wires) {
    const a = ns.find(n => n.id === w.from), b = ns.find(n => n.id === w.to); if (!a || !b) continue;
    const la = L.get(a.id)!, xa = a.x + la.w, ya = a.y + 34 + 20 * w.out, xb = b.x, yb = b.y + 34 + 20 * w.inp, dx = Math.max(36, Math.abs(xb - xa) * 0.45);
    parts.push(`<path d="M${xa},${ya} C${xa + dx},${ya} ${xb - dx},${yb} ${xb},${yb}" fill="none" stroke="${TYPE_COLORS[la.outs[w.out]?.type ?? 'any']}" stroke-width="1.8"/>`);
  }
  for (const n of ns) {
    const l = L.get(n.id)!, col = CATEGORY_COLORS[l.def?.category ?? ''] ?? '#888';
    parts.push(`<rect x="${n.x}" y="${n.y}" width="${l.w}" height="${l.h}" rx="6" fill="#fff" stroke="#c9ced6"/><rect x="${n.x}" y="${n.y}" width="4" height="${l.h}" rx="2" fill="${col}"/><text x="${n.x + 12}" y="${n.y + 16}" font-family="sans-serif" font-size="11" font-weight="600" fill="#1d232b">${esc(n.label ?? l.def?.name ?? n.type)}</text>`);
    l.ins.forEach((p, i) => parts.push(`<circle cx="${n.x}" cy="${n.y + 34 + 20 * i}" r="4" fill="${TYPE_COLORS[p.type]}"/><text x="${n.x + 9}" y="${n.y + 38 + 20 * i}" font-family="sans-serif" font-size="10" fill="#555">${esc(p.nick)}</text>`));
    l.outs.forEach((p, i) => parts.push(`<circle cx="${n.x + l.w}" cy="${n.y + 34 + 20 * i}" r="4" fill="${TYPE_COLORS[p.type]}"/><text x="${n.x + l.w - 9}" y="${n.y + 38 + 20 * i}" text-anchor="end" font-family="sans-serif" font-size="10" fill="#555">${esc(p.nick)}</text>`));
    if (l.def?.widget === 'slider') parts.push(`<text x="${n.x + l.w / 2}" y="${n.y + 38}" text-anchor="middle" font-family="monospace" font-size="11" fill="#1d232b">${esc(formatValue(n.state.value))}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${x1 - x0}" height="${y1 - y0}" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}"><rect x="${x0}" y="${y0}" width="100%" height="100%" fill="#f6f5f1"/>${parts.join('')}</svg>`;
}
function svgToPng(svg: string, name: string): void {
  const img = new Image(), url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  img.onload = () => { const c = document.createElement('canvas'); c.width = img.width * 2; c.height = img.height * 2; const ctx = c.getContext('2d')!; ctx.scale(2, 2); ctx.drawImage(img, 0, 0); URL.revokeObjectURL(url); c.toBlob(b => { if (b) download(name, b, 'image/png'); }); };
  img.src = url;
}

async function openFile(): Promise<void> {
  const f = await pickFile('.nodal,.json');
  if (!f) return;
  try { openProject(migrate(JSON.parse(await f.text()))); toast(`Opened ${f.name}`); } catch (e) { toast((e as Error).message, 7000); }
}
async function importGeometry(): Promise<void> {
  const f = await pickFile('.stl,.obj,.dxf,.3dm,.csv,.txt,.step,.stp,.iges,.igs');
  if (!f) return;
  try {
    const data = await importFile(f.name, await f.arrayBuffer());
    const id = addNode('param.file', (200 - ui.panX) / ui.zoom, (160 - ui.panY) / ui.zoom, { label: f.name });
    mutate(p => { const n = p.graph.nodes.find(q => q.id === id); if (n) n.state = { data, name: `${f.name} (${data.length} object${data.length === 1 ? '' : 's'})` }; }, { undo: false });
    toast(`Imported ${data.length} object${data.length === 1 ? '' : 's'} from ${f.name}`);
  } catch (e) { toast((e as Error).message, 8000); }
}
async function exportAs(kind: string): Promise<void> {
  try {
    const set = visibleGeometry();
    if (['stl', 'obj', 'dxf', 'gltf', '3dm'].includes(kind) && !set.meshes.length && !set.curves.length && !set.points.length) { toast('There is no previewed geometry to export. Turn on Preview for the components you want.'); return; }
    if (kind === 'stl') { if (!set.meshes.length) { toast('STL needs meshes or surfaces; only curves and points are visible.'); return; } download('nodal.stl', exportSTL(set.meshes)); }
    else if (kind === 'obj') download('nodal.obj', exportOBJ(set), 'text/plain');
    else if (kind === 'dxf') download('nodal.dxf', exportDXF(set), 'application/dxf');
    else if (kind === 'gltf') download('nodal.gltf', exportGLTF(set), 'model/gltf+json');
    else if (kind === '3dm') download('nodal.3dm', (await export3dm(set)) as unknown as BlobPart);
    else if (kind === 'csv') {
      // Data of the selected component (all outputs), or the points in view.
      const sel = selection()[0], rows: (string | number)[][] = [];
      if (sel) engine.outputs(sel).forEach((t, o) => t.branches.forEach(b => b.items.forEach((it: any, i) => rows.push([o, `{${b.path.join(';')}}`, i, ...(it && typeof it === 'object' && 'x' in it ? [it.x, it.y, it.z] : [formatValue(it)])]))));
      else set.points.forEach(p => rows.push([p.x, p.y, p.z]));
      if (!rows.length) { toast('Select a component to export its data as CSV.'); return; }
      download('nodal-data.csv', toCSV(sel ? [['output', 'branch', 'index', 'value / x', 'y', 'z'], ...rows] : rows), 'text/csv');
    }
    else if (kind === 'png-view') { const url = viewportApi.png?.(); if (url) { const a = document.createElement('a'); a.href = url; a.download = 'nodal-view.png'; a.click(); } }
    else if (kind === 'svg-view') { const s = viewportApi.svg?.(); if (s) download('nodal-view.svg', s, 'image/svg+xml'); }
    else if (kind === 'svg-canvas') download('nodal-canvas.svg', canvasSVG(), 'image/svg+xml');
    else if (kind === 'png-canvas') svgToPng(canvasSVG(), 'nodal-canvas.png');
    else if (kind === 'step') toast('STEP and IGES export needs a B-rep kernel, which is not part of this version. Use 3DM, OBJ, STL, glTF or DXF.', 8000);
  } catch (e) { toast('Export failed: ' + (e as Error).message, 8000); }
}
export function openExample(id: string): void {
  const ex = EXAMPLES.find(e => e.id === id);
  if (!ex) return;
  const built = ex.build();
  openProject(built.project);
  setUi('dialog', null);
  setSelection([]);
}

// ---- first-run tour --------------------------------------------------------------------
/** Open a verification benchmark: as its single component, or rebuilt from ordinary components. */
export function openBenchmark(id: string, asComponents: boolean): void {
  if (!asComponents) { openExample('bench-' + id.toLowerCase()); return; }
  const def = BENCHMARKS.find(b => b.id === id);
  if (!def) return;
  try { openProject(benchmarkAsComponents(def)); setUi('dialog', null); setSelection([]); } catch (e) { toast((e as Error).message); }
}

const TOUR: { title: string; text: string; keys: string[] }[] = [
  { title: 'Welcome to Nodal', text: 'Nodal is a canvas of components joined by wires. Data flows from left to right, and the 3D view updates as you go. This short tour builds a small truss in five steps. You can skip it at any time.', keys: [] },
  { title: '1. Geometry from sliders', text: 'Two sliders set the span and the height. Three points are built from them, and three lines join the points. To add components yourself, pick them from the ribbon at the top, or double-click the canvas and type a name.', keys: ['span', 'height', 'half', 'A', 'B', 'C', 'l1', 'l2', 'l3'] },
  { title: '2. Structural elements', text: 'A Tube Section and a Truss component turn the three lines into bars. Element components always need a curve and a cross-section; the material defaults to steel.', keys: ['sec', 'truss'] },
  { title: '3. Supports and a load', text: 'Supports and loads are placed by position: each one attaches to the node at its point. Here a pin, a roller, and a 10 kN load at the apex. Because the truss is flat, the apex is also held against moving out of its plane.', keys: ['sA', 'sB', 'sC', 'load', 'neg', 'F', 'pl'] },
  { title: '4. Assemble and analyze', text: 'Assemble Model joins everything at shared nodes and checks the model. Linear Static solves it in a background worker and reports an equilibrium check.', keys: ['model', 'static'] },
  { title: '5. Results', text: 'Result View draws the deformed shape and the axial forces; the panel lists them: −7.07 kN in the rafters and +5.00 kN in the tie. Now drag the Height slider and watch the forces change. Click any bar in the 3D view to read its results.', keys: ['view', 'axial', 'panel'] },
];
function showTourStep(step: number): void {
  const ex = EXAMPLES.find(e => e.id === 'quick-truss')!.build().project;
  const keep = new Set(TOUR.slice(0, step + 1).flatMap(s => s.keys).map(k => 'ex_' + k));
  const p: ProjectFile = { ...ex, name: 'My first truss', graph: { nodes: ex.graph.nodes.filter(n => keep.has(n.id)), wires: ex.graph.wires.filter(w => keep.has(w.from) && keep.has(w.to)), groups: [] } };
  openProject(p);
}
export function startTour(): void { setUi('tour', 0); openProject(emptyProject('My first truss')); }
function endTour(): void { try { localStorage.setItem('nodal.tourDone', '1'); } catch { /* ignore */ } setUi('tour', -1); }

export function App(): JSX.Element {
  const [menu, setMenu] = createSignal<string | null>(null);
  let main!: HTMLDivElement;
  const onKey = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), t = e.target as HTMLElement | null;
    // Undo and redo work wherever the focus is, except while typing in a text box (which has its own undo).
    const typing = !!t && (t.matches?.('input:not([type="range"]):not([type="checkbox"]), textarea, select') || t.isContentEditable);
    if (mod && k === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && k === 'y' && !typing) { e.preventDefault(); redo(); }
    else if (mod && k === 'k') { e.preventDefault(); window.dispatchEvent(new CustomEvent('nodal:palette')); }
    else if (mod && k === 's') { e.preventDefault(); saveProjectFile(); }
    else if (mod && k === 'o') { e.preventDefault(); void openFile(); }
    else if (e.key === 'Escape') { setMenu(null); if (ui.dialog) setUi('dialog', null); }
  };
  onMount(async () => {
    document.documentElement.dataset.theme = ui.theme;
    document.documentElement.style.setProperty('--ts', String(ui.textScale));
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', (e) => { if (!(e.target as HTMLElement).closest('.menubar')) setMenu(null); });
    window.addEventListener('beforeunload', (e) => { if (dirty() && project.graph.nodes.length && !localStorage.getItem('nodal.noUnloadPrompt')) e.preventDefault(); });
    const query = new URLSearchParams(location.search), example = query.get('example'), blank = query.has('new');
    const saved = example || blank || sharedCode() ? null : await loadAutosave();
    const shared = sharedCode(), embedded = query.has('embed');
    if (embedded) { document.documentElement.classList.add('embed'); const lay = query.get('layout'); setUi({ ribbon: false, side: 'hidden', layout: lay === 'split' || lay === 'canvas' ? lay : 'view' }); }
    if (shared) {
      // A model carried in the link. It is data from someone else: it goes through the same checks as an opened file.
      try { openProject(migrate(await decodeProject(shared))); if (!embedded) history.replaceState(null, '', location.pathname + location.search); return; }
      catch { toast('The model in this link could not be read. The link may have been cut short.', 8000); }
    }
    if (blank) { /* ?new=1 starts with an empty canvas */ }
    else if (example && EXAMPLES.some(e => e.id === example)) openExample(example);
    else if (saved && saved.graph.nodes.length) openProject(saved);
    else if (!localStorage.getItem('nodal.tourDone')) startTour();
    else openExample('quick-truss');
  });
  onCleanup(() => window.removeEventListener('keydown', onKey));
  const setTheme = (t: 'light' | 'dark') => { setUi('theme', t); document.documentElement.dataset.theme = t; try { localStorage.setItem('nodal.theme', t); } catch { /* ignore */ } };
  const startSplit = (e: PointerEvent) => {
    e.preventDefault();
    const r = main.getBoundingClientRect(), stack = ui.layout === 'stack';
    const mv = (ev: PointerEvent) => setUi('split', Math.min(0.85, Math.max(0.15, stack ? (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width)));
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  const Menu = (p: { name: string; label: string; children: JSX.Element }) => <div class="menu-root">
    <button class="menu-btn" classList={{ on: menu() === p.name }} aria-haspopup="true" aria-expanded={menu() === p.name} onClick={() => setMenu(menu() === p.name ? null : p.name)} onPointerEnter={() => { if (menu()) setMenu(p.name); }}>{p.label}</button>
    <Show when={menu() === p.name}><div class="menu-drop" role="menu" onClick={() => setMenu(null)}>{p.children}</div></Show></div>;
  const Item = (p: { label: string; key?: string; onClick: () => void; disabled?: boolean; title?: string }) => <button role="menuitem" disabled={p.disabled} title={p.title} onClick={p.onClick}>{p.label}<kbd>{p.key ?? ''}</kbd></button>;
  const stats = createMemo(() => { runTick(); let err = 0, warn = 0; for (const n of project.graph.nodes) { const s = engine.status(n.id).state; if (s === 'error') err++; else if (s === 'warning') warn++; } return { err, warn }; });
  const first = () => (ui.swap ? 'view' : 'canvas');
  const paneStyle = (which: 'canvas' | 'view') => { if (ui.layout === 'canvas') return { display: which === 'canvas' ? '' : 'none', flex: '1' }; if (ui.layout === 'view') return { display: which === 'view' ? '' : 'none', flex: '1' }; const isFirst = first() === which; return { flex: `${isFirst ? ui.split : 1 - ui.split} 1 0`, order: isFirst ? 0 : 2 }; };
  return (
    <div class="app" classList={{ stack: ui.layout === 'stack' }}>
      <header class="topbar">
        <div class="brand" title={`Nodal ${VERSION}`}><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 18 L12 5 L20 18 Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /><circle cx="4" cy="18" r="2.4" fill="var(--accent)" /><circle cx="12" cy="5" r="2.4" fill="var(--accent)" /><circle cx="20" cy="18" r="2.4" fill="var(--accent)" /></svg><b>Nodal</b></div>
        <nav class="menubar" aria-label="Main menu">
          <Menu name="file" label="File">
            <Item label="New project" onClick={() => { if (!project.graph.nodes.length || confirm('Start a new project? Unsaved changes to the current one will be lost.')) openProject(emptyProject()); }} />
            <Item label="Open…" key="Ctrl O" onClick={() => void openFile()} /><Item label="Save" key="Ctrl S" onClick={saveProjectFile} /><Item label="Share or embed…" onClick={() => setUi('dialog', 'share')} /><hr />
            <Item label="Import geometry…" onClick={() => void importGeometry()} title="STL, OBJ, DXF, 3DM, CSV" /><hr />
            <div class="menu-title">Export geometry in view</div>
            <Item label="STL (meshes)" onClick={() => void exportAs('stl')} /><Item label="OBJ" onClick={() => void exportAs('obj')} /><Item label="glTF" onClick={() => void exportAs('gltf')} /><Item label="3DM" onClick={() => void exportAs('3dm')} /><Item label="DXF" onClick={() => void exportAs('dxf')} />
            <Item label="STEP / IGES (not available yet)" onClick={() => void exportAs('step')} /><hr />
            <div class="menu-title">Export data and images</div>
            <Item label="CSV of the selected component" onClick={() => void exportAs('csv')} /><Item label="3D view as PNG" onClick={() => void exportAs('png-view')} /><Item label="3D view as SVG" onClick={() => void exportAs('svg-view')} /><Item label="Canvas as PNG" onClick={() => void exportAs('png-canvas')} /><Item label="Canvas as SVG" onClick={() => void exportAs('svg-canvas')} />
          </Menu>
          <Menu name="edit" label="Edit"><Item label="Undo" key="Ctrl Z" onClick={undo} /><Item label="Redo" key="Ctrl Y" onClick={redo} /><hr /><Item label="Add component…" key="Ctrl K" onClick={() => window.dispatchEvent(new CustomEvent('nodal:palette'))} /><Item label="Recompute everything" onClick={() => { engine.invalidate(); mutate(() => undefined, { undo: false }); }} /><Item label="Cancel running analysis" onClick={() => { cancelSolver(); engine.cancel(); }} /></Menu>
          <Menu name="units" label={`Units: ${project.units}`}>
            <Item label={(project.units === 'SI' ? '● ' : '○ ') + 'SI: kN, m, MPa (sections in mm)'} onClick={() => mutate(p => { p.units = 'SI'; })} />
            <Item label={(project.units === 'US' ? '● ' : '○ ') + 'US: kip, ft, ksi (sections in inches)'} onClick={() => mutate(p => { p.units = 'US'; })} />
            <div class="menu-note">Switching units changes how the numbers on the canvas are read; it does not convert them.</div>
          </Menu>
          <Menu name="view" label="View">
            <Item label="Canvas and 3D view side by side" onClick={() => setUi('layout', 'split')} /><Item label="Stacked" onClick={() => setUi('layout', 'stack')} /><Item label="Canvas only" onClick={() => setUi('layout', 'canvas')} /><Item label="3D view only" onClick={() => setUi('layout', 'view')} /><Item label="Swap sides" onClick={() => setUi('swap', !ui.swap)} /><hr />
            <Item label={(ui.ribbon ? 'Hide' : 'Show') + ' ribbon'} onClick={() => { const open = !ui.ribbon; setUi('ribbon', open); try { localStorage.setItem('nodal.ribbon', open ? '1' : '0'); } catch { /* storage unavailable */ } }} /><Item label={(ui.side === 'hidden' ? 'Show' : 'Hide') + ' side panel'} onClick={() => setSide(ui.side === 'hidden' ? 'inspector' : 'hidden')} /><Item label="Assistant (optional AI)" onClick={() => setSide('assistant')} /><hr />
            <Item label={ui.theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={() => setTheme(ui.theme === 'dark' ? 'light' : 'dark')} /><hr />
            <div class="menu-title">Text size</div>
            <For each={TEXT_SCALES}>{([val, name]) => <Item label={(ui.textScale === val ? '● ' : '○ ') + name} onClick={() => setTextScale(val)} />}</For>
          </Menu>
          <Menu name="help" label="Help"><Item label="Take the tour" onClick={startTour} /><Item label="Coming from Grasshopper…" onClick={() => setUi('dialog', 'grasshopper')} /><Item label="Stiffness method, step by step…" onClick={() => setUi('dialog', 'teach')} /><Item label="Examples…" onClick={() => setUi('dialog', 'examples')} /><Item label="Verification…" onClick={() => setUi('dialog', 'verification')} /><Item label="Keyboard shortcuts" onClick={() => setUi('dialog', 'shortcuts')} /><Item label="User guide" onClick={() => window.open('https://github.com/hse95/nodal/blob/main/docs/user-guide.md', '_blank', 'noopener')} /><Item label="Theory manual" onClick={() => window.open('https://github.com/hse95/nodal/blob/main/docs/theory-manual.md', '_blank', 'noopener')} /><Item label="About Nodal" onClick={() => setUi('dialog', 'about')} /></Menu>
        </nav>
        <div class="spacer" />
        <a class="embed-open" href={location.href.replace(/[?&]embed=1(&layout=[a-z]+)?/, '').replace(/\?#/, '#')} target="_blank" rel="noopener">Open in Nodal ↗</a>
        <div class="status" role="status" aria-live="polite">
          <Show when={solvingNode()} fallback={<Show when={stats().err || stats().warn} fallback={<span class="ok">Ready</span>}><Show when={stats().err}><span class="bad">{stats().err} error{stats().err > 1 ? 's' : ''}</span></Show><Show when={stats().warn}><span class="warn">{stats().warn} warning{stats().warn > 1 ? 's' : ''}</span></Show></Show>}>
            <span class="busy">Solving {registry.get(project.graph.nodes.find(n => n.id === solvingNode())?.type ?? '')?.name ?? ''}…</span><button class="link" onClick={() => { cancelSolver(); engine.cancel(); }}>Cancel</button></Show>
        </div>
        <div class="layout-btns" role="group" aria-label="Text size">
          <button title="Smaller text" aria-label="Smaller text" disabled={ui.textScale === TEXT_SCALES[0][0]} onClick={() => stepTextScale(-1)}><span style={{ 'font-size': '0.85em' }}>A</span>−</button>
          <button title="Larger text" aria-label="Larger text" disabled={ui.textScale === TEXT_SCALES[TEXT_SCALES.length - 1][0]} onClick={() => stepTextScale(1)}><span style={{ 'font-size': '1.15em' }}>A</span>+</button>
        </div>
        <div class="layout-btns" role="group" aria-label="Layout">
          <button title="Side by side" aria-label="Side by side" classList={{ on: ui.layout === 'split' }} onClick={() => setUi('layout', 'split')}>▯▯</button>
          <button title="Stacked" aria-label="Stacked" classList={{ on: ui.layout === 'stack' }} onClick={() => setUi('layout', 'stack')}>▭</button>
          <button title="Swap canvas and 3D view" aria-label="Swap canvas and 3D view" onClick={() => setUi('swap', !ui.swap)}>⇄</button>
          <button title="Maximize canvas" aria-label="Maximize canvas" classList={{ on: ui.layout === 'canvas' }} onClick={() => setUi('layout', ui.layout === 'canvas' ? 'split' : 'canvas')}>◧</button>
          <button title="Maximize 3D view" aria-label="Maximize 3D view" classList={{ on: ui.layout === 'view' }} onClick={() => setUi('layout', ui.layout === 'view' ? 'split' : 'view')}>◨</button>
          <button title={ui.theme === 'dark' ? 'Light theme' : 'Dark theme'} aria-label="Toggle theme" onClick={() => setTheme(ui.theme === 'dark' ? 'light' : 'dark')}>{ui.theme === 'dark' ? '☀' : '☾'}</button>
        </div>
      </header>
      <Ribbon onExample={openExample} onAllExamples={() => setUi('dialog', 'examples')} onVerify={() => setUi('dialog', 'verification')} onBenchmark={openBenchmark} />
      <div class="body">
        <main class="main" ref={main}>
          <div class="pane" style={paneStyle('canvas')}><Canvas /></div>
          <Show when={ui.layout === 'split' || ui.layout === 'stack'}><div class="divider" style={{ order: 1 }} role="separator" aria-label="Resize panes" onPointerDown={startSplit} /></Show>
          <div class="pane" style={paneStyle('view')}><Viewport /></div>
        </main>
        <SidePanel />
      </div>
      <Show when={ui.toast}><div class="toast" role="alert">{ui.toast}</div></Show>
      <Show when={ui.dialog === 'render'}><RenderDialog /></Show>
      <Show when={ui.dialog === 'teach'}><TeachDialog /></Show>
      <Show when={ui.dialog === 'share'}><ShareDialog /></Show>
      <Show when={ui.dialog === 'grasshopper'}><GrasshopperDialog /></Show>
      <Show when={ui.dialog === 'examples'}><ExamplesDialog /></Show>
      <Show when={ui.dialog === 'verification'}><VerificationDialog /></Show>
      <Show when={ui.dialog === 'about'}><Dialog title="About Nodal"><div class="about">
        <p><b>Nodal {VERSION}</b>: parametric modeling and structural finite element analysis in the browser. Free and open source (MIT license). Everything runs on your computer; nothing is uploaded.</p>
        <p>{CREDIT.replace('samsmith@ksu.edu)', '')}<a href="mailto:samsmith@ksu.edu">samsmith@ksu.edu</a>)</p>
        <p class="warnbox">This software is provided as is, without warranty. It is a tool for exploration and teaching. Check every result independently before using it for any real design. The utilization values are simplified stress checks and are not design-code verifications.</p>
        <p>Source code, user guide, theory manual and verification report: <a href="https://github.com/hse95/nodal" target="_blank" rel="noopener">github.com/hse95/nodal</a></p>
        <p class="muted">Uses Solid, Three.js, KaTeX, Manifold and rhino3dm. See THIRD_PARTY_LICENSES.md in the repository.</p></div></Dialog></Show>
      <Show when={ui.dialog === 'shortcuts'}><Dialog title="Keyboard shortcuts"><table class="kv shortcuts"><tbody>
        <For each={[['Double-click canvas', 'Add a component by name'], ['Ctrl/Cmd + K', 'Command palette'], ['Drag from a port', 'Connect (Shift adds a second wire)'], ['Drop a wire on empty canvas', 'Choose a component to connect it to'], ['Drop a wire on a component', 'Connect to its first fitting port'], ['Right-click a wire', 'Delete it, or show its data in a panel'], ['Double-click a title', 'Rename a component'], ['Drag from the left list', 'Place a component or a template'], ['Mouse wheel', 'Zoom the canvas'], ['Right- or middle-drag, or Space + drag', 'Pan the canvas'], ['Drag on empty canvas', 'Box select'], ['Delete', 'Delete selection or selected wire'], ['Ctrl/Cmd + Z / Y', 'Undo / redo'], ['Ctrl/Cmd + C / X / V', 'Copy / cut / paste (also between projects)'], ['Ctrl/Cmd + D', 'Duplicate'], ['Ctrl/Cmd + A', 'Select all'], ['Ctrl/Cmd + G', 'Group selection'], ['Arrow keys', 'Nudge selection (Shift: larger steps)'], ['Alt while dragging', 'Move without snapping'], ['F', 'Zoom canvas to fit'], ['P', 'Toggle preview of the selection'], ['Ctrl/Cmd + S / O', 'Save / open project'], ['Right-click', 'Context menu'], ['Esc', 'Close menus and dialogs']]}>{([k, d]) => <tr><th><kbd>{k}</kbd></th><td>{d}</td></tr>}</For></tbody></table></Dialog></Show>
      <Show when={ui.tour >= 0}><div class="tour" role="dialog" aria-label="Tour">
        <div class="tour-step">{ui.tour === 0 ? 'Tour' : `Step ${ui.tour} of ${TOUR.length - 1}`}</div><h3>{TOUR[ui.tour].title}</h3><p>{TOUR[ui.tour].text}</p>
        <div class="row"><button class="link" onClick={() => { endTour(); if (ui.tour < 0 && !project.graph.nodes.length) openExample('quick-truss'); }}>{ui.tour === TOUR.length - 1 ? 'Close' : 'Skip the tour'}</button><div class="spacer" />
          <Show when={ui.tour > 0}><button onClick={() => { setUi('tour', ui.tour - 1); showTourStep(ui.tour); }}>Back</button></Show>
          <Show when={ui.tour < TOUR.length - 1} fallback={<button class="primary" onClick={endTour}>Done</button>}><button class="primary" onClick={() => { setUi('tour', ui.tour + 1); showTourStep(ui.tour); }}>{ui.tour === 0 ? 'Start' : 'Next'}</button></Show></div>
      </div></Show>
    </div>
  );
}

export function Dialog(props: { title: string; wide?: boolean; children: JSX.Element }): JSX.Element {
  return <div class="backdrop" onPointerDown={e => { if (e.target === e.currentTarget) setUi('dialog', null); }}>
    <div class="dialog" classList={{ wide: props.wide }} role="dialog" aria-modal="true" aria-label={props.title}>
      <div class="dialog-head"><h2>{props.title}</h2><button class="link" onClick={() => setUi('dialog', null)} aria-label="Close">Close</button></div>
      <div class="dialog-body">{props.children}</div></div></div>;
}
function ExamplesDialog(): JSX.Element {
  const groups = createMemo(() => { const m = new Map<string, typeof EXAMPLES>(); for (const e of EXAMPLES) { const l = m.get(e.group); if (l) l.push(e); else m.set(e.group, [e]); } return [...m.entries()]; });
  return <Dialog title="Examples" wide><p class="muted">Each example opens as a normal project that you can change. The description states the key results you should see.</p>
    <For each={groups()}>{([g, list]) => <section class="ex-group"><h3>{g}</h3><div class="ex-grid"><For each={list}>{e => <button class="ex-card" onClick={() => openExample(e.id)}><b>{e.title}</b><span>{e.summary}</span><small>{e.description}</small><Show when={e.benchmark}><em>Related benchmark: {e.benchmark}</em></Show></button>}</For></div></section>}</For></Dialog>;
}
function ConvergencePlot(props: { r: BenchmarkResult }): JSX.Element {
  const c = props.r.convergence!, pts = c.points.filter(p => p.errorPct > 0 && p.x > 0);
  if (pts.length < 2) return <></>;
  const lx = pts.map(p => Math.log10(p.x)), ly = pts.map(p => Math.log10(p.errorPct)), x0 = Math.min(...lx), x1 = Math.max(...lx), y0 = Math.floor(Math.min(...ly)), y1 = Math.ceil(Math.max(...ly));
  const X = (x: number) => 40 + (x - x0) / (x1 - x0 || 1) * 200, Y = (y: number) => 10 + (y1 - y) / (y1 - y0 || 1) * 90;
  return <svg class="conv-plot" viewBox="0 0 260 125" role="img" aria-label={`Convergence of ${c.label}`}>
    <For each={Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i)}>{y => <><line x1="40" x2="240" y1={Y(y)} y2={Y(y)} class="gridline" /><text x="36" y={Y(y) + 3} text-anchor="end">{`1e${y}`}</text></>}</For>
    <path d={'M' + pts.map((_, i) => `${X(lx[i])},${Y(ly[i])}`).join(' L')} class="curve" /><For each={pts}>{(p, i) => <><circle cx={X(lx[i()])} cy={Y(ly[i()])} r="2.6" class="dot" /><text x={X(lx[i()])} y="114" text-anchor="middle">{p.x}</text></>}</For>
    <text x="140" y="124" text-anchor="middle">{c.param === 'n' ? 'elements per side / member' : c.param}</text><text x="6" y="8">error %</text></svg>;
}
function VerificationDialog(): JSX.Element {
  const [results, setResults] = createSignal<BenchmarkResult[]>([]), [running, setRunning] = createSignal(false), [progress, setProgress] = createSignal('');
  let stop = false;
  const run = async () => {
    setRunning(true); setResults([]); stop = false;
    for (const def of BENCHMARKS) {
      if (stop) break;
      setProgress(`Running ${def.id} ${def.title}…`);
      await new Promise(r => setTimeout(r, 15));        // let the table repaint between benchmarks
      const r = runBenchmark(def);
      setResults(list => [...list, r]);
    }
    setProgress(''); setRunning(false);
  };
  const summary = () => { const r = results(), checks = r.flatMap(x => x.rows); return `${r.filter(x => x.pass).length} of ${r.length} benchmarks pass (${checks.filter(c => c.pass).length} of ${checks.length} checks)`; };
  const csv = () => download('nodal-verification.csv', toCSV([['Benchmark', 'Check', 'Computed', 'Reference', 'Error', 'Tolerance', 'Unit', 'Pass'], ...results().flatMap(r => r.rows.map(c => [r.def.id + ' ' + r.def.title, c.label + (c.tex ? ` (${texToPlain(c.tex)})` : ''), c.computed, c.expected, c.absolute ? c.errorPct : c.errorPct + ' %', c.absolute ? c.tolerancePct : c.tolerancePct + ' %', c.unit, c.pass ? 'pass' : 'FAIL']))]), 'text/csv');
  const pdf = async () => { const { verificationPdf } = await import('../verify/report'); download(`nodal-${VERSION}-verification.pdf`, verificationPdf(results(), { version: VERSION, date: new Date().toISOString().slice(0, 10), browser: navigator.userAgent }) as BlobPart, 'application/pdf'); };
  onMount(() => void run());
  onCleanup(() => { stop = true; });
  return <Dialog title="Verification" wide>
    <p class="muted">Every benchmark is solved here, in your browser, by the same solver the app uses, and compared with a closed-form solution, a published reference value, or the independent reference solver. The same suite runs in the automated tests.</p>
    <div class="row"><button class="primary" disabled={running()} onClick={() => void run()}>Run all again</button><Show when={running()}><button onClick={() => { stop = true; }}>Stop</button></Show><Show when={results().length}><button onClick={csv}>Download CSV</button></Show><Show when={results().length === BENCHMARKS.length && !running()}><button class="pdf" title="A report of every benchmark, its reference, tolerance and outcome, for this version" onClick={() => void pdf()}>Save report (PDF)</button></Show><span class="muted">{progress() || (results().length ? summary() : '')}</span></div>
    <For each={results()}>{r => <section class="bench" classList={{ fail: !r.pass }}>
      <div class="bench-head"><span class="pill" classList={{ pass: r.pass, fail: !r.pass }}>{r.pass ? 'PASS' : 'FAIL'}</span><b>{r.def.id} {r.def.title}</b><span class="muted">{r.ms.toFixed(0)} ms</span><button class="link" onClick={() => openBenchmark(r.def.id, false)}>Open</button><button class="link" title="Open this model built from ordinary components" onClick={() => openBenchmark(r.def.id, true)}>Open as components</button></div>
      <p class="muted">{r.def.description} <i>Reference: {r.def.source}</i></p>
      <Show when={r.error}><p class="msg error">{r.error}</p></Show>
      <div class="bench-body"><table class="grid"><thead><tr><th>Check</th><th>Formula</th><th>Computed</th><th>Reference</th><th>Error</th><th>Tolerance</th><th /></tr></thead><tbody>
        <For each={r.rows}>{c => <tr classList={{ failrow: !c.pass }} title={c.note ?? ''}><td>{c.label}{c.note ? ' *' : ''}</td><td class="fx">{c.tex ? <Tex tex={c.tex} big /> : ''}</td><td>{fmtSci(c.computed)} {c.unit}</td><td>{fmtSci(c.expected)} {c.unit}</td><td>{c.absolute ? c.errorPct.toExponential(1) : c.errorPct.toPrecision(3) + ' %'}</td><td>{c.absolute ? c.tolerancePct : +c.tolerancePct.toPrecision(3) + ' %'}</td><td>{c.pass ? '✓' : '✗'}</td></tr>}</For></tbody></table>
        <Show when={r.convergence}><ConvergencePlot r={r} /></Show></div>
    </section>}</For>
  </Dialog>;
}
