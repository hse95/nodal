import { describe, it, expect, beforeEach } from 'vitest';
import '../src/components';
import { Engine, emptyProject, registry } from '../src/core/graph';
import type { ProjectFile } from '../src/core/types';
import { GraphHost, TOOL_DEFS, executeTool, arrangeGraph } from '../src/ai/tools';
import { buildCatalogue, buildSystemPrompt, catalogueLine, isBlocked } from '../src/ai/catalogue';
import { runTurn, LIMITS } from '../src/ai/agent';
import { ApiError, Reply, Request, send, retry, API_URL } from '../src/ai/client';
import { parseMarkdown } from '../src/ai/markdown';
import { DEFAULT_MODEL, MODELS, forgetKey, loadKey, redact, saveKey } from '../src/ai/key';
const iSection = (h: number, b: number, tw: number, tf: number) => (b * h ** 3 - (b - tw) * (h - 2 * tf) ** 3) / 12 * 1e-12;

/** A host over a plain project, with the same undo rule as the editor: one snapshot per group. */
function makeHost(units: 'SI' | 'US' = 'SI') {
  const state = { p: emptyProject('Test') as ProjectFile }, undo: string[] = [];
  state.p.units = units;
  let depth = 0, pushed = false;
  const engine = new Engine();
  const host: GraphHost = {
    project: () => state.p,
    mutate: fn => { if (!(depth > 0 && pushed)) { undo.push(JSON.stringify(state.p)); pushed = true; } const next = JSON.parse(JSON.stringify(state.p)); fn(next); state.p = next; },
    settle: () => engine.run(JSON.parse(JSON.stringify(state.p))), engine,
  };
  return { host, state, undo, begin: () => { if (depth++ === 0) pushed = false; }, end: () => { depth--; }, undoOnce: () => { state.p = JSON.parse(undo.pop()!); } };
}
const call = async (h: GraphHost, name: string, input: unknown) => (await executeTool(h, name, input)).result as any;
const add = async (h: GraphHost, type: string, extra: Record<string, unknown> = {}) => { const r = await call(h, 'add_component', { type, ...extra }); expect(r.error, JSON.stringify(r)).toBeUndefined(); return r.id as string; };

/** Build a simply supported beam through the tools, the way the assistant would. */
async function buildBeam(h: GraphHost, L = 6, w = 20) {
  const span = await add(h, 'param.slider', { label: 'Span [m]', settings: { min: 1, max: 20, value: L } });
  const end = await add(h, 'vec.point', { label: 'Right end', inputs: { X: { from: span, output: 'Value' } } });
  const line = await add(h, 'crv.line', { inputs: { A: '0, 0, 0', B: { from: end, output: 'Point' } } });
  const sec = await add(h, 'fe.sec.i');
  const beam = await add(h, 'fe.beam', { inputs: { Curve: { from: line }, Section: { from: sec }, Size: L / 8 } });
  const pin = await add(h, 'fe.support', { label: 'Pin', inputs: { Point: '0, 0, 0', Conditions: 'ux uy uz rx' } });
  const roller = await add(h, 'fe.support', { label: 'Roller', inputs: { Point: { from: end, output: 'Point' }, Conditions: 'uy uz' } });
  const load = await add(h, 'fe.load.line', { inputs: { Load: `0, 0, ${-w}` } });
  const model = await add(h, 'fe.assemble', { inputs: { Elements: { from: beam }, Supports: [{ from: pin }, { from: roller }], Loads: { from: load } } });
  const stat = await add(h, 'fe.static', { inputs: { Model: { from: model } } });
  const view = await add(h, 'fe.view', { inputs: { Result: { from: stat, output: 'Result' } }, settings: { diagram: 'My' } });
  return { span, end, line, sec, beam, pin, roller, load, model, stat, view };
}

