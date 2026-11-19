/**
 * Graph engine: component registry, type coercion, and incremental evaluation.
 *
 * Evaluation model
 *  1. Nodes are sorted topologically; nodes on a cycle are reported as errors.
 *  2. For every node a signature is built from its own settings and from the
 *     result versions of the nodes feeding it. A node whose signature has not
 *     changed is skipped, so dragging one slider only recomputes what is
 *     downstream of it.
 *  3. Inputs are collected (wires, then constants, then defaults), coerced to
 *     the port type, and passed through the per-port tree modifiers.
 *  4. Branches are matched across inputs, items are matched inside each set of
 *     branches (longest / shortest / cross), and `solve` runs once per match.
 */
import { DataTree, matchBranches, matchIndices, Matching } from './tree';
import type { ComponentDef, DType, GraphDoc, NodeData, NodeStatus, PortSpec, ProjectFile, SolveContext, WireData } from './types';
import { isV3, isPlane, v, planeFromNormal, Z } from '../geom/vec';
import { isCurve, curveLength } from '../geom/curve';
import { isSurface, surfaceToMesh } from '../geom/surface';
import { isMesh } from '../geom/mesh';

// ---- registry ------------------------------------------------------------
export class Registry {
  private defs = new Map<string, ComponentDef>();
  add(def: ComponentDef): void {
    if (this.defs.has(def.id)) throw new Error(`Duplicate component id ${def.id}`);
    this.defs.set(def.id, def);
  }
  get(id: string): ComponentDef | undefined { return this.defs.get(id); }
  all(): ComponentDef[] { return [...this.defs.values()]; }
}
export const registry = new Registry();

/** Port specification helper: P('A', 'number', 'First value', { d: 0 }). */
export function P(name: string, type: DType, desc: string, o: { d?: unknown; list?: boolean; tree?: boolean; opt?: boolean; nick?: string } = {}): PortSpec {
  return {
    name, nick: o.nick ?? (name.length <= 5 ? name : name.replace(/[^A-Z0-9]/g, '').slice(0, 3) || name.slice(0, 3)),
    type, desc, access: o.tree ? 'tree' : o.list ? 'list' : 'item', default: o.d, optional: o.opt,
  };
}
export function portsOf(node: NodeData, project: ProjectFile, reg: Registry = registry): { inputs: PortSpec[]; outputs: PortSpec[] } {
  const def = reg.get(node.type);
  if (!def) return { inputs: [], outputs: [] };
  return def.ports ? def.ports(node, project) : { inputs: def.inputs, outputs: def.outputs };
}

