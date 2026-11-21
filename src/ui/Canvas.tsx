/**
 * Node canvas: components, wires, groups, on-canvas widgets, search, context
 * menu and minimap. Components are DOM elements inside one transformed layer,
 * so panning and zooming only change a single CSS transform.
 */
import { createMemo, createSignal, For, Show, onCleanup, onMount, JSX, batch } from 'solid-js';
import { project, mutate, pushUndo, selection, setSelection, selectedWire, setSelectedWire, runTick, engine, ui, setUi, addNode, connect, deleteSelection, copySelection, paste, groupSelection, clusterSelection, alignSelection, solvingNode, registry, portsOf, unwrap, clusterLibrary, insertCluster, toast, deleteWire, insertFragment, freeSpot, nodeById } from './store';
import { TYPE_COLORS } from '../core/types';
import type { NodeData, PortSpec, ComponentDef, TableValue, DType } from '../core/types';
import { formatValue, typesCompatible } from '../core/graph';
import { exprToTex } from '../core/expr';
import { Tex, RichText, hasMath } from './Tex';
import { TEMPLATES, Template } from '../templates';
import { pathText } from '../core/tree';
import { graphMap } from '../components/basic';
import { unitSystem } from '../fe/units';

const HEADER = 24, ROW = 20, PAD = 6, EXPR_TEX = 40;
export const CATEGORY_COLORS: Record<string, string> = { Params: '#7a8699', Math: '#4f8ef7', Lists: '#9b7fd1', Trees: '#8a6fc0', Vector: '#d19a2a', Curve: '#3fae6b', Surface: '#2f9e8f', Mesh: '#58a65c', Transform: '#a06cd5', Display: '#d1589b', Structure: '#d4504c', 'Form-Finding': '#e0703a', Optimization: '#c2569b', Script: '#5f6b7a' };

export interface Layout { w: number; h: number; ins: PortSpec[]; outs: PortSpec[]; def: ComponentDef | undefined; body: number }
export function layoutOf(n: NodeData): Layout {
  const def = registry.get(n.type), { inputs: ins, outputs: outs } = portsOf(n, unwrap(project));
  const rows = Math.max(ins.length, outs.length, 1);
  let w = n.w ?? def?.width ?? 150, body = rows * ROW, extra = 0;
  if (def?.widget === 'panel') { body = n.h ?? 110; w = n.w ?? 220; }
  else if (def?.widget === 'note') { body = n.h ?? 54; w = n.w ?? 200; }
  else if (def?.widget === 'graph') extra = 60;
  else if (def?.widget === 'text') extra = n.type === 'math.expr' ? 26 + EXPR_TEX : 26;
  else if (def?.widget === 'optimizer') extra = 58;
  const longest = Math.max(0, ...ins.map(p => p.nick.length)) + Math.max(0, ...outs.map(p => p.nick.length));
  if (!def?.widget && !n.w) w = Math.max(w, 70 + longest * 7, 60 + (n.label ?? def?.name ?? '').length * 6.4);
  return { w, h: HEADER + body + extra + PAD, ins, outs, def, body };
}
const portY = (i: number) => HEADER + ROW * i + ROW / 2;
export const layouts = createMemo(() => new Map(project.graph.nodes.map(n => [n.id, layoutOf(n)])));
export const toWorld = (cx: number, cy: number, el: HTMLElement) => { const r = el.getBoundingClientRect(); return { x: (cx - r.left - ui.panX) / ui.zoom, y: (cy - r.top - ui.panY) / ui.zoom }; };