describe('assistant: system prompt', () => {
  it('lists every component of the registry except the blocked ones, and only those', () => {
    const cat = buildCatalogue(), lines = cat.split('\n');
    const allowed = registry.all().filter(d => !isBlocked(d.id));
    expect(lines.length).toBe(allowed.length);
    for (const d of allowed) expect(cat).toContain('`' + d.id + '` ' + d.name);
    expect(cat).not.toContain('`script.js`');
    expect(catalogueLine(registry.get('fe.beam')!)).toMatch(/^`fe\.beam` Beam \[Structure\]: Curve:curve.*-> .*:element/);
  });
  it('states the units from the unit tables and keeps the hand-written rules', () => {
    const si = buildSystemPrompt('SI'), us = buildSystemPrompt('US');
    expect(si).toContain('forces in kN'); expect(si).toContain('lengths and coordinates in m,');
    expect(us).toContain('forces in kip'); expect(us).toContain('section dimensions and displacements in in');
    for (const rule of ['only through the tools', 'Never invent types or ports', 'state it plainly', 'must come from `get_results`', 'No hype']) expect(si).toContain(rule);
    expect(si).not.toContain('{{');
  });
  it('declares a schema for every tool', () => {
    for (const t of TOOL_DEFS) { expect(t.description.length).toBeGreaterThan(20); expect((t.input_schema as any).type).toBe('object'); }
    expect(TOOL_DEFS.map(t => t.name)).toEqual(expect.arrayContaining(['list_component_types', 'get_graph', 'add_component', 'set_parameter', 'connect', 'disconnect', 'delete_component', 'arrange', 'run_analysis', 'get_results', 'load_template', 'load_example']));
  });
});

