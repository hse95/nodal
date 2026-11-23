/**
 * Component library, part 4: list and tree operations familiar from Grasshopper, paneling and
 * structure generators, tweening, pipes, mesh subdivision, deformations and sun position.
 * All of it is written for Nodal from the published mathematics; nothing is copied from other tools.
 */
import { P } from '../core/graph';
import { DataTree, pathText } from '../core/tree';
import type { DType } from '../core/types';
import { C, num, int, pt, vec } from './basic';
import { V3, v, add, sub, mul, unit, len, cross, dot, lerp, Z, X } from '../geom/vec';
import * as cv from '../geom/curve';
import * as sf from '../geom/surface';
import * as ms from '../geom/mesh';
import { toMesh } from './geometry';

const L = (n: string, d: string, type: DType = 'any', o: any = {}) => P(n, type, d, { list: true, nick: 'L', ...o });
const T = (n: string, d: string, o: any = {}) => P(n, 'any', d, { tree: true, nick: 'T', ...o });
const crv = (n: string, d: string, o: any = {}) => P(n, 'curve', d, { nick: 'C', ...o });
const srf = (n: string, d: string, o: any = {}) => P(n, 'surface', d, { nick: 'S', ...o });
const msh = (n: string, d: string, o: any = {}) => P(n, 'mesh', d, { nick: 'M', ...o });
const wrap = (i: number, n: number) => ((i % n) + n) % n;
const same = (a: any, b: any): boolean => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)) : JSON.stringify(a) === JSON.stringify(b));
/** A small repeatable random number generator (mulberry32), so that a seed always gives the same result. */
export function rng(seed: number): () => number { let a = (Math.floor(seed) >>> 0) + 0x6d2b79f5; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ======================================================================= Lists
C('list.split', 'Split List', 'Split', 'Lists', 'Splits a list in two at an index: A holds the items before it, B the rest.', [L('List', 'The list'), int('Index', 'Where to split', 1, { nick: 'i' })], [P('A', 'any', 'Items before the index', { list: true }), P('B', 'any', 'Items from the index on', { list: true })],
  ([l, i]) => { const k = Math.max(0, Math.min(l.length, i < 0 ? l.length + i : i)); return [l.slice(0, k), l.slice(k)]; }, { example: 'Split at 1 to separate the first support from the others' });
C('list.cullnth', 'Cull Nth', 'CullN', 'Lists', 'Removes every Nth item.', [L('List', 'The list'), int('N', 'Remove every Nth item', 2, { nick: 'N' })], [L('List', 'Remaining items')], ([l, n]) => { if (n < 1) throw new Error('N must be 1 or more'); return [l.filter((_: any, i: number) => (i + 1) % n !== 0)]; });
C('list.dedupe', 'Delete Consecutive', 'DCon', 'Lists', 'Removes items that repeat the item just before them. With Wrap on, the last item is also compared with the first.', [L('List', 'The list'), P('Wrap', 'boolean', 'Compare the last item with the first', { d: false, nick: 'W' })], [L('List', 'Items without consecutive repeats'), int('Removed', 'How many were removed', undefined, { nick: 'N' })],
  ([l, w]) => { const out = l.filter((x: any, i: number) => i === 0 || !same(x, l[i - 1])); if (w && out.length > 1 && same(out[0], out[out.length - 1])) out.pop(); return [out, l.length - out.length]; });
C('list.repeat', 'Repeat Data', 'Repeat', 'Lists', 'Repeats a pattern until the list has the given length.', [L('Data', 'The pattern to repeat', 'any', { nick: 'D' }), int('Length', 'Length of the result', 10, { nick: 'L' })], [L('Data', 'Repeated data', 'any', { nick: 'D' })], ([d, n]) => { if (!d.length) return [[]]; return [Array.from({ length: Math.max(0, n) }, (_, i) => d[i % d.length])]; });
C('list.jitter', 'Jitter', 'Jitter', 'Lists', 'Shuffles a list. Jitter 0 leaves it as it is, 1 shuffles it completely; the same seed always gives the same order.', [L('List', 'The list'), num('Jitter', 'Strength from 0 to 1', 1, { nick: 'J' }), int('Seed', 'Random seed', 1, { nick: 'S' })], [L('List', 'Shuffled list'), P('Indices', 'integer', 'Original index of each item', { list: true, nick: 'i' })],
  ([l, j, s]) => { const r = rng(s), k = Math.max(0, Math.min(1, j)), keys = l.map((_: any, i: number) => i + k * (r() - 0.5) * 2 * l.length), idx = l.map((_: any, i: number) => i).sort((a: number, b: number) => keys[a] - keys[b]); return [idx.map((i: number) => l[i]), idx]; });
C('list.insert', 'Insert Items', 'Ins', 'Lists', 'Inserts items into a list at the given indices (indices refer to the original list).', [L('List', 'The list'), P('Items', 'any', 'Items to insert', { list: true, nick: 'I' }), P('Indices', 'integer', 'Where each item goes', { list: true, nick: 'i' })], [L('List', 'List with the items inserted')],
  ([l, it, idx]) => { const at = new Map<number, any[]>(); it.forEach((x: any, k: number) => { const i = Math.max(0, Math.min(l.length, idx[Math.min(k, idx.length - 1)] ?? l.length)); at.set(i, [...(at.get(i) ?? []), x]); }); const out: any[] = []; for (let i = 0; i <= l.length; i++) { out.push(...(at.get(i) ?? [])); if (i < l.length) out.push(l[i]); } return [out]; });
C('list.replace', 'Replace Items', 'Replace', 'Lists', 'Replaces the items at the given indices.', [L('List', 'The list'), P('Items', 'any', 'Replacement items', { list: true, nick: 'I' }), P('Indices', 'integer', 'Which positions to replace', { list: true, nick: 'i' })], [L('List', 'List with replaced items')],
  ([l, it, idx]) => { const out = [...l]; idx.forEach((i: number, k: number) => { if (out.length) out[wrap(i, out.length)] = it[Math.min(k, it.length - 1)]; }); return [out]; });
C('list.set', 'Create Set', 'Set', 'Lists', 'The distinct values of a list, in order of first appearance, and for each item the index of its value in that set.', [L('List', 'The list')], [P('Set', 'any', 'Distinct values', { list: true, nick: 'S' }), P('Map', 'integer', 'Index into the set for each item', { list: true, nick: 'M' })],
  ([l]) => { const set: any[] = [], map = l.map((x: any) => { let i = set.findIndex(y => same(x, y)); if (i < 0) { i = set.length; set.push(x); } return i; }); return [set, map]; }, { example: 'Group members by their section name' });

// ======================================================================= Trees
C('tree.entwine', 'Entwine', 'Entwine', 'Trees', 'Combines up to six lists into one tree: each input becomes a branch ({0}, {1}, ...), in order. Unused inputs are skipped.',
  ['A', 'B', 'C', 'D', 'E', 'F'].map(n => P(n, 'any', `Data for branch ${n}`, { tree: true, opt: true })), [T('Result', 'One branch per input', { nick: 'R' })], null,
  { solveTrees: (ins) => { const out = new DataTree<any>(); let k = 0; for (const t of ins) { if (!t || !t.dataCount) continue; out.add([k++], t.allItems()); } return [out]; }, example: 'Entwine chords and diagonals to keep them apart' });
C('tree.clean', 'Clean Tree', 'Clean', 'Trees', 'Removes empty items (nothing, or numbers that are not finite) and, optionally, branches left empty.', [T('Tree', 'Data tree'), P('Empty', 'boolean', 'Also remove empty branches', { d: true, nick: 'E' })], [T('Tree', 'Cleaned tree')], null,
  { solveTrees: ([t, e]) => { const out = new DataTree<any>(), drop = e.first() !== false; for (const b of t.branches) { const items = b.items.filter(x => x !== null && x !== undefined && !(typeof x === 'number' && !Number.isFinite(x))); if (items.length || !drop) out.add(b.path, items); } return [out]; } });
const parsePath = (s: string): number[] => String(s).replace(/[{}\s]/g, '').split(';').filter(x => x.length).map(Number);
C('tree.item', 'Tree Item', 'TItem', 'Trees', 'One item of a tree, by branch path and index.', [T('Tree', 'Data tree'), P('Path', 'text', 'Path of the branch, e.g. {0;1}', { d: '{0}', nick: 'P' }), int('Index', 'Index within the branch', 0, { nick: 'i' }), P('Wrap', 'boolean', 'Wrap the index around', { d: true, nick: 'W' })], [P('Item', 'any', 'The item', { nick: 'I' })], null,
  { solveTrees: ([t, pth, idx, w]) => { const path = parsePath(String(pth.first() ?? '{0}')), items = t.branch(path); if (!items) throw new Error(`There is no branch ${pathText(path)}`); const i = Number(idx.first() ?? 0), k = w.first() === false ? i : wrap(i, items.length || 1); if (k < 0 || k >= items.length) throw new Error(`Index ${i} is outside the branch (it has ${items.length} items)`); return [DataTree.of(items[k])]; } });

/** One rule of a tree mask: a number, !number, ?, *, a set (a,b,c), a range (a to b), or !( ... ). */
function ruleTest(rule: string): (n: number) => boolean {
  let r = rule.trim(), neg = false;
  if (r.startsWith('!')) { neg = true; r = r.slice(1).trim(); }
  let test: (n: number) => boolean;
  if (r === '?' || r === '*') test = () => true;
  else if (/^\(.*\)$/.test(r)) {
    const inner = r.slice(1, -1).trim(), range = /^(-?\d+)\s+to\s+(-?\d+)$/i.exec(inner);
    if (range) { const a = Number(range[1]), b = Number(range[2]); test = n => n >= Math.min(a, b) && n <= Math.max(a, b); }
    else {
      const parts = inner.split(',').map(s => s.trim()), dots = parts.indexOf('...');
      if (dots >= 2) { const a = Number(parts[0]), step = Number(parts[1]) - a, end = parts[dots + 1] !== undefined ? Number(parts[dots + 1]) : Infinity; if (!(step > 0)) throw new Error(`The sequence in "${rule}" must increase`); test = n => n >= a && n <= end && (n - a) % step === 0; }
      else { const set = new Set(parts.map(Number)); if ([...set].some(x => !Number.isFinite(x))) throw new Error(`Cannot read the mask rule "${rule}"`); test = n => set.has(n); }
    }
  } else { const k = Number(r); if (!Number.isFinite(k)) throw new Error(`Cannot read the mask rule "${rule}"`); test = n => n === k; }
  return neg ? n => !test(n) : test;
}
/** Compile a mask such as "{0;?;(2 to 4)}[!0]" into a test of (path, item index). */
export function treeMask(mask: string): (path: readonly number[], index: number) => boolean {
  const m = /^\s*\{([^}]*)\}\s*(?:\[([^\]]*)\])?\s*$/.exec(mask);
  if (!m) throw new Error('A mask looks like {0;*}[?]: branch rules in braces, an optional item rule in square brackets');
  const rules = m[1].split(';').map(s => s.trim()).filter(s => s.length), item = m[2] === undefined || m[2].trim() === '' || m[2].trim() === '*' ? null : ruleTest(m[2]);
  const tests = rules.map(r => (r === '*' ? null : ruleTest(r)));
  const match = (path: readonly number[], pi: number, ri: number): boolean => {
    if (ri === tests.length) return pi === path.length;
    const t = tests[ri];
    if (t === null) { for (let k = pi; k <= path.length; k++) if (match(path, k, ri + 1)) return true; return false; }
    return pi < path.length && t(path[pi]) && match(path, pi + 1, ri + 1);
  };
  return (path, index) => match(path, 0, 0) && (!item || item(index));
}
C('tree.split', 'Split Tree', 'SplitT', 'Trees', 'Splits a tree with a mask. Branch rules go in braces, separated by semicolons; an optional item rule goes in square brackets. A rule is a number, ? (any one index), * (any number of indices), !n (not n), (a,b,c), (a to b) or (a,b,...) for a sequence.',
  [T('Tree', 'Data tree'), P('Mask', 'text', 'For example {0;*} or {*}[(0,2,...)]', { d: '{*}[0]', nick: 'M' })], [T('Positive', 'Items that match the mask', { nick: 'P' }), T('Negative', 'All other items', { nick: 'N' })], null,
  { solveTrees: ([t, mk]) => { const test = treeMask(String(mk.first() ?? '{*}')), pos = new DataTree<any>(), neg = new DataTree<any>(); for (const b of t.branches) { const a: any[] = [], c: any[] = []; b.items.forEach((x, i) => (test(b.path, i) ? a : c).push(x)); if (a.length) pos.add(b.path, a); if (c.length) neg.add(b.path, c); } return [pos, neg]; }, example: '{*}[0] takes the first item of every branch' });
