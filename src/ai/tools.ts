/**
 * The tools the assistant uses to edit the canvas. Every tool validates its input and returns a plain
 * object; a rejected call returns { error } so that the model can correct itself. All changes go through
 * the host, which in the app is the same command layer the editor uses (so undo, validation and
 * warnings behave the same) and in the tests is a plain project with an engine.
 */
import type { ComponentDef, GraphDoc, NodeData, PortSpec, ProjectFile } from '../core/types';
import { Engine, coerce, formatValue, makeNode, newId, portsOf, registry, typesCompatible, wouldCycle } from '../core/graph';
import { compileExpr } from '../core/expr';
import { unitSystem } from '../fe/units';
import * as post from '../fe/post';
import type { FEResult } from '../fe/system';
import { TEMPLATES } from '../templates';
import { EXAMPLES } from '../examples';
import { isBlocked } from './catalogue';

export interface GraphHost {
  /** The current project as plain data (read only). */
  project(): ProjectFile;
  /** Change the project through the editor's command layer (undoable, triggers a solve). */
  mutate(fn: (p: ProjectFile) => void): void;
  /** Resolves when the solver has finished everything queued. */
  settle(): Promise<void>;
  engine: Engine;
}
export interface ToolDef { name: string; description: string; input_schema: Record<string, unknown> }
/** One line for the list of actions shown under an assistant message. */
export interface ToolOutcome { result: Record<string, unknown>; action?: string; touched?: string[] }

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const S = { type: 'string' }, ID = { type: 'string', description: 'Component id, as returned by add_component or get_graph' };
export const TOOL_DEFS: ToolDef[] = [
  { name: 'list_component_types', description: 'List component types with their category and one-line description. Optionally filter by category or by a search word. Use describe_components for ports and settings.', input_schema: obj({ category: S, query: S }) },
  { name: 'describe_components', description: 'Full details of up to 12 component types: description, inputs (name, type, unit, default, required), outputs and settings.', input_schema: obj({ types: { type: 'array', items: S, maxItems: 12 } }, ['types']) },
  { name: 'get_graph', description: 'The current canvas: components (id, type, label, position, values of unwired inputs, settings) and wires.', input_schema: obj({}) },
  { name: 'add_component', description: 'Add one component. `inputs` sets its inputs: a constant (number, text, true/false, or "x, y, z" for a point or vector), or a wire given as {"from": id, "output": name}. `settings` sets component settings such as a slider\'s min, max and value. Returns the new id.', input_schema: obj({ type: S, label: S, inputs: { type: 'object' }, settings: { type: 'object' }, position: obj({ x: { type: 'number' }, y: { type: 'number' } }, ['x', 'y']) }, ['type']) },
  { name: 'set_parameter', description: 'Set one input constant or one setting of an existing component. `name` is an input port name or a setting name; "label" renames the component.', input_schema: obj({ id: ID, name: S, value: {} }, ['id', 'name', 'value']) },
  { name: 'connect', description: 'Wire an output of one component to an input of another. By default the new wire replaces what was connected to that input; set add=true to keep the existing wires (for inputs that collect several sources, such as Assemble Model).', input_schema: obj({ from_id: ID, output: S, to_id: ID, input: S, add: { type: 'boolean' } }, ['from_id', 'output', 'to_id', 'input']) },
  { name: 'disconnect', description: 'Remove the wire(s) into one input. Give from_id and output to remove only that wire.', input_schema: obj({ to_id: ID, input: S, from_id: ID, output: S }, ['to_id', 'input']) },
  { name: 'delete_component', description: 'Delete a component and its wires.', input_schema: obj({ id: ID }, ['id']) },
  { name: 'arrange', description: 'Tidy the layout left to right in data-flow order. With no ids, arranges everything.', input_schema: obj({ ids: { type: 'array', items: S } }) },
  { name: 'run_analysis', description: 'Solve the graph (including the structural analysis) and report the state of every component that has an error or a warning.', input_schema: obj({}) },
  { name: 'get_results', description: 'Read values computed by Nodal. With an id: the outputs of that component (for an analysis component, a summary of displacements, reactions and member forces). Without an id: a summary of every analysis result on the canvas.', input_schema: obj({ id: ID }) },
  { name: 'load_template', description: 'Add a ready-made group of components to the canvas. Call with no name to list the templates.', input_schema: obj({ name: S }) },
  { name: 'load_example', description: 'Replace the canvas with a ready-made example model. Call with no name to list the examples.', input_schema: obj({ name: S }) },
];