describe('assistant: tool validation', () => {
  let t: ReturnType<typeof makeHost>;
  beforeEach(() => { t = makeHost(); });
  it('rejects unknown and unavailable component types', async () => {
    expect((await call(t.host, 'add_component', { type: 'fe.girder' })).error).toMatch(/Unknown component type/);
    expect((await call(t.host, 'add_component', { type: 'beam' })).error).toMatch(/Did you mean: .*fe\.beam/);
    expect((await call(t.host, 'add_component', { type: 'script.js' })).error).toMatch(/not available to the assistant/);
    expect((await call(t.host, 'add_component', {})).error).toBeTruthy();
    expect(t.state.p.graph.nodes.length).toBe(0);
  });
  it('rejects unknown ports and names the real ones', async () => {
    const a = await add(t.host, 'vec.point'), b = await add(t.host, 'crv.line');
    expect((await call(t.host, 'connect', { from_id: a, output: 'Pt', to_id: b, input: 'Start' })).error).toMatch(/has no input called "Start".*A, B/);
    expect((await call(t.host, 'connect', { from_id: a, output: 'Nope', to_id: b, input: 'A' })).error).toMatch(/has no output called "Nope"/);
    expect((await call(t.host, 'add_component', { type: 'crv.line', inputs: { Start: '0,0,0' } })).error).toMatch(/no input called "Start"/);
    expect((await call(t.host, 'set_parameter', { id: b, name: 'Start', value: 1 })).error).toMatch(/no input or setting/);
    expect((await call(t.host, 'connect', { from_id: 'ghost', output: 'x', to_id: b, input: 'A' })).error).toMatch(/no component with id/);
    expect(t.state.p.graph.wires.length).toBe(0);
  });
  it('rejects incompatible data types', async () => {
    const line = await add(t.host, 'crv.line'), sup = await add(t.host, 'fe.support'), beam = await add(t.host, 'fe.beam');
    expect((await call(t.host, 'connect', { from_id: line, output: 'Line', to_id: beam, input: 'Section' })).error).toMatch(/Cannot wire .*curve.*section/);
    expect((await call(t.host, 'add_component', { type: 'fe.assemble', inputs: { Elements: { from: sup } } })).error).toMatch(/No output of Support fits/);
    expect((await call(t.host, 'set_parameter', { id: beam, name: 'Curve', value: 3 })).error).toMatch(/cannot be set to a constant/);
    expect((await call(t.host, 'set_parameter', { id: line, name: 'A', value: 'left' })).error).toMatch(/expects point/);
    expect((await call(t.host, 'set_parameter', { id: beam, name: 'Size', value: 'big' })).error).toMatch(/expects number/);
  });
  it('rejects out-of-range and wrongly typed settings', async () => {
    const s = await add(t.host, 'param.slider', { settings: { min: 0, max: 10, value: 4 } });
    expect((await call(t.host, 'set_parameter', { id: s, name: 'value', value: 25 })).error).toMatch(/outside its range 0 to 10/);
    expect((await call(t.host, 'set_parameter', { id: s, name: 'max', value: -5 })).error).toMatch(/min < max/);
    expect((await call(t.host, 'set_parameter', { id: s, name: 'value', value: 'seven' })).error).toMatch(/finite number/);
    expect((await call(t.host, 'set_parameter', { id: s, name: 'value', value: Infinity })).error).toBeTruthy();
    expect((await call(t.host, 'add_component', { type: 'param.slider', settings: { min: 0, max: 5, value: 9 } })).error).toMatch(/outside its range/);
    expect((await call(t.host, 'add_component', { type: 'param.slider', settings: { colour: 'red' } })).error).toMatch(/no setting called "colour"/);
    expect((await call(t.host, 'set_parameter', { id: s, name: 'value', value: 7 })).ok).toBe(true);
    expect(t.state.p.graph.nodes[0].state.value).toBe(7);
  });
  it('rejects wires that would make a loop', async () => {
    const a = await add(t.host, 'math.add'), b = await add(t.host, 'math.add', { inputs: { A: { from: a, output: 'Result' } } });
    expect((await call(t.host, 'connect', { from_id: b, output: 'Result', to_id: a, input: 'A' })).error).toMatch(/loop/);
    expect((await call(t.host, 'connect', { from_id: a, output: 'Result', to_id: a, input: 'B' })).error).toMatch(/loop/);
  });
  it('passes formulas through the expression parser and refuses anything it does not accept', async () => {
    const def = registry.get('math.expr')!, key = Object.keys(def.state ?? {}).find(k => typeof (def.state as any)[k] === 'string')!;
    expect(key).toBe('expr');
    for (const bad of ['alert(1)', 'a +* b', 'constructor.constructor("x")()', 'x; y', '(() => 1)()', 'this.x']) expect((await call(t.host, 'add_component', { type: 'math.expr', settings: { expr: bad } })).error, bad).toMatch(/formula is not valid/);
    const ok = await call(t.host, 'add_component', { type: 'math.expr', settings: { expr: 'w * L^2 / 8' } });
    expect(ok.error).toBeUndefined(); expect(ok.inputs).toEqual(expect.arrayContaining(['w', 'L']));
  });
  it('refuses unknown tools and unknown ids, and never throws', async () => {
    expect((await call(t.host, 'format_disk', {})).error).toMatch(/Unknown tool/);
    expect((await call(t.host, 'delete_component', { id: 'x' })).error).toMatch(/no component/);
    expect((await call(t.host, 'disconnect', { to_id: 'x', input: 'A' })).error).toBeTruthy();
    expect((await call(t.host, 'get_results', {})).error).toMatch(/no analysis result/);
    expect((await call(t.host, 'load_template', { name: 'castle' })).error).toMatch(/Unknown template/);
    expect((await call(t.host, 'add_component', null)).error).toBeTruthy();
  });
});

