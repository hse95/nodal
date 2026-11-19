import { describe, it, expect } from 'vitest';
import { DataTree, matchIndices, matchBranches, mapPathsByMask, comparePaths } from '../src/core/tree';
import { evalExpr, compileExpr } from '../src/core/expr';
import { Engine, Registry, P, makeNode, emptyProject, wouldCycle, coerce } from '../src/core/graph';
import type { ComponentDef, ProjectFile } from '../src/core/types';

const paths = (t: DataTree) => t.branches.map(b => `{${b.path.join(';')}}:${b.items.join(',')}`).join(' ');

describe('DataTree structure', () => {
  it('keeps branches sorted lexicographically, shorter paths first', () => {
    const t = new DataTree<number>().add([1, 0], [1]).add([0, 2], [2]).add([0], [3]).add([0, 10], [4]).add([0, 2, 1], [5]);
    expect(t.branches.map(b => b.path.join(';'))).toEqual(['0', '0;2', '0;2;1', '0;10', '1;0']);
    expect(comparePaths([0, 2], [0, 10])).toBeLessThan(0);
  });
  it('appends to an existing branch', () => {
    const t = DataTree.fromList([1, 2]).add([0], [3]);
    expect(t.branchCount).toBe(1); expect(t.allItems()).toEqual([1, 2, 3]);
  });
  it('counts data and branches, and reports emptiness', () => {
    const t = new DataTree<number>().add([0], [1, 2]).add([1], []);
    expect(t.branchCount).toBe(2); expect(t.dataCount).toBe(2); expect(t.isEmpty).toBe(false);
    expect(new DataTree().isEmpty).toBe(true); expect(new DataTree().ensure([0]).isEmpty).toBe(true);
  });
  it('flatten puts everything in {0} in branch order', () => {
    const t = new DataTree<number>().add([1], [3, 4]).add([0, 5], [1, 2]);
    expect(paths(t.flatten())).toBe('{0}:1,2,3,4');
  });
  it('graft gives each item its own sub-branch', () => {
    const t = new DataTree<string>().add([0], ['a', 'b']).add([2], ['c']);
    expect(paths(t.graft())).toBe('{0;0}:a {0;1}:b {2;0}:c');
  });
  it('graft keeps empty branches as an empty sub-branch', () => {
    expect(new DataTree().ensure([3]).graft().branches[0].path).toEqual([3, 0]);
  });
  it('graft then flatten restores the flat list', () => {
    const t = DataTree.fromList([5, 6, 7]);
    expect(t.graft().flatten().allItems()).toEqual([5, 6, 7]);
  });
  it('simplify removes the shared prefix', () => {
    const t = new DataTree<number>().add([0, 0, 1], [1]).add([0, 0, 2], [2]);
    expect(paths(t.simplify())).toBe('{1}:1 {2}:2');
  });
  it('simplify keeps one index on a single branch', () => {
    expect(paths(new DataTree<number>().add([0, 0, 4], [1]).simplify())).toBe('{4}:1');
    expect(paths(DataTree.of(9).simplify())).toBe('{0}:9');
  });
  it('simplify handles ragged depths without dropping distinguishing indices', () => {
    const t = new DataTree<number>().add([0, 1], [1]).add([0, 1, 3], [2]).add([0, 2], [3]);
    expect(paths(t.simplify())).toBe('{1}:1 {1;3}:2 {2}:3');
  });
  it('simplify with nothing in common is a no-op', () => {
    const t = new DataTree<number>().add([0, 1], [1]).add([1, 1], [2]);
    expect(paths(t.simplify())).toBe('{0;1}:1 {1;1}:2');
  });
  it('reverse flips items inside each branch only', () => {
    const t = new DataTree<number>().add([0], [1, 2, 3]).add([1], [4, 5]);
    expect(paths(t.reverse())).toBe('{0}:3,2,1 {1}:5,4');
  });
  it('trim merges sibling branches', () => {
    const t = new DataTree<number>().add([0, 0], [1]).add([0, 1], [2]).add([1, 0], [3]);
    expect(paths(t.trim())).toBe('{0}:1,2 {1}:3');
    expect(paths(t.trim(5))).toBe('{0}:1,2,3');
  });
  it('merge concatenates equal paths in argument order', () => {
    const a = new DataTree<number>().add([0], [1]).add([1], [2]);
    const b = new DataTree<number>().add([1], [3]).add([2], [4]);
    expect(paths(DataTree.merge([a, b]))).toBe('{0}:1 {1}:2,3 {2}:4');
  });
  it('branch extraction returns the items or undefined', () => {
    const t = new DataTree<number>().add([0, 1], [7, 8]);
    expect(t.branch([0, 1])).toEqual([7, 8]); expect(t.branch([0])).toBeUndefined();
  });
  it('map_ preserves structure', () => {
    const t = new DataTree<number>().add([0], [1, 2]).add([3], [4]);
    expect(paths(t.map_(x => x * 10))).toBe('{0}:10,20 {3}:40');
  });
  it('serialises to plain branches', () => {
    const t = new DataTree<number>().add([1], [2]);
    expect(JSON.parse(JSON.stringify(t))).toEqual([{ path: [1], items: [2] }]);
    expect(paths(DataTree.fromBranches(t.toJSON()))).toBe('{1}:2');
  });
});