/** Fuzzy match: all characters of the query must appear in order; earlier and contiguous matches score higher. */
export function fuzzy(query: string, text: string): number {
  const q = query.toLowerCase(), t = text.toLowerCase();
  if (!q) return 1;
  if (t.startsWith(q)) return 1000 - t.length;
  const at = t.indexOf(q);
  if (at >= 0) return 600 - at - t.length * 0.1;
  let ti = 0, score = 0, run = 0;
  for (const ch of q) { const f = t.indexOf(ch, ti); if (f < 0) return 0; run = f === ti ? run + 1 : 0; score += 10 + run * 5 - (f - ti); ti = f + 1; }
  return Math.max(1, score);
}
export function searchComponents(q: string, limit = 12): ComponentDef[] {
  return registry.all().filter(d => d.id !== 'cluster').map(d => ({ d, s: Math.max(fuzzy(q, d.name), fuzzy(q, d.nick) * 0.9, fuzzy(q, d.category + ' ' + d.name) * 0.5) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map(x => x.d);
}

/** A wire end that is waiting for a component: the search then lists only components that can take it. */
interface Link { node: string; port: number; out: boolean; type: DType }
type Found = { kind: 'component'; d: ComponentDef } | { kind: 'template'; t: Template };
/** Index of the port of `def` that best fits data of the link's type: an exact type match first, then anything compatible. */
function fittingPort(ports: PortSpec[], link: Link, used: Set<number> = new Set()): number {
  const ok = (p: PortSpec) => (link.out ? typesCompatible(link.type, p.type) : typesCompatible(p.type, link.type));
  let i = ports.findIndex((p, k) => p.type === link.type && !used.has(k));
  if (i < 0) i = ports.findIndex((p, k) => ok(p) && p.type !== 'any' && !used.has(k));
  if (i < 0) i = ports.findIndex((p, k) => ok(p) && !used.has(k));
  if (i < 0) i = ports.findIndex(ok);
  return i;
}
function searchAll(q: string, link: Link | undefined, limit = 10): Found[] {
  if (link) {
    const fits = (d: ComponentDef) => { const ports = link.out ? d.inputs : d.outputs; return ports.length ? fittingPort(ports, link) >= 0 : !!d.ports && link.out; };
    const exact = (d: ComponentDef) => (link.out ? d.inputs : d.outputs).some(p => p.type === link.type);
    const all = searchComponents(q, 400).filter(fits);
    // With nothing typed yet, components made for exactly this kind of data come first.
    return (q ? all : [...all.filter(exact), ...all.filter(d => !exact(d))]).slice(0, limit).map(d => ({ kind: 'component', d }));
  }
  const comps: Found[] = searchComponents(q, limit).map(d => ({ kind: 'component', d }));
  if (!q) return comps;
  const tpls: Found[] = TEMPLATES.map(t => ({ t, s: Math.max(fuzzy(q, t.title), fuzzy(q, 'template ' + t.title) * 0.6) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3).map(x => ({ kind: 'template', t: x.t }));
  return [...comps.slice(0, limit - tpls.length), ...tpls];
}
/** Insert a template and, when no place is given, put it below the existing graph and scroll there. */
export function insertTemplate(t: Template, at?: { x: number; y: number }): void {
  const spot = at ?? freeSpot(), wasEmpty = !project.graph.nodes.length;
  insertFragment(t.build().project.graph, spot.x, spot.y);
  // On an empty canvas the view is fitted to the new components; otherwise it scrolls to where they were added.
  if (wasEmpty) requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('nodal:fit')));
  else if (!at) setUi({ panX: 40 - spot.x * ui.zoom, panY: 70 - spot.y * ui.zoom });
  (document.querySelector('.canvas') as HTMLElement | null)?.focus();
  toast(`Inserted “${t.title}”. Its components are selected, so you can drag them into place.`);
}
/**
 * Start dragging a list entry (a component or a template) toward the canvas. A small tag follows the
 * pointer; releasing over the canvas calls `drop` with the canvas position, a plain click calls `click`.
 */
export function dragToCanvas(e: PointerEvent, label: string, drop: (x: number, y: number) => void, click: () => void): void {
  if (e.button !== 0) return;
  const x0 = e.clientX, y0 = e.clientY;
  let tag: HTMLDivElement | null = null;
  const mv = (ev: PointerEvent) => {
    if (!tag && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
    if (!tag) { tag = document.createElement('div'); tag.className = 'drag-tag'; tag.textContent = label; document.body.appendChild(tag); }
    tag.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 10}px)`;
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
    if (!tag) { click(); return; }
    tag.remove();
    const canvas = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('.canvas') as HTMLElement | null;
    if (canvas) { const w = toWorld(ev.clientX, ev.clientY, canvas); drop(w.x, w.y); }
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}

export function Canvas(): JSX.Element {
  let root!: HTMLDivElement;
  const [drag, setDrag] = createSignal<null | { from: { node: string; port: number; out: boolean }; x: number; y: number }>(null);
  const [band, setBand] = createSignal<null | { x0: number; y0: number; x1: number; y1: number }>(null);
  const [search, setSearch] = createSignal<null | { x: number; y: number; wx: number; wy: number; q: string; i: number; link?: Link }>(null);
  const [menu, setMenu] = createSignal<null | { x: number; y: number; node: string | null; wire?: string; wx: number; wy: number }>(null);
  const [spaceDown, setSpaceDown] = createSignal(false);

  const fit = (readable = false) => {
    const ns = project.graph.nodes;
    if (!ns.length || !root) return;
    const L = layouts(), x0 = Math.min(...ns.map(n => n.x)), y0 = Math.min(...ns.map(n => n.y)), x1 = Math.max(...ns.map(n => n.x + (L.get(n.id)?.w ?? 150))), y1 = Math.max(...ns.map(n => n.y + (L.get(n.id)?.h ?? 60)));
    const r = root.getBoundingClientRect(), exact = Math.min((r.width - 80) / Math.max(1, x1 - x0), (r.height - 80) / Math.max(1, y1 - y0));
    // Never zoom out so far that labels become unreadable: large graphs start at their top-left corner instead.
    // (A project opens at no less than 70 % so that its text can be read; press F to see all of it.)
    const z = Math.min(1.1 * ui.textScale, Math.max(readable ? 0.7 * ui.textScale : 0.12, exact)), fits = exact >= z - 1e-9;
    setUi({ zoom: z, panX: fits ? (r.width - (x1 - x0) * z) / 2 - x0 * z : 30 - x0 * z, panY: fits ? (r.height - (y1 - y0) * z) / 2 - y0 * z : 46 - y0 * z });
  };
  const onFit = () => fit(true);
  window.addEventListener('nodal:fit', onFit);
  onCleanup(() => window.removeEventListener('nodal:fit', onFit));

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.shiftKey) { setUi('panX', ui.panX - e.deltaY); return; }
    const r = root.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const z = Math.min(2.5 * ui.textScale, Math.max(0.12, ui.zoom * Math.exp(-e.deltaY * 0.0015)));
    setUi({ panX: mx - (mx - ui.panX) * z / ui.zoom, panY: my - (my - ui.panY) * z / ui.zoom, zoom: z });
  };
  /** Generic pointer-drag helper. */
  const track = (e: PointerEvent, move: (ev: PointerEvent, dx: number, dy: number) => void, up?: (ev: PointerEvent, moved: boolean) => void) => {
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const mv = (ev: PointerEvent) => { if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return; moved = true; move(ev, ev.clientX - x0, ev.clientY - y0); };
    const fin = (ev: PointerEvent) => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', fin); up?.(ev, moved); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', fin);
  };
  const startPan = (e: PointerEvent, onClick?: (ev: PointerEvent) => void) => {
    const px = ui.panX, py = ui.panY;
    track(e, (_ev, dx, dy) => setUi({ panX: px + dx, panY: py + dy }), (ev, moved) => { if (!moved) onClick?.(ev); });
  };
  const onBackgroundDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('.node, .popup, .minimap, .wire-hit')) return;
    setMenu(null); setSearch(null);
    root.focus();
    const w = toWorld(e.clientX, e.clientY, root);
    if (e.button === 1 || e.button === 2 || spaceDown()) { e.preventDefault(); startPan(e, ev => { if (ev.button === 2) setMenu({ x: ev.clientX, y: ev.clientY, node: null, wx: w.x, wy: w.y }); }); return; }
    const add = e.shiftKey, before = selection();
    track(e, (ev) => {
      const q = toWorld(ev.clientX, ev.clientY, root);
      setBand({ x0: Math.min(w.x, q.x), y0: Math.min(w.y, q.y), x1: Math.max(w.x, q.x), y1: Math.max(w.y, q.y) });
      const b = band()!, L = layouts();
      const hit = project.graph.nodes.filter(n => { const l = L.get(n.id)!; return n.x < b.x1 && n.x + l.w > b.x0 && n.y < b.y1 && n.y + l.h > b.y0; }).map(n => n.id);
      setSelection(add ? [...new Set([...before, ...hit])] : hit);
    }, (_ev, moved) => { setBand(null); if (!moved && !add) { setSelection([]); setSelectedWire(null); setUi('pick', null); } });
  };
  const onNodeDown = (e: PointerEvent, n: NodeData) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, button, .port, .resize')) return;
    e.stopPropagation(); setMenu(null); setSearch(null); setSelectedWire(null);
    if (e.button === 2) { if (!selection().includes(n.id)) setSelection([n.id]); const w = toWorld(e.clientX, e.clientY, root); setMenu({ x: e.clientX, y: e.clientY, node: n.id, wx: w.x, wy: w.y }); return; }
    if (e.button !== 0) return;
    if (e.shiftKey) setSelection(s => (s.includes(n.id) ? s.filter(x => x !== n.id) : [...s, n.id]));
    else if (!selection().includes(n.id)) setSelection([n.id]);
    const ids = selection(), start = new Map(project.graph.nodes.filter(x => ids.includes(x.id)).map(x => [x.id, { x: x.x, y: x.y }]));
    let pushed = false;
    track(e, (ev, dx, dy) => {
      if (!pushed) { pushUndo(); pushed = true; }
      const snap = ev.altKey ? 1 : 10;
      mutate(p => { for (const x of p.graph.nodes) { const s = start.get(x.id); if (s) { x.x = Math.round((s.x + dx / ui.zoom) / snap) * snap; x.y = Math.round((s.y + dy / ui.zoom) / snap) * snap; } } }, { undo: false, run: false });
    });
  };
  const onPortDown = (e: PointerEvent, node: string, port: number, out: boolean) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    const w = toWorld(e.clientX, e.clientY, root);
    setDrag({ from: { node, port, out }, x: w.x, y: w.y });
    track(e, (ev) => { const q = toWorld(ev.clientX, ev.clientY, root); setDrag(d => d && { ...d, x: q.x, y: q.y }); }, (ev, moved) => {
      const under = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null, el = under?.closest('[data-port]') as HTMLElement | null;
      setDrag(null);
      if (!el) {
        const L = layouts(), src = (out ? L.get(node)?.outs : L.get(node)?.ins)?.[port];
        if (!src || !moved) return;
        const link: Link = { node, port, out, type: src.type }, other = (under?.closest('[data-node]') as HTMLElement | null)?.dataset.node;
        if (other && other !== node) {
          // Released on a component rather than on a port: use the port of that component that fits.
          const lo = L.get(other)!, used = new Set(project.graph.wires.filter(w => w.to === other).map(w => w.inp)), idx = fittingPort(out ? lo.ins : lo.outs, link, out ? used : undefined);
          if (idx < 0) toast('That component has no port for this kind of data.');
          else if (out) connect(node, port, other, idx, ev.shiftKey); else connect(other, idx, node, port, ev.shiftKey);
        } else if (!other && under?.closest('.canvas') && !under.closest('.popup, .minimap, .canvas-tools')) openSearch(ev.clientX, ev.clientY, link);   // released on empty canvas: choose what to connect
        return;
      }
      const [tn, tp, to] = el.dataset.port!.split('|');
      if ((to === 'o') === out) { toast('Connect an output (right side) to an input (left side).'); return; }
      if (out) connect(node, port, tn, Number(tp), ev.shiftKey); else connect(tn, Number(tp), node, port, ev.shiftKey);
    });
  };
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.matches('input, textarea, select') || t.isContentEditable) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (e.key === ' ') { setSpaceDown(true); e.preventDefault(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelection(); e.preventDefault(); }
    else if (mod && k === 'c') copySelection();
    else if (mod && k === 'x') { copySelection(); deleteSelection(); }
    else if (mod && k === 'v') paste();
    else if (mod && k === 'd') { copySelection(); paste(); e.preventDefault(); }
    else if (mod && k === 'a') { setSelection(project.graph.nodes.map(n => n.id)); e.preventDefault(); }
    else if (mod && k === 'g') { groupSelection(); e.preventDefault(); }
    else if (k === 'f' && !mod) fit();
    else if (k === 'p' && !mod) togglePreview();
    else if (e.key.startsWith('Arrow') && selection().length) {
      const d = e.shiftKey ? 50 : 10, dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0, ids = new Set(selection());
      mutate(p => { for (const n of p.graph.nodes) if (ids.has(n.id)) { n.x += dx; n.y += dy; } }, { run: false }); e.preventDefault();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => { if (e.key === ' ') setSpaceDown(false); };
  const togglePreview = () => { const ids = new Set(selection()); if (ids.size) mutate(p => { for (const n of p.graph.nodes) if (ids.has(n.id)) n.preview = n.preview === false; }, { run: false }); };
  const openSearch = (cx: number, cy: number, link?: Link) => { const r = root.getBoundingClientRect(), w = toWorld(cx, cy, root); setSearch({ x: Math.max(4, Math.min(cx - r.left, r.width - 290)), y: Math.max(4, Math.min(cy - r.top, r.height - 330)), wx: w.x, wy: w.y, q: '', i: 0, link }); };
  onMount(() => { const pal = (ev: Event) => { const r = root.getBoundingClientRect(); openSearch(r.left + r.width / 2 - 130, r.top + 80); void ev; }; window.addEventListener('nodal:palette', pal); onCleanup(() => window.removeEventListener('nodal:palette', pal)); });

  /** Wire curve from an output (x1, y1) to an input (x2, y2). A wire that runs backward gets a wider loop so that it clears both components. */
  const wirePath = (x1: number, y1: number, x2: number, y2: number) => { const back = x2 < x1 + 20, dx = back ? Math.min(160, 60 + Math.abs(y2 - y1) * 0.35) : Math.max(36, Math.abs(x2 - x1) * 0.45); return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`; };
  const nodeMap = createMemo(() => new Map(project.graph.nodes.map(n => [n.id, n])));

  return (
    <div class="canvas" ref={root} tabindex="0" onWheel={onWheel} onPointerDown={onBackgroundDown} onKeyDown={onKey} onKeyUp={onKeyUp} onContextMenu={e => e.preventDefault()}
      onDblClick={e => { if (!(e.target as HTMLElement).closest('.node, .popup, .minimap')) openSearch(e.clientX, e.clientY); }}
      style={{ 'background-position': `${ui.panX}px ${ui.panY}px`, 'background-size': `${20 * ui.zoom}px ${20 * ui.zoom}px`, cursor: spaceDown() ? 'grab' : 'default' }}>
      <div class="world" style={{ transform: `translate(${ui.panX}px, ${ui.panY}px) scale(${ui.zoom})`, '--z': String(ui.zoom), '--tsz': String(ui.textScale) }}>
        <For each={project.graph.groups}>{g => {
          const box = createMemo(() => { const L = layouts(), ns = g.nodes.map(id => nodeMap().get(id)).filter(Boolean) as NodeData[]; if (!ns.length) return null; const x0 = Math.min(...ns.map(n => n.x)) - 14, y0 = Math.min(...ns.map(n => n.y)) - 30; return { x: x0, y: y0, w: Math.max(...ns.map(n => n.x + (L.get(n.id)?.w ?? 150))) + 14 - x0, h: Math.max(...ns.map(n => n.y + (L.get(n.id)?.h ?? 60))) + 14 - y0 }; });
          return <Show when={box()}>{b => <div class="group" style={{ left: b().x + 'px', top: b().y + 'px', width: b().w + 'px', height: b().h + 'px', 'border-color': g.color, background: g.color + '14' }}>
            <span class="group-label" style={{ color: g.color }} title="Double-click to rename, right-click to remove" onDblClick={e => { e.stopPropagation(); const name = prompt('Group name', g.label); if (name !== null) mutate(p => { const x = p.graph.groups.find(q => q.id === g.id); if (x) x.label = name; }, { run: false }); }}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); mutate(p => { p.graph.groups = p.graph.groups.filter(q => q.id !== g.id); }, { run: false }); }}>{g.label}</span></div>}</Show>;
        }}</For>
        <svg class="wires">
          <For each={project.graph.wires}>{w => {
            const geo = createMemo(() => { const a = nodeMap().get(w.from), b = nodeMap().get(w.to), L = layouts(), la = L.get(w.from), lb = L.get(w.to); if (!a || !b || !la || !lb) return null; return { d: wirePath(a.x + la.w, a.y + portY(w.out), b.x, b.y + portY(w.inp)), color: TYPE_COLORS[la.outs[w.out]?.type ?? 'any'] }; });
            const wide = createMemo(() => { runTick(); const t = engine.outputs(w.from)[w.out]; return !t ? 1.6 : t.branchCount > 1 ? 3.4 : t.dataCount > 1 ? 2.4 : 1.6; });
            return <Show when={geo()}>{g => <g>
              <path class="wire-hit" d={g().d} onPointerDown={e => { e.stopPropagation(); setSearch(null); setSelection([]); setSelectedWire(w.id); root.focus(); if (e.button === 2) { const q = toWorld(e.clientX, e.clientY, root); setMenu({ x: e.clientX, y: e.clientY, node: null, wire: w.id, wx: q.x, wy: q.y }); } else setMenu(null); }}><title>Click to select, right-click for options</title></path>
              <path class="wire" classList={{ sel: selectedWire() === w.id, tree: wide() > 3 }} d={g().d} stroke={g().color} stroke-width={wide()} />
            </g>}</Show>;
          }}</For>
          <Show when={drag()}>{d => { const n = nodeMap().get(d().from.node)!, l = layouts().get(n.id)!; const px = d().from.out ? n.x + l.w : n.x, py = n.y + portY(d().from.port); return <path class="wire temp" d={d().from.out ? wirePath(px, py, d().x, d().y) : wirePath(d().x, d().y, px, py)} />; }}</Show>
        </svg>
        <For each={project.graph.nodes}>{n => <NodeView n={n} onDown={onNodeDown} onPort={onPortDown} />}</For>
        <Show when={band()}>{b => <div class="band" style={{ left: b().x0 + 'px', top: b().y0 + 'px', width: b().x1 - b().x0 + 'px', height: b().y1 - b().y0 + 'px' }} />}</Show>
      </div>
      <Show when={!project.graph.nodes.length && ui.tour < 0}><div class="empty-state"><h3>Start with a template, or add a component</h3><p>A template drops a small complete model onto the canvas. To build from scratch, double-click anywhere and type a name, such as <b>line</b>, <b>slider</b> or <b>beam</b>.</p>
        <div class="row center"><button class="primary" onClick={() => insertTemplate(TEMPLATES[0], { x: 60, y: 60 })}>Insert a simply supported beam</button><button onClick={() => { setUi('palette', true); setPaletteTab('templates'); }}>All templates</button><button onClick={() => setUi('dialog', 'examples')}>Examples</button></div></div></Show>
      <Show when={search()}>{s => {
        const results = createMemo(() => searchAll(s().q, s().link, 10));
        const pick = (f: Found) => {
          const link = s().link;
          if (f.kind === 'template') insertTemplate(f.t, { x: s().wx, y: s().wy });
          else if (!link) addNode(f.d.id, s().wx, s().wy);
          else {
            // Place the new component so that the port it is wired to sits near where the wire was released, then connect.
            const id = addNode(f.d.id, link.out ? s().wx + 20 : s().wx - (f.d.width ?? 150) - 20, s().wy - 34), made = nodeById(id);
            if (made) { const ports = portsOf(made, unwrap(project)), idx = fittingPort(link.out ? ports.inputs : ports.outputs, link); if (idx >= 0) { if (link.out) connect(link.node, link.port, id, idx); else connect(id, idx, link.node, link.port); } }
          }
          setSearch(null); root.focus();
        };
        return <div class="popup search" style={{ left: s().x + 'px', top: s().y + 'px' }} onPointerDown={e => e.stopPropagation()}>
          <input ref={el => setTimeout(() => el.focus())} placeholder={s().link ? `Connect ${s().link!.type} data to…` : 'Type a component or template name…'} value={s().q} aria-label="Search components"
            onInput={e => setSearch(v => v && { ...v, q: e.currentTarget.value, i: 0 })}
            onKeyDown={e => { e.stopPropagation(); const r = results(); if (e.key === 'Escape') { setSearch(null); root.focus(); } else if (e.key === 'ArrowDown') { setSearch(v => v && { ...v, i: Math.min(r.length - 1, v.i + 1) }); e.preventDefault(); } else if (e.key === 'ArrowUp') { setSearch(v => v && { ...v, i: Math.max(0, v.i - 1) }); e.preventDefault(); } else if (e.key === 'Enter' && r[s().i]) pick(r[s().i]); }} />
          <div class="results" role="listbox"><For each={results()}>{(f, i) => (f.kind === 'component'
            ? <div class="result" role="option" classList={{ on: i() === s().i }} onPointerDown={() => pick(f)}><i style={{ background: CATEGORY_COLORS[f.d.category] }} /><b>{f.d.name}</b><span>{f.d.category}</span><small>{f.d.desc}</small></div>
            : <div class="result" role="option" classList={{ on: i() === s().i }} onPointerDown={() => pick(f)}><i class="tpl" /><b>{f.t.title}</b><span>Template</span><small>{f.t.summary}</small></div>)}</For>
            <Show when={!results().length}><div class="result none">{s().link ? 'No component takes this kind of data under that name.' : `Nothing matches “${s().q}”.`}</div></Show></div>
        </div>;
      }}</Show>
      <Show when={menu()}>{m => {
        const item = (label: string, fn: () => void, key = '') => <button onClick={() => { fn(); setMenu(null); root.focus(); }}>{label}<kbd>{key}</kbd></button>;
        const r = () => root.getBoundingClientRect();
        const setMatch = (mode: 'longest' | 'shortest' | 'cross') => { const ids = new Set(selection()); mutate(p => { for (const n of p.graph.nodes) if (ids.has(n.id)) n.matching = mode; }); };
        return <div class="popup menu" style={{ left: Math.max(4, Math.min(m().x - r().left, r().width - 250)) + 'px', top: Math.max(4, Math.min(m().y - r().top, r().height - (m().node ? 420 : m().wire ? 90 : 470))) + 'px', 'max-height': r().height - 12 + 'px' }} onPointerDown={e => e.stopPropagation()}>
          <Show when={m().node} fallback={<Show when={m().wire} fallback={<>
            {item('Add component…', () => openSearch(m().x, m().y), 'Dbl-click')}{item('Paste', () => paste({ x: m().wx, y: m().wy }), 'Ctrl V')}{item('Select all', () => setSelection(project.graph.nodes.map(n => n.id)), 'Ctrl A')}{item('Zoom to fit', () => fit(), 'F')}
            <hr /><div class="menu-title">Insert template here</div><For each={TEMPLATES}>{t => item(t.title, () => insertTemplate(t, { x: m().wx, y: m().wy }))}</For>
            <Show when={clusterLibrary().length}><hr /><div class="menu-title">Insert saved cluster</div><For each={clusterLibrary()}>{c => item(c.name, () => insertCluster(c, m().wx, m().wy))}</For></Show>
          </>}>
            {item('Delete wire', () => deleteWire(m().wire!), 'Del')}
            {item('Show its data in a panel', () => { const w = project.graph.wires.find(x => x.id === m().wire); if (!w) return; const id = addNode('param.panel', m().wx + 20, m().wy + 30); connect(w.from, w.out, id, 0); })}
          </Show>}>
            {item('Toggle preview', togglePreview, 'P')}
            {item('Enable / disable', () => { const ids = new Set(selection()); mutate(p => { for (const n of p.graph.nodes) if (ids.has(n.id)) n.enabled = n.enabled === false; }); })}
            {item('Rename…', () => { const n = nodeMap().get(m().node!)!; const name = prompt('Label for this component', n.label ?? layouts().get(n.id)?.def?.name ?? ''); if (name !== null) mutate(p => { const x = p.graph.nodes.find(q => q.id === n.id); if (x) x.label = name || undefined; }, { run: false }); })}
            <hr />{item('Copy', copySelection, 'Ctrl C')}{item('Duplicate', () => { copySelection(); paste(); }, 'Ctrl D')}{item('Delete', deleteSelection, 'Del')}
            <hr />{item('Group', groupSelection, 'Ctrl G')}{item('Make cluster', clusterSelection)}
            <hr /><div class="menu-title">Matching</div>{item('Longest list', () => setMatch('longest'))}{item('Shortest list', () => setMatch('shortest'))}{item('Cross reference', () => setMatch('cross'))}
            <Show when={selection().length > 1}><hr />{item('Align left', () => alignSelection('left'))}{item('Align top', () => alignSelection('top'))}{item('Space evenly (horizontal)', () => alignSelection('hspace'))}{item('Space evenly (vertical)', () => alignSelection('vspace'))}</Show>
          </Show>
        </div>;
      }}</Show>
      <Minimap getRoot={() => root} />
      <div class="canvas-tools"><button title="Zoom to fit (F)" onClick={() => fit()} aria-label="Zoom canvas to fit">⤢</button><span>{Math.round(ui.zoom * 100)}%</span></div>
    </div>
  );
}