describe('assistant: building and reading results', () => {
  it('builds a simply supported beam that solves without warnings and matches wL²/8 and 5wL⁴/384EI', async () => {
    const t = makeHost(), ids = await buildBeam(t.host, 6, 20);
    const run = await call(t.host, 'run_analysis', {});
    expect(run.status, JSON.stringify(run.issues)).toBe('ok');
    const res = await call(t.host, 'get_results', { id: ids.stat }), c = res.outputs.Result.cases[0];
    expect(res.outputs.Result.source).toBe('Nodal solver');
    expect(c.member_forces.My.max).toBeCloseTo(20 * 36 / 8, 6);                                   // 90 kN·m
    const EI = 210e9 * iSection(300, 150, 7.1, 10.7);
    expect(c.max_displacement.value).toBeCloseTo(5 * 20e3 * 6 ** 4 / (384 * EI) * 1000, 3);          // mm
    expect(c.reactions.reduce((s: number, r: any) => s + r.force[2], 0)).toBeCloseTo(120, 6);
    expect((await call(t.host, 'get_results', {})).results[0].id).toBe(ids.stat);
    // The graph is readable: arranged left to right in data-flow order.
    await call(t.host, 'arrange', {});
    const at = (id: string) => t.state.p.graph.nodes.find(n => n.id === id)!;
    expect(at(ids.span).x).toBeLessThan(at(ids.end).x); expect(at(ids.line).x).toBeLessThan(at(ids.beam).x);
    expect(at(ids.beam).x).toBeLessThan(at(ids.model).x); expect(at(ids.model).x).toBeLessThan(at(ids.stat).x); expect(at(ids.stat).x).toBeLessThan(at(ids.view).x);
    const boxes = t.state.p.graph.nodes.map(n => `${n.x},${n.y}`); expect(new Set(boxes).size).toBe(boxes.length);
  });
  it('reports model errors back so they can be fixed', async () => {
    const t = makeHost(), ids = await buildBeam(t.host);
    await call(t.host, 'delete_component', { id: ids.pin }); await call(t.host, 'delete_component', { id: ids.roller });
    const run = await call(t.host, 'run_analysis', {});
    expect(run.status).not.toBe('ok'); expect(run.issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(run.issues)).toMatch(/support|unstable|restrain|mechanism/i);
  });
  it('get_graph shows components, constants, settings and wires by port name', async () => {
    const t = makeHost(), ids = await buildBeam(t.host);
    const g = await call(t.host, 'get_graph', {});
    expect(g.units).toBe('SI'); expect(g.components.length).toBe(11);
    expect(g.wires).toContainEqual({ from_id: ids.line, output: 'Line', to_id: ids.beam, input: 'Curve' });
    expect(g.components.find((c: any) => c.id === ids.pin).inputs.Conditions).toBe('ux uy uz rx');
    expect((await call(t.host, 'disconnect', { to_id: ids.model, input: 'Supports', from_id: ids.pin })).removed).toBe(1);
  });
  it('loads a template and lists components', async () => {
    const t = makeHost();
    expect((await call(t.host, 'load_template', {})).templates.length).toBeGreaterThan(5);
    const r = await call(t.host, 'load_template', { name: 'beam-cantilever' });
    expect(r.components.length).toBeGreaterThan(5);
    expect((await call(t.host, 'run_analysis', {})).status).toBe('ok');
    expect((await call(t.host, 'list_component_types', { query: 'buckling' })).types.map((x: any) => x.type)).toContain('fe.buckling');
    const d = (await call(t.host, 'describe_components', { types: ['fe.load.line'] })).components[0];
    expect(d.inputs.find((p: any) => p.name === 'Load').unit).toMatch(/kN\/m/);
  });
  it('arrange is stable for a graph with a cycle-free diamond', () => {
    const g = { nodes: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, type: 'math.add', x: 500 - i * 10, y: 0, state: {}, consts: {} })), wires: [{ id: '1', from: 'a', out: 0, to: 'b', inp: 0 }, { id: '2', from: 'a', out: 0, to: 'c', inp: 0 }, { id: '3', from: 'b', out: 0, to: 'd', inp: 0 }, { id: '4', from: 'c', out: 0, to: 'd', inp: 1 }], groups: [] };
    const pos = arrangeGraph(g as any);
    expect(pos.get('a')!.x).toBeLessThan(pos.get('b')!.x); expect(pos.get('b')!.x).toBe(pos.get('c')!.x); expect(pos.get('b')!.y).not.toBe(pos.get('c')!.y); expect(pos.get('d')!.x).toBeGreaterThan(pos.get('c')!.x);
  });
});