C('tree.relative', 'Relative Item', 'RelItem', 'Trees', 'Pairs every item with another one at a fixed offset, written {branch offset}[item offset], for example {0}[+1] (the next item in the same branch) or {+1}[0] (the same position in the next branch). Pairs that would fall outside the tree are left out.',
  [T('Tree', 'Data tree'), P('Offset', 'text', 'Offset such as {0}[+1] or {+1}[+1]', { d: '{0}[+1]', nick: 'O' })], [T('A', 'The items', { nick: 'A' }), T('B', 'Their partners', { nick: 'B' })], null,
  { solveTrees: ([t, off]) => { const m = /^\s*\{([^}]*)\}\s*\[\s*([+-]?\d+)\s*\]\s*$/.exec(String(off.first() ?? '{0}[+1]')); if (!m) throw new Error('An offset looks like {0}[+1] or {+1;0}[-1]'); const po = m[1].split(';').map(s => Number(s.trim() || 0)), io = Number(m[2]); if (po.some(x => !Number.isFinite(x))) throw new Error('Branch offsets must be whole numbers'); const A = new DataTree<any>(), B = new DataTree<any>();
    for (const b of t.branches) { const target = b.path.map((x, k) => x + (po[po.length - b.path.length + k] ?? 0)), other = t.branch(target); if (!other) continue; const a: any[] = [], c: any[] = []; b.items.forEach((x, i) => { const j = i + io; if (j >= 0 && j < other.length) { a.push(x); c.push(other[j]); } }); if (a.length) { A.add(b.path, a); B.add(b.path, c); } } return [A, B]; }, example: 'Grid points with {0}[+1] and {+1}[0] give the two families of grid lines' });