// ---- coercion --------------------------------------------------------------
const STRUCT_TYPES = new Set(['material', 'section', 'element', 'support', 'load', 'model', 'result']);
export function typeOfValue(val: any): DType {
  if (typeof val === 'number') return 'number';
  if (typeof val === 'boolean') return 'boolean';
  if (typeof val === 'string') return 'text';
  if (isV3(val)) return 'point';
  if (isPlane(val)) return 'plane';
  if (isCurve(val)) return 'curve';
  if (isSurface(val)) return 'surface';
  if (isMesh(val)) return 'mesh';
  if (val && typeof val === 'object' && STRUCT_TYPES.has(val.k)) return val.k;
  if (val && val.k === 'domain') return 'domain';
  if (Array.isArray(val) && val.length === 16) return 'transform';
  return 'any';
}
export function coerce(val: any, type: DType): any {
  if (val === null || val === undefined) throw new Error('Empty value');
  const fail = (): never => { throw new Error(`Cannot use ${typeOfValue(val)} data where ${type} is expected`); };
  switch (type) {
    case 'any': case 'geometry': return val;
    case 'number': case 'integer': {
      let n: number;
      if (typeof val === 'number') n = val;
      else if (typeof val === 'boolean') n = val ? 1 : 0;
      else if (typeof val === 'string' && val.trim() !== '' && Number.isFinite(Number(val))) n = Number(val);
      else return fail();
      return type === 'integer' ? Math.round(n) : n;
    }
    case 'boolean':
      if (typeof val === 'boolean') return val;
      if (typeof val === 'number') return val !== 0;
      if (typeof val === 'string' && /^(true|false|yes|no|1|0)$/i.test(val.trim())) return /^(true|yes|1)$/i.test(val.trim());
      return fail();
    case 'text': return typeof val === 'string' ? val : formatValue(val);
    case 'point': case 'vector': {
      if (isV3(val)) return val;
      if (isPlane(val)) return type === 'point' ? val.o : val.z;
      if (Array.isArray(val) && val.length === 3 && val.every(x => typeof x === 'number')) return v(val[0], val[1], val[2]);
      if (typeof val === 'string') {
        const parts = val.replace(/[{}()[\]]/g, '').split(/[,;\s]+/).filter(s => s.length).map(Number);
        if (parts.length === 3 && parts.every(Number.isFinite)) return v(parts[0], parts[1], parts[2]);
        if (parts.length === 2 && parts.every(Number.isFinite)) return v(parts[0], parts[1], 0);
      }
      return fail();
    }
    case 'plane': if (isPlane(val)) return val; if (isV3(val)) return planeFromNormal(val, Z); return fail();
    case 'curve': return isCurve(val) ? val : fail();
    case 'surface': return isSurface(val) ? val : fail();
    case 'mesh': if (isMesh(val)) return val; if (isSurface(val)) return surfaceToMesh(val, 10, 10); return fail();
    case 'brep': return isMesh(val) || isSurface(val) ? val : fail();
    case 'domain': {
      if (val && val.k === 'domain') return val;
      if (typeof val === 'number') return { k: 'domain', a: 0, b: val };
      if (typeof val === 'string') {
        const m = val.split(/\s*(?:to|,|;)\s*/i).map(Number);
        if (m.length === 2 && m.every(Number.isFinite)) return { k: 'domain', a: m[0], b: m[1] };
      }
      return fail();
    }
    case 'color': return typeof val === 'string' ? val : fail();
    case 'transform': return Array.isArray(val) && val.length === 16 ? val : fail();
    default: return val && typeof val === 'object' && val.k === type ? val : fail();
  }
}
export function fmtNum(n: number, digits = 6): string {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return '0';
  const a = Math.abs(n);
  if (a >= 1e9 || a < 1e-6) return n.toExponential(Math.max(0, digits - 1)).replace(/\.?0+e/, 'e');
  return String(parseFloat(n.toPrecision(digits)));
}
/** Short human-readable form of any value, used by panels and tooltips. */
export function formatValue(val: any): string {
  if (val === null || val === undefined) return '<empty>';
  if (typeof val === 'number') return fmtNum(val);
  if (typeof val === 'boolean') return val ? 'True' : 'False';
  if (typeof val === 'string') return val;
  if (isV3(val)) return `{${fmtNum(val.x)}, ${fmtNum(val.y)}, ${fmtNum(val.z)}}`;
  if (isPlane(val)) return `Plane O${formatValue(val.o)} Z${formatValue(val.z)}`;
  if (isCurve(val)) {
    const names: Record<string, string> = { line: 'Line', polyline: 'Polyline', arc: 'Arc', nurbs: 'NURBS curve', poly: 'Poly-curve' };
    return `${names[val.k]} (L = ${fmtNum(curveLength(val), 5)})`;
  }
  if (isSurface(val)) return `Surface (${val.nu} x ${val.nv} control points)`;
  if (isMesh(val)) return `${val.solid ? 'Solid mesh' : 'Mesh'} (V = ${val.v.length / 3}, F = ${val.f.length})`;
  if (val.k === 'domain') return `${fmtNum(val.a)} to ${fmtNum(val.b)}`;
  if (typeof val.summary === 'string') return val.summary;
  if (typeof val.name === 'string' && typeof val.k === 'string') return `${val.k}: ${val.name}`;
  if (Array.isArray(val)) return val.length === 16 ? 'Transform' : `[${val.map(formatValue).join(', ')}]`;
  if (typeof val.k === 'string') return val.k;
  try { return JSON.stringify(val); } catch { return String(val); }
}

