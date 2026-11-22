/**
 * Inspector: settings, help and data for the selected component, and the full
 * results of a structural node or element picked in the 3D view.
 */
import { createMemo, createSignal, For, Show, JSX, Switch, Match } from 'solid-js';
import { project, mutate, selection, runTick, engine, ui, setUi, registry, portsOf, unwrap, download, pickFile, toast, saveClusterToLibrary, pushUndo } from './store';
import { TYPE_COLORS } from '../core/types';
import type { NodeData, PortSpec, PortMods } from '../core/types';
import { formatValue, fmtNum } from '../core/graph';
import { unitSystem } from '../fe/units';
import type { FEResult } from '../fe/system';
import { nodeXYZ, sectionModuli } from '../fe/model';
import * as post from '../fe/post';
import { resultTable } from '../components/structure';
import { CONTOUR_NAMES } from './scene';
import { toCSV, importFile } from '../io/formats';
import { runOptimizer, stopOptimizer, optRunning, optStatus, reinstate } from './optimizer';
import { sparkline } from './Canvas';
import { cancelSolver } from './workers';
import { firstResult, previewPlan, previewOn } from './preview';
import { exprToTex } from '../core/expr';
import { Tex } from './Tex';

export function Inspector(): JSX.Element {
  const node = createMemo(() => (selection().length === 1 ? project.graph.nodes.find(n => n.id === selection()[0]) : undefined));
  return <aside class="inspector" aria-label="Inspector">
    <Switch fallback={<ProjectPanel />}>
      <Match when={ui.pick}><PickPanel /></Match>
      <Match when={node()}>{n => <NodePanel n={n()} />}</Match>
      <Match when={selection().length > 1}><div class="ins-sec"><h3>{selection().length} components selected</h3><p class="muted">Right-click a selected component to group, cluster, align or delete them together.</p></div></Match>
    </Switch>
  </aside>;
}

function ProjectPanel(): JSX.Element {
  const stats = createMemo(() => { runTick(); let err = 0, warn = 0, ms = 0; for (const n of project.graph.nodes) { const s = engine.status(n.id); if (s.state === 'error') err++; if (s.state === 'warning') warn++; ms += s.ms; } return { err, warn, ms }; });
  return <div class="ins-sec">
    <h3>Project</h3>
    <label class="field"><span>Name</span><input type="text" value={project.name} onChange={e => mutate(p => { p.name = e.currentTarget.value; }, { run: false })} /></label>
    <label class="field"><span>Notes</span><textarea rows="4" value={project.description ?? ''} onChange={e => mutate(p => { p.description = e.currentTarget.value; }, { run: false })} /></label>
    <p class="muted">{project.graph.nodes.length} components, {project.graph.wires.length} wires. {stats().err ? `${stats().err} with errors. ` : ''}{stats().warn ? `${stats().warn} with warnings. ` : ''}Last solve {stats().ms.toFixed(0)} ms.</p>
    <p class="muted">Units: {project.units === 'SI' ? 'SI (kN, m, MPa; section sizes in mm)' : 'US customary (kip, ft, ksi; section sizes in inches)'}. One model unit is one {unitSystem(project.units).len.label === 'm' ? 'meter' : 'foot'}.</p>
    <h4>Getting around</h4>
    <ul class="tips"><li>Pick a component from the ribbon at the top: click it, or drag it onto the canvas. Double-clicking the canvas searches by name.</li><li>The Templates tab of the ribbon adds whole groups, such as a complete beam model.</li><li>Drag from an output dot to an input dot to connect. Let go on empty canvas to pick what to connect to.</li><li>Right-click a wire to delete it.</li><li>Select a component to see its settings and help here.</li><li>Click a node or member in the 3D view to read its results. Press F there to fit the view.</li><li>The A− and A+ buttons at the top change the text size.</li></ul>
  </div>;
}

