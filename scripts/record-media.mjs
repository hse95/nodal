// Records the screenshots and animations used in the README from the running app.
// Usage: npm run build && npx vite preview --port 4173 &   then   node scripts/record-media.mjs
// Needs Chrome (through Playwright's "chrome" channel) and ffmpeg on the PATH.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '../docs/media'), tmp = '/tmp/nodal-frames';
const only = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });

async function open(example, { dark = false, w = 1280, h = 760, palette = false } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.addInitScript((d) => { localStorage.setItem('nodal.tourDone', '1'); localStorage.setItem('nodal.theme', d ? 'dark' : 'light'); }, dark);
  await page.goto('http://localhost:4173/?example=' + example);
  await page.waitForSelector('.status .ok, .status .warn', { timeout: 60000 });
  if (!palette) { await page.locator('.rb-toggle').click(); }
  await page.waitForTimeout(700);
  return page;
}
const settle = async (page, ms = 260) => { await page.waitForSelector('.status .ok, .status .warn', { timeout: 60000 }); await page.waitForTimeout(ms); };
async function setSlider(page, label, value) {
  const inp = page.locator('.node', { hasText: label }).first().locator('input.num');
  await inp.fill(String(value)); await inp.press('Enter');
  await settle(page);
}
function gif(name, frames, fps = 7, width = 960) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(tmp, name, 'f%03d.png'), '-vf', `scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, join(out, name + '.gif')]);
  console.log(name + '.gif', frames, 'frames');
}
async function record(name, page, steps, opt = {}) {
  if (only.length && !only.includes(name)) { await page.close(); return; }
  rmSync(join(tmp, name), { recursive: true, force: true }); mkdirSync(join(tmp, name), { recursive: true });
  let i = 0;
  const shot = async (n = 1) => { for (let k = 0; k < n; k++) await page.screenshot({ path: join(tmp, name, `f${String(i++).padStart(3, '0')}.png`) }); };
  await shot(4);
  await steps(shot);
  await shot(5);
  gif(name, i, opt.fps ?? 7, opt.width ?? 960);
  await page.close();
}
const ramp = (a, b, n) => Array.from({ length: n }, (_, k) => +(a + (b - a) * (k + 1) / n).toFixed(3));
const want = (n) => !only.length || only.includes(n);

if (want('hero')) { const p = await open('portal-building', { w: 1440, h: 860, palette: true }); await p.screenshot({ path: join(out, 'hero.png') }); await p.close(); console.log('hero.png'); }
if (want('dark')) { const p = await open('cable-net', { dark: true, w: 1280, h: 760 }); await p.screenshot({ path: join(out, 'dark.png') }); await p.close(); console.log('dark.png'); }
if (want('verification')) {
  const p = await open('quick-truss', { w: 1280, h: 860 });
  await p.locator('.rb-tabs button[role="tab"]', { hasText: 'Verification' }).click(); await p.locator('.rb-body button', { hasText: 'Run all checks' }).click();
  await p.waitForFunction(() => document.querySelectorAll('.bench').length === 28, null, { timeout: 120000 });
  await p.waitForTimeout(300); await p.screenshot({ path: join(out, 'verification.png') }); await p.close(); console.log('verification.png');
}
if (want('beam')) { const p = await open('bench-b05', { w: 1440, h: 800, palette: true }); await p.waitForSelector('.panel-table .katex'); await p.waitForTimeout(400); await p.screenshot({ path: join(out, 'beam.png') }); await p.close(); console.log('beam.png'); }
if (want('components')) {
  // A verification model opened as ordinary components.
  const p = await open('quick-truss', { w: 1440, h: 820, palette: true });
  await p.locator('.rb-tabs button[role="tab"]', { hasText: 'Verification' }).click();
  await p.locator('.rb-body button', { hasText: 'As components' }).click();
  await p.locator('.rb-card[aria-label^="B13"]').click(); await settle(p, 1500);
  await p.locator('.canvas').click({ position: { x: 300, y: 560 } }); await p.keyboard.press('f'); await p.waitForTimeout(500);
  await p.screenshot({ path: join(out, 'components.png') }); await p.close(); console.log('components.png');
}
await record('templates', await open('quick-truss', { palette: true }), async (shot) => {
  const page = browser.contexts().at(-1).pages().at(-1);
  // Start an empty project, then drop two templates from the Templates tab and move a slider.
  await page.evaluate(() => localStorage.setItem('nodal.noUnloadPrompt', '1'));
  await page.locator('.menu-btn', { hasText: 'File' }).click(); page.once('dialog', d => d.accept()); await page.locator('.menu-drop button', { hasText: 'New project' }).click();
  await page.locator('.rb-tabs button[role="tab"]', { hasText: 'Templates' }).click(); await page.waitForTimeout(300); await shot(5);
  await page.locator('.rb-card', { hasText: 'Simply supported beam' }).click(); await settle(page, 900); await shot(8);
  for (const L of ramp(6, 10, 8)) { await setSlider(page, 'Span [m]', L); await shot(); }
  for (const w of ramp(10, 25, 6)) { await setSlider(page, 'Load [kN/m]', w); await shot(); }
  await shot(4);
  await page.locator('.menu-btn', { hasText: 'File' }).click(); page.once('dialog', d => d.accept()); await page.locator('.menu-drop button', { hasText: 'New project' }).click();
  await page.locator('.rb-card', { hasText: 'Portal frame' }).click(); await settle(page, 900); await shot(8);
  for (const F of ramp(20, 80, 8)) { await setSlider(page, 'Side load [kN]', F); await shot(); }
});
await record('truss', await open('quick-truss'), async (shot) => {
  for (const hgt of [...ramp(3, 6, 9), ...ramp(6, 1.5, 12), ...ramp(1.5, 3, 5)]) { await setSlider(page(), 'Height [m]', hgt); await shot(); }
  function page() { return browser.contexts().at(-1).pages().at(-1); }
});
await record('bridge', await open('truss-bridge'), async (shot) => {
  const page = browser.contexts().at(-1).pages().at(-1);
  for (const n of [9, 10, 11, 12]) { await setSlider(page, 'Panels', n); await shot(2); }
  for (const d of ramp(3, 5.5, 8)) { await setSlider(page, 'Depth [m]', d); await shot(); }
  for (const n of [10, 8]) { await setSlider(page, 'Panels', n); await shot(2); }
  for (const d of ramp(5.5, 3, 6)) { await setSlider(page, 'Depth [m]', d); await shot(); }
});
await record('shell', await open('hypar-shell'), async (shot) => {
  const page = browser.contexts().at(-1).pages().at(-1);
  for (const r of [...ramp(3, 6, 8), ...ramp(6, 0.5, 12), ...ramp(0.5, 3, 6)]) { await setSlider(page, 'Corner rise [m]', r); await shot(); }
});
await record('gridshell', await open('gridshell'), async (shot) => {
  const page = browser.contexts().at(-1).pages().at(-1);
  for (const s of [...ramp(1.08, 1.0, 5), ...ramp(1.0, 1.22, 11), ...ramp(1.22, 1.08, 6)]) { await setSlider(page, 'Slack factor', s); await shot(); }
});
await record('modes', await open('tower'), async (shot) => {
  const page = browser.contexts().at(-1).pages().at(-1);
  // Show the modal view instead of the static one, and animate it.
  await page.locator('.node', { hasText: 'Static view' }).locator('.hd').click(); await page.locator('.inspector label.check', { hasText: 'Preview in 3D' }).locator('input').uncheck();
  await page.locator('.node', { hasText: 'Modal view' }).locator('.hd').click(); await page.locator('.inspector label.check', { hasText: 'Preview in 3D' }).locator('input').check();
  await page.locator('.inspector label.check', { hasText: 'Animate' }).locator('input').check();
  await page.waitForTimeout(500);
  for (let k = 0; k < 30; k++) { await shot(); await page.waitForTimeout(70); }
  await page.locator('.inspector label.field', { hasText: 'Mode' }).locator('select').selectOption('2');
  for (let k = 0; k < 26; k++) { await shot(); await page.waitForTimeout(70); }
}, { fps: 10 });
await record('optimize', await open('evolve-beam'), async (shot) => {
  const page = browser.contexts().at(-1).pages().at(-1);
  await page.locator('.node', { hasText: 'Evolutionary Optimizer' }).locator('.hd').click();
  await page.locator('.inspector button', { hasText: 'Run optimization' }).click();
  for (let k = 0; k < 60; k++) { await shot(); await page.waitForTimeout(140); if (await page.locator('.inspector', { hasText: /Finished: best/ }).count()) break; }
  await shot(6);
}, { fps: 8 });
await browser.close();
