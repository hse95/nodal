import { test, expect, Page, Route } from '@playwright/test';

/**
 * The assistant is tested without Anthropic: every request to the API is answered here by a script.
 * A script is a list of steps; each step receives the results of the previous tool calls and returns
 * text and tool calls, which are sent back as a real streamed (server-sent events) reply.
 */
type Out = string | { name: string; input: unknown };
type Step = (results: any[], body: any) => Out[] | { status: number; headers?: Record<string, string> } | 'hang';
const API = 'https://api.anthropic.com/v1/messages';

function sseBody(out: Out[], n: number): string {
  const ev: any[] = [{ type: 'message_start', message: { usage: { input_tokens: 1200 + n, output_tokens: 0 } } }];
  out.forEach((o, i) => {
    if (typeof o === 'string') { ev.push({ type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } }); for (let k = 0; k < o.length; k += 12) ev.push({ type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: o.slice(k, k + 12) } }); }
    else { const json = JSON.stringify(o.input); ev.push({ type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: `tu_${n}_${i}`, name: o.name, input: {} } }); ev.push({ type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: json.slice(0, 9) } }, { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: json.slice(9) } }); }
    ev.push({ type: 'content_block_stop', index: i });
  });
  ev.push({ type: 'message_delta', delta: { stop_reason: out.some(o => typeof o !== 'string') ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 80 } }, { type: 'message_stop' });
  return ev.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}
async function mockClaude(page: Page, steps: Step[]) {
  const log = { requests: [] as any[], headers: [] as Record<string, string>[], results: [] as any[] };
  let n = 0;
  await page.route(API, async (route: Route) => {
    const req = route.request(), body = req.postDataJSON();
    log.requests.push(body); log.headers.push(req.headers());
    const last = body.messages[body.messages.length - 1], results = (Array.isArray(last.content) ? last.content : []).filter((b: any) => b.type === 'tool_result').map((b: any) => JSON.parse(b.content));
    log.results.push(...results);
    const step = steps[n++], out = step ? step(results, body) : ['Done.'];
    if (out === 'hang') return;                                     // never answered: used to test Stop
    if (!Array.isArray(out)) return route.fulfill({ status: out.status, headers: { 'access-control-allow-origin': '*', ...(out.headers ?? {}) }, contentType: 'application/json', body: JSON.stringify({ type: 'error', error: { type: 'x', message: 'mock' } }) });
    await route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'text/event-stream', body: sseBody(out, n) });
  });
  return log;
}
const watch = (page: Page) => { const errors: string[] = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); }); return errors; };
const ready = async (page: Page) => { await expect(page.locator('.status .ok, .status .warn')).toBeVisible({ timeout: 60_000 }); };
async function openAssistant(page: Page, key = 'sk-ant-test-key-0123456789') {
  await page.addInitScript(() => { localStorage.setItem('nodal.tourDone', '1'); });
  await page.goto('/?new=1'); await ready(page);
  await page.locator('.rb-ai').click();
  await expect(page.locator('.assistant')).toBeVisible();
  if (key) { await page.locator('.as-settings input[type="password"]').fill(key); await page.locator('.as-head button', { hasText: 'Settings' }).click(); }
}
async function say(page: Page, text: string) { await page.locator('.as-input textarea').fill(text); await page.locator('.as-input textarea').press('Enter'); }
const done = async (page: Page) => { await expect(page.locator('.as-input .primary')).toBeVisible({ timeout: 60_000 }); };
const add = (type: string, extra: Record<string, unknown> = {}) => ({ name: 'add_component', input: { type, ...extra } });
const w = (from: string, output?: string) => ({ from, ...(output ? { output } : {}) });
const E = 210e9, I = (h: number, b: number, tw: number, tf: number) => (b * h ** 3 - (b - tw) * (h - 2 * tf) ** 3) / 12 * 1e-12, I300 = I(300, 150, 7.1, 10.7);
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const TOL = 1e-3;   // the tolerance of the frame benchmarks in docs/verification