function PickPanel(): JSX.Element {
  const u = () => unitSystem(project.units);
  const data = createMemo(() => { runTick(); const pk = ui.pick!; const r = firstResult(pk.nodeId); let model = r?.model ?? null; if (!model) for (const t of engine.outputs(pk.nodeId)) for (const it of t.allItems() as any[]) if (it?.k === 'model') model = it; const viewNode = project.graph.nodes.find(n => n.id === pk.nodeId); return { pk, r, model, ci: Math.min(viewNode?.state.caseIndex ?? 0, (r?.cases.length ?? 1) - 1) }; });
  const row = (k: string, val: string | number) => <tr><th>{k}</th><td>{typeof val === 'number' ? fmtNum(val, 5) : val}</td></tr>;
  return <div class="ins-sec">
    <div class="ins-head"><h3>{data().pk.kind === 'node' ? 'Node' : data().pk.kind === 'beam' ? 'Line element' : 'Shell element'} {data().pk.index}</h3><button class="link" onClick={() => setUi('pick', null)}>Close</button></div>
    <Show when={data().model} fallback={<p class="muted">The picked item is no longer in the model.</p>}>{m => {
      const cr = () => data().r?.cases[data().ci];
      return <Switch>
        <Match when={data().pk.kind === 'node' && data().pk.index < m().nodes.length / 3}>{(() => { const p = nodeXYZ(m(), data().pk.index), U = u(); const d = () => (cr() ? post.nodeDisp(cr()!, data().pk.index) : null), q = () => (cr() ? post.nodeReaction(cr()!, data().pk.index) : null); const sup = m().supports.find(s => s.node === data().pk.index);
          return <table class="kv"><tbody>
            {row(`Position [${U.len.label}]`, `${fmtNum(p.x / U.len.f, 5)}, ${fmtNum(p.y / U.len.f, 5)}, ${fmtNum(p.z / U.len.f, 5)}`)}
            <Show when={sup}>{row('Support', ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'].filter((_, i) => sup!.fix[i]).join(' ') || 'spring')}</Show>
            <Show when={d()}><tr class="sep"><th colSpan={2}>Case {cr()!.name}</th></tr>{row(`ux [${U.dim.label}]`, d()![0] / U.dim.f)}{row(`uy [${U.dim.label}]`, d()![1] / U.dim.f)}{row(`uz [${U.dim.label}]`, d()![2] / U.dim.f)}{row('rx [rad]', d()![3])}{row('ry [rad]', d()![4])}{row('rz [rad]', d()![5])}</Show>
            <Show when={sup && q()}>{row(`Rx [${U.force.label}]`, q()![0] / U.force.f)}{row(`Ry [${U.force.label}]`, q()![1] / U.force.f)}{row(`Rz [${U.force.label}]`, q()![2] / U.force.f)}{row(`Mx [${U.moment.label}]`, q()![3] / U.moment.f)}{row(`My [${U.moment.label}]`, q()![4] / U.moment.f)}{row(`Mz [${U.moment.label}]`, q()![5] / U.moment.f)}</Show>
          </tbody></table>; })()}</Match>
        <Match when={data().pk.kind === 'beam' && m().beams[data().pk.index]}>{(() => { const e = data().pk.index, b = m().beams[e], s = m().sections[b.sec], mat = m().materials[b.mat], U = u(), L = post.kinOf(m(), e).L, W = sectionModuli(s);
          const st = () => (cr() ? post.memberStations(m(), cr()!, e, 4) : null), ut = () => (cr() ? post.memberUtilization(m(), cr()!, e) : null);
          return <><table class="kv"><tbody>
            {row('ID', b.id)}{row('Type', b.type === 'beam' ? (b.shear ? 'Beam (Timoshenko)' : 'Beam (Euler–Bernoulli)') : b.type)}{row(`Length [${U.len.label}]`, L / U.len.f)}{row('Section', s.name)}{row('Material', mat.name)}
            {row(`A [${U.area.label}]`, s.A / U.area.f)}{row(`Iy [${U.inertia.label}]`, s.Iy / U.inertia.f)}{row(`Iz [${U.inertia.label}]`, s.Iz / U.inertia.f)}{row(`Wy [${U.dim.label}³]`, W.Wy / U.dim.f ** 3)}
            <Show when={b.rel.some(Boolean)}>{row('Releases', ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'].map((k, i) => (b.rel[i] ? k + '(start)' : b.rel[i + 6] ? k + '(end)' : '')).filter(Boolean).join(' '))}</Show>
            <Show when={ut()}>{row('Utilization (simplified)', ut()!.util)}{row(`Max stress [${U.stress.label}]`, ut()!.sigma / U.stress.f)}</Show>
          </tbody></table>
            <Show when={st()}><h4>Internal forces, case {cr()!.name}</h4><table class="grid"><thead><tr><th>x [{U.len.label}]</th><th>N</th><th>Vy</th><th>Vz</th><th>T</th><th>My</th><th>Mz</th></tr></thead><tbody>
              <For each={st()!.f}>{(f, i) => <tr><td>{fmtNum(st()!.x[i()] / U.len.f, 4)}</td><For each={f}>{(val, k) => <td>{fmtNum(val / (k() < 3 ? U.force.f : U.moment.f), 4)}</td>}</For></tr>}</For></tbody></table>
              <p class="muted">Forces in {U.force.label}, moments in {U.moment.label}. N is positive in tension; My is positive for sagging. The utilization is a simplified stress check, not a design-code verification.</p></Show></>; })()}</Match>
        <Match when={data().pk.kind === 'shell' && m().shells[data().pk.index]}>{(() => { const i = data().pk.index, sh = m().shells[i], U = u(); const val = (q: post.ShellQuantity, layer: 'top' | 'bottom' = 'top') => (cr() ? post.shellElementValue(m(), cr()!, i, q, layer) : 0);
          return <table class="kv"><tbody>{row('ID', sh.id)}{row('Element', sh.n.length === 4 ? 'Quadrilateral (MITC4 + enriched membrane)' : 'Triangle (DKT + constant strain)')}{row(`Thickness [${U.dim.label}]`, sh.t / U.dim.f)}{row('Material', m().materials[sh.mat].name)}
            <Show when={cr()}><tr class="sep"><th colSpan={2}>Case {cr()!.name}, element center, local axes</th></tr>
              <For each={['Nx', 'Ny', 'Nxy'] as post.ShellQuantity[]}>{q => row(`${q} [${U.forcePerLen.label}]`, val(q) / U.forcePerLen.f)}</For><For each={['Mx', 'My', 'Mxy'] as post.ShellQuantity[]}>{q => row(`${q} [${U.momentPerLen.label}]`, val(q) / U.momentPerLen.f)}</For>
              {row(`von Mises top [${U.stress.label}]`, val('vonMises', 'top') / U.stress.f)}{row(`von Mises bottom [${U.stress.label}]`, val('vonMises', 'bottom') / U.stress.f)}</Show></tbody></table>; })()}</Match>
      </Switch>;
    }}</Show>
  </div>;
}

function NodePanel(props: { n: NodeData }): JSX.Element {
  const n = () => props.n;
  const def = () => registry.get(n().type);
  const ports = createMemo(() => portsOf(n(), unwrap(project)));
  const status = createMemo(() => { runTick(); return engine.status(n().id); });
  const wired = createMemo(() => new Set(project.graph.wires.filter(w => w.to === n().id).map(w => w.inp)));
  const u = () => unitSystem(project.units);
  const hiddenBy = createMemo(() => { runTick(); void n().preview; void project.graph.wires.length; return previewPlan().hiddenBy(n().id); });
  const edit = (fn: (x: NodeData) => void, run = true) => mutate(p => { const x = p.graph.nodes.find(q => q.id === n().id); if (x) fn(x); }, { run });
  const setState = (k: string, val: any) => edit(x => { x.state[k] = val; });
  const unitLabel = (p: PortSpec) => (p.unit ? (u() as any)[p.unit]?.label ?? '' : '');
  const constText = (p: PortSpec) => { const c = n().consts[p.name] ?? p.default; if (c === undefined || c === null) return ''; return typeof c === 'object' ? (Array.isArray(c) ? c.map(formatValue).join('; ') : formatValue(c).replace(/[{}]/g, '')) : String(c); };
  const setConst = (p: PortSpec, text: string) => edit(x => { if (text.trim() === '') { delete x.consts[p.name]; return; } x.consts[p.name] = p.access === 'list' && text.includes(';') ? text.split(';').map(s => { const t = s.trim(); return Number.isFinite(Number(t)) && t !== '' ? Number(t) : t; }) : p.type === 'number' || p.type === 'integer' ? (Number.isFinite(Number(text)) ? Number(text) : text) : text; });
  const toggleMod = (p: PortSpec, k: keyof PortMods) => edit(x => { x.mods ??= {}; x.mods[p.name] = { ...(x.mods[p.name] ?? {}), [k]: !(x.mods[p.name] as any)?.[k] }; });
  const outSummary = (i: number) => { runTick(); const t = engine.outputs(n().id)[i]; if (!t || !t.branchCount) return 'no data'; const items = t.allItems(); return `${t.dataCount} item${t.dataCount === 1 ? '' : 's'}${t.branchCount > 1 ? ` in ${t.branchCount} branches` : ''}: ${items.slice(0, 3).map(formatValue).join(' | ')}${items.length > 3 ? ' …' : ''}`; };
  const editable = (p: PortSpec) => ['number', 'integer', 'text', 'boolean', 'point', 'vector', 'domain', 'color'].includes(p.type);
  return <>
    <div class="ins-sec">
      <div class="ins-head"><h3>{def()?.name ?? n().type}</h3><span class="chip">{def()?.category}</span></div>
      <p>{def()?.desc}</p>
      <Show when={status().messages.length}><div class="msg" classList={{ [status().state]: true }}><For each={status().messages}>{m => <p>{m}</p>}</For></div></Show>
      <Show when={optRunning() === null && (status().state === 'pending')}><button onClick={() => cancelSolver()}>Cancel analysis</button></Show>
      <label class="field"><span>Label</span><input type="text" value={n().label ?? ''} placeholder={def()?.name} onChange={e => edit(x => { x.label = e.currentTarget.value || undefined; }, false)} /></label>
      <div class="row">
        <label class="check"><input type="checkbox" checked={previewOn(n()) && !hiddenBy()} onChange={e => edit(x => { x.preview = e.currentTarget.checked; }, false)} />Preview in 3D</label>
        <label class="check"><input type="checkbox" checked={n().enabled !== false} onChange={e => edit(x => { x.enabled = e.currentTarget.checked; })} />Enabled</label>
      </div>
      <Show when={hiddenBy()}><p class="muted">Not drawn on its own because it feeds “{hiddenBy()}”, which draws it. Tick Preview to draw it here as well.</p></Show>
      <Show when={def()?.solve && ports().inputs.length > 1}><label class="field"><span>List matching</span><select value={n().matching ?? 'longest'} onChange={e => edit(x => { x.matching = e.currentTarget.value as any; })}><option value="longest">Longest list (repeat last item)</option><option value="shortest">Shortest list</option><option value="cross">Cross reference (all combinations)</option></select></label></Show>
    </div>
    <StatePanel n={n()} setState={setState} edit={edit} />
    <Show when={ports().inputs.length}><div class="ins-sec"><h4>Inputs</h4>
      <For each={ports().inputs}>{(p, i) => <div class="port-row">
        <div class="port-name"><i style={{ background: TYPE_COLORS[p.type] }} /><b>{p.name}</b><Show when={unitLabel(p)}><span class="unit">{unitLabel(p)}</span></Show>
          <span class="mods" role="group" aria-label={`Tree options for ${p.name}`}><For each={[['flatten', 'F', 'Flatten: put all items in one list'], ['graft', 'G', 'Graft: one branch per item'], ['simplify', 'S', 'Simplify branch paths'], ['reverse', 'R', 'Reverse item order']] as [keyof PortMods, string, string][]}>{([k, l, t]) => <button classList={{ on: !!n().mods?.[p.name]?.[k] }} title={t} aria-pressed={!!n().mods?.[p.name]?.[k]} onClick={() => toggleMod(p, k)}>{l}</button>}</For></span></div>
        <Show when={!wired().has(i())} fallback={<small class="muted">wired · {p.desc}</small>}>
          <Show when={editable(p)} fallback={<small class="muted">{p.optional ? 'optional · ' : 'needs a wire · '}{p.desc}</small>}>
            <Show when={p.type === 'boolean'} fallback={<input type="text" value={constText(p)} placeholder={p.type === 'point' || p.type === 'vector' ? 'x, y, z' : p.optional ? 'optional' : ''} spellcheck={false} aria-label={p.name} onChange={e => setConst(p, e.currentTarget.value)} />}>
              <label class="check"><input type="checkbox" checked={!!(n().consts[p.name] ?? p.default)} onChange={e => edit(x => { x.consts[p.name] = e.currentTarget.checked; })} />{p.desc}</label></Show>
            <Show when={p.type !== 'boolean'}><small class="muted">{p.desc}{p.access === 'list' ? ' Separate several values with semicolons.' : ''}</small></Show>
          </Show>
        </Show>
      </div>}</For></div></Show>
    <Show when={ports().outputs.length}><div class="ins-sec"><h4>Outputs</h4>
      <For each={ports().outputs}>{(p, i) => <div class="port-row"><div class="port-name"><i style={{ background: TYPE_COLORS[p.type] }} /><b>{p.name}</b><Show when={unitLabel(p)}><span class="unit">{unitLabel(p)}</span></Show></div><small class="muted">{p.desc}</small><small class="data">{outSummary(i())}</small></div>}</For></div></Show>
    <ResultTables id={n().id} />
    <Show when={def()?.example}><div class="ins-sec"><h4>Example</h4><p class="muted">{def()!.example}</p></div></Show>
  </>;
}

function StatePanel(props: { n: NodeData; setState: (k: string, v: any) => void; edit: (fn: (x: NodeData) => void, run?: boolean) => void }): JSX.Element {
  const n = () => props.n, s = () => props.n.state;
  const num = (k: string, label: string, step: number | 'any' = 'any') => <label class="field small"><span>{label}</span><input type="number" step={step} value={s()[k]} onChange={e => { const val = Number(e.currentTarget.value); if (Number.isFinite(val)) props.setState(k, val); }} /></label>;
  const check = (k: string, label: string) => <label class="check"><input type="checkbox" checked={!!s()[k]} onChange={e => props.setState(k, e.currentTarget.checked)} />{label}</label>;
  const res = createMemo(() => { runTick(); return n().type === 'fe.view' ? firstResult(n().id) : null; });
  const sliders = createMemo(() => project.graph.nodes.filter(x => x.type === 'param.slider'));
  const exprTex = createMemo(() => { if (n().type !== 'math.expr') return ''; try { return exprToTex(String(s().expr ?? '')); } catch { return ''; } });
  return <Switch>
    <Match when={n().type === 'param.slider'}><div class="ins-sec"><h4>Slider</h4><div class="row">{num('min', 'Minimum')}{num('max', 'Maximum')}{num('step', 'Step')}</div><div class="row">{num('value', 'Value')}{check('integer', 'Whole numbers only')}</div></div></Match>
    <Match when={n().type === 'param.valuelist'}><div class="ins-sec"><h4>Entries</h4><textarea rows="6" spellcheck={false} value={(s().items as any[]).map(it => `${it.name} = ${it.value}`).join('\n')} aria-label="List entries"
      onChange={e => props.setState('items', e.currentTarget.value.split('\n').filter(l => l.trim()).map(l => { const k = l.indexOf('='); return k < 0 ? { name: l.trim(), value: l.trim() } : { name: l.slice(0, k).trim(), value: l.slice(k + 1).trim() }; }))} /><p class="muted">One entry per line, written as “Name = value”.</p></div></Match>
    <Match when={n().type === 'param.graph'}><div class="ins-sec"><h4>Curve</h4><label class="field"><span>Shape</span><select value={s().kind} onChange={e => props.setState('kind', e.currentTarget.value)}><option value="linear">Linear</option><option value="smooth">Smooth step</option><option value="power">Power</option><option value="sine">Sine wave</option><option value="parabola">Parabola</option><option value="bell">Bell</option></select></label>{num('p', 'Shape parameter')}</div></Match>
    <Match when={n().type === 'math.expr'}><div class="ins-sec"><h4>Formula</h4><input type="text" value={s().expr} spellcheck={false} aria-label="Formula" onChange={e => props.setState('expr', e.currentTarget.value)} />
      <Show when={exprTex()} fallback={<p class="msg error">This is not a valid formula yet.</p>}>{t => <div class="formula"><Tex tex={t()} block /></div>}</Show>
      <p class="muted">Write it as you would on a calculator: <span class="code">w*L^2/8</span>, <span class="code">sqrt(a^2 + b^2)</span>. Each name becomes an input.</p></div></Match>
    <Match when={n().type === 'param.note'}><div class="ins-sec"><h4>Note</h4><textarea rows="5" value={s().text} aria-label="Note text" onChange={e => props.setState('text', e.currentTarget.value)} /><p class="muted">Text between dollar signs is typeset as a formula, for example <span class="code">$\frac{'{wL^2}{8}'}$</span>.</p></div></Match>
    <Match when={n().type === 'script.js'}><div class="ins-sec"><h4>Script</h4><div class="row"><label class="field small"><span>Inputs</span><input type="text" value={s().inputs} onChange={e => props.setState('inputs', e.currentTarget.value)} /></label><label class="field small"><span>Outputs</span><input type="text" value={s().outputs} onChange={e => props.setState('outputs', e.currentTarget.value)} /></label></div>
      <textarea class="code" rows="12" spellcheck={false} value={s().code} aria-label="Script code" onChange={e => props.setState('code', e.currentTarget.value)} /><p class="muted">Runs in a sandboxed worker without access to the page or the network, and is stopped after 5 seconds.</p></div></Match>
    <Match when={n().type === 'param.file'}><div class="ins-sec"><h4>File</h4><p>{s().name || 'No file loaded.'}</p><button onClick={async () => { const f = await pickFile('.stl,.obj,.dxf,.3dm,.csv,.txt,.step,.stp,.iges,.igs'); if (!f) return; try { const data = await importFile(f.name, await f.arrayBuffer()); props.edit(x => { x.state.data = data; x.state.name = `${f.name} (${data.length} object${data.length === 1 ? '' : 's'})`; }); } catch (e) { toast((e as Error).message, 7000); } }}>Import a file…</button><p class="muted">STL, OBJ, DXF, 3DM and CSV (points). The geometry is stored inside the project file.</p></div></Match>
    <Match when={n().type === 'cluster'}><div class="ins-sec"><h4>Cluster</h4><label class="field"><span>Name</span><input type="text" value={project.clusters[s().clusterId]?.name ?? ''} onChange={e => mutate(p => { const c = p.clusters[s().clusterId]; if (c) c.name = e.currentTarget.value; }, { run: false })} /></label>
      <p class="muted">{project.clusters[s().clusterId]?.graph.nodes.length ?? 0} components inside.</p><div class="row"><button onClick={() => { const c = unwrap(project).clusters[s().clusterId]; if (c) { saveClusterToLibrary(JSON.parse(JSON.stringify(c))); toast('Saved to your cluster library.'); } }}>Save to library</button>
        <button onClick={() => { const c = unwrap(project).clusters[s().clusterId]; if (!c) return; pushUndo(); const off = { x: n().x, y: n().y + 120 }, map = new Map<string, string>(); mutate(p => { const inner = c.graph.nodes.filter(q => !q.type.startsWith('cluster.')); const minX = Math.min(...inner.map(q => q.x)), minY = Math.min(...inner.map(q => q.y)); for (const q of inner) { const id = q.id + '_x' + Date.now().toString(36); map.set(q.id, id); p.graph.nodes.push({ ...JSON.parse(JSON.stringify(q)), id, x: q.x - minX + off.x, y: q.y - minY + off.y }); } for (const w of c.graph.wires) if (map.has(w.from) && map.has(w.to)) p.graph.wires.push({ ...w, id: w.id + '_x', from: map.get(w.from)!, to: map.get(w.to)! }); }, { undo: false }); toast('The contents were copied onto the canvas below the cluster.'); }}>Unpack a copy</button></div></div></Match>
    <Match when={n().type === 'opt.evolve'}><div class="ins-sec"><h4>Optimizer</h4>
      <p class="muted">Sliders the optimizer may change:</p>
      <div class="gene-list"><For each={sliders()} fallback={<p class="muted">Add Number Slider components first.</p>}>{sl => <label class="check"><input type="checkbox" checked={(s().genes ?? []).includes(sl.id)} onChange={e => props.setState('genes', e.currentTarget.checked ? [...(s().genes ?? []), sl.id] : (s().genes ?? []).filter((x: string) => x !== sl.id))} />{sl.label ?? 'Slider'} <span class="muted">({fmtNum(sl.state.min)} to {fmtNum(sl.state.max)})</span></label>}</For></div>
      <div class="row">{num('population', 'Population', 1)}{num('generations', 'Generations', 1)}{num('seed', 'Seed', 1)}</div>
      <div class="row">{check('maximize', 'Maximize (default: minimize)')}{check('localSearch', 'Local search at the end')}</div>
      <div class="row"><Show when={optRunning() !== n().id} fallback={<button class="primary" onClick={stopOptimizer}>Stop</button>}><button class="primary" disabled={optRunning() !== null} onClick={() => void runOptimizer(n().id)}>Run optimization</button></Show></div>
      <p class="muted">{optStatus()}</p>
      <Show when={(s().history ?? []).length > 1}><svg class="conv" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label="Convergence plot"><path d={sparkline(s().history)} /></svg><p class="muted">Best fitness per generation: {fmtNum(s().history[0])} → {fmtNum(s().history[s().history.length - 1])}</p></Show>
      <Show when={(s().top ?? []).length}><h4>Best designs</h4><table class="grid"><thead><tr><th>Fitness</th><th>Slider values</th><th /></tr></thead><tbody><For each={s().top as any[]}>{t => <tr><td>{fmtNum(t.f, 6)}</td><td>{t.x.map((x: number) => fmtNum(x, 4)).join(', ')}</td><td><button class="link" onClick={() => reinstate(n().id, t)}>Use</button></td></tr>}</For></tbody></table></Show>
    </div></Match>
    <Match when={n().type === 'fe.view'}><div class="ins-sec"><h4>What to show</h4>
      <Show when={res()} fallback={<p class="muted">Connect an analysis result.</p>}>{r => <>
        <Show when={r().cases.length > 0 && !r().modes.length}><label class="field"><span>Load case</span><select value={s().caseIndex} onChange={e => props.setState('caseIndex', Number(e.currentTarget.value))}><For each={r().cases}>{(c, i) => <option value={i()}>{c.name}</option>}</For></select></label></Show>
        <Show when={r().modes.length}><label class="field"><span>Mode</span><select value={s().mode} onChange={e => props.setState('mode', Number(e.currentTarget.value))}><For each={r().modes}>{(m, i) => <option value={i()}>{m.label}</option>}</For></select></label></Show>
        <div class="row">{check('deformed', 'Deformed shape')}{check('undeformed', 'Undeformed overlay')}{check('animate', 'Animate')}</div>
        <label class="field small"><span>Scale (−1 = automatic)</span><input type="number" step="any" value={s().scale} onChange={e => props.setState('scale', Number(e.currentTarget.value))} /></label>
        <Show when={r().model.beams.length}><label class="field"><span>Member diagram</span><select value={s().diagram} onChange={e => props.setState('diagram', e.currentTarget.value)}><option value="none">None</option><option value="N">Axial force N</option><option value="Vy">Shear Vy</option><option value="Vz">Shear Vz</option><option value="T">Torsion T</option><option value="My">Bending moment My</option><option value="Mz">Bending moment Mz</option></select></label>
          <div class="row">{check('utilization', 'Color by utilization')}{check('sections', 'Section shapes')}{check('localAxes', 'Local axes')}</div></Show>
        <Show when={r().model.shells.length}><label class="field"><span>Shell contour</span><select value={s().contour} onChange={e => props.setState('contour', e.currentTarget.value)}><option value="none">None</option><For each={Object.entries(CONTOUR_NAMES)}>{([k, name]) => <option value={k}>{name}</option>}</For></select></label>
          <div class="row"><label class="field small"><span>Surface</span><select value={s().layer} onChange={e => props.setState('layer', e.currentTarget.value)}><option value="top">Top (+z)</option><option value="mid">Middle</option><option value="bottom">Bottom (−z)</option></select></label>{check('principal', 'Principal directions')}</div></Show>
        <div class="row">{check('reactions', 'Reactions')}{check('loads', 'Loads')}{check('supports', 'Supports')}{check('values', 'Values')}</div>
      </>}</Show></div></Match>
  </Switch>;
}

/** Sortable, filterable result tables for any component that outputs an analysis result. */
function ResultTables(props: { id: string }): JSX.Element {
  const [table, setTable] = createSignal(0), [filter, setFilter] = createSignal(''), [sort, setSort] = createSignal<{ col: number; dir: 1 | -1 } | null>(null), [open, setOpen] = createSignal(false);
  const res = createMemo(() => { runTick(); return firstResult(props.id); });
  const ci = () => Math.min(project.graph.nodes.find(n => n.id === props.id)?.state.caseIndex ?? 0, (res()?.cases.length ?? 1) - 1);
  const rows = createMemo(() => { const r = res(); if (!r || !open()) return null; const all = resultTable(r, Math.max(0, ci()), table(), unitSystem(project.units)); const head = all[0]; let body = all.slice(1); const f = filter().toLowerCase(); if (f) body = body.filter(row => row.some(c => String(c).toLowerCase().includes(f))); const s = sort(); if (s) body = [...body].sort((a, b) => (typeof a[s.col] === 'number' && typeof b[s.col] === 'number' ? ((a[s.col] as number) - (b[s.col] as number)) * s.dir : String(a[s.col]).localeCompare(String(b[s.col])) * s.dir)); return { head, body }; });
  return <Show when={res()}>{r => <div class="ins-sec">
    <div class="ins-head"><h4>Result tables</h4><button class="link" onClick={() => setOpen(!open())}>{open() ? 'Hide' : 'Show'}</button></div>
    <p class="muted">{r().summary}</p>
    <For each={r().cases}>{c => <p class="muted eq">Equilibrium, {c.name}: applied ({c.equilibrium.applied.map(x => fmtNum(x / unitSystem(project.units).force.f, 4)).join(', ')}), reactions ({c.equilibrium.reactions.map(x => fmtNum(x / unitSystem(project.units).force.f, 4)).join(', ')}) {unitSystem(project.units).force.label}; error {c.equilibrium.relError.toExponential(1)}</p>}</For>
    <p class="muted">{r().stats.nodes} nodes · {r().stats.lineElements + r().stats.shellElements} elements · {r().stats.freeDofs} equations · K {r().stats.nnzK} non-zeros · factor {r().stats.nnzL} · factorization {r().stats.tFactor.toFixed(0)} ms · total {r().stats.tTotal.toFixed(0)} ms</p>
    <Show when={open() && rows()}>{t => <>
      <div class="row"><select value={table()} onChange={e => { setTable(Number(e.currentTarget.value)); setSort(null); }} aria-label="Table"><option value="0">Nodal displacements</option><option value="1">Reactions</option><option value="2">Member forces</option><option value="3">Shell results</option></select>
        <input type="search" placeholder="Filter" value={filter()} onInput={e => setFilter(e.currentTarget.value)} aria-label="Filter rows" /><button onClick={() => download('nodal-results.csv', toCSV([t().head, ...t().body]), 'text/csv')}>CSV</button></div>
      <div class="table-wrap"><table class="grid"><thead><tr><For each={t().head}>{(h, i) => <th onClick={() => setSort(s => ({ col: i(), dir: s?.col === i() && s.dir === 1 ? -1 : 1 }))} title="Click to sort">{h}{sort()?.col === i() ? (sort()!.dir === 1 ? ' ▲' : ' ▼') : ''}</th>}</For></tr></thead>
        <tbody><For each={t().body.slice(0, 400)}>{row => <tr><For each={row}>{c => <td>{c}</td>}</For></tr>}</For></tbody></table></div>
      <Show when={t().body.length > 400}><p class="muted">Showing the first 400 of {t().body.length} rows. Use the filter, or export the CSV for all rows.</p></Show></>}</Show>
  </div>}</Show>;
}