function NodeView(props: { n: NodeData; onDown: (e: PointerEvent, n: NodeData) => void; onPort: (e: PointerEvent, node: string, port: number, out: boolean) => void }): JSX.Element {
  const n = props.n;
  const l = createMemo(() => layouts().get(n.id) ?? layoutOf(n));
  const status = createMemo(() => { runTick(); return engine.status(n.id); });
  const wired = createMemo(() => new Set(project.graph.wires.filter(w => w.to === n.id).map(w => w.inp)));
  const def = () => l().def;
  const sel = () => selection().includes(n.id);
  const set = (fn: (s: Record<string, any>) => void, undoable = true) => mutate(p => { const x = p.graph.nodes.find(q => q.id === n.id); if (x) fn(x.state); }, { undo: undoable });
  const title = () => { const s = status(); return [def()?.desc ?? 'Unknown component', s.messages.length ? '\n' + s.messages.join('\n') : '', s.ms > 20 ? `\n(${s.ms.toFixed(0)} ms)` : ''].join(''); };
  const u = () => unitSystem(project.units);
  const exprTex = createMemo(() => { if (n.type !== 'math.expr') return ''; try { return exprToTex(String(n.state.expr ?? '')); } catch { return ''; } });
  // A note that contains $...$ mathematics is shown typeset; double-click it to edit the text.
  const [editingNote, setEditingNote] = createSignal(false);
  return (
    <div class="node" classList={{ sel: sel(), [status().state]: true, busy: solvingNode() === n.id, hidden: n.preview === false, ['w-' + (def()?.widget ?? 'none')]: true }} data-node={n.id}
      style={{ left: n.x + 'px', top: n.y + 'px', width: l().w + 'px', height: l().h + 'px', '--cat': CATEGORY_COLORS[def()?.category ?? ''] ?? '#888' }}
      onPointerDown={e => props.onDown(e, n)}>
      <Show when={def()?.widget !== 'note'}>
        <div class="hd" title={title() + '\n\nDouble-click to rename.'} onDblClick={e => { e.stopPropagation(); const name = prompt('Label for this component', n.label ?? def()?.name ?? ''); if (name !== null) mutate(p => { const x = p.graph.nodes.find(q => q.id === n.id); if (x) x.label = name.trim() || undefined; }, { run: false }); }}><span class="nm">{n.label ?? def()?.name ?? n.type}</span>
          <Show when={n.matching && n.matching !== 'longest'}><span class="badge" title={`Matching: ${n.matching}`}>{n.matching === 'cross' ? '×' : '≤'}</span></Show>
          <Show when={status().state === 'error' || status().state === 'warning'}><span class="flag" title={status().messages.join('\n')}>!</span></Show></div>
      </Show>
      <For each={l().ins}>{(p, i) => <div class="port in" data-port={`${n.id}|${i()}|i`} style={{ top: portY(i()) - ROW / 2 + 'px' }} title={`${p.name} (${p.type}${p.unit ? ', ' + (u() as any)[p.unit]?.label : ''})\n${p.desc}`} onPointerDown={e => props.onPort(e, n.id, i(), false)}>
        <i style={{ background: TYPE_COLORS[p.type] }} classList={{ empty: !wired().has(i()) }} /><label>{p.nick}<Show when={n.mods?.[p.name]}><sup>{['flatten', 'graft', 'simplify', 'reverse'].filter(k => (n.mods![p.name] as any)[k]).map(k => k[0].toUpperCase()).join('')}</sup></Show></label></div>}</For>
      <For each={l().outs}>{(p, i) => <div class="port out" data-port={`${n.id}|${i()}|o`} style={{ top: portY(i()) - ROW / 2 + 'px' }} title={`${p.name} (${p.type}${p.unit ? ', ' + (u() as any)[p.unit]?.label : ''})\n${p.desc}`} onPointerDown={e => props.onPort(e, n.id, i(), true)}>
        <label>{p.nick}</label><i style={{ background: TYPE_COLORS[p.type] }} /></div>}</For>
      <Show when={def()?.widget === 'slider'}><div class="widget slider">
        <input type="range" min={n.state.min} max={n.state.max} step={n.state.integer ? 1 : n.state.step || 'any'} value={n.state.value} aria-label={n.label ?? 'Slider'}
          onPointerDown={() => pushUndo()} onInput={e => set(s => { s.value = Number(e.currentTarget.value); }, false)} />
        <input type="number" class="num" value={n.state.value} step={n.state.integer ? 1 : n.state.step || 'any'} onChange={e => set(s => { const val = Number(e.currentTarget.value); if (Number.isFinite(val)) { s.value = val; s.min = Math.min(s.min, val); s.max = Math.max(s.max, val); } })} />
      </div></Show>
      <Show when={def()?.widget === 'toggle'}><div class="widget"><button class="toggle" classList={{ on: !!n.state.value }} onClick={() => set(s => { s.value = !s.value; })} aria-pressed={!!n.state.value}>{n.state.value ? 'True' : 'False'}</button></div></Show>
      <Show when={def()?.widget === 'valuelist'}><div class="widget"><select value={n.state.index} onChange={e => set(s => { s.index = Number(e.currentTarget.value); })} aria-label="Value">
        <For each={n.state.items as { name: string }[]}>{(it, i) => <option value={i()}>{it.name}</option>}</For></select></div></Show>
      <Show when={def()?.widget === 'color'}><div class="widget"><input type="color" value={n.state.value} onInput={e => set(s => { s.value = e.currentTarget.value; }, false)} aria-label="Color" /></div></Show>
      <Show when={def()?.widget === 'text'}><div class="widget below" style={{ top: HEADER + l().body + 'px' }}>
        <Show when={n.type === 'tree.pathmap'} fallback={<input type="text" value={n.type === 'math.expr' ? n.state.expr : n.state.name} spellcheck={false} aria-label="Text"
          onChange={e => set(s => { if (n.type === 'math.expr') s.expr = e.currentTarget.value; else s.name = e.currentTarget.value; })} />}>
          <input type="text" class="half" value={n.state.source} onChange={e => set(s => { s.source = e.currentTarget.value; })} aria-label="Source mask" /><span>→</span><input type="text" class="half" value={n.state.target} onChange={e => set(s => { s.target = e.currentTarget.value; })} aria-label="Target mask" /></Show>
      </div></Show>
      <Show when={n.type === 'math.expr'}><div class="expr-tex" style={{ top: HEADER + l().body + 26 + 'px', height: EXPR_TEX - 4 + 'px' }} title="The formula as written above">
        <Show when={exprTex()} fallback={<span class="muted">not a valid formula</span>}>{t => <Tex tex={t()} />}</Show></div></Show>
      <Show when={def()?.widget === 'graph'}><svg class="widget below graphmap" style={{ top: HEADER + l().body + 'px' }} viewBox="0 0 100 50" preserveAspectRatio="none">
        <path d={'M' + Array.from({ length: 41 }, (_, i) => `${i * 2.5},${48 - 46 * graphMap(n.state.kind, n.state.p, i / 40)}`).join(' L')} /></svg></Show>
      <Show when={def()?.widget === 'panel'}><PanelBody n={n} /></Show>
      <Show when={def()?.widget === 'note'}>
        <Show when={hasMath(String(n.state.text ?? '')) && !editingNote()} fallback={<textarea class="note-text" ref={el => { if (editingNote()) setTimeout(() => el.focus()); }} value={n.state.text} onChange={e => set(s => { s.text = e.currentTarget.value; })} onBlur={() => setEditingNote(false)} aria-label="Note" placeholder="Note. Text between $ signs is typeset as a formula, for example $\frac{wL^2}{8}$" />}>
          <div class="note-text rich" title="Double-click to edit" onDblClick={e => { e.stopPropagation(); setEditingNote(true); }}><RichText text={String(n.state.text)} /></div></Show>
      </Show>
      <Show when={def()?.widget === 'optimizer'}><div class="widget below opt" style={{ top: HEADER + l().body + 'px' }}>
        <svg viewBox="0 0 100 30" preserveAspectRatio="none"><Show when={(n.state.history ?? []).length > 1}><path d={sparkline(n.state.history)} /></Show></svg>
        <small>{(n.state.genes ?? []).length} sliders · {(n.state.history ?? []).length ? 'best ' + formatValue(n.state.history[n.state.history.length - 1]) : 'select to set up'}</small></div></Show>
      <Show when={def()?.widget === 'panel' || def()?.widget === 'note'}><div class="resize" onPointerDown={e => {
        e.stopPropagation(); e.preventDefault(); pushUndo();
        const w0 = l().w, h0 = l().body, x0 = e.clientX, y0 = e.clientY;
        const mv = (ev: PointerEvent) => mutate(p => { const x = p.graph.nodes.find(q => q.id === n.id); if (x) { x.w = Math.max(120, Math.round(w0 + (ev.clientX - x0) / ui.zoom)); x.h = Math.max(40, Math.round(h0 + (ev.clientY - y0) / ui.zoom)); } }, { undo: false, run: false });
        const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      }} /></Show>
    </div>
  );
}
export function sparkline(h: number[]): string {
  const f = h.filter(Number.isFinite);
  if (f.length < 2) return '';
  const lo = Math.min(...f), hi = Math.max(...f), span = hi - lo || 1;
  return 'M' + h.map((val, i) => `${(i / (h.length - 1)) * 100},${28 - 26 * ((Number.isFinite(val) ? val : hi) - lo) / span}`).join(' L');
}
/** Text shown in a panel: the incoming tree (truncated), or the editable text when nothing is wired. */
export function panelText(id: string, limit = 400): string {
  const t = engine.inputs(id)[0];
  if (!t || (!t.branchCount)) return '';
  const lines: string[] = [];
  let count = 0;
  for (const b of t.branches) {
    if (t.branchCount > 1) lines.push(`${pathText(b.path)}  (${b.items.length})`);
    b.items.forEach((it, i) => { if (count++ < limit) lines.push(`${String(i).padStart(2, ' ')}  ${formatValue(it)}`); });
  }
  if (count > limit) lines.push(`… ${count - limit} more items`);
  return lines.join('\n');
}
function PanelBody(props: { n: NodeData }): JSX.Element {
  const n = props.n;
  const hasInput = createMemo(() => project.graph.wires.some(w => w.to === n.id));
  const text = createMemo(() => { runTick(); return panelText(n.id); });
  const table = createMemo<TableValue | null>(() => { runTick(); const it = engine.inputs(n.id)[0]?.first() as any; return hasInput() && it?.k === 'table' ? it : null; });
  return <Show when={!table()} fallback={<div class="panel-text panel-table">
    <Show when={table()!.title}><b>{table()!.title}</b></Show>
    <table class="grid"><thead><tr><For each={table()!.head}>{h => <th>{h}</th>}</For></tr></thead>
      <tbody><For each={table()!.rows}>{row => <tr classList={{ failrow: row[row.length - 1] === '✗' }}><For each={row}>{c => <td><RichText text={c} big /></td>}</For></tr>}</For></tbody></table>
    <Show when={table()!.foot}><p class="muted">{table()!.foot}</p></Show></div>}><Show when={hasInput()} fallback={<textarea class="panel-text" placeholder="Type values, one per line…" value={n.state.text} spellcheck={false} aria-label="Panel text"
    onChange={e => mutate(p => { const x = p.graph.nodes.find(q => q.id === n.id); if (x) x.state.text = e.currentTarget.value; })} />}><pre class="panel-text">{text()}</pre></Show></Show>;
}