// ======================================================================= Curves
const samples = (c: cv.Curve, n: number): V3[] => cv.divideByCount(c, n).map(t => cv.curvePoint(c, t));
/** The curve a fraction f of the way from A to B, matched point by point along their lengths. */
export function tween(a: cv.Curve, b: cv.Curve, f: number, n = 32): cv.Curve {
  if (a.k === 'line' && b.k === 'line') return cv.line(lerp(a.a, b.a, f), lerp(a.b, b.b, f));
  if (a.k === 'polyline' && b.k === 'polyline' && cv.plPts(a).length === cv.plPts(b).length) { const pa = cv.plPts(a), pb = cv.plPts(b); return cv.polyline(pa.map((p, i) => lerp(p, pb[i], f)), cv.curveClosed(a) && cv.curveClosed(b)); }
  const closed = cv.curveClosed(a) && cv.curveClosed(b), pa = samples(a, n), pb = samples(b, n), pts = pa.map((p, i) => lerp(p, pb[Math.min(i, pb.length - 1)], f));
  if (closed) pts.push(pts[0]);
  return cv.interpolateCurve(pts, 3);
}
C('crv.tween', 'Tween Curve', 'Tween', 'Curve', 'A curve part of the way between two curves. Factor 0 gives A, 1 gives B.', [crv('A', 'First curve', { nick: 'A' }), crv('B', 'Second curve', { nick: 'B' }), num('Factor', 'Position between A and B, from 0 to 1', 0.5, { nick: 'F' })], [crv('Tween', 'The in-between curve', { nick: 'T' })], ([a, b, f]) => [tween(a, b, f)], { example: 'Blend an arch into a straight tie' });
C('crv.tweens', 'Tween Curves', 'Tweens', 'Curve', 'A number of evenly spaced curves between two curves, for ribs, purlins or contour-like families.', [crv('A', 'First curve', { nick: 'A' }), crv('B', 'Second curve', { nick: 'B' }), int('Count', 'How many curves in between', 5, { nick: 'N' }), P('Ends', 'boolean', 'Include A and B themselves', { d: false, nick: 'E' })], [P('Tweens', 'curve', 'The in-between curves', { list: true, nick: 'T' })],
  ([a, b, n, e]) => { const k = Math.max(1, n), out: cv.Curve[] = []; if (e) out.push(a); for (let i = 1; i <= k; i++) out.push(tween(a, b, i / (k + 1))); if (e) out.push(b); return [out]; }, { example: 'Purlins between two rafters' });
/** A tube around a curve: rings carried along it without twisting (parallel transport). */
export function pipeMesh(c: cv.Curve, radius: number, sides = 12, capped = true): ms.Mesh {
  if (!(radius > 0)) throw new Error('The pipe radius must be positive');
  const closed = cv.curveClosed(c), raw = c.k === 'line' ? [c.a, c.b] : c.k === 'polyline' ? cv.plPts(c) : samples(c, Math.max(8, Math.min(200, Math.round(cv.curveLength(c) / (radius * 1.5))))), path = raw.filter((p, i) => i === 0 || len(sub(p, raw[i - 1])) > 1e-9);
  if (closed && path.length > 2 && len(sub(path[0], path[path.length - 1])) < 1e-9) path.pop();
  const n = path.length, k = Math.max(3, Math.round(sides));
  if (n < 2) throw new Error('The curve is too short for a pipe');
  const tan = path.map((_, i) => { const a = path[closed ? wrap(i - 1, n) : Math.max(0, i - 1)], b = path[closed ? wrap(i + 1, n) : Math.min(n - 1, i + 1)]; return unit(sub(b, a)); });
  let u = unit(cross(Math.abs(tan[0].z) < 0.9 ? Z : X, tan[0]));
  const pts: V3[] = [], faces: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) { u = sub(u, mul(tan[i], dot(u, tan[i]))); u = len(u) > 1e-9 ? unit(u) : unit(cross(Math.abs(tan[i].z) < 0.9 ? Z : X, tan[i])); }
    const w = cross(tan[i], u);
    for (let j = 0; j < k; j++) { const a = 2 * Math.PI * j / k; pts.push(add(path[i], add(mul(u, radius * Math.cos(a)), mul(w, radius * Math.sin(a))))); }
  }
  const rings = closed ? n : n - 1;
  for (let i = 0; i < rings; i++) for (let j = 0; j < k; j++) { const a = i * k + j, b = i * k + (j + 1) % k, i2 = (i + 1) % n; faces.push([a, b, i2 * k + (j + 1) % k, i2 * k + j]); }
  if (capped && !closed) { const s = pts.length; pts.push(path[0], path[n - 1]); for (let j = 0; j < k; j++) { faces.push([s, (j + 1) % k, j]); faces.push([s + 1, (n - 1) * k + j, (n - 1) * k + (j + 1) % k]); } }
  const m = ms.meshFromPointsFaces(pts, faces); if (capped || closed) m.solid = true; return m;
}
C('crv.pipe', 'Pipe', 'Pipe', 'Curve', 'A tube of constant radius around a curve, as a mesh.', [crv('Curve', 'The centerline'), num('Radius', 'Tube radius', 0.1, { nick: 'R' }), int('Sides', 'Number of sides around', 12, { nick: 'N' }), P('Caps', 'boolean', 'Close the ends', { d: true, nick: 'E' })], [msh('Pipe', 'The tube', { nick: 'P' })], ([c, r, n, e]) => [pipeMesh(c, r, n, e)], { example: 'Show cables or members with a real thickness' });