// ---- the turn loop, with a scripted stand-in for the API ---------------------------------------
type Step = (results: any[]) => (string | { name: string; input: unknown })[];
function scripted(steps: Step[]) {
  const seen: Request[] = []; let n = 0;
  const transport = async (req: Request): Promise<Reply> => {
    seen.push(JSON.parse(JSON.stringify({ ...req, signal: undefined })));
    const last = req.messages[req.messages.length - 1], results = last.content.filter(b => b.type === 'tool_result').map(b => JSON.parse((b as any).content));
    const out = (steps[n++] ?? (() => ['Done.']))(results);
    const content = out.map((o, i) => typeof o === 'string' ? { type: 'text' as const, text: o } : { type: 'tool_use' as const, id: `tu_${n}_${i}`, name: o.name, input: o.input });
    for (const c of content) if (c.type === 'text') req.onText?.(c.text);
    return { content, stop: content.some(c => c.type === 'tool_use') ? 'tool_use' : 'end_turn', usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 } };
  };
  return { transport, seen };
}

describe('assistant: one turn', () => {
  it('folds all changes of a turn into one undo step', async () => {
    const t = makeHost(), s = scripted([
      () => [{ name: 'add_component', input: { type: 'vec.point', label: 'A' } }, { name: 'add_component', input: { type: 'vec.point', label: 'B', inputs: { X: 4 } } }],
      r => [{ name: 'add_component', input: { type: 'crv.line', inputs: { A: { from: r[0].id }, B: { from: r[1].id } } } }],
      () => ['Built a line between two points.'],
    ]);
    const r = await runTurn({ key: 'k', model: DEFAULT_MODEL, host: t.host, history: [], user: [{ type: 'text', text: 'line' }], transport: s.transport, beginGroup: t.begin, endGroup: t.end });
    expect(r.text).toContain('Built a line'); expect(r.changed).toBe(true); expect(r.actions.map(a => a.line)).toEqual(['+ A', '+ B', '+ Line']);
    expect(r.touched.length).toBe(3); expect(r.usage.input).toBe(300);
    expect(t.state.p.graph.nodes.length).toBe(3); expect(t.state.p.graph.wires.length).toBe(2);
    expect(t.undo.length).toBe(1);
    t.undoOnce();
    expect(t.state.p.graph.nodes.length).toBe(0);
    // The request carried the tools, the generated prompt, and never the key in the body.
    expect(s.seen[0].tools.length).toBe(TOOL_DEFS.length); expect(s.seen[0].system).toContain('`crv.line` Line');
    expect(JSON.stringify(s.seen.map(q => q.messages))).not.toContain('"k"');
  });
  it('returns a rejected call to the model, which corrects it', async () => {
    const t = makeHost(), s = scripted([
      () => [{ name: 'add_component', input: { type: 'vec.point' } }, { name: 'add_component', input: { type: 'crv.line' } }],
      r => [{ name: 'connect', input: { from_id: r[0].id, output: 'Point', to_id: r[1].id, input: 'Start' } }],
      r => { expect(r[0].error).toMatch(/no input called "Start"/); const g = t.state.p.graph.nodes; return [{ name: 'connect', input: { from_id: g[0].id, output: 'Point', to_id: g[1].id, input: 'A' } }]; },
      () => ['Connected.'],
    ]);
    const r = await runTurn({ key: 'k', model: DEFAULT_MODEL, host: t.host, history: [], user: [{ type: 'text', text: 'x' }], transport: s.transport });
    expect(r.actions.filter(a => !a.ok).length).toBe(1); expect(t.state.p.graph.wires.length).toBe(1);
    const sent = s.seen[2].messages[s.seen[2].messages.length - 1].content[0] as any;
    expect(sent.type).toBe('tool_result'); expect(sent.is_error).toBe(true);
  });
  it('stops at the limit of rounds with a message', async () => {
    const t = makeHost(), s = scripted(Array.from({ length: LIMITS.rounds + 5 }, () => () => [{ name: 'get_graph', input: {} }]));
    const r = await runTurn({ key: 'k', model: DEFAULT_MODEL, host: t.host, history: [], user: [{ type: 'text', text: 'loop' }], transport: s.transport });
    expect(r.stopped).toBe('limit'); expect(s.seen.length).toBe(LIMITS.rounds);
    expect(r.messages[r.messages.length - 1].role).toBe('assistant');
  });
  it('stops cleanly when cancelled and leaves a valid conversation', async () => {
    const t = makeHost(), ac = new AbortController();
    const transport = async (): Promise<Reply> => { ac.abort(); return { content: [{ type: 'tool_use', id: 'a', name: 'add_component', input: { type: 'vec.point' } }], stop: 'tool_use', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }; };
    const r = await runTurn({ key: 'k', model: DEFAULT_MODEL, host: t.host, history: [], user: [{ type: 'text', text: 'x' }], transport, signal: ac.signal });
    expect(r.stopped).toBe('cancelled'); expect(t.state.p.graph.nodes.length).toBe(0);
    const last = r.messages[r.messages.length - 1];
    expect(last.role).toBe('user'); expect((last.content[0] as any).type).toBe('tool_result');
  });
});