describe('path mapping', () => {
  const t = new DataTree<number>().add([0, 0], [1]).add([0, 1], [2]).add([1, 0], [3]).add([1, 1], [4]);
  const ev = (e: string, vars: Record<string, number>) => evalExpr(e, vars);
  it('swaps indices', () => { expect(paths(mapPathsByMask(t, '{A;B}', '{B;A}', ev))).toBe('{0;0}:1 {0;1}:3 {1;0}:2 {1;1}:4'); });
  it('drops an index and merges', () => { expect(paths(mapPathsByMask(t, '{A;B}', '{A}', ev))).toBe('{0}:1,2 {1}:3,4'); });
  it('evaluates expressions', () => { expect(paths(mapPathsByMask(t, '{A;B}', '{A*2+B}', ev))).toBe('{0}:1 {1}:2 {2}:3 {3}:4'); });
  it('leaves paths of another depth alone', () => {
    const r = mapPathsByMask(new DataTree<number>().add([5], [1]).add([0, 1], [2]), '{A;B}', '{B}', ev);
    expect(paths(r)).toBe('{1}:2 {5}:1');
  });
  it('rejects bad masks and negative indices', () => {
    expect(() => mapPathsByMask(t, 'A;B', '{A}', ev)).toThrow();
    expect(() => mapPathsByMask(t, '{A;B}', '{A-5}', ev)).toThrow();
  });
});