class Reject extends Error {}
const reject = (msg: string): never => { throw new Reject(msg); };
const CONST_TYPES = new Set(['number', 'integer', 'boolean', 'text', 'point', 'vector', 'domain', 'color', 'any']);
const MAX_TEXT = 4000;

function def(type: unknown): ComponentDef {
  if (typeof type !== 'string') return reject('"type" must be a component id such as "fe.beam".');
  const d = registry.get(type);
  if (!d || isBlocked(type)) {
    const near = registry.all().filter(x => !isBlocked(x.id) && (x.id.includes(type.toLowerCase()) || x.name.toLowerCase() === type.toLowerCase())).slice(0, 6).map(x => x.id);
    return reject(isBlocked(type) && d ? `The component "${type}" is not available to the assistant.` : `Unknown component type "${type}".${near.length ? ' Did you mean: ' + near.join(', ') + '?' : ' Use list_component_types.'}`);
  }
  return d;
}
function node(h: GraphHost, id: unknown): NodeData {
  const n = typeof id === 'string' ? h.project().graph.nodes.find(x => x.id === id) : undefined;
  return n ?? reject(`There is no component with id "${String(id)}". Use get_graph to see the ids.`);
}
function findPort(list: PortSpec[], name: unknown, what: string, of: string): number {
  const key = String(name).trim().toLowerCase();
  let i = list.findIndex(p => p.name.toLowerCase() === key);
  if (i < 0) i = list.findIndex(p => p.nick.toLowerCase() === key);
  if (i < 0) reject(`${of} has no ${what} called "${String(name)}". Its ${what}s are: ${list.map(p => p.name).join(', ') || '(none)'}.`);
  return i;
}
/** Check a constant against the port type with the same coercion the solver applies to user input. */
function constant(p: PortSpec, value: unknown, of: string): unknown {
  if (!CONST_TYPES.has(p.type)) return reject(`Input "${p.name}" of ${of} takes ${p.type} data and cannot be set to a constant; wire it from a component that outputs ${p.type}.`);
  if (value === null || value === undefined || (typeof value === 'object' && !Array.isArray(value))) return reject(`Input "${p.name}" of ${of} needs a plain value (a number, text, true/false or "x, y, z").`);
  if (typeof value === 'string' && value.length > MAX_TEXT) return reject('Text is too long.');
  if (typeof value === 'number' && !Number.isFinite(value)) return reject(`Input "${p.name}" needs a finite number.`);
  const v = Array.isArray(value) ? value.join(', ') : value;
  try { coerce(v, p.type); } catch (e) { return reject(`Input "${p.name}" of ${of} expects ${p.type}: ${(e as Error).message}.`); }
  return v;
}
/** Check a setting against the component's own defaults (same kind of value, sensible range). */
function setting(d: ComponentDef, n: Pick<NodeData, 'state'>, key: string, value: unknown): unknown {
  const defaults = d.state ?? {};
  if (!(key in defaults)) return reject(`${d.name} has no setting called "${key}". Its settings are: ${Object.keys(defaults).join(', ') || '(none)'}.`);
  const was = defaults[key];
  if (typeof value === 'string' && value.length > MAX_TEXT) return reject('Text is too long.');
  if (typeof was === 'number') { if (typeof value !== 'number' || !Number.isFinite(value)) return reject(`Setting "${key}" of ${d.name} must be a finite number.`); }
  else if (typeof was === 'boolean') { if (typeof value !== 'boolean') return reject(`Setting "${key}" of ${d.name} must be true or false.`); }
  else if (typeof was === 'string') { if (typeof value !== 'string') return reject(`Setting "${key}" of ${d.name} must be text.`); }
  else if (value !== null && typeof value === 'object' && JSON.stringify(value).length > MAX_TEXT) return reject('Value is too large.');
  if (d.id === 'math.expr' && key === 'expr') { try { compileExpr(String(value)); } catch (e) { return reject(`The formula is not valid: ${(e as Error).message}`); } }
  if (d.widget === 'slider') {
    const st = { ...n.state, [key]: value } as Record<string, number>;
    if (st.min >= st.max) return reject(`A slider needs min < max (min ${st.min}, max ${st.max}).`);
    if (st.value < st.min || st.value > st.max) return reject(`The slider value ${st.value} is outside its range ${st.min} to ${st.max}. Set min or max first, or give all three in one add_component call.`);
    if (key === 'step' && !(st.step > 0)) return reject('A slider step must be positive.');
  }
  return value;
}
const label = (h: GraphHost, n: NodeData): string => n.label ?? registry.get(n.type)?.name ?? n.type;

