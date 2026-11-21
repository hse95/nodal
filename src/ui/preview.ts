/**
 * Decides which component outputs are drawn in the 3D view.
 *
 * A structural model passes through several components (curves -> elements ->
 * model -> analysis result -> result view), and each stage could draw it. Drawing
 * all of them on top of each other is unreadable, so only the last stage that
 * draws is shown: an output is hidden when a component it is wired into already
 * draws a more complete picture of the same thing.
 *
 *   rank 3  result view     rank 2  analysis result     rank 1  model
 *   rank 0.5  elements, supports, loads     rank 0  geometry feeding a structural component
 *
 * Ticking "Preview in 3D" on a component (preview === true) or selecting it
 * always draws it. Switching off the preview of the last stage hides the whole
 * chain; it does not bring the earlier stages back.
 */
import { project, engine, registry, portsOf, unwrap } from './store';
import type { NodeData } from '../core/types';
import type { FEResult } from '../fe/system';

const GEOMETRY_TYPES = new Set(['point', 'curve', 'surface', 'mesh', 'brep', 'geometry', 'plane']);
export const PREVIEW_TYPES = new Set([...GEOMETRY_TYPES, 'model', 'result', 'element', 'support', 'load']);

function rankOf(item: any): number {
  switch (item?.k) {
    case 'feview': return 3;
    case 'result': return 2;
    case 'model': return 1;
    case 'element': case 'support': case 'load': return 0.5;
    default: return -1;
  }
}
/** Whether the component's own preview setting allows drawing (before the overlap rule). */
export function previewOn(n: NodeData): boolean {
  const def = registry.get(n.type);
  return !!def && n.enabled !== false && n.preview !== false && !(def.noPreview && n.preview !== true);
}

export interface PreviewPlan {
  /** True when output `out` of the node should be drawn (not counting selection, which always draws). */
  draws(nodeId: string, out: number): boolean;
  /** Name of the component that draws this node's structural output instead, when it is hidden automatically. */
  hiddenBy(nodeId: string): string | null;
}

export function previewPlan(): PreviewPlan {
  const proj = unwrap(project), nodes = new Map(proj.graph.nodes.map(n => [n.id, n]));
  const outRank = new Map<string, number[]>(), nodeRank = new Map<string, number>();
  for (const n of proj.graph.nodes) {
    const ranks = engine.outputs(n.id).map(t => { let r = -1; if (t) for (const b of t.branches) { if (b.items.length) { r = Math.max(r, rankOf(b.items[0])); break; } } return r; });
    outRank.set(n.id, ranks); nodeRank.set(n.id, Math.max(-1, ...ranks));
  }
  const consumers = new Map<string, string[]>();
  for (const w of proj.graph.wires) { const key = `${w.from}:${w.out}`, l = consumers.get(key); if (l) l.push(w.to); else consumers.set(key, [w.to]); }
  const alive = (n: NodeData | undefined): n is NodeData => !!n && n.enabled !== false && engine.status(n.id).state !== 'error';
  const memo = new Map<string, string | null>();
  /** The component that takes over the drawing of this output, or null. */
  const coveredBy = (id: string, out: number): string | null => {
    const key = `${id}:${out}`;
    if (memo.has(key)) return memo.get(key)!;
    memo.set(key, null);
    const n = nodes.get(id)!, def = registry.get(n.type), port = def ? portsOf(n, proj).outputs[out] : undefined;
    let r = outRank.get(id)?.[out] ?? -1;
    const geometry = r < 0;
    if (geometry) { if (!port || !GEOMETRY_TYPES.has(port.type) && port.type !== 'any') return null; r = 0; }
    let found: string | null = null;
    for (const cid of consumers.get(key) ?? []) {
      const c = nodes.get(cid);
      if (!alive(c) || (nodeRank.get(cid) ?? -1) <= r) continue;
      if (geometry && registry.get(c.type)?.category !== 'Structure') continue;
      // The consumer takes over the drawing, whether or not its own preview is on: switching a Result View off
      // hides the result, it does not bring the earlier stages back.
      found = c.label ?? registry.get(c.type)?.name ?? c.type; break;
    }
    memo.set(key, found);
    return found;
  };
  const sibling = (id: string, out: number): boolean => {
    const ranks = outRank.get(id) ?? [], top = nodeRank.get(id) ?? -1, r = ranks[out] ?? -1;
    if (top < 0.5) return false;
    // A component that outputs elements, a model or a result draws only its most complete output.
    return r < top;
  };
  return {
    draws(id, out) {
      const n = nodes.get(id);
      if (!n || !previewOn(n)) return false;
      if (sibling(id, out)) return false;
      return n.preview === true || coveredBy(id, out) === null;
    },
    hiddenBy(id) {
      const n = nodes.get(id);
      if (!n || !previewOn(n) || n.preview === true) return null;
      const ranks = outRank.get(id) ?? [];
      let by: string | null = null, drawsSomething = false;
      ranks.forEach((_, j) => { if (sibling(id, j)) return; const c = coveredBy(id, j); if (c) by = c; else if (PREVIEW_TYPES.has(portsOf(n, proj).outputs[j]?.type ?? '')) drawsSomething = true; });
      return drawsSomething ? null : by;
    },
  };
}

/** First analysis result found in a component's outputs (directly, or inside a Result View). */
export function firstResult(id: string): FEResult | null {
  for (const t of engine.outputs(id)) for (const it of t.allItems() as any[]) { if (it?.k === 'result') return it; if (it?.k === 'feview') return it.result; }
  return null;
}