test('nothing is sent to Anthropic unless the assistant is opened and has a key', async ({ page }) => {
  const calls: string[] = []; page.on('request', r => { if (r.url().includes('anthropic')) calls.push(r.url()); });
  await page.addInitScript(() => { localStorage.setItem('nodal.tourDone', '1'); });
  await page.goto('/?example=quick-truss'); await ready(page);
  await page.locator('.rb-ai').click();
  await expect(page.locator('.as-settings')).toBeVisible();                       // no key yet: settings are shown
  await expect(page.locator('.as-settings')).toContainText('Your messages, images and the current model are sent to Anthropic using your own API key. Usage is billed to your Anthropic account.');
  await expect(page.locator('.as-settings a')).toHaveAttribute('href', 'https://console.anthropic.com');
  await say(page, 'hello');
  await page.waitForTimeout(400);
  expect(calls).toEqual([]);
  // The key is kept for the session only unless "remember" is ticked, and can be forgotten.
  await page.locator('.as-settings input[type="password"]').fill('sk-ant-test-key-0123456789');
  expect(await page.evaluate(() => [localStorage.getItem('nodal.ai.key'), sessionStorage.getItem('nodal.ai.key')])).toEqual([null, 'sk-ant-test-key-0123456789']);
  await page.locator('.as-settings input[type="checkbox"]').check();
  expect(await page.evaluate(() => [localStorage.getItem('nodal.ai.key'), sessionStorage.getItem('nodal.ai.key')])).toEqual(['sk-ant-test-key-0123456789', null]);
  await page.locator('.as-settings button', { hasText: 'Forget key' }).click();
  expect(await page.evaluate(() => [localStorage.getItem('nodal.ai.key'), sessionStorage.getItem('nodal.ai.key')])).toEqual([null, null]);
  expect(page.url()).not.toContain('sk-ant');
});