// ---- the client, with fetch replaced -----------------------------------------------------------
const sse = (events: unknown[]) => new Response(new ReadableStream({ start(c) { const enc = new TextEncoder(); for (const e of events) c.enqueue(enc.encode(`event: ${(e as any).type}\ndata: ${JSON.stringify(e)}\n\n`)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const base = { key: 'sk-ant-test-0123456789', model: DEFAULT_MODEL, system: 'S', messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }], tools: [] };
describe('assistant: API client', () => {
  const real = globalThis.fetch;
  beforeEach(() => { globalThis.fetch = real; retry.delays = [1, 1, 1]; });
  it('sends the required headers and reads a streamed reply with text and a tool call', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: any, init: any) => { seen = { url: String(url), init }; return sse([
      { type: 'message_start', message: { usage: { input_tokens: 42, cache_read_input_tokens: 7 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } }, { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'add_component', input: {} } }, { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"type":"fe.' } }, { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'beam"}' } }, { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } }, { type: 'message_stop' }]); }) as any;
    let text = '';
    const r = await send({ ...base, onText: d => { text += d; } });
    expect(seen!.url).toBe(API_URL); expect(seen!.url).not.toContain('sk-ant');
    const h = seen!.init.headers as Record<string, string>;
    expect(h['x-api-key']).toBe(base.key); expect(h['anthropic-version']).toBe('2023-06-01'); expect(h['content-type']).toBe('application/json'); expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
    const body = JSON.parse(String(seen!.init.body));
    expect(body.stream).toBe(true); expect(body.model).toBe(DEFAULT_MODEL); expect(JSON.stringify(body)).not.toContain(base.key);
    expect(body.messages[0].content[0].cache_control).toBeUndefined();          // a single message is sent as it is
    await send({ ...base, messages: [...base.messages, { role: 'assistant', content: [{ type: 'text', text: 'a' }] }, { role: 'user', content: [{ type: 'text', text: 'b' }, { type: 'text', text: 'c' }] }] });
    const later = JSON.parse(String(seen!.init.body)).messages; expect(later[2].content[1].cache_control).toEqual({ type: 'ephemeral' }); expect(later[2].content[0].cache_control).toBeUndefined(); expect(later[0].content[0].cache_control).toBeUndefined();
    expect(text).toBe('Hello'); expect(r.stop).toBe('tool_use'); expect(r.usage).toEqual({ input: 42, output: 9, cacheRead: 7, cacheWrite: 0 });
    expect(r.content).toEqual([{ type: 'text', text: 'Hello' }, { type: 'tool_use', id: 'tu1', name: 'add_component', input: { type: 'fe.beam' } }]);
  });
  it('explains a rejected key without repeating it', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: `invalid x-api-key ${base.key}` } }), { status: 401 })) as any;
    const e = await send(base).catch(x => x) as ApiError;
    expect(e.kind).toBe('key'); expect(e.message).toMatch(/did not accept the API key/); expect(e.message).not.toContain('sk-ant');
  });
  it('retries with backoff on 429 and 529, then succeeds or gives a plain message', async () => {
    let n = 0; const notes: string[] = [];
    globalThis.fetch = (async () => (++n < 3 ? new Response('{}', { status: n === 1 ? 429 : 529 }) : sse([{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'ok' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }]))) as any;
    const r = await send({ ...base, onStatus: s => { if (s) notes.push(s); } });
    expect(n).toBe(3); expect(r.content[0]).toEqual({ type: 'text', text: 'ok' }); expect(notes[0]).toMatch(/Rate limit/); expect(notes[1]).toMatch(/busy/);
    n = 0; globalThis.fetch = (async () => { n++; return new Response('{}', { status: 429 }); }) as any;
    const e = await send(base).catch(x => x) as ApiError;
    expect(n).toBe(4); expect(e.kind).toBe('busy'); expect(e.message).toMatch(/rate limit/i);
  });
  it('reports a network failure and a user stop distinctly', async () => {
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as any;
    expect(((await send(base).catch(x => x)) as ApiError).kind).toBe('network');
    const ac = new AbortController(); ac.abort();
    expect(((await send({ ...base, signal: ac.signal }).catch(x => x)) as ApiError).kind).toBe('cancelled');
  });
});

