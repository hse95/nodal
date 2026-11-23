/**
 * The ribbon: every component as an icon, grouped under one tab per category,
 * plus tabs for templates, examples and the verification models. Click an icon
 * to add the component in the middle of the canvas, or drag it to where it
 * should go. The ribbon can be collapsed to its row of tabs.
 */
import { createMemo, createSignal, For, JSX, Show } from 'solid-js';
import { ui, setUi, setSide, registry, addNode, clusterLibrary, insertCluster } from './store';
import { CATEGORY_COLORS, dragToCanvas, insertTemplate, canvasCenter, searchComponents } from './Canvas';
import { Icon, Thumb } from './Icon';
import { TEMPLATES } from '../templates';
import { EXAMPLES } from '../examples';
import { BENCHMARKS } from '../verify/load';
import type { ComponentDef } from '../core/types';

const TOOLS = new Set(['Form-Finding', 'Optimization', 'Script']);
const tabOf = (d: ComponentDef): string => (TOOLS.has(d.category) ? 'Tools' : d.category);
export const COMPONENT_TABS = ['Params', 'Math', 'Lists', 'Trees', 'Vector', 'Curve', 'Surface', 'Mesh', 'Transform', 'Display', 'Structure', 'Tools'];
const EXTRA_TABS = ['Templates', 'Examples', 'Verification'];

/** Which group of its tab a component is shown in (first match wins). */
const GROUP_RULES: [RegExp, string][] = [
  [/^param\.(slider|toggle|valuelist|panel|graph|color|note|file)$/, 'Input'], [/^param\./, 'Data'],
  [/^math\.(add|sub|mul|div|neg|abs|sqrt|pow|mod|exp|ln|log10|round|clamp)$/, 'Arithmetic'], [/^math\.(sin|cos|tan|asin|acos|atan|atan2|deg|rad|pi)$/, 'Trigonometry'],
  [/^math\.(min|max|sum|avg|bounds|range|series|random|domain|dedomain|remap)$/, 'Numbers and ranges'], [/^math\.expr$/, 'Formula'], [/^math\./, 'Logic'],
  [/^list\./, 'Lists'], [/^tree\./, 'Data trees'],
  [/^vec\./, 'Points and vectors'], [/^plane\./, 'Planes'], [/^grid\./, 'Grids'],
  [/^crv\.(line|linesdl|polyline|arc|arc3|circle|rectangle|polygon|interp|nurbs)$/, 'Create'], [/^crv\.(divide|dividelength|eval|ends|closest|length|curvature|cps|ccx)$/, 'Analyze'], [/^crv\./, 'Edit'],
  [/^srf\./, 'Surfaces'], [/^solid\./, 'Solids'],
  [/^mesh\.(union|difference|intersection)$/, 'Booleans'], [/^mesh\./, 'Meshes'],
  [/^xform\.array/, 'Arrays'], [/^xform\./, 'Move and shape'], [/^disp\./, 'Display'],
  [/^fe\.(material|sec)/, 'Materials and sections'], [/^fe\.(beam|truss|cable|release|offset|shell)$/, 'Elements'], [/^fe\.support/, 'Supports'], [/^fe\.load/, 'Loads'],
  [/^fe\.(assemble|static|second|buckling|modal|nonlinear|sizing)$/, 'Analysis'], [/^fe\.(view|res)/, 'Results'], [/^fe\.benchmark/, 'Verification'],
  [/^ff\./, 'Form-finding'], [/^opt\./, 'Optimization'], [/^(script|cluster)/, 'Script and clusters'],
];
const groupOf = (id: string): string => GROUP_RULES.find(([re]) => re.test(id))?.[1] ?? 'Other';

/** How a verification model is opened from the ribbon: as its single component, or built from ordinary components. */
export const [benchAsComponents, setBenchAsComponents] = createSignal(false);