// ---- evaluation -------------------------------------------------------------
interface CacheEntry { sig: string; outputs: DataTree[]; version: number; status: NodeStatus; inputs: (DataTree | null)[] }

export class Engine {
  private cache = new Map<string, CacheEntry>();
  private versionCounter = 1;
  private runToken = 0;
  private running: Promise<void> | null = null;
  private queued: ProjectFile | null = null;
  /** Called after every completed run. */
  onUpdate: (() => void) | null = null;
  /** Called when a node starts/finishes solving (for progress display). */
  onProgress: ((nodeId: string | null) => void) | null = null;
  /** Values injected into cluster input nodes when this engine evaluates a subgraph. */
  clusterInputs: Record<string, DataTree> | null = null;

  constructor(private reg: Registry = registry) {}

  status(id: string): NodeStatus { return this.cache.get(id)?.status ?? { state: 'idle', messages: [], ms: 0 }; }
  outputs(id: string): DataTree[] { return this.cache.get(id)?.outputs ?? []; }
  inputs(id: string): (DataTree | null)[] { return this.cache.get(id)?.inputs ?? []; }
  /** Abort the current run as soon as the node being solved returns. */
  cancel(): void { this.runToken++; this.queued = null; }
  /** Forget cached results so that the next run recomputes everything (or one node). */
  invalidate(id?: string): void { if (id) this.cache.delete(id); else this.cache.clear(); }

  /**
   * Evaluate the project. Calls made while a run is in progress are coalesced:
   * the current run is abandoned at the next node boundary and one new run starts.
   */
  run(project: ProjectFile): Promise<void> {
    if (this.running) { this.queued = project; this.runToken++; return this.running; }
    this.running = (async () => {
      let p: ProjectFile | null = project;
      while (p) {
        this.queued = null;
        try { await this.runOnce(p); } catch (e) { console.error(e); }
        p = this.queued;
      }
      this.running = null;
      this.onUpdate?.();
    })();
    return this.running;
  }

  private async runOnce(project: ProjectFile): Promise<void> {
    const token = ++this.runToken;
    const graph = project.graph;
    const byId = new Map(graph.nodes.map(n => [n.id, n]));
    const incoming = new Map<string, WireData[]>();
    for (const w of graph.wires) {
      if (!byId.has(w.from) || !byId.has(w.to)) continue;
      const list = incoming.get(w.to); if (list) list.push(w); else incoming.set(w.to, [w]);
    }
    // Kahn topological sort.
    const indeg = new Map<string, number>(graph.nodes.map(n => [n.id, 0]));
    const outgoing = new Map<string, string[]>();
    for (const [to, ws] of incoming) for (const w of ws) {
      indeg.set(to, (indeg.get(to) ?? 0) + 1);
      const o = outgoing.get(w.from); if (o) o.push(to); else outgoing.set(w.from, [to]);
    }
    const queue = graph.nodes.filter(n => indeg.get(n.id) === 0).map(n => n.id), order: string[] = [];
    while (queue.length) {
      const id = queue.shift()!; order.push(id);
      for (const to of outgoing.get(id) ?? []) { const d = indeg.get(to)! - 1; indeg.set(to, d); if (d === 0) queue.push(to); }
    }
    const ordered = new Set(order);
    for (const n of graph.nodes) if (!ordered.has(n.id)) {
      this.cache.set(n.id, { sig: '', outputs: [], version: this.versionCounter++, inputs: [], status: { state: 'error', messages: ['This component is part of a loop. Remove one of the wires that feeds it from its own output.'], ms: 0 } });
    }
    for (const id of [...this.cache.keys()]) if (!byId.has(id)) this.cache.delete(id);

    for (const id of order) {
      if (token !== this.runToken) return;
      const node = byId.get(id)!, def = this.reg.get(node.type);
      const ws = incoming.get(id) ?? [];
      const sig = JSON.stringify([node.type, node.state, node.consts, node.mods ?? 0, node.matching ?? 0, node.enabled !== false, project.units,
        ws.map(w => [w.inp, w.from, w.out, this.cache.get(w.from)?.version ?? 0]),
        node.type === 'cluster' ? project.clusters[node.state.clusterId] ?? 0 : 0,
        node.type === 'cluster.in' && this.clusterInputs ? this.versionCounter : 0]);
      const cached = this.cache.get(id);
      if (cached && cached.sig === sig) continue;
      if (!def) {
        this.cache.set(id, { sig, outputs: [], version: this.versionCounter++, inputs: [], status: { state: 'error', messages: [`Unknown component type "${node.type}". It may come from a newer version of Nodal.`], ms: 0 } });
        continue;
      }
      this.onProgress?.(id);
      const t0 = performance.now();
      const entry = await this.solveNode(node, def, ws, project, token);
      entry.sig = sig; entry.status.ms = performance.now() - t0;
      if (token !== this.runToken) return;           // result belongs to an abandoned run
      this.cache.set(id, entry);
    }
    this.onProgress?.(null);
  }