function describe(d: ComponentDef): Record<string, unknown> {
  const u = unitSystem('SI'), us = unitSystem('US');
  const unit = (p: PortSpec) => (p.unit && (u as any)[p.unit] ? `${(u as any)[p.unit].label} (SI) / ${(us as any)[p.unit].label} (US)` : undefined);
  return {
    type: d.id, name: d.name, category: d.category, description: d.desc, example: d.example,
    inputs: d.inputs.map(p => ({ name: p.name, type: p.type, access: p.access, unit: unit(p), default: p.default === undefined ? undefined : formatValue(p.default), required: p.default === undefined && !p.optional, description: p.desc })),
    outputs: d.outputs.map(p => ({ name: p.name, type: p.type, access: p.access, unit: unit(p), description: p.desc })),
    settings: d.state && Object.keys(d.state).length ? d.state : undefined,
    note: d.ports ? 'The ports of this component depend on its settings; get_graph shows the current ones.' : undefined,
  };
}

/** A short summary of a structural result, in project units. Every number comes from the solver's output. */
export function summarizeResult(r: FEResult, units: 'SI' | 'US'): Record<string, unknown> {
  const u = unitSystem(units), g = (x: number) => parseFloat(x.toPrecision(6));
  const out: Record<string, unknown> = { source: 'Nodal solver', analysis: r.kind, nodes: r.model.nodes.length / 3 || undefined, members: r.model.beams.length, shells: r.model.shells.length, warnings: r.messages.length ? r.messages : undefined };
  if (r.modes.length) out.modes = r.modes.slice(0, 12).map(m => ({ label: m.label, value: g(m.value) }));
    out.cases = r.cases.slice(0, 8).map((c, i) => {
    const md = post.maxDisplacement(c), F = ['N', 'Vy', 'Vz', 'T', 'My', 'Mz'], lo = Array(6).fill(Infinity), hi = Array(6).fill(-Infinity);
    r.model.beams.forEach((_, e) => { const env = post.memberEnvelope(r.model, [c], e); for (let k = 0; k < 6; k++) { lo[k] = Math.min(lo[k], env.min[k]); hi[k] = Math.max(hi[k], env.max[k]); } });
    const forces: Record<string, unknown> = {};
    if (r.model.beams.length) F.forEach((f, k) => { const fac = k < 3 ? u.force.f : u.moment.f; forces[f] = { min: g(lo[k] / fac), max: g(hi[k] / fac), unit: k < 3 ? u.force.label : u.moment.label }; });
    return {
      case: c.name || `case ${i + 1}`,
      max_displacement: { value: g(md.value / u.dim.f), unit: u.dim.label, node: md.node },
      member_forces: r.model.beams.length ? forces : undefined,
      reactions: r.model.supports.slice(0, 24).map(s => { const q = post.nodeReaction(c, s.node); return { node: s.node, force: q.slice(0, 3).map(x => g(x / u.force.f)), moment: q.slice(3).map(x => g(x / u.moment.f)) }; }),
      reaction_units: `${u.force.label}, ${u.moment.label}`,
      equilibrium_error: g(c.equilibrium?.relError ?? 0),
    };
  });
  return out;
}
const isResult = (x: any): x is FEResult => !!x && typeof x === 'object' && x.k === 'result';
function outputsOf(h: GraphHost, n: NodeData): Record<string, unknown> {
  const ports = portsOf(n, h.project()).outputs, trees = h.engine.outputs(n.id), st = h.engine.status(n.id), units = h.project().units;
  const outs: Record<string, unknown> = {};
  ports.forEach((p, i) => {
    const items = trees[i]?.allItems() ?? [];
    const first = items[0];
    if (isResult(first)) outs[p.name] = summarizeResult(first, units);
    else outs[p.name] = items.length > 30 ? { count: items.length, first: items.slice(0, 30).map(formatValue) } : items.map(formatValue);
  });
  return { id: n.id, type: n.type, label: n.label, state: st.state, messages: st.messages.length ? st.messages : undefined, outputs: outs, note: 'These values were computed by Nodal.' };
}