export function Ribbon(props: { onExample: (id: string) => void; onAllExamples: () => void; onVerify: () => void; onBenchmark: (id: string, asComponents: boolean) => void }): JSX.Element {
  const [q, setQ] = createSignal('');
  const [tip, setTip] = createSignal<null | { x: number; y: number; title: string; text: string }>(null);
  let tipTimer = 0;
  const hover = (e: PointerEvent, title: string, text: string) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect(), show = () => setTip({ x: Math.min(r.left, window.innerWidth - 300), y: r.bottom + 6, title, text });
    clearTimeout(tipTimer);
    if (tip()) show(); else tipTimer = window.setTimeout(show, 350);
  };
  const leave = () => { clearTimeout(tipTimer); setTip(null); };
  const tab = () => ui.ribbonTab;
  const select = (t: string) => { setQ(''); setUi({ ribbonTab: t, ribbon: true }); remember(true); };
  const remember = (open: boolean) => { try { localStorage.setItem('nodal.ribbon', open ? '1' : '0'); } catch { /* storage unavailable */ } };
  const groups = createMemo(() => {
    const m = new Map<string, ComponentDef[]>();
    for (const d of registry.all()) { if (d.id === 'cluster' || tabOf(d) !== tab()) continue; const g = groupOf(d.id), l = m.get(g); if (l) l.push(d); else m.set(g, [d]); }
    return [...m.entries()];
  });
  const add = (d: ComponentDef) => { const c = canvasCenter(); addNode(d.id, c.x, c.y); };
  const Btn = (p: { d: ComponentDef; wide?: boolean }) => <button class="rb-btn" classList={{ wide: p.wide }} aria-label={p.d.name}
    onPointerEnter={e => hover(e, p.d.name, p.d.desc)} onPointerLeave={leave}
    onPointerDown={e => { leave(); dragToCanvas(e, p.d.name, (x, y) => addNode(p.d.id, x - 20, y - 12), () => add(p.d)); }}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); add(p.d); } }}>
    <Icon id={p.d.id} nick={p.d.nick} color={CATEGORY_COLORS[p.d.category]} size={22} /><Show when={p.wide}><span>{p.d.name}</span></Show></button>;
  const found = createMemo(() => (q() ? searchComponents(q(), 24) : []));
  const foundTemplates = createMemo(() => { const f = q().toLowerCase(); return f ? TEMPLATES.filter(t => (t.title + ' ' + t.summary).toLowerCase().includes(f)) : []; });
  const scrollX = (e: WheelEvent) => { const el = e.currentTarget as HTMLElement; if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) { el.scrollLeft += e.deltaY; e.preventDefault(); } };
  const TemplateCard = (p: { t: typeof TEMPLATES[number] }) => <button class="rb-card" aria-label={p.t.title}
    onPointerEnter={e => hover(e, p.t.title, p.t.summary + ' Click to add it, or drag it onto the canvas.')} onPointerLeave={leave}
    onPointerDown={e => { leave(); dragToCanvas(e, p.t.title, (x, y) => insertTemplate(p.t, { x, y }), () => insertTemplate(p.t), p.t.id); }}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); insertTemplate(p.t); } }}><Thumb id={p.t.id} color="#d4504c" /><span>{p.t.title}</span></button>;
  return <div class="ribbon" classList={{ closed: !ui.ribbon }} aria-label="Components, templates and examples">
    <div class="rb-tabs" role="tablist">
      <For each={COMPONENT_TABS}>{t => <button role="tab" aria-selected={ui.ribbon && tab() === t && !q()} classList={{ on: ui.ribbon && tab() === t && !q() }} style={{ '--ic': CATEGORY_COLORS[t] ?? CATEGORY_COLORS.Script }} onClick={() => select(t)}>{t}</button>}</For>
      <i class="rb-sep" />
      <For each={EXTRA_TABS}>{t => <button role="tab" class="extra" aria-selected={ui.ribbon && tab() === t && !q()} classList={{ on: ui.ribbon && tab() === t && !q() }} onClick={() => select(t)}>{t}</button>}</For>
      <span class="grow" />
      <button class="rb-ai" classList={{ on: ui.side === 'assistant' }} title="Assistant (optional AI): describe a model or paste a sketch" aria-label="Assistant" onClick={() => setSide(ui.side === 'assistant' ? 'inspector' : 'assistant')}><svg viewBox="0 0 24 24" class="ico" width="20" height="20" aria-hidden="true"><path d="M5 6h14v9H11l-4 3.5V15H5z" /><path class="ia" d="M9.5 10.5h.01M12 10.5h.01M14.5 10.5h.01" /></svg></button>
      <input class="rb-search" type="search" placeholder="Search components" value={q()} aria-label="Search components" onInput={e => { setQ(e.currentTarget.value); if (!ui.ribbon) setUi('ribbon', true); }} onKeyDown={e => { if (e.key === 'Escape') { setQ(''); e.currentTarget.blur(); } else if (e.key === 'Enter' && found()[0]) { add(found()[0]); setQ(''); } }} />
      <button class="rb-toggle" title={ui.ribbon ? 'Hide the ribbon' : 'Show the ribbon'} aria-label={ui.ribbon ? 'Hide the ribbon' : 'Show the ribbon'} aria-expanded={ui.ribbon} onClick={() => { const open = !ui.ribbon; setUi('ribbon', open); remember(open); }}>
        <svg class="ico" viewBox="0 0 24 24" style={{ width: '16px', height: '16px' }}><path d={ui.ribbon ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} /></svg></button>
    </div>
    <Show when={ui.ribbon}>
      <div class="rb-body" onWheel={scrollX}>
        <Show when={!q()} fallback={<div class="rb-group"><div class="rb-row"><For each={found()}>{d => <Btn d={d} wide />}</For><For each={foundTemplates()}>{t => <TemplateCard t={t} />}</For>
          <Show when={!found().length && !foundTemplates().length}><span class="rb-none">Nothing matches “{q()}”.</span></Show></div><div class="rb-label">Search results: click to add, or drag onto the canvas</div></div>}>
          <Show when={COMPONENT_TABS.includes(tab())}>
            <For each={groups()}>{([name, defs]) => <div class="rb-group"><div class="rb-icons"><For each={defs}>{d => <Btn d={d} />}</For></div><div class="rb-label">{name}</div></div>}</For>
            <Show when={tab() === 'Tools' && clusterLibrary().length}><div class="rb-group"><div class="rb-icons"><For each={clusterLibrary()}>{c => <button class="rb-btn" aria-label={c.name} onPointerEnter={e => hover(e, c.name, 'A cluster you saved.')} onPointerLeave={leave} onClick={() => { const p = canvasCenter(); insertCluster(c, p.x, p.y); }}><Icon id="cluster" color={CATEGORY_COLORS.Script} /></button>}</For></div><div class="rb-label">My clusters</div></div></Show>
          </Show>
          <Show when={tab() === 'Templates'}>
            <For each={['Complete models', 'Building blocks'] as const}>{g => <div class="rb-group"><div class="rb-row"><For each={TEMPLATES.filter(t => t.group === g)}>{t => <TemplateCard t={t} />}</For></div><div class="rb-label">{g}: drag onto the canvas, or click</div></div>}</For>
          </Show>
          <Show when={tab() === 'Examples'}>
            <div class="rb-group"><div class="rb-row"><For each={EXAMPLES.filter(e => !e.id.startsWith('bench-'))}>{e => <button class="rb-card" aria-label={e.title} onPointerEnter={ev => hover(ev, e.title, e.summary + ' Opens as a new project.')} onPointerLeave={leave} onClick={() => { leave(); props.onExample(e.id); }}><Thumb id={e.id} color="#2f6fd6" /><span>{e.title.replace(/^Quick start: a/, 'A')}</span></button>}</For>
              <button class="rb-card more" onClick={props.onAllExamples}><span>All examples, with descriptions…</span></button></div><div class="rb-label">Examples open as a new project</div></div>
          </Show>
          <Show when={tab() === 'Verification'}>
            <div class="rb-group"><div class="rb-col">
              <button class="primary" onClick={props.onVerify}>Run all checks…</button>
              <div class="seg" role="group" aria-label="How a verification model opens"><button classList={{ on: !benchAsComponents() }} aria-pressed={!benchAsComponents()} title="Open the model as one Verification Model component" onClick={() => setBenchAsComponents(false)}>One component</button><button classList={{ on: benchAsComponents() }} aria-pressed={benchAsComponents()} title="Open the model built from ordinary components (points, lines, sections, supports, loads, analysis), so that it can be studied and changed" onClick={() => setBenchAsComponents(true)}>As components</button></div>
            </div><div class="rb-label">Open as</div></div>
            <div class="rb-group"><div class="rb-chips"><For each={BENCHMARKS}>{b => <button class="rb-card small" aria-label={`${b.id} ${b.title}`} onPointerEnter={e => hover(e, `${b.id} ${b.title}`, b.description ?? '')} onPointerLeave={leave} onClick={() => { leave(); props.onBenchmark(b.id, benchAsComponents()); }}><Thumb id={'b:' + b.builder} color="#3fae6b" /><span><b>{b.id}</b> {b.title}</span></button>}</For></div><div class="rb-label">28 verification models with known answers</div></div>
          </Show>
        </Show>
      </div>
    </Show>
    <Show when={tip()}>{t => <div class="rb-tip" style={{ left: t().x + 'px', top: t().y + 'px' }}><b>{t().title}</b><span>{t().text}</span></div>}</Show>
  </div>;
}