test('text: a simply supported beam with a uniform load is built, solved and matches the hand formulas', async ({ page }) => {
  const errors = watch(page), ids: Record<string, string> = {};
  const log = await mockClaude(page, [
    () => ['I will build a 6 m simply supported beam with 20 kN/m. ', add('param.slider', { label: 'Span [m]', settings: { min: 1, max: 20, value: 6 } }), add('param.slider', { label: 'Load [kN/m]', settings: { min: 0, max: 100, value: 20 } }), add('fe.sec.i')],
    r => { [ids.L, ids.w, ids.sec] = r.map(x => x.id); return [add('vec.point', { label: 'Right end', inputs: { X: w(ids.L) } }), add('math.neg', { inputs: { X: w(ids.w) } })]; },
    r => { [ids.B, ids.neg] = r.map(x => x.id); return [add('crv.line', { label: 'Beam axis', inputs: { A: '0, 0, 0', B: w(ids.B) } }), add('vec.vector', { label: 'Load vector', inputs: { Z: w(ids.neg) } }), add('fe.support', { label: 'Pin', inputs: { Point: '0, 0, 0', Conditions: 'ux uy uz rx' } }), add('fe.support', { label: 'Roller', inputs: { Point: w(ids.B), Conditions: 'uy uz' } })]; },
    r => { [ids.line, ids.wv, ids.pin, ids.roller] = r.map(x => x.id); return [add('fe.beam', { inputs: { Curve: w(ids.line), Section: w(ids.sec), Size: 0.75 } }), add('fe.load.line', { inputs: { Load: w(ids.wv) } })]; },
    r => { [ids.beam, ids.load] = r.map(x => x.id); return [add('fe.assemble', { inputs: { Elements: w(ids.beam), Supports: [w(ids.pin), w(ids.roller)], Loads: w(ids.load) } })]; },
    r => { ids.model = r[0].id; return [add('fe.static', { inputs: { Model: w(ids.model, 'Model') } })]; },
    r => { ids.stat = r[0].id; return [add('fe.view', { inputs: { Result: w(ids.stat, 'Result') }, settings: { diagram: 'My' } }), { name: 'arrange', input: {} }, { name: 'run_analysis', input: {} }]; },
    r => { expect(r[2].status).toBe('ok'); return [{ name: 'get_results', input: { id: ids.stat } }]; },
    r => { const c = r[0].outputs.Result.cases[0]; return [`Built a **simply supported beam**: 6 m span, 20 kN/m, default I section (assumed). From Nodal's solver: largest moment ${c.member_forces.My.max} kN·m, largest deflection ${c.max_displacement.value} mm. The Result View shows the moment diagram.`]; },
  ]);
  await openAssistant(page);
  await say(page, 'Simply supported steel beam, 6 m, 20 kN/m UDL, show moment and deflection.');
  await done(page);
  await expect(page.locator('.node')).toHaveCount(14);
  await expect(page.locator('.node.error')).toHaveCount(0); await expect(page.locator('.node.warning')).toHaveCount(0);
  if (process.env.SHOTS) { await page.waitForTimeout(1200); await page.screenshot({ path: process.env.SHOTS + '/assistant-text.png' }); }
  await expect(page.locator('.as-msg .md b')).toHaveText('simply supported beam');
  await expect(page.locator('.as-actions summary')).toContainText('actions');
  await expect(page.locator('.as-usage')).toContainText('tokens in');
  // The numbers the assistant reported were read from the solver; compare them with the hand formulas.
  const res = log.results.find(x => x.outputs?.Result)!.outputs.Result.cases[0];
  expect(rel(res.member_forces.My.max, 20 * 6 ** 2 / 8)).toBeLessThan(TOL);                              // wL²/8 = 90 kN·m
  expect(rel(res.max_displacement.value, 5 * 20e3 * 6 ** 4 / (384 * E * I300) * 1000)).toBeLessThan(TOL);   // 5wL⁴/384EI
  // The request went straight to Anthropic with the documented headers; the key is nowhere else.
  const h = log.headers[0];
  expect(h['x-api-key']).toBe('sk-ant-test-key-0123456789'); expect(h['anthropic-version']).toBe('2023-06-01'); expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
  expect(JSON.stringify(log.requests)).not.toContain('sk-ant'); expect(log.requests[0].stream).toBe(true); expect(log.requests[0].system[0].text).toContain('`fe.beam` Beam');
  // One undo step for the whole turn: the button, then Ctrl+Z / redo behave as usual.
  await page.locator('.as-undo').click();
  await expect(page.locator('.node')).toHaveCount(0);
  await page.locator('.canvas').click({ position: { x: 200, y: 300 } }); await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.node')).toHaveCount(14);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.node')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('text: a cantilever with a tip load matches PL and PL³/3EI', async ({ page }) => {
  const errors = watch(page), ids: Record<string, string> = {};
  const log = await mockClaude(page, [
    () => [add('crv.line', { inputs: { A: '0, 0, 0', B: '3, 0, 0' } }), add('fe.sec.i'), add('fe.support', { inputs: { Point: '0, 0, 0', Conditions: 'fixed' } }), add('fe.load.point', { inputs: { Point: '3, 0, 0', Force: '0, 0, -10' } })],
    r => { [ids.line, ids.sec, ids.sup, ids.load] = r.map(x => x.id); return [add('fe.beam', { inputs: { Curve: w(ids.line), Section: w(ids.sec) } })]; },
    r => { ids.beam = r[0].id; return [add('fe.assemble', { inputs: { Elements: w(ids.beam), Supports: w(ids.sup), Loads: w(ids.load) } })]; },
    r => [add('fe.static', { inputs: { Model: w(r[0].id, 'Model') } })],
    r => { ids.stat = r[0].id; return [add('fe.view', { inputs: { Result: w(ids.stat, 'Result') } }), { name: 'run_analysis', input: {} }, { name: 'get_results', input: {} }]; },
    () => ['Cantilever built. Values are from Nodal\'s solver.'],
  ]);
  await openAssistant(page);
  await say(page, 'Cantilever 3 m with 10 kN at the tip');
  await done(page);
  await expect(page.locator('.node')).toHaveCount(8); await expect(page.locator('.node.error')).toHaveCount(0);
  const c = log.results.find(x => x.results)!.results[0].result.cases[0];
  expect(rel(Math.abs(c.member_forces.My.min), 10 * 3)).toBeLessThan(TOL);                                  // PL = 30 kN·m, hogging
  expect(rel(c.max_displacement.value, 10e3 * 3 ** 3 / (3 * E * I300) * 1000)).toBeLessThan(TOL);          // PL³/3EI
  expect(rel(c.reactions[0].force[2], 10)).toBeLessThan(TOL);
  expect(errors).toEqual([]);
});

test('text: a portal frame with a side load is in equilibrium and matches the stiffness-method solution', async ({ page }) => {
  const errors = watch(page), ids: Record<string, string> = {};
  const log = await mockClaude(page, [
    () => [add('crv.polyline', { label: 'Frame axis', inputs: {} }), add('param.panel', { label: 'Corner points', settings: { text: '0, 0, 0\n0, 0, 4\n8, 0, 4\n8, 0, 0' } })],
    r => { expect(r[0].error ?? r[1].error).toBeUndefined(); [ids.pl, ids.pts] = r.map(x => x.id); return [{ name: 'describe_components', input: { types: ['crv.polyline', 'crv.explode'] } }]; },
    () => [{ name: 'connect', input: { from_id: ids.pts, output: 'Out', to_id: ids.pl, input: 'Vertices' } }],
    r => { if (r[0].error) throw new Error(r[0].error); return [add('crv.explode', { inputs: { Curve: w(ids.pl) } }), add('fe.sec.i'), add('fe.support', { label: 'Left base', inputs: { Point: '0, 0, 0', Conditions: 'fixed' } }), add('fe.support', { label: 'Right base', inputs: { Point: '8, 0, 0', Conditions: 'fixed' } }), add('fe.load.point', { label: 'Side load', inputs: { Point: '0, 0, 4', Force: '15, 0, 0' } })]; },
    r => { [ids.seg, ids.sec, ids.s1, ids.s2, ids.load] = r.map(x => x.id); return [add('fe.beam', { inputs: { Curve: w(ids.seg, 'Segments'), Section: w(ids.sec) } })]; },
    r => [add('fe.assemble', { inputs: { Elements: w(r[0].id), Supports: [w(ids.s1), w(ids.s2)], Loads: w(ids.load) } })],
    r => [add('fe.static', { inputs: { Model: w(r[0].id, 'Model') } })],
    r => [add('fe.view', { inputs: { Result: w(r[0].id, 'Result') }, settings: { diagram: 'My' } }), { name: 'arrange', input: {} }, { name: 'run_analysis', input: {} }, { name: 'get_results', input: {} }],
    () => ['Portal frame built: 8 m wide, 4 m high, fixed bases, 15 kN sideways at the left eave.'],
  ]);
  await openAssistant(page);
  await say(page, '2D portal frame, 8 m wide, 4 m high, fixed bases, 15 kN lateral load at the eave');
  await done(page);
  await expect(page.locator('.node.error')).toHaveCount(0);
  const run = log.results.find(x => x.status)!; expect(run.status, JSON.stringify(run.issues)).toBe('ok');
  const c = log.results.find(x => x.results)!.results[0].result.cases[0];
  // Equilibrium: the base shears carry the 15 kN, the vertical reactions form the couple for the rest of the overturning moment.
  const Fx = c.reactions.reduce((s: number, r: any) => s + r.force[0], 0), Fz = c.reactions.reduce((s: number, r: any) => s + r.force[2], 0);
  expect(rel(-Fx, 15)).toBeLessThan(TOL); expect(Math.abs(Fz)).toBeLessThan(1e-6);
  const Mbase = c.reactions.reduce((s: number, r: any) => s + r.moment[1], 0), couple = Math.abs(c.reactions[0].force[2]) * 8;
  expect(rel(Math.abs(Mbase) + couple, 15 * 4)).toBeLessThan(TOL);
  // Antisymmetric sway of a fixed-base portal (axial strain ignored): each base moment is (Ph/2)(3k+1)/(6k+1) with k = (I_b/L)/(I_c/h).
  const k = (1 / 8) / (1 / 4), hand = 15 * 4 / 2 * (3 * k + 1) / (6 * k + 1);
  for (const r of c.reactions) expect(rel(Math.abs(r.moment[1]), hand)).toBeLessThan(0.01);                   // 1 %: the model includes axial and shear strain
  expect(errors).toEqual([]);
});

test('image: a truss sketch is sent as an image and built from the tool calls', async ({ page }) => {
  const errors = watch(page), ids: Record<string, string> = {};
  const log = await mockClaude(page, [
    () => ['I read a triangular truss from the sketch: 6 m span, 3 m high, pin at the left, roller at the right, 20 kN down at the apex. ', add('crv.line', { inputs: { A: '0, 0, 0', B: '6, 0, 0' } }), add('crv.line', { inputs: { A: '0, 0, 0', B: '3, 0, 3' } }), add('crv.line', { inputs: { A: '3, 0, 3', B: '6, 0, 0' } }), add('fe.sec.tube')],
    r => { const [a, b, c, s] = r.map(x => x.id); return [add('fe.truss', { inputs: { Curve: [w(a), w(b), w(c)], Section: w(s) } }), add('fe.support', { inputs: { Point: '0, 0, 0', Conditions: 'ux uy uz' } }), add('fe.support', { inputs: { Point: '6, 0, 0', Conditions: 'uy uz' } }), add('fe.support', { label: 'Out of plane', inputs: { Point: '3, 0, 3', Conditions: 'uy' } }), add('fe.load.point', { inputs: { Point: '3, 0, 3', Force: '0, 0, -20' } })]; },
    r => { const [t, s1, s2, s3, l] = r.map(x => x.id); return [add('fe.assemble', { inputs: { Elements: w(t), Supports: [w(s1), w(s2), w(s3)], Loads: w(l) } })]; },
    r => [add('fe.static', { inputs: { Model: w(r[0].id, 'Model') } })],
    r => { ids.stat = r[0].id; return [add('fe.view', { inputs: { Result: w(ids.stat, 'Result') } }), { name: 'arrange', input: {} }, { name: 'run_analysis', input: {} }, { name: 'get_results', input: { id: ids.stat } }]; },
    () => ['Truss built from the sketch.'],
  ]);
  await openAssistant(page);
  // A 2000 × 1200 sketch, drawn in the page, is attached through the file input and scaled down before it is sent.
  const png = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 2000; c.height = 1200; const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, 2000, 1200); g.strokeStyle = '#222'; g.lineWidth = 8; g.beginPath(); g.moveTo(300, 900); g.lineTo(1700, 900); g.lineTo(1000, 300); g.closePath(); g.stroke(); return c.toDataURL('image/png').split(',')[1]; });
  await page.locator('.as-attach input[type="file"]').setInputFiles({ name: 'sketch.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.locator('.as-imgs.pending img')).toHaveCount(1);
  await say(page, 'Build this truss');
  await done(page);
  const first = log.requests[0].messages[0].content;
  expect(first[0].type).toBe('image'); expect(first[0].source.type).toBe('base64'); expect(first[0].source.media_type).toBe('image/png'); expect(first[1]).toEqual({ type: 'text', text: 'Build this truss' });
  const size = await page.evaluate(async (b64: string) => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); return [im.naturalWidth, im.naturalHeight]; }, first[0].source.data);
  expect(size).toEqual([1568, 941]);
  await expect(page.locator('.as-msg.user img')).toHaveCount(1);
  if (process.env.SHOTS) { await page.waitForTimeout(1200); await page.screenshot({ path: process.env.SHOTS + '/assistant-image.png' }); }
  await expect(page.locator('.as-msg .md')).toContainText('I read a triangular truss from the sketch');
  await expect(page.locator('.node.error')).toHaveCount(0);
  const run = log.results.find(x => x.status)!; expect(run.status, JSON.stringify(run.issues)).toBe('ok');
  const c = log.results.find(x => x.outputs?.Result)!.outputs.Result.cases[0];
  expect(rel(c.member_forces.N.min, -10 * Math.SQRT2)).toBeLessThan(TOL);     // rafters: -P/(2 sin 45°)
  expect(rel(c.member_forces.N.max, 10)).toBeLessThan(TOL);                   // tie: P/(2 tan 45°)
  expect(errors).toEqual([]);
});