function Minimap(props: { getRoot: () => HTMLDivElement }): JSX.Element {
  const W = 170, H = 110;
  const geo = createMemo(() => {
    const ns = project.graph.nodes, L = layouts();
    if (!ns.length) return null;
    const x0 = Math.min(...ns.map(n => n.x)) - 100, y0 = Math.min(...ns.map(n => n.y)) - 100, x1 = Math.max(...ns.map(n => n.x + (L.get(n.id)?.w ?? 150))) + 100, y1 = Math.max(...ns.map(n => n.y + (L.get(n.id)?.h ?? 60))) + 100;
    const s = Math.min(W / (x1 - x0), H / (y1 - y0));
    return { x0, y0, s };
  });
  const nav = (e: PointerEvent) => { const g = geo(), root = props.getRoot(); if (!g || !root) return; const r = (e.currentTarget as HTMLElement).getBoundingClientRect(), rr = root.getBoundingClientRect(); const wx = g.x0 + (e.clientX - r.left) / g.s, wy = g.y0 + (e.clientY - r.top) / g.s; batch(() => setUi({ panX: rr.width / 2 - wx * ui.zoom, panY: rr.height / 2 - wy * ui.zoom })); };
  return <Show when={geo()}>{g => {
    const view = () => { const root = props.getRoot(); if (!root) return { x: 0, y: 0, w: 0, h: 0 }; const rr = root.getBoundingClientRect(); return { x: (-ui.panX / ui.zoom - g().x0) * g().s, y: (-ui.panY / ui.zoom - g().y0) * g().s, w: rr.width / ui.zoom * g().s, h: rr.height / ui.zoom * g().s }; };
    return <svg class="minimap" width={W} height={H} onPointerDown={e => { e.stopPropagation(); nav(e); const mv = (ev: PointerEvent) => nav({ ...ev, currentTarget: e.currentTarget, clientX: ev.clientX, clientY: ev.clientY } as any); const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); }; window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); }} aria-label="Minimap">
      <For each={project.graph.nodes}>{n => <rect x={(n.x - g().x0) * g().s} y={(n.y - g().y0) * g().s} width={Math.max(2, (layouts().get(n.id)?.w ?? 150) * g().s)} height={Math.max(2, (layouts().get(n.id)?.h ?? 60) * g().s)} fill={CATEGORY_COLORS[layouts().get(n.id)?.def?.category ?? ''] ?? '#888'} opacity={selection().includes(n.id) ? 1 : 0.55} />}</For>
      <rect class="mm-view" x={view().x} y={view().y} width={view().w} height={view().h} />
    </svg>;
  }}</Show>;
}