  private async solveNode(node: NodeData, def: ComponentDef, wires: WireData[], project: ProjectFile, token: number): Promise<CacheEntry> {
    const { inputs: inPorts, outputs: outPorts } = def.ports ? def.ports(node, project) : { inputs: def.inputs, outputs: def.outputs };
    const messages: string[] = [];
    const mk = (state: NodeStatus['state'], outputs: DataTree[], inputs: (DataTree | null)[] = []): CacheEntry =>
      ({ sig: '', outputs, version: this.versionCounter++, inputs, status: { state, messages, ms: 0 } });
    const empty = () => outPorts.map(() => new DataTree());
    if (node.enabled === false) return mk('disabled', empty());

    // 1. collect inputs
    const trees: (DataTree | null)[] = [];
    try {
      inPorts.forEach((port, i) => {
        const ws = wires.filter(w => w.inp === i);
        let tree: DataTree | null = null;
        if (ws.length) {
          const parts = ws.map(w => this.cache.get(w.from)?.outputs[w.out] ?? new DataTree());
          const merged = parts.length === 1 ? parts[0] : DataTree.merge(parts);
          tree = port.type === 'any' || port.type === 'geometry' ? merged : merged.map_(item => coerce(item, port.type));
        } else {
          const c = node.consts[port.name] !== undefined && node.consts[port.name] !== '' ? node.consts[port.name] : port.default;
          if (c !== undefined && c !== null) {
            tree = Array.isArray(c) && port.access !== 'item' && port.type !== 'transform'
              ? DataTree.fromList(c.map(x => coerce(x, port.type))) : DataTree.of(coerce(c, port.type));
          }
        }
        if (tree) {
          const m = node.mods?.[port.name];
          if (m?.flatten) tree = tree.flatten();
          if (m?.graft) tree = tree.graft();
          if (m?.simplify) tree = tree.simplify();
          if (m?.reverse) tree = tree.reverse();
        }
        trees.push(tree);
      });
    } catch (e) {
      messages.push((e as Error).message);
      return mk('error', empty(), trees);
    }
    const missing = inPorts.filter((p, i) => !p.optional && (trees[i] === null || trees[i]!.isEmpty));
    if (missing.length) {
      messages.push(`Input "${missing[0].name}" has no data. Connect a wire or set a value in the inspector.`);
      return mk('warning', empty(), trees);
    }

    const ctx: SolveContext = {
      node, project, units: project.units,
      warn: (m) => { if (!messages.includes(m)) messages.push(m); },
      cancelled: () => token !== this.runToken,
      runSubgraph: async (graph: GraphDoc, inputs: Record<string, DataTree>) => {
        const sub = new Engine(this.reg);
        sub.clusterInputs = inputs;
        await sub.runOnce({ ...project, graph });
        const out: Record<string, DataTree> = {};
        for (const n of graph.nodes) {
          if (n.type === 'cluster.out') out[n.state.name ?? 'Out'] = sub.inputs(n.id)[0] ?? new DataTree();
          const st = sub.status(n.id);
          if (st.state === 'error') throw new Error(`Inside cluster, "${this.reg.get(n.type)?.name ?? n.type}": ${st.messages[0]}`);
        }
        return out;
      },
    };
    (ctx as any).clusterInputs = this.clusterInputs;

    // 2. solve
    try {
      let outputs: DataTree[];
      if (def.solveTrees) {
        outputs = await def.solveTrees(trees.map(t => t ?? new DataTree()), ctx);
      } else if (def.solve) {
        outputs = outPorts.map(() => new DataTree());
        const active = inPorts.map((_, i) => i).filter(i => trees[i] !== null && !trees[i]!.isEmpty);
        const matched = matchBranches(active.map(i => trees[i]!));
        const hasItemIn = inPorts.some(p => p.access === 'item');
        const mode: Matching = node.matching ?? 'longest';
        for (const { path, lists } of matched) {
          const itemSlots = active.map((i, k) => (inPorts[i].access === 'item' ? k : -1)).filter(k => k >= 0);
          const combos = itemSlots.length ? matchIndices(itemSlots.map(k => lists[k].length), mode) : [[]];
          for (let it = 0; it < combos.length; it++) {
            const args: any[] = inPorts.map(() => undefined);
            active.forEach((i, k) => {
              const slot = itemSlots.indexOf(k);
              args[i] = slot >= 0 ? lists[k][combos[it][slot]] : lists[k];
            });
            const res = await def.solve(args, ctx);
            outPorts.forEach((port, o) => {
              const r = res[o];
              if (r === undefined || r === null) return;
              if (port.access === 'list') {
                // A list produced once per item gets its own sub-branch {path;i} so results stay separable.
                const p = hasItemIn ? [...path, it] : path;
                outputs[o].add(p, Array.isArray(r) ? r.filter(x => x !== undefined && x !== null) : [r]);
              } else outputs[o].add(path, [r]);
            });
            if (token !== this.runToken) return mk('pending', empty(), trees);
          }
        }
      } else outputs = empty();
      return mk(messages.length ? 'warning' : 'ok', outputs, trees);
    } catch (e) {
      messages.unshift((e as Error).message || String(e));
      return mk('error', empty(), trees);
    }
  }
}

// ---- document helpers ---------------------------------------------------------
let idCounter = 0;
export function newId(prefix = 'n'): string {
  idCounter++;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}
export function makeNode(type: string, x: number, y: number, init: Partial<NodeData> = {}, reg: Registry = registry): NodeData {
  const def = reg.get(type);
  if (!def) throw new Error(`Unknown component "${type}"`);
  return { id: newId(), type, x, y, state: JSON.parse(JSON.stringify(def.state ?? {})), consts: {}, ...init };
}
/** True if adding a wire from -> to would create a cycle. */
export function wouldCycle(graph: GraphDoc, from: string, to: string): boolean {
  if (from === to) return true;
  const out = new Map<string, string[]>();
  for (const w of graph.wires) { const l = out.get(w.from); if (l) l.push(w.to); else out.set(w.from, [w.to]); }
  const stack = [to], seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === from) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const nx of out.get(id) ?? []) stack.push(nx);
  }
  return false;
}
export function emptyProject(name = 'Untitled'): ProjectFile {
  return { format: 'nodal', schema: 1, name, units: 'SI', graph: { nodes: [], wires: [], groups: [] }, clusters: {} };
}
