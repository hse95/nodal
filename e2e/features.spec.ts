import { test, expect, Page } from '@playwright/test';
import { readFileSync, statSync } from 'node:fs';

function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  return errors;
}
const open = async (page: Page, example: string) => {
  await page.addInitScript(() => { localStorage.setItem('nodal.tourDone', '1'); localStorage.setItem('nodal.noUnloadPrompt', '1'); });
  await page.goto('/?example=' + example);
  await expect(page.locator('.status .ok, .status .warn')).toBeVisible({ timeout: 60_000 });
};

test('every gallery example that is not a benchmark opens without component errors', async ({ page }) => {
  const errors = watch(page);
  for (const id of ['truss-bridge', 'portal-building', 'space-truss', 'gridshell', 'cable-net', 'hypar-shell', 'tower', 'sizing', 'evolve-beam', 'bench-b17', 'bench-b21', 'bench-b24']) {
    await open(page, id);
    await expect(page.locator('.node.error'), id).toHaveCount(0);
    await expect(page.locator('.viewport canvas'), id).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('the script component runs in its sandbox and cannot reach the network', async ({ page }) => {
  const errors = watch(page);
  await open(page, 'space-truss');
  await expect(page.locator('.node', { hasText: 'Largest displacement' }).locator('pre')).toContainText('28.68');
  // A script that tries to use fetch must fail inside the sandbox, as a component error (not a page error).
  await page.locator('.node', { hasText: 'Grid generator' }).locator('.hd').click();
  const code = page.locator('.inspector textarea.code');
  await code.fill('bottom = [typeof fetch, typeof XMLHttpRequest, typeof importScripts].join(","); top = []; web = []; topNodes = []; corners = [];');
  await code.blur();
  await page.locator('.canvas').dblclick({ position: { x: 300, y: 560 } });
  await page.locator('.popup.search input').fill('panel'); await page.keyboard.press('Enter');
  await expect(page.locator('.inspector')).toContainText('Panel');
  // Read the script output through the inspector summary of the script node.
  await page.locator('.node', { hasText: 'Grid generator' }).locator('.hd').click();
  await expect(page.locator('.inspector')).toContainText('undefined,undefined,undefined');
  expect(errors).toEqual([]);
});

test('the evolutionary optimizer drives the sliders and improves the fitness', async ({ page }) => {
  const errors = watch(page);
  await open(page, 'evolve-beam');
  await page.locator('.node', { hasText: 'Evolutionary Optimizer' }).locator('.hd').click();
  const field = (label: string) => page.locator('.inspector label.field', { hasText: label }).locator('input');
  await field('Population').fill('10'); await field('Population').blur();
  await field('Generations').fill('6'); await field('Generations').blur();
  await page.locator('.inspector button', { hasText: 'Run optimization' }).click();
  await expect(page.locator('.inspector')).toContainText(/Finished: best/, { timeout: 90_000 });
  await expect(page.locator('.inspector table.grid tbody tr').first()).toBeVisible();
  // The weight panel must now show less than the 3600 kg starting design.
  const weight = Number((await page.locator('.node', { hasText: 'Weight [kg]' }).locator('pre').innerText()).trim().split(/\s+/).pop());
  expect(weight).toBeLessThan(1500);
  expect(errors).toEqual([]);
});

test('geometry exports produce files and an exported STL can be imported again', async ({ page }, info) => {
  const errors = watch(page);
  await open(page, 'hypar-shell');
  // Turn the surface preview on so that there is plain geometry to export.
  await page.locator('.node', { hasText: '4Point Surface' }).locator('.hd').click();
  await page.locator('.inspector label.check', { hasText: 'Preview in 3D' }).locator('input').check();
  const save = async (label: string) => {
    await page.locator('.menu-btn', { hasText: 'File' }).click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.menu-drop button', { hasText: label }).click()]);
    const path = info.outputPath(dl.suggestedFilename());
    await dl.saveAs(path);
    return path;
  };
  const stl = await save('STL (meshes)');
  expect(statSync(stl).size).toBe(84 + 50 * 2 * 24 * 24);          // 24 x 24 quads -> 1152 triangles
  for (const [label, min] of [['OBJ', 2000], ['glTF', 2000], ['DXF', 2000], ['3DM', 1000], ['Canvas as SVG', 2000]] as [string, number][]) expect(statSync(await save(label)).size, label).toBeGreaterThan(min);
  expect(readFileSync(await save('OBJ'), 'utf8')).toContain('\nf ');
  // Import the STL back as a Geometry From File component.
  await page.locator('.menu-btn', { hasText: 'File' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.menu-drop button', { hasText: 'Import geometry' }).click()]);
  await chooser.setFiles(stl);
  await expect(page.locator('.toast')).toContainText('Imported 1 object');
  await expect(page.locator('.node', { hasText: 'nodal.stl' })).toHaveCount(1);
  // 3DM goes through the rhino3dm WebAssembly module: export, then read the same file back.
  const tdm = await save('3DM');
  await page.locator('.menu-btn', { hasText: 'File' }).click();
  const [chooser2] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.menu-drop button', { hasText: 'Import geometry' }).click()]);
  await chooser2.setFiles(tdm);
  await expect(page.locator('.node', { hasText: 'nodal.3dm' })).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator('.node.error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('solid booleans run through the Manifold WebAssembly module in the browser', async ({ page }) => {
  const errors = watch(page);
  await open(page, 'quick-truss');
  const project = { format: 'nodal', schema: 1, name: 'Boolean', units: 'SI', clusters: {}, graph: { groups: [], nodes: [
    { id: 'box', type: 'solid.box', x: 40, y: 40, state: {}, consts: { X: 2, Y: 2, Z: 2 } }, { id: 'sph', type: 'solid.sphere', x: 40, y: 200, state: {}, consts: { Center: '2, 2, 2', Radius: 1.2 } },
    { id: 'dif', type: 'solid.difference', x: 300, y: 100, state: {}, consts: {} }, { id: 'av', type: 'solid.props', x: 520, y: 100, state: {}, consts: {} }, { id: 'pan', type: 'param.panel', x: 740, y: 100, state: { text: '' }, consts: {} }],
    wires: [{ id: 'w1', from: 'box', out: 0, to: 'dif', inp: 0 }, { id: 'w2', from: 'sph', out: 0, to: 'dif', inp: 1 }, { id: 'w3', from: 'dif', out: 0, to: 'av', inp: 0 }, { id: 'w4', from: 'av', out: 1, to: 'pan', inp: 0 }] } };
  await page.locator('.menu-btn', { hasText: 'File' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.menu-drop button', { hasText: 'Open…' }).click()]);
  await chooser.setFiles({ name: 'boolean.nodal', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.locator('.node')).toHaveCount(5);
  await expect(page.locator('.status .ok')).toBeVisible({ timeout: 30_000 });
  // Box volume 8 minus one eighth of a sphere of radius 1.2 (faceted, so slightly less is removed): about 7.12.
  const vol = Number((await page.locator('.node.w-panel pre').innerText()).trim().split(/\s+/).pop());
  expect(vol).toBeGreaterThan(7.09); expect(vol).toBeLessThan(7.14);
  expect(errors).toEqual([]);
});

test('a selection can be turned into a cluster that still computes', async ({ page }) => {
  const errors = watch(page);
  await open(page, 'quick-truss');
  const panel = page.locator('.node.w-panel pre');
  await expect(panel).toContainText('-7.07107');
  // Select the three line components and cluster them.
  const lines = page.locator('.node', { hasText: /^Line/ });
  await lines.nth(0).locator('.hd').click();
  await lines.nth(1).locator('.hd').click({ modifiers: ['Shift'] });
  await lines.nth(2).locator('.hd').click({ modifiers: ['Shift'] });
  await lines.nth(0).locator('.hd').click({ button: 'right' });
  await page.locator('.popup.menu button', { hasText: 'Make cluster' }).click();
  await expect(page.locator('.node', { hasText: 'Cluster' })).toHaveCount(1);
  await expect(page.locator('.node')).toHaveCount(21);
  await expect(page.locator('.status .ok')).toBeVisible();
  await expect(panel).toContainText('-7.07107');
  await page.locator('.canvas').focus();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.node')).toHaveCount(23);
  expect(errors).toEqual([]);
});

test('canvas stays responsive with 500 components', async ({ page }) => {
  const errors = watch(page);
  await open(page, 'quick-truss');
  // Build a 500-component project (chains of arithmetic fed by sliders) and load it through the normal file path.
  const project = await page.evaluate(() => {
    const nodes: any[] = [], wires: any[] = [];
    for (let r = 0; r < 25; r++) {
      nodes.push({ id: `s${r}`, type: 'param.slider', x: 0, y: r * 70, state: { min: 0, max: 10, step: 0.1, value: r % 10, integer: false }, consts: {} });
      for (let c = 0; c < 19; c++) { nodes.push({ id: `a${r}_${c}`, type: 'math.add', x: 260 + c * 190, y: r * 70, state: {}, consts: { B: 1 } }); wires.push({ id: `w${r}_${c}`, from: c === 0 ? `s${r}` : `a${r}_${c - 1}`, out: 0, to: `a${r}_${c}`, inp: 0 }); }
    }
    return { format: 'nodal', schema: 1, name: 'Stress test', units: 'SI', graph: { nodes, wires, groups: [] }, clusters: {} };
  });
  await page.locator('.menu-btn', { hasText: 'File' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.menu-drop button', { hasText: 'Open…' }).click()]);
  await chooser.setFiles({ name: 'stress.nodal', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.locator('.node')).toHaveCount(500);
  await expect(page.locator('.status .ok')).toBeVisible({ timeout: 30_000 });
  // Measure frame times while panning and while dragging a slider that sits at the head of a 19-component chain.
  const fps = await page.evaluate(async () => {
    const canvas = document.querySelector('.canvas') as HTMLElement, r = canvas.getBoundingClientRect();
    const frames: number[] = []; let last = performance.now(), run = true;
    const tick = (t: number) => { frames.push(t - last); last = t; if (run) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const ev = (type: string, x: number, y: number, button = 1) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button, buttons: 4 }));
    ev('pointerdown', r.left + 300, r.top + 300);
    for (let i = 0; i < 90; i++) { window.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + 300 + i * 3, clientY: r.top + 300 + i * 2 })); await new Promise(res => requestAnimationFrame(res)); }
    window.dispatchEvent(new PointerEvent('pointerup', {}));
    run = false;
    const steady = frames.slice(5).sort((a, b) => a - b);
    return { median: 1000 / steady[Math.floor(steady.length / 2)], p95: 1000 / steady[Math.floor(steady.length * 0.95)] };
  });
  console.log(`CANVAS_FPS 500 components while panning: median ${fps.median.toFixed(0)} fps, 95th percentile frame ${fps.p95.toFixed(0)} fps`);
  expect(fps.median).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});