// ======================================================================= Paneling and structure from a surface
const grid = (s: sf.Surface, U: number, V: number): V3[][] => Array.from({ length: V + 1 }, (_, j) => Array.from({ length: U + 1 }, (_, i) => sf.srfPoint(s, i / U, j / V)));
const closedPl = (pts: V3[]) => cv.polyline(pts, true);
const panelOut = [P('Panels', 'curve', 'Panel outlines', { list: true, nick: 'P' }), msh('Mesh', 'The panels as one mesh')];
const meshOf = (cells: V3[][]): ms.Mesh => { const pts: V3[] = [], faces: number[][] = []; for (const c of cells) { faces.push(c.map((_, i) => pts.length + i)); pts.push(...c); } return ms.weld(ms.meshFromPointsFaces(pts, faces), 1e-9); };
const uv = (n: number, lo = 1) => Math.max(lo, Math.round(n));
C('srf.panel.quad', 'Quad Panels', 'QuadP', 'Surface', 'Divides a surface into a grid of four-sided panels.', [srf('Surface', 'A surface'), int('U', 'Panels along U', 8), int('V', 'Panels along V', 6)], panelOut,
  ([s, a, b]) => { const U = uv(a), V = uv(b), g = grid(s, U, V), cells: V3[][] = []; for (let j = 0; j < V; j++) for (let i = 0; i < U; i++) cells.push([g[j][i], g[j][i + 1], g[j + 1][i + 1], g[j + 1][i]]); return [cells.map(closedPl), meshOf(cells)]; }, { example: 'Cladding panels on a lofted roof' });
C('srf.panel.tri', 'Triangular Panels', 'TriP', 'Surface', 'Divides a surface into triangles. Pattern 0 uses the same diagonal everywhere, 1 alternates it (a Union Jack pattern), 2 uses the other diagonal.', [srf('Surface', 'A surface'), int('U', 'Divisions along U', 8), int('V', 'Divisions along V', 6), int('Pattern', '0 same diagonal, 1 alternating, 2 other diagonal', 0, { nick: 'P' })], panelOut,
  ([s, a, b, p]) => { const U = uv(a), V = uv(b), g = grid(s, U, V), cells: V3[][] = []; for (let j = 0; j < V; j++) for (let i = 0; i < U; i++) { const q = [g[j][i], g[j][i + 1], g[j + 1][i + 1], g[j + 1][i]], flip = p === 2 || (p === 1 && (i + j) % 2 === 1); if (flip) cells.push([q[0], q[1], q[3]], [q[1], q[2], q[3]]); else cells.push([q[0], q[1], q[2]], [q[0], q[2], q[3]]); } return [cells.map(closedPl), meshOf(cells)]; });
C('srf.panel.diamond', 'Diamond Panels', 'DiaP', 'Surface', 'Divides a surface into diamonds, with triangles along the edges.', [srf('Surface', 'A surface'), int('U', 'Diamonds along U', 8), int('V', 'Diamonds along V', 6)], panelOut,
  ([s, a, b]) => { const U = uv(a), V = uv(b), g = grid(s, 2 * U, 2 * V), cells: V3[][] = [];
    // A diamond sits around every grid point whose two indices are both odd or both even; at the edges it is cut to a triangle.
    for (let cj = 0; cj <= 2 * V; cj++) for (let ci = cj % 2; ci <= 2 * U; ci += 2) { const poly: V3[] = []; for (const [x, y] of [[ci - 1, cj], [ci, cj - 1], [ci + 1, cj], [ci, cj + 1]]) { const p = x < 0 || y < 0 || x > 2 * U || y > 2 * V ? g[cj][ci] : g[y][x]; if (!poly.some(q => len(sub(q, p)) < 1e-12)) poly.push(p); } if (poly.length >= 3) cells.push(poly); }
    return [cells.map(closedPl), meshOf(cells)]; });
C('srf.panel.stagger', 'Staggered Panels', 'StagP', 'Surface', 'Four-sided panels laid like bricks: every other row is shifted by a fraction of a panel.', [srf('Surface', 'A surface'), int('U', 'Panels along U', 8), int('V', 'Rows along V', 6), num('Shift', 'Shift of every other row, as a fraction of a panel', 0.5, { nick: 't' })], panelOut,
  ([s, a, b, t]) => { const U = uv(a), V = uv(b), sh = Math.max(0, Math.min(0.95, t)), cells: V3[][] = []; for (let j = 0; j < V; j++) { const off = j % 2 === 1 && sh > 0 ? sh : 0, us = off ? [0, ...Array.from({ length: U }, (_, i) => (i + off) / U), 1] : Array.from({ length: U + 1 }, (_, i) => i / U); for (let i = 0; i + 1 < us.length; i++) { if (us[i + 1] - us[i] < 1e-9) continue; cells.push([sf.srfPoint(s, us[i], j / V), sf.srfPoint(s, us[i + 1], j / V), sf.srfPoint(s, us[i + 1], (j + 1) / V), sf.srfPoint(s, us[i], (j + 1) / V)]); } } return [cells.map(closedPl), ms.meshFromPointsFaces(cells.flat(), cells.map((_, i) => [4 * i, 4 * i + 1, 4 * i + 2, 4 * i + 3]))]; });
C('srf.diagrid', 'Diagrid', 'Diagrid', 'Surface', 'Two families of diagonal lines over a surface, as on a diagrid tower or a lamella roof, plus the edge lines.', [srf('Surface', 'A surface'), int('U', 'Divisions along U', 8), int('V', 'Divisions along V', 6)], [P('A', 'curve', 'Diagonals rising one way', { list: true }), P('B', 'curve', 'Diagonals rising the other way', { list: true }), P('Edges', 'curve', 'Lines along the two V edges', { list: true, nick: 'E' })],
  ([s, a, b]) => { const U = uv(a), V = uv(b), g = grid(s, U, V), A: cv.Curve[] = [], B: cv.Curve[] = [], E: cv.Curve[] = []; for (let j = 0; j < V; j++) for (let i = 0; i < U; i++) { if ((i + j) % 2 === 0) A.push(cv.line(g[j][i], g[j + 1][i + 1])); else B.push(cv.line(g[j][i + 1], g[j + 1][i])); } for (let i = 0; i < U; i++) { E.push(cv.line(g[0][i], g[0][i + 1]), cv.line(g[V][i], g[V][i + 1])); } return [A, B, E]; }, { example: 'Diagrid -> Beam for a tower façade structure' });