test('an invalid tool call is reported and corrected, and model text cannot inject markup', async ({ page }) => {
  const errors = watch(page), ids: Record<string, string> = {};
  const log = await mockClaude(page, [
    () => [add('vec.point', { inputs: { X: 2 } }), add('crv.line')],
    r => { [ids.p, ids.l] = r.map(x => x.id); return [{ name: 'connect', input: { from_id: ids.p, output: 'Point', to_id: ids.l, input: 'Start' } }, add('fe.girder'), add('math.expr', { settings: { expr: 'fetch("https://example.com")' } })]; },
    r => { expect(r[0].error).toMatch(/no input called "Start"/); expect(r[1].error).toMatch(/Unknown component type/); expect(r[2].error).toMatch(/formula is not valid/); return [{ name: 'connect', input: { from_id: ids.p, output: 'Point', to_id: ids.l, input: 'B' } }]; },
    () => ['Fixed. <img src=x onerror="window.__pwned = 1"> <script>window.__pwned = 2</script> **done**'],
  ]);
  await openAssistant(page);
  await say(page, 'line to a point');
  await done(page);
  await expect(page.locator('.node')).toHaveCount(2);
  await expect(page.locator('.wire, path.wire')).not.toHaveCount(0);
  await expect(page.locator('.as-actions')).toContainText('3 corrected');
  await page.locator('.as-actions summary').click();
  await expect(page.locator('.as-actions div.bad')).toHaveCount(3);
  await expect(page.locator('.as-msg .md')).toContainText('<img src=x onerror="window.__pwned = 1">');
  expect(await page.locator('.as-msg .md img, .as-msg .md script').count()).toBe(0);
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  const err = log.requests[2].messages.at(-1).content[0]; expect(err.is_error).toBe(true);
  expect(errors).toEqual([]);
});

