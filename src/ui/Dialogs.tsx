/** Dialogs added in version 0.5: the step-by-step stiffness method, sharing, and the guide for Grasshopper users. */
import { For, JSX, Show, createMemo, createSignal, onMount } from 'solid-js';
import { project, engine, runTick, registry, unwrap, toast, ui } from './store';
import { Dialog } from './App';
import { ALIASES } from '../core/aliases';
import { teach, teachable, Teach, DOF } from '../teach/steps';
import { shareLink } from './share';
import type { FEResult } from '../fe/system';
import { unitSystem } from '../fe/units';

// ---- step-by-step stiffness method ------------------------------------------------------------
const num = (x: number, digits = 4): string => { if (x === 0 || Math.abs(x) < 1e-300) return '0'; const a = Math.abs(x); return a >= 1e5 || a < 1e-3 ? x.toExponential(digits - 2).replace('e+', 'e') : Number(x.toPrecision(digits)).toString(); };
function Matrix(props: { m: number[][]; rows?: string[]; cols?: string[]; hot?: (i: number, j: number) => boolean; dim?: (i: number, j: number) => boolean; scale?: number; caption?: string }): JSX.Element {
  const k = props.scale ?? 1;
  return <div class="mx-wrap"><table class="mx"><Show when={props.caption}><caption>{props.caption}</caption></Show>
    <Show when={props.cols}><thead><tr><Show when={props.rows}><th /></Show><For each={props.cols}>{c => <th>{c}</th>}</For></tr></thead></Show>
    <tbody><For each={props.m}>{(row, i) => <tr><Show when={props.rows}><th>{props.rows![i()]}</th></Show><For each={row}>{(x, j) => <td classList={{ zero: Math.abs(x) < 1e-12 * Math.max(1, ...row.map(Math.abs)), hot: props.hot?.(i(), j()) ?? false, dim: props.dim?.(i(), j()) ?? false }}>{num(x / k)}</td>}</For></tr>}</For></tbody></table></div>;
}
export function TeachDialog(): JSX.Element {
  const result = createMemo<FEResult | null>(() => { runTick(); for (const n of project.graph.nodes) for (const t of engine.outputs(n.id)) { const r = t?.first?.() as any; if (r && r.k === 'result' && r.kind === 'static') return r as FEResult; } return null; });
  const data = createMemo<{ t?: Teach; why?: string }>(() => { const r = result(); if (!r) return { why: 'There is no linear static result on the canvas yet. Build a small frame or truss (the Templates tab has some) and solve it with Linear Static.' }; const no = teachable(r.model); if (no) return { why: no }; try { return { t: teach(r) }; } catch (e) { return { why: (e as Error).message }; } });
  const [step, setStep] = createSignal(0), [el, setEl] = createSignal(0);
  const u = () => unitSystem(project.units);
  const STEPS = ['Nodes and unknowns', 'Member stiffness', 'Assembly', 'Supports and loads', 'Solution', 'Reactions'];
  const isRot = (label: string) => label.startsWith('r');
  return <Dialog title="Stiffness method, step by step" wide>
    <Show when={data().t} fallback={<p class="muted">{data().why}</p>}>{tt => { const t = tt(), e = () => t.elements[Math.min(el(), t.elements.length - 1)];
      return <div class="teach">
        <div class="teach-steps" role="tablist"><For each={STEPS}>{(s, i) => <button role="tab" aria-selected={step() === i()} classList={{ on: step() === i() }} onClick={() => setStep(i())}><b>{i() + 1}</b> {s}</button>}</For></div>
        <p class="muted">Values are in N, m and rad, the units the solver works in. Load case: {t.caseName}. <For each={t.notes}>{n => <>{n} </>}</For></p>
        <Show when={step() === 0}>
          <p>The structure has {t.nodes.length} nodes and {t.elements.length} members. Each node has {t.per.length} unknown displacement{t.per.length > 1 ? 's' : ''} ({t.per.map(i => DOF[i]).join(', ')}), so there are {t.labels.length} degrees of freedom in all. They are numbered node by node.</p>
          <table class="grid"><thead><tr><th>Node</th><th>x [m]</th><th>y [m]</th><th>z [m]</th><th>Degrees of freedom</th><th>Restrained</th></tr></thead><tbody><For each={t.nodes}>{(p, i) => { const mine = t.labels.map((l, k) => ({ l, k })).filter(x => Number(x.l.slice(2)) === i() + 1); return <tr><td>{i() + 1}</td><td>{num(p.x)}</td><td>{num(p.y)}</td><td>{num(p.z)}</td><td>{mine.map(x => `${x.k + 1}: ${x.l}`).join(', ')}</td><td>{mine.filter(x => t.fixed[x.k]).map(x => x.l).join(', ') || '–'}</td></tr>; }}</For></tbody></table>
        </Show>
        <Show when={step() === 1}>
          <div class="row">Member <select value={el()} onChange={ev => setEl(Number(ev.currentTarget.value))} aria-label="Member"><For each={t.elements}>{(x, i) => <option value={i()}>{i() + 1}: {x.id} (nodes {x.nodes[0]}–{x.nodes[1]})</option>}</For></select><span class="muted">{e().type === 'truss' ? 'truss member (axial only)' : 'frame member'}, L = {num(e().L)} m</span></div>
          <p>1. The stiffness matrix of the member in its own axes, <b>k′</b>, relates its end displacements to its end forces.</p>
          <Matrix m={e().kLocal} caption="k′ (local axes)" />
          <p>2. The transformation matrix <b>T</b> turns the displacements of the structure's axes into the member's axes.</p>
          <Matrix m={e().T} cols={e().labels} caption="T" />
          <p>3. In the structure's axes the member stiffness is <b>k = Tᵀ k′ T</b>. Its rows and columns belong to the degrees of freedom of the member's two nodes.</p>
          <Matrix m={e().kGlobal} rows={e().labels} cols={e().labels} caption="k (structure axes)" />
        </Show>
        <Show when={step() === 2}>
          <div class="row">Show the contribution of member <select value={el()} onChange={ev => setEl(Number(ev.currentTarget.value))} aria-label="Member"><For each={t.elements}>{(x, i) => <option value={i()}>{i() + 1}: {x.id}</option>}</For></select></div>
          <p>The structure stiffness matrix <b>K</b> is the sum of all member matrices, each term added at the row and column of its degrees of freedom. The highlighted cells are where member {el() + 1} adds its terms.</p>
          <Matrix m={t.K} rows={t.labels} cols={t.labels} hot={(i, j) => e().dofs.includes(i) && e().dofs.includes(j)} caption={`K (${t.labels.length} × ${t.labels.length})`} />
        </Show>
        <Show when={step() === 3}>
          <p>Restrained degrees of freedom are known (zero), so their rows and columns are set aside (shown faded). What remains is <b>K_ff u_f = F_f</b> for the {t.free.length} free degrees of freedom. Member loads have been replaced by their equivalent nodal loads.</p>
          <Matrix m={t.K.map((r, i) => [...r, t.F[i]])} rows={t.labels} cols={[...t.labels, 'F']} dim={(i, j) => !t.free.includes(i) || (j < t.labels.length && !t.free.includes(j))} caption="K and the load vector F" />
        </Show>
        <Show when={step() === 4}>
          <p>Solving <b>K_ff u_f = F_f</b> by Gaussian elimination gives the displacements.</p>
          <Matrix m={t.Kff.map((r, i) => [...r, t.Ff[i]])} rows={t.free.map(i => t.labels[i])} cols={[...t.free.map(i => t.labels[i]), 'F_f']} caption="K_ff and F_f" />
          <table class="grid"><thead><tr><th>Degree of freedom</th><th>Displacement</th><th>In project units</th></tr></thead><tbody><For each={t.free}>{i => <tr><td>{t.labels[i]}</td><td>{num(t.u[i], 6)} {isRot(t.labels[i]) ? 'rad' : 'm'}</td><td>{isRot(t.labels[i]) ? num(t.u[i], 6) + ' rad' : `${num(t.u[i] / u().dim.f, 6)} ${u().dim.label}`}</td></tr>}</For></tbody></table>
          <p class="teach-check" classList={{ ok: t.agreement < 1e-6 }}>Compared with Nodal's solver: the largest difference is {t.agreement < 1e-12 ? 'below 1e-12' : t.agreement.toExponential(1)} of the largest displacement. {t.agreement < 1e-6 ? 'The two solutions agree.' : 'The two solutions differ; this view does not cover something in this model.'}</p>
        </Show>
        <Show when={step() === 5}>
          <p>The reactions follow from the rows that were set aside: <b>R = K_sf u_f − F_s</b>.</p>
          <table class="grid"><thead><tr><th>Restrained degree of freedom</th><th>Reaction</th><th>In project units</th></tr></thead><tbody><For each={t.labels.map((l, i) => ({ l, i })).filter(x => t.fixed[x.i])}>{x => <tr><td>{x.l}</td><td>{num(t.reactions[x.i], 6)} {isRot(x.l) ? 'N·m' : 'N'}</td><td>{isRot(x.l) ? `${num(t.reactions[x.i] / u().moment.f, 6)} ${u().moment.label}` : `${num(t.reactions[x.i] / u().force.f, 6)} ${u().force.label}`}</td></tr>}</For></tbody></table>
          <p class="muted">Member end forces then follow member by member from <b>q′ = k′ T u</b> plus the fixed-end forces of member loads; the Member Forces component and the diagrams in the 3D view show them.</p>
        </Show>
        <div class="row end"><button disabled={step() === 0} onClick={() => setStep(step() - 1)}>Back</button><button class="primary" disabled={step() === STEPS.length - 1} onClick={() => setStep(step() + 1)}>Next</button></div>
      </div>; }}</Show>
  </Dialog>;
}