C('srf.spacetruss', 'Space Truss', 'SpaceT', 'Surface', 'A double-layer space truss on a surface: a top grid on the surface, a bottom grid offset along the normals and shifted by half a bay, and the diagonals between them.', [srf('Surface', 'The top surface'), int('U', 'Bays along U', 6), int('V', 'Bays along V', 6), num('Depth', 'Distance between the layers (positive is against the normal)', 1, { nick: 'D' })], [P('Top', 'curve', 'Top chords', { list: true, nick: 'T' }), P('Bottom', 'curve', 'Bottom chords', { list: true, nick: 'B' }), P('Diagonals', 'curve', 'Web members', { list: true, nick: 'W' }), P('Top Nodes', 'point', 'Top nodes', { list: true, nick: 'Pt' }), P('Bottom Nodes', 'point', 'Bottom nodes', { list: true, nick: 'Pb' })],
  ([s, a, b, d]) => { const U = uv(a), V = uv(b), g = grid(s, U, V), top: cv.Curve[] = [], bot: cv.Curve[] = [], web: cv.Curve[] = [];
    for (let j = 0; j <= V; j++) for (let i = 0; i <= U; i++) { if (i < U) top.push(cv.line(g[j][i], g[j][i + 1])); if (j < V) top.push(cv.line(g[j][i], g[j + 1][i])); }
    const low = Array.from({ length: V }, (_, j) => Array.from({ length: U }, (_, i) => { const u0 = (i + 0.5) / U, v0 = (j + 0.5) / V; return add(sf.srfPoint(s, u0, v0), mul(sf.srfNormal(s, u0, v0), -d)); }));
    for (let j = 0; j < V; j++) for (let i = 0; i < U; i++) { if (i < U - 1) bot.push(cv.line(low[j][i], low[j][i + 1])); if (j < V - 1) bot.push(cv.line(low[j][i], low[j + 1][i])); for (const q of [g[j][i], g[j][i + 1], g[j + 1][i + 1], g[j + 1][i]]) web.push(cv.line(low[j][i], q)); }
    return [top, bot, web, g.flat(), low.flat()]; }, { example: 'Space Truss -> Truss elements for a roof over a column grid' });

// ======================================================================= Structure generators
C('fe.gen.truss', 'Truss Generator', 'TrussG', 'Structure', 'The member lines of a plane truss between two points. Type 0 is a Pratt truss (diagonals falling toward midspan), 1 a Howe truss (diagonals rising toward midspan), 2 a Warren truss without verticals, 3 a Warren truss with verticals. Depth 2 gives a different depth at midspan (a pitched or bowstring-like top chord).',
  [pt('Start', 'Left support point', v(0, 0, 0), { nick: 'A' }), pt('End', 'Right support point', v(12, 0, 0), { nick: 'B' }), num('Depth', 'Depth at the ends', 2, { nick: 'D' }), int('Panels', 'Number of panels (made even for Warren trusses)', 6, { nick: 'N' }), int('Type', '0 Pratt, 1 Howe, 2 Warren, 3 Warren with verticals', 0, { nick: 'T' }), num('Mid Depth', 'Depth at midspan (0 = same as the ends)', 0, { nick: 'Dm' }), vec('Up', 'Direction of the depth', v(0, 0, 1), { nick: 'U' })],
  [P('Top', 'curve', 'Top chord members', { list: true, nick: 'T' }), P('Bottom', 'curve', 'Bottom chord members', { list: true, nick: 'B' }), P('Verticals', 'curve', 'Vertical members', { list: true, nick: 'V' }), P('Diagonals', 'curve', 'Diagonal members', { list: true, nick: 'D' }), P('Bottom Nodes', 'point', 'Bottom chord nodes', { list: true, nick: 'Pb' }), P('Top Nodes', 'point', 'Top chord nodes', { list: true, nick: 'Pt' })],
  ([A, B, d, n, type, dm, up]) => {
    if (!(d > 0)) throw new Error('The depth must be positive');
    let N = Math.max(2, Math.round(n)); if (type === 3 && N % 2) N++;
    const ax = sub(B, A), L = len(ax); if (L < 1e-9) throw new Error('Start and End are the same point');
    const e = unit(ax); let w = sub(up, mul(e, dot(up, e))); if (len(w) < 1e-9) throw new Error('Up is parallel to the truss'); w = unit(w);
    const depth = (x: number) => (dm > 0 ? d + (dm - d) * (1 - Math.abs(2 * x - 1)) : d);
    const bot = Array.from({ length: N + 1 }, (_, i) => add(A, mul(ax, i / N))), top = bot.map((p, i) => add(p, mul(w, depth(i / N))));
    const T: cv.Curve[] = [], Bc: cv.Curve[] = [], Vs: cv.Curve[] = [], D: cv.Curve[] = [];
    for (let i = 0; i < N; i++) Bc.push(cv.line(bot[i], bot[i + 1]));
    if (type === 2) {
      // Warren: a top node above the middle of every bottom panel, joined to both ends of that panel.
      const tn = Array.from({ length: N }, (_, i) => add(add(A, mul(ax, (i + 0.5) / N)), mul(w, depth((i + 0.5) / N))));
      for (let i = 0; i + 1 < N; i++) T.push(cv.line(tn[i], tn[i + 1]));
      for (let i = 0; i < N; i++) D.push(cv.line(bot[i], tn[i]), cv.line(tn[i], bot[i + 1]));
      return [T, Bc, Vs, D, bot, tn];
    }
    if (type === 3) {
      // Warren with verticals: top nodes above every other bottom node, each with a vertical and two diagonals.
      const odd = [...Array(N / 2).keys()].map(k => 2 * k + 1);
      for (let k = 0; k + 1 < odd.length; k++) T.push(cv.line(top[odd[k]], top[odd[k + 1]]));
      for (const i of odd) { D.push(cv.line(bot[i - 1], top[i]), cv.line(top[i], bot[i + 1])); Vs.push(cv.line(bot[i], top[i])); }
      return [T, Bc, Vs, D, bot, odd.map(i => top[i])];
    }
    for (let i = 0; i < N; i++) T.push(cv.line(top[i], top[i + 1]));
    for (let i = 0; i <= N; i++) Vs.push(cv.line(bot[i], top[i]));
    for (let i = 0; i < N; i++) { const left = i < N / 2, pratt = type !== 1; D.push(left === pratt ? cv.line(top[i], bot[i + 1]) : cv.line(bot[i], top[i + 1])); }
    return [T, Bc, Vs, D, bot, top];
  }, { example: 'Truss Generator -> Truss: a 12 m Pratt truss in two components' });