export const [paletteTab, setPaletteTab] = createSignal<'components' | 'templates'>('components');
/**
 * Left-hand list with two tabs: single components by category, and templates (ready-made groups of
 * components). Click an entry to add it, or drag it onto the canvas to choose where it goes.
 */
export function Palette(): JSX.Element {
  const [q, setQ] = createSignal('');
  const [open, setOpen] = createSignal<Record<string, boolean>>({ Params: true, Structure: true });
  const cats = createMemo(() => { const m = new Map<string, ComponentDef[]>(); for (const d of registry.all()) { if (d.id === 'cluster' || d.id.startsWith('cluster.')) continue; const l = m.get(d.category); if (l) l.push(d); else m.set(d.category, [d]); } return [...m.entries()]; });
  const center = () => {
    const el = document.querySelector('.canvas') as HTMLElement | null, r = el?.getBoundingClientRect(), k = project.graph.nodes.length % 6;
    return { x: (r ? (r.width / 2 - ui.panX) / ui.zoom : 100) - 70 + k * 24, y: (r ? (r.height / 2 - ui.panY) / ui.zoom : 100) - 40 + k * 24 };
  };
  const Item = (p: { d: ComponentDef }) => <button class="pal-item" title={p.d.desc + (p.d.example ? '\n\nExample: ' + p.d.example : '') + '\n\nClick to add, or drag onto the canvas.'}
    onPointerDown={e => dragToCanvas(e, p.d.name, (x, y) => addNode(p.d.id, x - 20, y - 12), () => { const c = center(); addNode(p.d.id, c.x, c.y); })}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const c = center(); addNode(p.d.id, c.x, c.y); } }}><i style={{ background: CATEGORY_COLORS[p.d.category] }} />{p.d.name}</button>;
  const tplGroups = createMemo(() => { const f = q().toLowerCase(), m = new Map<string, Template[]>(); for (const t of TEMPLATES) { if (f && !(t.title + ' ' + t.summary).toLowerCase().includes(f)) continue; const l = m.get(t.group); if (l) l.push(t); else m.set(t.group, [t]); } return [...m.entries()]; });
  return <aside class="palette" aria-label="Components and templates">
    <div class="pal-tabs" role="tablist"><For each={[['components', 'Components'], ['templates', 'Templates']] as ['components' | 'templates', string][]}>{([k, label]) => <button role="tab" aria-selected={paletteTab() === k} classList={{ on: paletteTab() === k }} onClick={() => setPaletteTab(k)}>{label}</button>}</For></div>
    <input class="pal-search" type="search" placeholder={paletteTab() === 'components' ? 'Search components' : 'Search templates'} value={q()} onInput={e => setQ(e.currentTarget.value)} aria-label="Search" />
    <div class="pal-list">
      <Show when={paletteTab() === 'components'} fallback={<>
        <p class="pal-note">A template adds a group of connected components to this project. Click to add it below your graph, or drag it onto the canvas.</p>
        <For each={tplGroups()}>{([group, list]) => <section><div class="pal-cat static">{group}</div>
          <For each={list}>{t => <button class="pal-tpl" title="Click to add, or drag onto the canvas"
            onPointerDown={e => dragToCanvas(e, t.title, (x, y) => insertTemplate(t, { x, y }), () => insertTemplate(t))}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); insertTemplate(t); } }}><b>{t.title}</b><small>{t.summary}</small></button>}</For></section>}</For>
        <Show when={!tplGroups().length}><p class="pal-note">No template matches “{q()}”.</p></Show>
      </>}>
        <Show when={!q()} fallback={<For each={searchComponents(q(), 40)}>{d => <Item d={d} />}</For>}>
          <For each={cats()}>{([cat, defs]) => <section>
            <button class="pal-cat" aria-expanded={!!open()[cat]} onClick={() => setOpen(o => ({ ...o, [cat]: !o[cat] }))}><i style={{ background: CATEGORY_COLORS[cat] }} />{cat}<span>{defs.length}</span></button>
            <Show when={open()[cat]}><For each={defs}>{d => <Item d={d} />}</For></Show>
          </section>}</For>
          <Show when={clusterLibrary().length}><section><div class="pal-cat static">My clusters</div><For each={clusterLibrary()}>{c => <button class="pal-item" onClick={() => insertCluster(c, (300 - ui.panX) / ui.zoom, (200 - ui.panY) / ui.zoom)}><i style={{ background: '#5f6b7a' }} />{c.name}</button>}</For></section></Show>
        </Show>
      </Show>
    </div>
  </aside>;
}