function graphView(h: GraphHost): Record<string, unknown> {
  const p = h.project();
  return {
    units: p.units, name: p.name,
    components: p.graph.nodes.map(n => { const d = registry.get(n.type); return { id: n.id, type: n.type, label: n.label, x: n.x, y: n.y, inputs: Object.keys(n.consts).length ? n.consts : undefined, settings: d?.state && Object.keys(d.state).length && !isBlocked(n.type) ? n.state : undefined }; }),
    wires: p.graph.wires.map(w => { const a = p.graph.nodes.find(n => n.id === w.from), b = p.graph.nodes.find(n => n.id === w.to); return { from_id: w.from, output: a ? portsOf(a, p).outputs[w.out]?.name : w.out, to_id: w.to, input: b ? portsOf(b, p).inputs[w.inp]?.name : w.inp }; }),
  };
}

/** Columns by data-flow depth, rows in the order the components already have. */
export function arrangeGraph(graph: GraphDoc, ids?: string[]): Map<string, { x: number; y: number }> {
  const pick = new Set(ids?.length ? ids : graph.nodes.map(n => n.id)), nodes = graph.nodes.filter(n => pick.has(n.id));
  const depth = new Map<string, number>(), ins = new Map<string, string[]>();
  for (const w of graph.wires) if (pick.has(w.from) && pick.has(w.to)) { const l = ins.get(w.to); if (l) l.push(w.from); else ins.set(w.to, [w.from]); }
  const visit = (id: string, seen: Set<string>): number => {
    const d = depth.get(id); if (d !== undefined) return d;
    if (seen.has(id)) return 0;
    seen.add(id);
    const v = Math.max(-1, ...(ins.get(id) ?? []).map(s => visit(s, seen))) + 1;
    depth.set(id, v); return v;
  };
  for (const n of nodes) visit(n.id, new Set());
  // Pull sources (sliders, panels) next to the first component that uses them, so wires stay short.
  const outs = new Map<string, number[]>();
  for (const w of graph.wires) if (pick.has(w.from) && pick.has(w.to)) { const l = outs.get(w.from); if (l) l.push(depth.get(w.to)!); else outs.set(w.from, [depth.get(w.to)!]); }
  for (const n of nodes) if (!(ins.get(n.id)?.length) && outs.get(n.id)?.length) depth.set(n.id, Math.max(0, Math.min(...outs.get(n.id)!) - 1));
  const x0 = Math.min(...nodes.map(n => n.x), 1e9) === 1e9 ? 40 : Math.min(...nodes.map(n => n.x)), y0 = nodes.length ? Math.min(...nodes.map(n => n.y)) : 40;
  const cols = new Map<number, NodeData[]>();
  for (const n of nodes) { const c = depth.get(n.id) ?? 0; const l = cols.get(c); if (l) l.push(n); else cols.set(c, [n]); }
  const pos = new Map<string, { x: number; y: number }>(), rowOf = new Map<string, number>();
  for (const c of [...cols.keys()].sort((a, b) => a - b)) {
    const list = cols.get(c)!;
    // Order a column by the average row of what feeds each component, which keeps wires from crossing much.
    const key = (n: NodeData) => { const s = (ins.get(n.id) ?? []).map(id => rowOf.get(id)).filter((v): v is number => v !== undefined); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : n.y / 1000; };
    list.sort((a, b) => key(a) - key(b));
    let y = y0;
    for (const n of list) {
      const d = registry.get(n.type), rows = Math.max(d ? portsOf(n, { graph } as ProjectFile).inputs.length : 1, d?.outputs.length ?? 1, 1);
      const height = n.h ?? (d?.widget === 'panel' || d?.widget === 'note' ? 110 : d?.widget ? 56 : 34 + rows * 22);
      pos.set(n.id, { x: Math.round((x0 + c * 230) / 10) * 10, y: Math.round(y / 10) * 10 }); rowOf.set(n.id, y);
      y += height + 26;
    }
  }
  return pos;
}