C('fe.gen.frame', 'Frame Grid', 'FrameG', 'Structure', 'The member lines of a regular building frame: columns, and beams in both directions at every floor.',
  [pt('Origin', 'Corner of the building', v(0, 0, 0), { nick: 'O' }), int('Bays X', 'Bays along X', 3, { nick: 'nx' }), int('Bays Y', 'Bays along Y (0 for a plane frame)', 2, { nick: 'ny' }), int('Stories', 'Number of stories', 3, { nick: 'ns' }), num('Bay X', 'Bay width along X', 6, { nick: 'bx' }), num('Bay Y', 'Bay width along Y', 6, { nick: 'by' }), num('Height', 'Story height', 3.5, { nick: 'h' })],
  [P('Columns', 'curve', 'Column lines', { list: true, nick: 'C' }), P('Beams X', 'curve', 'Beams along X', { list: true, nick: 'Bx' }), P('Beams Y', 'curve', 'Beams along Y', { list: true, nick: 'By' }), P('Bases', 'point', 'Column base points', { list: true, nick: 'P' }), P('Floor Nodes', 'point', 'Nodes at the floors, one branch per floor', { tree: true, nick: 'F' })], null,
  { solveTrees: (ins) => { const g = (i: number, d: number) => Number(ins[i].first() ?? d), O = (ins[0].first() as V3) ?? v(), nx = Math.max(1, Math.round(g(1, 3))), ny = Math.max(0, Math.round(g(2, 2))), ns = Math.max(1, Math.round(g(3, 3))), bx = g(4, 6), by = g(5, 6), h = g(6, 3.5);
    if (!(bx > 0) || !(h > 0) || (ny > 0 && !(by > 0))) throw new Error('Bay sizes and story height must be positive');
    const at = (i: number, j: number, k: number) => add(O, v(i * bx, j * by, k * h)), cols: cv.Curve[] = [], BX: cv.Curve[] = [], BY: cv.Curve[] = [], bases: V3[] = [], floors = new DataTree<V3>();
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { bases.push(at(i, j, 0)); for (let k = 0; k < ns; k++) cols.push(cv.line(at(i, j, k), at(i, j, k + 1))); }
    for (let k = 1; k <= ns; k++) { const nodes: V3[] = []; for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { nodes.push(at(i, j, k)); if (i < nx) BX.push(cv.line(at(i, j, k), at(i + 1, j, k))); if (j < ny) BY.push(cv.line(at(i, j, k), at(i, j + 1, k))); } floors.add([k - 1], nodes); }
    return [DataTree.fromList(cols), DataTree.fromList(BX), DataTree.fromList(BY), DataTree.fromList(bases), floors]; }, example: 'Frame Grid -> Beam: a three-story frame from seven numbers' });

// ======================================================================= Meshes
/** One level of Catmull-Clark subdivision. Boundary edges and corners follow the usual crease rules. */
export function catmullClark(input: ms.Mesh): ms.Mesh {
  const m = ms.weld(input, 1e-9), P0 = ms.meshVertices(m), nV = P0.length, key = (a: number, b: number) => (a < b ? a + '_' + b : b + '_' + a);
  const faceP = m.f.map(f => mul(f.reduce((s, i) => add(s, P0[i]), v()), 1 / f.length));
  const edges = new Map<string, { a: number; b: number; faces: number[]; id: number }>();
  m.f.forEach((f, fi) => f.forEach((a, k) => { const b = f[(k + 1) % f.length], e = edges.get(key(a, b)); if (e) e.faces.push(fi); else edges.set(key(a, b), { a, b, faces: [fi], id: 0 }); }));
  const pts: V3[] = new Array(nV), vFaces: number[][] = Array.from({ length: nV }, () => []), vEdges: { mid: V3; boundary: boolean }[][] = Array.from({ length: nV }, () => []);
  m.f.forEach((f, fi) => f.forEach(i => vFaces[i].push(fi)));
  const fId = m.f.map((_, i) => nV + i); let next = nV + m.f.length;
  const out: V3[] = [...P0, ...faceP];
  for (const e of edges.values()) { const mid = mul(add(P0[e.a], P0[e.b]), 0.5), boundary = e.faces.length < 2; e.id = next++; out.push(boundary ? mid : mul(add(add(P0[e.a], P0[e.b]), add(faceP[e.faces[0]], faceP[e.faces[1]])), 0.25)); vEdges[e.a].push({ mid, boundary }); vEdges[e.b].push({ mid, boundary }); }
  for (let i = 0; i < nV; i++) {
    const be = vEdges[i].filter(e => e.boundary), n = vFaces[i].length;
    if (be.length >= 2) pts[i] = add(mul(P0[i], 0.75), mul(add(be[0].mid, be[1].mid), 0.125));
    else if (!n) pts[i] = P0[i];
    else { const F = mul(vFaces[i].reduce((s, f) => add(s, faceP[f]), v()), 1 / n), R = mul(vEdges[i].reduce((s, e) => add(s, e.mid), v()), 1 / vEdges[i].length); pts[i] = mul(add(add(F, mul(R, 2)), mul(P0[i], n - 3)), 1 / n); }
    out[i] = pts[i];
  }
  const faces: number[][] = [];
  m.f.forEach((f, fi) => f.forEach((a, k) => { const b = f[(k + 1) % f.length], p = f[(k + f.length - 1) % f.length]; faces.push([a, edges.get(key(a, b))!.id, fId[fi], edges.get(key(p, a))!.id]); }));
  const r = ms.meshFromPointsFaces(out, faces); if (input.solid) r.solid = true; return r;
}
C('mesh.subdivide', 'Subdivide Mesh', 'SubD', 'Mesh', 'Smooths a coarse mesh into a finer, rounder one by Catmull-Clark subdivision. Each level splits every face into four-sided faces; open edges stay on a smooth edge curve.', [msh('Mesh', 'A coarse mesh (a control cage)'), int('Levels', 'Number of subdivision steps, 1 to 4', 2, { nick: 'L' })], [msh('Mesh', 'The subdivided mesh')],
  ([m, l]) => { let r = m as ms.Mesh; const n = Math.max(0, Math.min(4, Math.round(l))); for (let i = 0; i < n; i++) { if (r.f.length > 60000) throw new Error('The mesh is already very fine; use fewer levels'); r = catmullClark(r); } return [r]; }, { example: 'Box -> Subdivide Mesh for a soft, organic form' });