describe('item matching', () => {
  it('longest repeats the last item of shorter lists', () => {
    expect(matchIndices([3, 1, 2], 'longest')).toEqual([[0, 0, 0], [1, 0, 1], [2, 0, 1]]);
  });
  it('shortest stops at the shortest list', () => { expect(matchIndices([3, 2], 'shortest')).toEqual([[0, 0], [1, 1]]); });
  it('cross reference is row-major (first list slowest)', () => {
    expect(matchIndices([2, 3], 'cross')).toEqual([[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]);
  });
  it('an empty list yields no iterations in every mode', () => {
    for (const m of ['longest', 'shortest', 'cross'] as const) expect(matchIndices([2, 0], m)).toEqual([]);
  });
  it('no lists yields exactly one iteration', () => { expect(matchIndices([], 'longest')).toEqual([[]]); });
  it('equal lengths are identical for longest and shortest', () => {
    expect(matchIndices([2, 2], 'longest')).toEqual(matchIndices([2, 2], 'shortest'));
  });
  it('single list iterates each item once', () => { expect(matchIndices([3], 'cross')).toEqual([[0], [1], [2]]); });
});

describe('branch matching', () => {
  it('pairs branches by position and repeats the last branch', () => {
    const a = new DataTree<number>().add([0], [1]).add([1], [2]).add([2], [3]);
    const b = new DataTree<number>().add([7], [10]);
    const m = matchBranches([a, b]);
    expect(m.map(x => x.path)).toEqual([[0], [1], [2]]);
    expect(m.map(x => x.lists[1])).toEqual([[10], [10], [10]]);
  });
  it('takes the output path from the tree with most branches', () => {
    const a = DataTree.of(1);
    const b = new DataTree<number>().add([3, 0], [1]).add([3, 1], [2]);
    expect(matchBranches([a, b]).map(x => x.path)).toEqual([[3, 0], [3, 1]]);
  });
  it('prefers the deeper path on ties', () => {
    const a = new DataTree<number>().add([0], [1]);
    const b = new DataTree<number>().add([0, 0, 4], [1]);
    expect(matchBranches([a, b])[0].path).toEqual([0, 0, 4]);
    expect(matchBranches([b, a])[0].path).toEqual([0, 0, 4]);
  });
  it('a tree without branches matches nothing', () => { expect(matchBranches([DataTree.of(1), new DataTree()])).toEqual([]); });
  it('no trees gives one default branch', () => { expect(matchBranches([])).toEqual([{ path: [0], lists: [] }]); });
});

describe('expressions', () => {
  it('respects precedence and associativity', () => {
    expect(evalExpr('1 + 2 * 3')).toBe(7); expect(evalExpr('(1 + 2) * 3')).toBe(9);
    expect(evalExpr('2 ^ 3 ^ 2')).toBe(512); expect(evalExpr('-2 ^ 2')).toBe(-4); expect(evalExpr('2 ^ -1')).toBe(0.5);
    expect(evalExpr('10 - 4 - 3')).toBe(3); expect(evalExpr('7 % 4')).toBe(3);
  });
  it('supports variables, functions, constants and scientific notation', () => {
    expect(evalExpr('P*L^3/(3*E*I)', { P: 1000, L: 2, E: 2e11, I: 1e-6 })).toBeCloseTo(8000 / 6e5, 12);
    expect(evalExpr('sqrt(16) + max(1, 2, 3) + cos(pi)')).toBeCloseTo(6); expect(evalExpr('1.5e3 + .5')).toBe(1500.5);
  });
  it('handles comparisons, logic and ternaries', () => {
    expect(evalExpr('x > 2 && x < 5 ? 10 : 20', { x: 3 })).toBe(10); expect(evalExpr('!(1 == 1) || 2 >= 3')).toBe(0);
    expect(evalExpr('if(x != 0, 1, 2)', { x: 0 })).toBe(2);
  });
  it('lists free variables', () => { expect(compileExpr('a*x + b - pi').vars.sort()).toEqual(['a', 'b', 'x']); });
  it('rejects unknown names and malformed input without executing code', () => {
    expect(() => evalExpr('alert(1)')).toThrow(/Unknown function/); expect(() => evalExpr('x + 1')).toThrow(/Unknown variable/);
    expect(() => evalExpr('1 +')).toThrow(); expect(() => evalExpr('2 $ 3')).toThrow(); expect(() => evalExpr('(1 + 2')).toThrow();
    expect(() => evalExpr('constructor')).toThrow(); expect(() => evalExpr('1; 2')).toThrow();
  });
});

// ---- engine tests with a tiny private registry -------------------------------------
function testRegistry(): Registry {
  const r = new Registry();
  const defs: ComponentDef[] = [
    { id: 'num', name: 'Number', nick: 'Num', category: 'T', desc: '', inputs: [], outputs: [P('N', 'number', '')], state: { v: 0 }, solve: (_i, ctx) => [ctx.node.state.v] },
    { id: 'list', name: 'List', nick: 'L', category: 'T', desc: '', inputs: [], outputs: [P('L', 'number', '', { list: true })], state: { v: [] }, solve: (_i, ctx) => [ctx.node.state.v] },
    { id: 'add', name: 'Add', nick: 'Add', category: 'T', desc: '', inputs: [P('A', 'number', '', { d: 0 }), P('B', 'number', '', { d: 0 })], outputs: [P('R', 'number', '')], solve: ([a, b]) => [a + b] },
    { id: 'sum', name: 'Sum', nick: 'Sum', category: 'T', desc: '', inputs: [P('L', 'number', '', { list: true })], outputs: [P('S', 'number', '')], solve: ([l]) => [l.reduce((a: number, b: number) => a + b, 0)] },
    { id: 'range', name: 'Range', nick: 'Rng', category: 'T', desc: '', inputs: [P('N', 'integer', '')], outputs: [P('R', 'number', '', { list: true })], solve: ([n]) => [Array.from({ length: n }, (_, i) => i)] },
    { id: 'need', name: 'Need', nick: 'Need', category: 'T', desc: '', inputs: [P('X', 'number', '')], outputs: [P('Y', 'number', '')], solve: ([x]) => [x] },
    { id: 'boom', name: 'Boom', nick: 'Boom', category: 'T', desc: '', inputs: [P('X', 'number', '', { d: 1 })], outputs: [P('Y', 'number', '')], solve: () => { throw new Error('boom'); } },
    { id: 'graftT', name: 'Graft', nick: 'G', category: 'T', desc: '', inputs: [P('T', 'any', '', { tree: true })], outputs: [P('T', 'any', '', { tree: true })], solveTrees: ([t]) => [t.graft()] },
  ];
  defs.forEach(d => r.add(d));
  return r;
}
function proj(reg: Registry, build: (p: ProjectFile, n: (type: string, state?: any, extra?: any) => string, w: (from: string, to: string, inp?: number, out?: number) => void) => void): ProjectFile {
  const p = emptyProject();
  const n = (type: string, state?: any, extra?: any) => { const node = makeNode(type, 0, 0, { ...(state ? { state } : {}), ...extra }, reg); p.graph.nodes.push(node); return node.id; };
  const w = (from: string, to: string, inp = 0, out = 0) => { p.graph.wires.push({ id: `w${p.graph.wires.length}`, from, out, to, inp }); };
  build(p, n, w);
  return p;
}

describe('graph engine', () => {
  it('applies longest-list matching by default', async () => {
    const reg = testRegistry(), e = new Engine(reg); let add = '';
    const p = proj(reg, (_p, n, w) => { const a = n('list', { v: [1, 2, 3] }), b = n('list', { v: [10, 20] }); add = n('add'); w(a, add, 0); w(b, add, 1); });
    await e.run(p);
    expect(e.outputs(add)[0].allItems()).toEqual([11, 22, 23]);
  });
  it('applies shortest and cross matching when requested', async () => {
    const reg = testRegistry(), e = new Engine(reg); let s = '', c = '';
    const p = proj(reg, (_p, n, w) => {
      const a = n('list', { v: [1, 2, 3] }), b = n('list', { v: [10, 20] });
      s = n('add', undefined, { matching: 'shortest' }); c = n('add', undefined, { matching: 'cross' });
      w(a, s, 0); w(b, s, 1); w(a, c, 0); w(b, c, 1);
    });
    await e.run(p);
    expect(e.outputs(s)[0].allItems()).toEqual([11, 22]);
    expect(e.outputs(c)[0].allItems()).toEqual([11, 21, 12, 22, 13, 23]);
  });
  it('uses constants and defaults for unwired inputs', async () => {
    const reg = testRegistry(), e = new Engine(reg); let add = '';
    const p = proj(reg, (_p, n) => { add = n('add', undefined, { consts: { A: 5 } }); });
    await e.run(p);
    expect(e.outputs(add)[0].allItems()).toEqual([5]);
  });
  it('list outputs from item inputs land in sub-branches', async () => {
    const reg = testRegistry(), e = new Engine(reg); let r = '', s = '';
    const p = proj(reg, (_p, n, w) => { const a = n('list', { v: [2, 3] }); r = n('range'); s = n('sum'); w(a, r); w(r, s); });
    await e.run(p);
    expect(paths(e.outputs(r)[0])).toBe('{0;0}:0,1 {0;1}:0,1,2');
    expect(paths(e.outputs(s)[0])).toBe('{0;0}:1 {0;1}:3');
  });
  it('matches a single value against every branch of a tree', async () => {
    const reg = testRegistry(), e = new Engine(reg); let add = '';
    const p = proj(reg, (_p, n, w) => { const a = n('list', { v: [1, 2] }), g = n('graftT'), b = n('num', { v: 100 }); add = n('add'); w(a, g); w(g, add, 0); w(b, add, 1); });
    await e.run(p);
    expect(paths(e.outputs(add)[0])).toBe('{0;0}:101 {0;1}:102');
  });
  it('merges several wires into one input in wire order', async () => {
    const reg = testRegistry(), e = new Engine(reg); let s = '';
    const p = proj(reg, (_p, n, w) => { const a = n('num', { v: 1 }), b = n('num', { v: 2 }); s = n('sum'); w(a, s); w(b, s); });
    await e.run(p);
    expect(e.outputs(s)[0].allItems()).toEqual([3]);
  });
  it('applies per-port modifiers', async () => {
    const reg = testRegistry(), e = new Engine(reg); let s = '';
    const p = proj(reg, (_p, n, w) => { const a = n('list', { v: [1, 2, 3] }); s = n('sum', undefined, { mods: { L: { graft: true } } }); w(a, s); });
    await e.run(p);
    expect(paths(e.outputs(s)[0])).toBe('{0;0}:1 {0;1}:2 {0;2}:3');
  });
  it('warns on missing required input and reports solve errors', async () => {
    const reg = testRegistry(), e = new Engine(reg); let need = '', boom = '', down = '';
    const p = proj(reg, (_p, n, w) => { need = n('need'); boom = n('boom'); down = n('need'); w(boom, down); });
    await e.run(p);
    expect(e.status(need).state).toBe('warning'); expect(e.status(need).messages[0]).toMatch(/no data/);
    expect(e.status(boom).state).toBe('error'); expect(e.status(boom).messages[0]).toBe('boom');
    expect(e.status(down).state).toBe('warning');
  });
  it('flags cycles and refuses wires that would create one', async () => {
    const reg = testRegistry(), e = new Engine(reg); let a = '', b = '';
    const p = proj(reg, (_p, n, w) => { a = n('add'); b = n('add'); w(a, b); });
    expect(wouldCycle(p.graph, b, a)).toBe(true); expect(wouldCycle(p.graph, a, b)).toBe(false);
    p.graph.wires.push({ id: 'x', from: b, out: 0, to: a, inp: 0 });
    await e.run(p);
    expect(e.status(a).state).toBe('error'); expect(e.status(a).messages[0]).toMatch(/loop/);
  });
  it('recomputes only what changed', async () => {
    const reg = testRegistry(); let calls = 0;
    reg.add({ id: 'count', name: 'C', nick: 'C', category: 'T', desc: '', inputs: [P('X', 'number', '')], outputs: [P('Y', 'number', '')], solve: ([x]) => { calls++; return [x]; } });
    const e = new Engine(reg); let a = '', b = '';
    const p = proj(reg, (_p, n, w) => { a = n('num', { v: 1 }); b = n('num', { v: 2 }); const c1 = n('count'), c2 = n('count'); w(a, c1); w(b, c2); });
    await e.run(p); expect(calls).toBe(2);
    await e.run(p); expect(calls).toBe(2);
    p.graph.nodes.find(n => n.id === a)!.state.v = 5;
    await e.run(p); expect(calls).toBe(3);
  });
  it('skips disabled components', async () => {
    const reg = testRegistry(), e = new Engine(reg); let a = '';
    const p = proj(reg, (_p, n) => { a = n('num', { v: 1 }, { enabled: false }); });
    await e.run(p);
    expect(e.status(a).state).toBe('disabled'); expect(e.outputs(a)[0].isEmpty).toBe(true);
  });
  it('coerces between compatible types and rejects others', () => {
    expect(coerce('3.5', 'number')).toBe(3.5); expect(coerce(2.6, 'integer')).toBe(3); expect(coerce(true, 'number')).toBe(1);
    expect(coerce('1, 2, 3', 'point')).toEqual({ x: 1, y: 2, z: 3 }); expect(coerce(0, 'boolean')).toBe(false);
    expect(coerce(5, 'domain')).toEqual({ k: 'domain', a: 0, b: 5 });
    expect(() => coerce('abc', 'number')).toThrow(/Cannot use text/); expect(() => coerce(1, 'curve')).toThrow();
  });
});