// ---- sharing -------------------------------------------------------------------------------------
export function ShareDialog(): JSX.Element {
  const [link, setLink] = createSignal(''), [embed, setEmbed] = createSignal(''), [layout, setLayout] = createSignal<'view' | 'split' | 'canvas'>('view'), [failed, setFailed] = createSignal('');
  const make = async () => { try { const p = unwrap(project); setLink(await shareLink(p)); setEmbed(`<iframe src="${await shareLink(p, { embed: true, layout: layout() })}" width="100%" height="520" style="border:1px solid #ddd;border-radius:8px" title="${(p.name || 'Nodal model').replace(/"/g, '&quot;')}" loading="lazy"></iframe>`); } catch (e) { setFailed('This browser cannot make share links (it lacks the compression feature they need). Save the project as a file instead.'); } };
  onMount(() => void make());
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); toast(`${what} copied.`); } catch { toast('Copying was blocked by the browser; select the text and copy it by hand.'); } };
  return <Dialog title="Share">
    <Show when={!failed()} fallback={<p class="msg error">{failed()}</p>}>
      <p>The whole model is written into the link itself, after the “#”. Nothing is uploaded: browsers do not send that part of an address to any server. Anyone who opens the link gets their own copy of the model.</p>
      <label class="field">Link<textarea class="share-box" readOnly rows={3} value={link()} aria-label="Share link" onFocus={e => e.currentTarget.select()} /></label>
      <div class="row"><button class="primary" disabled={!link()} onClick={() => void copy(link(), 'Link')}>Copy link</button><span class="muted">{link() ? `${link().length.toLocaleString()} characters` : 'Making the link…'}{link().length > 8000 ? '. Long links can be cut off by email and chat programs; for large models, send the project file instead.' : ''}</span></div>
      <h3>Embed in a web page</h3>
      <p class="muted">For course pages and documentation: a frame with the model, without the ribbon and side panel. Readers can turn the view, move sliders and open the full app.</p>
      <label class="field">Show <select value={layout()} onChange={e => { setLayout(e.currentTarget.value as 'view'); void make(); }} aria-label="Embed layout"><option value="view">3D view only</option><option value="split">Canvas and 3D view</option><option value="canvas">Canvas only</option></select></label>
      <label class="field">HTML<textarea class="share-box" readOnly rows={4} value={embed()} aria-label="Embed code" onFocus={e => e.currentTarget.select()} /></label>
      <div class="row"><button disabled={!embed()} onClick={() => void copy(embed(), 'Embed code')}>Copy embed code</button></div>
    </Show>
  </Dialog>;
}