C('mesh.smooth', 'Smooth Mesh', 'Smooth', 'Mesh', 'Relaxes a mesh by moving every vertex toward the average of its neighbors. Vertices on open edges can be kept in place.', [msh('Mesh', 'A mesh'), num('Strength', 'How far each step moves, from 0 to 1', 0.5, { nick: 'S' }), int('Steps', 'Number of steps', 5, { nick: 'N' }), P('Fix Edges', 'boolean', 'Keep vertices on open edges where they are', { d: true, nick: 'F' })], [msh('Mesh', 'The smoothed mesh')],
  ([m0, s, n, fix]) => { const m = ms.weld(m0, 1e-9), k = Math.max(0, Math.min(1, s)), nb: Set<number>[] = Array.from({ length: m.v.length / 3 }, () => new Set<number>()), count = new Map<string, number>(), ek = (a: number, b: number) => (a < b ? a + '_' + b : b + '_' + a);
    for (const f of m.f) f.forEach((a, i) => { const b = f[(i + 1) % f.length]; nb[a].add(b); nb[b].add(a); count.set(ek(a, b), (count.get(ek(a, b)) ?? 0) + 1); });
    const pinned = new Set<number>(); if (fix) for (const [e, c] of count) if (c === 1) e.split('_').forEach(x => pinned.add(Number(x)));
    let P1 = ms.meshVertices(m);
    for (let it = 0; it < Math.max(0, Math.min(200, n)); it++) P1 = P1.map((p, i) => { if (pinned.has(i) || !nb[i].size) return p; let c = v(); for (const j of nb[i]) c = add(c, P1[j]); return lerp(p, mul(c, 1 / nb[i].size), k); });
    const r = ms.meshFromPointsFaces(P1, m.f); if (m0.solid) r.solid = true; return [r]; });
C('mesh.weld', 'Weld Mesh', 'Weld', 'Mesh', 'Merges vertices that lie within a tolerance of each other, so that faces share their vertices.', [msh('Mesh', 'A mesh'), num('Tolerance', 'Merge distance', 1e-6, { nick: 't' })], [msh('Mesh', 'The welded mesh'), int('Vertices', 'Number of vertices after welding', undefined, { nick: 'N' })], ([m, t]) => { const r = ms.weld(m, Math.max(0, t)); return [r, r.v.length / 3]; });

// ======================================================================= Deformations
/** Move every point of a piece of geometry with a function. Curves keep their kind where that is possible. */
export function deform(g: any, fn: (p: V3) => V3): any {
  if (g && typeof g.x === 'number' && typeof g.y === 'number' && typeof g.z === 'number') return fn(g);
  if (ms.isMesh(g)) { const r = ms.meshFromPointsFaces(ms.meshVertices(g).map(fn), g.f); if (g.solid) r.solid = true; return r; }
  if (cv.isCurve(g)) { if (g.k === 'polyline') { const pts = cv.plPts(g), fine: V3[] = []; pts.forEach((p, i) => { if (i === 0) { fine.push(p); return; } for (let k = 1; k <= 8; k++) fine.push(lerp(pts[i - 1], p, k / 8)); }); return cv.polyline(fine.map(fn)); } return cv.interpolateCurve(samples(g, g.k === 'line' ? 16 : 48).map(fn), 3); }
  if (sf.isSurface(g)) return deform(toMesh(g, 24), fn);
  if (Array.isArray(g)) return g.map(x => deform(x, fn));
  throw new Error('This kind of data cannot be deformed');
}
const geo = (n: string, d: string, o: any = {}) => P(n, 'geometry', d, { nick: 'G', ...o });
const axisOf = (a: V3, b: V3) => { const d = sub(b, a), L = len(d); if (L < 1e-9) throw new Error('The axis needs two different points'); return { e: mul(d, 1 / L), L }; };
C('xform.twist', 'Twist', 'Twist', 'Transform', 'Twists geometry around an axis: the rotation grows evenly from zero at the start of the axis to the full angle at its end. Surfaces become meshes; lines become curves.', [geo('Geometry', 'What to twist'), pt('Start', 'Start of the axis', v(0, 0, 0), { nick: 'A' }), pt('End', 'End of the axis', v(0, 0, 10), { nick: 'B' }), num('Angle', 'Rotation at the end of the axis, in degrees', 90, { nick: '°' })], [geo('Geometry', 'The twisted geometry')],
  ([g, a, b, deg]) => { const { e, L } = axisOf(a, b), th = deg * Math.PI / 180; return [deform(g, p => { const r = sub(p, a), t = dot(r, e), ang = th * t / L, perp = sub(r, mul(e, t)), c = Math.cos(ang), s = Math.sin(ang); return add(a, add(mul(e, t), add(mul(perp, c), mul(cross(e, perp), s)))); })]; }, { example: 'Twist a tower floor by floor' });
C('xform.taper', 'Taper', 'Taper', 'Transform', 'Scales geometry toward or away from an axis: by the start factor at the start of the axis, changing evenly to the end factor at its end.', [geo('Geometry', 'What to taper'), pt('Start', 'Start of the axis', v(0, 0, 0), { nick: 'A' }), pt('End', 'End of the axis', v(0, 0, 10), { nick: 'B' }), num('Start Factor', 'Scale at the start', 1, { nick: 's0' }), num('End Factor', 'Scale at the end', 0.5, { nick: 's1' })], [geo('Geometry', 'The tapered geometry')],
  ([g, a, b, s0, s1]) => { const { e, L } = axisOf(a, b); return [deform(g, p => { const r = sub(p, a), t = dot(r, e), k = s0 + (s1 - s0) * t / L, perp = sub(r, mul(e, t)); return add(a, add(mul(e, t), mul(perp, k))); })]; });
C('xform.bend', 'Bend', 'Bend', 'Transform', 'Bends geometry that lies along an axis into a circular arc of the given total angle. The axis keeps its length; the bend is toward the given direction.', [geo('Geometry', 'What to bend'), pt('Start', 'Start of the axis', v(0, 0, 0), { nick: 'A' }), pt('End', 'End of the axis', v(10, 0, 0), { nick: 'B' }), num('Angle', 'Total bend angle in degrees', 60, { nick: '°' }), vec('Toward', 'Direction of the bend', v(0, 0, 1), { nick: 'D' })], [geo('Geometry', 'The bent geometry')],
  ([g, a, b, deg, dir]) => { const { e, L } = axisOf(a, b), th = deg * Math.PI / 180; let n = sub(dir, mul(e, dot(dir, e))); if (len(n) < 1e-9) throw new Error('The bend direction is parallel to the axis'); n = unit(n); if (Math.abs(th) < 1e-9) return [g]; const R = L / th, w = cross(e, n);
    return [deform(g, p => { const r = sub(p, a), t = dot(r, e), h = dot(r, n), s = dot(r, w), ang = t / R, rad = R - h; return add(a, add(add(mul(e, rad * Math.sin(ang)), mul(n, R - rad * Math.cos(ang))), mul(w, s))); })]; }, { example: 'Bend a flat truss into an arch' });

// ======================================================================= Sun
/**
 * Position of the sun from latitude, longitude, date and clock time, by the equations of the NOAA solar
 * calculator (Meeus, Astronomical Algorithms). Good to about a tenth of a degree for years near the present.
 * Returns altitude and azimuth in degrees (azimuth clockwise from north) and the unit vector toward the sun,
 * with +Y as north and +X as east.
 */