export async function executeTool(h: GraphHost, name: string, input: any): Promise<ToolOutcome> {
  try { return await run(h, name, input && typeof input === 'object' ? input : {}); }
  catch (e) { if (e instanceof Reject) return { result: { error: e.message } }; return { result: { error: `The tool failed: ${(e as Error).message}` } }; }
}

async function run(h: GraphHost, name: string, a: any): Promise<ToolOutcome> {
  const p = h.project();
  switch (name) {
    case 'list_component_types': {
      const q = String(a.query ?? '').toLowerCase(), cat = String(a.category ?? '').toLowerCase();
      const list = registry.all().filter(d => !isBlocked(d.id) && (!cat || d.category.toLowerCase() === cat) && (!q || (d.id + ' ' + d.name + ' ' + d.desc).toLowerCase().includes(q)));
      return { result: { count: list.length, categories: cat || q ? undefined : [...new Set(list.map(d => d.category))], types: list.map(d => ({ type: d.id, name: d.name, category: d.category, description: d.desc.split('. ')[0] })) } };
    }
    case 'describe_components': {
      if (!Array.isArray(a.types) || !a.types.length) reject('"types" must be a list of component ids.');
      return { result: { components: (a.types as unknown[]).slice(0, 12).map(t => describe(def(t))) } };
    }
    case 'get_graph': return { result: graphView(h) };
    case 'add_component': {
      const d = def(a.type);
      const taken = p.graph.nodes, at = a.position && Number.isFinite(a.position.x) && Number.isFinite(a.position.y) ? { x: a.position.x, y: a.position.y } : { x: 40 + (taken.length % 6) * 230, y: (taken.length ? Math.max(...taken.map(n => n.y)) : 0) + 90 };
      const n = makeNode(d.id, Math.round(at.x / 10) * 10, Math.round(at.y / 10) * 10);
      if (a.label !== undefined) { if (typeof a.label !== 'string' || a.label.length > 80) reject('"label" must be short text.'); n.label = a.label; }
      // Settings first: they can change the ports (an Expression's variables, a Merge's inputs).
      const settings = a.settings && typeof a.settings === 'object' ? a.settings : {};
      for (const k of Object.keys(settings)) if (!(k in (d.state ?? {}))) reject(`${d.name} has no setting called "${k}". Its settings are: ${Object.keys(d.state ?? {}).join(', ') || '(none)'}.`);
      Object.assign(n.state, settings);
      for (const k of Object.keys(settings)) setting(d, n, k, settings[k]);
      const ports = (d.ports ? d.ports(n, p) : { inputs: d.inputs, outputs: d.outputs }).inputs, wires: { from: string; out: number; inp: number }[] = [];
      for (const [key, value] of Object.entries((a.inputs && typeof a.inputs === 'object' ? a.inputs : {}) as Record<string, any>)) {
        const i = findPort(ports, key, 'input', d.name);
        const sources = Array.isArray(value) && value.every(x => x && typeof x === 'object' && 'from' in x) ? value : value && typeof value === 'object' && !Array.isArray(value) && 'from' in value ? [value] : null;
        if (!sources) { n.consts[ports[i].name] = constant(ports[i], value, d.name); continue; }
        for (const s of sources) {
          const src = node(h, s.from), so = portsOf(src, p).outputs, first = so.findIndex(x => typesCompatible(x.type, ports[i].type)), o = s.output === undefined ? (first >= 0 ? first : reject(`No output of ${label(h, src)} fits ${d.name}.${ports[i].name} (${ports[i].type}). Its outputs are: ${so.map(x => `${x.name} (${x.type})`).join(', ')}.`)) : findPort(so, s.output, 'output', label(h, src));
          if (!typesCompatible(so[o].type, ports[i].type)) reject(`Cannot wire ${label(h, src)}.${so[o].name} (${so[o].type}) into ${d.name}.${ports[i].name} (${ports[i].type}).`);
          wires.push({ from: src.id, out: o, inp: i });
        }
      }
      h.mutate(q => { q.graph.nodes.push(n); for (const w of wires) q.graph.wires.push({ id: newId('w'), from: w.from, out: w.out, to: n.id, inp: w.inp }); });
      return { result: { id: n.id, type: d.id, inputs: ports.map(x => x.name), outputs: (d.ports ? d.ports(n, p) : d).outputs.map(x => x.name) }, action: `+ ${n.label ?? d.name}`, touched: [n.id] };
    }
    case 'set_parameter': {
      const n = node(h, a.id), d = registry.get(n.type)!;
      if (isBlocked(n.type)) reject('This component cannot be changed by the assistant.');
      const key = String(a.name ?? '');
      if (key === 'label') { if (typeof a.value !== 'string' || a.value.length > 80) reject('A label must be short text.'); h.mutate(q => { q.graph.nodes.find(x => x.id === n.id)!.label = a.value; }); return { result: { ok: true }, action: `rename ${d.name} to "${a.value}"`, touched: [n.id] }; }
      const ports = portsOf(n, p).inputs, i = ports.findIndex(x => x.name.toLowerCase() === key.toLowerCase() || x.nick.toLowerCase() === key.toLowerCase());
      if (i >= 0) {
        const v = constant(ports[i], a.value, label(h, n)), wired = p.graph.wires.some(w => w.to === n.id && w.inp === i);
        h.mutate(q => { q.graph.nodes.find(x => x.id === n.id)!.consts[ports[i].name] = v; });
        return { result: { ok: true, note: wired ? `Input "${ports[i].name}" is wired, so the wire still decides its value; disconnect it to use the constant.` : undefined }, action: `${label(h, n)}.${ports[i].name} = ${formatValue(v)}`, touched: [n.id] };
      }
      if (d.state && key in d.state) {
        const v = setting(d, n, key, a.value);
        h.mutate(q => { q.graph.nodes.find(x => x.id === n.id)!.state[key] = v; });
        return { result: { ok: true }, action: `${label(h, n)}: ${key} = ${typeof v === 'string' ? JSON.stringify(v.length > 40 ? v.slice(0, 40) + '…' : v) : formatValue(v)}`, touched: [n.id] };
      }
      return reject(`${d.name} has no input or setting called "${key}". Inputs: ${ports.map(x => x.name).join(', ') || '(none)'}. Settings: ${Object.keys(d.state ?? {}).join(', ') || '(none)'}.`);
    }
    case 'connect': {
      const from = node(h, a.from_id), to = node(h, a.to_id);
      if (isBlocked(to.type) || isBlocked(from.type)) reject('This component cannot be wired by the assistant.');
      const so = portsOf(from, p).outputs, ti = portsOf(to, p).inputs, o = findPort(so, a.output, 'output', label(h, from)), i = findPort(ti, a.input, 'input', label(h, to));
      if (!typesCompatible(so[o].type, ti[i].type)) reject(`Cannot wire ${label(h, from)}.${so[o].name} (${so[o].type}) into ${label(h, to)}.${ti[i].name} (${ti[i].type}).`);
      if (wouldCycle(p.graph, from.id, to.id)) reject('That wire would create a loop, which a graph cannot evaluate.');
      h.mutate(q => {
        if (!a.add) q.graph.wires = q.graph.wires.filter(w => !(w.to === to.id && w.inp === i));
        if (!q.graph.wires.some(w => w.from === from.id && w.out === o && w.to === to.id && w.inp === i)) q.graph.wires.push({ id: newId('w'), from: from.id, out: o, to: to.id, inp: i });
      });
      return { result: { ok: true }, action: `connect ${label(h, from)}.${so[o].name} → ${label(h, to)}.${ti[i].name}`, touched: [from.id, to.id] };
    }
    case 'disconnect': {
      const to = node(h, a.to_id), ti = portsOf(to, p).inputs, i = findPort(ti, a.input, 'input', label(h, to));
      let o = -1; if (a.from_id !== undefined) { const from = node(h, a.from_id); o = a.output === undefined ? -2 : findPort(portsOf(from, p).outputs, a.output, 'output', label(h, from)); }
      const hit = (w: { from: string; out: number; to: string; inp: number }) => w.to === to.id && w.inp === i && (a.from_id === undefined || (w.from === a.from_id && (o === -2 || w.out === o)));
      const n = p.graph.wires.filter(hit).length;
      if (!n) reject(`There is no such wire into ${label(h, to)}.${ti[i].name}.`);
      h.mutate(q => { q.graph.wires = q.graph.wires.filter(w => !hit(w)); });
      return { result: { ok: true, removed: n }, action: `disconnect ${label(h, to)}.${ti[i].name}`, touched: [to.id] };
    }
    case 'delete_component': {
      const n = node(h, a.id), nm = label(h, n);
      h.mutate(q => { q.graph.nodes = q.graph.nodes.filter(x => x.id !== n.id); q.graph.wires = q.graph.wires.filter(w => w.from !== n.id && w.to !== n.id); for (const g of q.graph.groups) g.nodes = g.nodes.filter(x => x !== n.id); q.graph.groups = q.graph.groups.filter(g => g.nodes.length); });
      return { result: { ok: true }, action: `− ${nm}` };
    }
    case 'arrange': {
      if (a.ids !== undefined && (!Array.isArray(a.ids) || a.ids.some((x: unknown) => typeof x !== 'string'))) reject('"ids" must be a list of component ids.');
      for (const id of a.ids ?? []) node(h, id);
      const pos = arrangeGraph(p.graph, a.ids);
      h.mutate(q => { for (const n of q.graph.nodes) { const t = pos.get(n.id); if (t) { n.x = t.x; n.y = t.y; } } });
      return { result: { ok: true, arranged: pos.size }, action: `arrange ${pos.size} components` };
    }
    case 'run_analysis': {
      await h.settle();
      const q = h.project(), issues: Record<string, unknown>[] = []; let ok = 0;
      for (const n of q.graph.nodes) { const st = h.engine.status(n.id); if (st.state === 'error' || st.state === 'warning') issues.push({ id: n.id, type: n.type, label: n.label, state: st.state, messages: st.messages }); else if (st.state === 'ok') ok++; }
      for (const n of q.graph.nodes) for (const t of h.engine.outputs(n.id)) { const r = t?.first?.(); if (isResult(r) && r.messages.length && !issues.some(x => x.id === n.id)) issues.push({ id: n.id, type: n.type, label: n.label, state: 'warning', messages: r.messages }); }
      const errors = issues.filter(x => x.state === 'error').length;
      return { result: { status: errors ? 'errors' : issues.length ? 'warnings' : 'ok', components: q.graph.nodes.length, solved: ok, errors, warnings: issues.length - errors, issues }, action: `run analysis: ${errors ? errors + ' error(s)' : issues.length ? issues.length + ' warning(s)' : 'no errors or warnings'}` };
    }
    case 'get_results': {
      await h.settle();
      const q = h.project();
      if (a.id !== undefined) return { result: outputsOf(h, node(h, a.id)) };
      const found: Record<string, unknown>[] = [];
      for (const n of q.graph.nodes) { const ports = portsOf(n, q).outputs; h.engine.outputs(n.id).forEach((t, i) => { const r = t?.first?.(); if (isResult(r) && ports[i]?.type === 'result') found.push({ id: n.id, type: n.type, label: n.label, result: summarizeResult(r, q.units) }); }); }
      if (!found.length) reject('There is no analysis result on the canvas yet. Add an analysis component (for example fe.static) and run it.');
      return { result: { source: 'Nodal solver', results: found } };
    }
    case 'load_template': {
      const key = String(a.name ?? '').toLowerCase(), t = TEMPLATES.find(x => x.id === key || x.title.toLowerCase() === key);
      if (!t) return a.name ? reject(`Unknown template "${a.name}". Templates: ${TEMPLATES.map(x => x.id).join(', ')}.`) : { result: { templates: TEMPLATES.map(x => ({ name: x.id, title: x.title, summary: x.summary })) } };
      const g = t.build().project.graph, map = new Map<string, string>(), dy = (p.graph.nodes.length ? Math.max(...p.graph.nodes.map(n => n.y)) + 160 : 0);
      const nodes = g.nodes.map(n => { const id = newId(); map.set(n.id, id); return { ...n, id, y: n.y + dy }; });
      h.mutate(q => { q.graph.nodes.push(...nodes); for (const w of g.wires) q.graph.wires.push({ ...w, id: newId('w'), from: map.get(w.from)!, to: map.get(w.to)! }); for (const gr of g.groups) q.graph.groups.push({ ...gr, id: newId('g'), nodes: gr.nodes.map(x => map.get(x)!) }); });
      return { result: { ok: true, components: nodes.map(n => ({ id: n.id, type: n.type, label: n.label })) }, action: `+ template "${t.title}"`, touched: nodes.map(n => n.id) };
    }
    case 'load_example': {
      const key = String(a.name ?? '').toLowerCase(), ex = EXAMPLES.find(x => x.id === key || x.title.toLowerCase() === key);
      if (!ex) return a.name ? reject(`Unknown example "${a.name}". Use load_example with no name to list them.`) : { result: { examples: EXAMPLES.filter(x => !x.id.startsWith('bench-')).map(x => ({ name: x.id, title: x.title })) } };
      const np = ex.build().project;
      h.mutate(q => { q.graph = np.graph; q.name = np.name; q.description = np.description; q.units = np.units; q.clusters = np.clusters; });
      return { result: { ok: true, components: np.graph.nodes.length }, action: `open example "${ex.title}"`, touched: np.graph.nodes.map(n => n.id) };
    }
    default: return reject(`Unknown tool "${name}".`);
  }
}