// ---- for Grasshopper users -----------------------------------------------------------------------
export const GH_HABITS: [string, string][] = [
  ['Double-click the canvas and type', 'The same. A name you know from Grasshopper usually finds the Nodal component, even where the name differs.'],
  ['Type a number, 0<5<10, "text or // note', 'The same shortcuts: a slider with that value, a slider with that range, a panel with the text, a note.'],
  ['Drag from an output to an input', 'The same. Hold Shift to add a wire to an input that already has one. Right-click a wire to delete it.'],
  ['Ctrl+G groups; clusters', 'Ctrl+G groups. Right-click a selection to make a cluster, which is saved under Tools in the ribbon.'],
  ['Flatten, graft, simplify, reverse on a parameter', 'Right-click an input and choose the same options. Data matching (longest, shortest, cross reference) is in the component menu.'],
  ['Panel, Param Viewer', 'Panel shows data and typed text. Tree Statistics lists paths and counts.'],
  ['Preview on or off, enable or disable', 'P toggles the preview of the selection; the right-click menu has Enable and Disable.'],
  ['Bake', 'There is no Rhino document. Use File → Export (3DM, OBJ, STL, DXF, glTF) to take geometry elsewhere, and Geometry From File to bring it in.'],
  ['Units come from the Rhino document', 'Units are a project setting (SI or US). Ports say which unit they expect; structural quantities are converted for you.'],
  ['Structural analysis needs an add-on', 'It is built in: the Structure tab has materials, sections, elements, supports, loads, analyses and results.'],
];
export function aliasRows(): { known: string; nodal: string; tab: string }[] {
  const byName = new Map(registry.all().map(d => [d.name, d]));
  return Object.entries(ALIASES).flatMap(([name, list]) => { const d = byName.get(name); return d ? list.filter(a => a.toLowerCase() !== name.toLowerCase()).map(a => ({ known: a, nodal: name, tab: d.category })) : []; }).sort((a, b) => a.known.localeCompare(b.known));
}
export function GrasshopperDialog(): JSX.Element {
  const [q, setQ] = createSignal('');
  const rows = createMemo(() => { const all = aliasRows(), k = q().trim().toLowerCase(); return k ? all.filter(r => r.known.toLowerCase().includes(k) || r.nodal.toLowerCase().includes(k)) : all; });
  return <Dialog title="Coming from Grasshopper" wide>
    <p>Nodal works the way Grasshopper does: components on a canvas, wires between them, data in lists and trees with the same matching rules. Most components have the same names. This page lists the habits that carry over and the names that differ.</p>
    <table class="grid gh"><thead><tr><th>In Grasshopper</th><th>In Nodal</th></tr></thead><tbody><For each={GH_HABITS}>{h => <tr><td>{h[0]}</td><td>{h[1]}</td></tr>}</For></tbody></table>
    <h3>Names that differ</h3>
    <p class="muted">Typing either name in the search finds the component. Names of add-on components are listed where Nodal has a component for the same job; Nodal is not affiliated with those products and shares no code with them.</p>
    <input class="gh-find" type="search" placeholder="Find a name" value={q()} onInput={e => setQ(e.currentTarget.value)} aria-label="Find a name" />
    <table class="grid gh"><thead><tr><th>Name you may know</th><th>Nodal component</th><th>Ribbon tab</th></tr></thead><tbody><For each={rows()}>{r => <tr><td>{r.known}</td><td><b>{r.nodal}</b></td><td>{['Form-Finding', 'Optimization', 'Script', 'Environment'].includes(r.tab) ? 'Tools' : r.tab}</td></tr>}</For></tbody></table>
    <h3>What is different</h3>
    <ul class="tips"><li>Nodal runs in the browser and has its own geometry kernel: curves, NURBS surfaces and meshes. It has no trimmed surfaces or solid modeling of B-reps; solids are meshes.</li><li>There is no Rhino viewport to pick geometry from. Geometry is made by components or read from a file.</li><li>Scripts are JavaScript, in a sandbox.</li><li>Check results before relying on them. The Verification tab shows what the solver has been tested against.</li></ul>
    <Show when={ui.side === 'hidden'}><span /></Show>
  </Dialog>;
}