describe('assistant: key storage and text safety', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, _m: m } as any; };
  beforeEach(() => { (globalThis as any).localStorage = mem(); (globalThis as any).sessionStorage = mem(); forgetKey(); });
  it('keeps the key for the session unless the user asks to remember it', () => {
    saveKey(' sk-ant-abc12345678 ', false);
    expect((globalThis as any).localStorage._m.size).toBe(0); expect((globalThis as any).sessionStorage.getItem('nodal.ai.key')).toBe('sk-ant-abc12345678');
    expect(loadKey()).toEqual({ key: 'sk-ant-abc12345678', remembered: false });
    saveKey('sk-ant-abc12345678', true);
    expect((globalThis as any).localStorage.getItem('nodal.ai.key')).toBe('sk-ant-abc12345678'); expect((globalThis as any).sessionStorage._m.size).toBe(0);
    expect(loadKey().remembered).toBe(true);
    forgetKey();
    expect((globalThis as any).localStorage._m.size).toBe(0); expect((globalThis as any).sessionStorage._m.size).toBe(0); expect(loadKey().key).toBe('');
  });
  it('never puts the key into a project, and offers the documented models', async () => {
    saveKey('sk-ant-secret-0123456789', true);
    const t = makeHost(); await buildBeam(t.host);
    expect(JSON.stringify(t.state.p)).not.toContain('sk-ant');
    expect(JSON.stringify(await call(t.host, 'get_graph', {}))).not.toContain('sk-ant');
    expect(redact('bad key sk-ant-secret-0123456789 here')).toBe('bad key sk-ant-… here');
    expect(MODELS.map(m => m.id)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5', 'claude-fable-5-2']); expect(DEFAULT_MODEL).toBe('claude-sonnet-5-5');
  });
  it('turns model text into plain tokens: markup stays text', () => {
    const blocks = parseMarkdown('Built **a beam**.\n\n<img src=x onerror="alert(1)"> and <script>steal()</script>\n- use `fe.beam`\n1. [link](javascript:alert(1))\n```\n<b>code</b>\n```');
    expect(blocks.map(b => b.k)).toEqual(['p', 'p', 'li', 'oli', 'pre']);
    expect(blocks[0].spans).toEqual([{ t: 'text', s: 'Built ' }, { t: 'bold', s: 'a beam' }, { t: 'text', s: '.' }]);
    expect(blocks[1].spans[0]).toEqual({ t: 'text', s: '<img src=x onerror="alert(1)"> and <script>steal()</script>' });
    expect(blocks[3].spans[0].s).toBe('[link](javascript:alert(1))'); expect(blocks[4].spans[0].s).toBe('<b>code</b>');
    for (const b of blocks) for (const s of b.spans) expect(['text', 'bold', 'code']).toContain(s.t);
  });
});