test('errors are explained plainly: a bad key, a rate limit that clears, and Stop', async ({ page }) => {
  const errors = watch(page);
  const log = await mockClaude(page, [
    () => ({ status: 401 }),
    () => ({ status: 429, headers: { 'retry-after': '1' } }),
    () => ['Back after the rate limit.'],
    () => 'hang',
  ]);
  await openAssistant(page);
  await say(page, 'one');
  await expect(page.locator('.as-error')).toContainText('did not accept the API key');
  await expect(page.locator('.as-error')).not.toContainText('sk-ant');
  await done(page);
  await say(page, 'two');
  await expect(page.locator('.as-list')).toContainText('Rate limit reached; trying again');
  await expect(page.locator('.as-msg .md').last()).toContainText('Back after the rate limit.', { timeout: 15_000 });
  await done(page);
  expect(log.requests.length).toBe(3);
  await say(page, 'three');
  await expect(page.locator('.as-input .stop')).toBeVisible();
  // The canvas stays usable while the assistant is working.
  await page.locator('.rb-tabs button[role="tab"]', { hasText: 'Params' }).click(); await page.locator('.rb-btn[aria-label="Panel"]').click();
  await expect(page.locator('.node')).toHaveCount(1);
  await page.locator('.as-input .stop').click();
  await expect(page.locator('.as-list')).toContainText('Stopped.');
  await done(page);
  // New chat clears the conversation; the side panel can be hidden and brought back.
  await page.locator('.as-head button', { hasText: 'New chat' }).click();
  await expect(page.locator('.as-msg')).toHaveCount(0);
  await page.locator('.side-hide').click();
  await expect(page.locator('.side')).toHaveCount(0); await expect(page.locator('.side-rail')).toBeVisible();
  await page.reload(); await ready(page);
  await expect(page.locator('.side')).toHaveCount(0);
  await page.locator('.side-rail button[aria-label="Show inspector"]').click();
  await expect(page.locator('.side .inspector')).toBeVisible();
  expect(errors.filter(e => !/401|429/.test(e))).toEqual([]);
});