export function sunPosition(lat: number, lon: number, year: number, month: number, day: number, hour: number, utcOffset: number): { altitude: number; azimuth: number; dir: V3; declination: number } {
  const rad = Math.PI / 180, JD = Date.UTC(year, month - 1, day, 0, 0, 0) / 86400000 + 2440587.5 + (hour - utcOffset) / 24, Tc = (JD - 2451545) / 36525;
  const L0 = (280.46646 + Tc * (36000.76983 + Tc * 0.0003032)) % 360, Mm = 357.52911 + Tc * (35999.05029 - 0.0001537 * Tc), ecc = 0.016708634 - Tc * (0.000042037 + 0.0000001267 * Tc);
  const Cc = Math.sin(Mm * rad) * (1.914602 - Tc * (0.004817 + 0.000014 * Tc)) + Math.sin(2 * Mm * rad) * (0.019993 - 0.000101 * Tc) + Math.sin(3 * Mm * rad) * 0.000289;
  const lam = L0 + Cc - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * Tc) * rad), eps0 = 23 + (26 + (21.448 - Tc * (46.815 + Tc * (0.00059 - Tc * 0.001813))) / 60) / 60, eps = eps0 + 0.00256 * Math.cos((125.04 - 1934.136 * Tc) * rad);
  const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lam * rad)) / rad, y = Math.tan(eps / 2 * rad) ** 2;
  const eot = 4 / rad * (y * Math.sin(2 * L0 * rad) - 2 * ecc * Math.sin(Mm * rad) + 4 * ecc * y * Math.sin(Mm * rad) * Math.cos(2 * L0 * rad) - 0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * ecc * ecc * Math.sin(2 * Mm * rad));
  const solarMin = (((hour * 60 + eot + 4 * lon - 60 * utcOffset) % 1440) + 1440) % 1440, ha = solarMin / 4 < 0 ? solarMin / 4 + 180 : solarMin / 4 - 180;
  const cosZ = Math.sin(lat * rad) * Math.sin(decl * rad) + Math.cos(lat * rad) * Math.cos(decl * rad) * Math.cos(ha * rad), zen = Math.acos(Math.max(-1, Math.min(1, cosZ))) / rad, alt = 90 - zen;
  let az = Math.acos(Math.max(-1, Math.min(1, (Math.sin(lat * rad) * Math.cos(zen * rad) - Math.sin(decl * rad)) / (Math.cos(lat * rad) * Math.sin(zen * rad) || 1e-12)))) / rad;
  az = ha > 0 ? (az + 180) % 360 : (540 - az) % 360;
  const ca = Math.cos(alt * rad);
  return { altitude: alt, azimuth: az, declination: decl, dir: v(ca * Math.sin(az * rad), ca * Math.cos(az * rad), Math.sin(alt * rad)) };
}
const sunIn = [num('Latitude', 'Degrees north (south is negative)', 39.19, { nick: 'φ' }), num('Longitude', 'Degrees east (west is negative)', -96.58, { nick: 'λ' }), int('Month', 'Month, 1 to 12', 6, { nick: 'M' }), int('Day', 'Day of the month', 21, { nick: 'D' })];
const TZ = num('UTC Offset', 'Clock time minus UTC, in hours (for example -6 for US Central Standard Time)', -6, { nick: 'tz' }), YEAR = int('Year', 'Year', 2026, { nick: 'Y' });
C('env.sun', 'Sun Position', 'Sun', 'Environment', 'Where the sun is for a place, date and clock time. North is +Y and east is +X. Altitude is the angle above the horizon; azimuth is measured clockwise from north.', [...sunIn, num('Hour', 'Clock time in hours, for example 14.5 for 2:30 pm', 12, { nick: 'h' }), TZ, YEAR],
  [vec('Direction', 'Unit vector pointing toward the sun', undefined, { nick: 'V' }), num('Altitude', 'Angle above the horizon in degrees', undefined, { nick: 'α' }), num('Azimuth', 'Degrees clockwise from north', undefined, { nick: 'Az' }), P('Up', 'boolean', 'True while the sun is above the horizon', { nick: 'Day' })],
  ([lat, lon, mo, d, h, tz, y]) => { if (Math.abs(lat) > 90) throw new Error('Latitude is between -90 and 90'); const s = sunPosition(lat, lon, y, mo, d, h, tz); return [s.dir, s.altitude, s.azimuth, s.altitude > 0]; }, { noPreview: true, example: 'Sun Position -> Shadow to study shading at 3 pm in June' });
C('env.sunpath', 'Sun Path', 'SunPath', 'Environment', 'The path of the sun across the sky for one day, drawn as a curve on a dome of the given radius, with a point for every full hour the sun is up.', [...sunIn, TZ, YEAR, pt('Center', 'Center of the dome', v(0, 0, 0), { nick: 'C' }), num('Radius', 'Radius of the dome', 20, { nick: 'R' })],
  [crv('Path', 'The path of the sun for the day', { nick: 'P' }), P('Hours', 'point', 'Position at each full hour', { list: true, nick: 'H' }), P('Labels', 'text', 'The hour of each point', { list: true, nick: 'L' }), num('Daylight', 'Hours of daylight', undefined, { nick: 'T' })],
  ([lat, lon, mo, d, tz, y, c, r]) => { const up: V3[] = [], hrs: V3[] = [], lab: string[] = []; let n = 0; for (let k = 0; k <= 24 * 12; k++) { const h = k / 12, s = sunPosition(lat, lon, y, mo, d, h, tz); if (s.altitude > 0) { n++; up.push(add(c, mul(s.dir, r))); if (k % 12 === 0) { hrs.push(add(c, mul(s.dir, r))); lab.push(`${h}:00`); } } } if (up.length < 2) throw new Error('The sun does not rise on this day at this latitude'); return [cv.interpolateCurve(up, 3), hrs, lab, n / 12]; }, { example: 'Compare the June and December paths over a site' });
C('env.shadow', 'Shadow', 'Shadow', 'Environment', 'The shadow that geometry casts on a horizontal plane, for a given direction toward the sun. The result is the geometry flattened along the sun rays.', [geo('Geometry', 'What casts the shadow'), vec('Sun', 'Direction toward the sun (from Sun Position)', v(0.4, -0.5, 0.77), { nick: 'V' }), num('Level', 'Height (Z) of the ground plane', 0, { nick: 'z' })], [geo('Shadow', 'The shadow on the ground', { nick: 'S' })],
  ([g, s, z]) => { if (!(s.z > 1e-6)) throw new Error('The sun is at or below the horizon, so there is no shadow on the ground'); return [deform(g, p => { const t = (p.z - z) / s.z; return v(p.x - s.x * t, p.y - s.y * t, z); })]; });
