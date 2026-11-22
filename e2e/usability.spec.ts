import { test, expect, Page } from '@playwright/test';

function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  return errors;
}
const ready = (page: Page) => expect(page.locator('.status .ok, .status .warn')).toBeVisible({ timeout: 60_000 });
const open = async (page: Page, example: string) => {
  await page.addInitScript(() => { localStorage.setItem('nodal.tourDone', '1'); localStorage.setItem('nodal.noUnloadPrompt', '1'); });
  await page.goto('/?example=' + example);
  await ready(page);
};
const newProject = async (page: Page) => {
  await page.locator('.menu-btn', { hasText: 'File' }).click();
  page.once('dialog', d => void d.accept());
  await page.locator('.menu-drop button', { hasText: 'New project' }).click();
  await expect(page.locator('.node')).toHaveCount(0);
};
/** A screen point on the visible part of a wire (the middle of its curve), found in the page. */
const wirePoint = (page: Page) => page.evaluate(() => {
  const c = document.querySelector('.canvas')!.getBoundingClientRect();
  for (const p of Array.from(document.querySelectorAll<SVGPathElement>('.wire-hit'))) {
    const q = p.getPointAtLength(p.getTotalLength() * 0.5), m = p.getScreenCTM()!, x = q.x * m.a + q.y * m.c + m.e, y = q.x * m.b + q.y * m.d + m.f;
    if (x > c.left + 20 && x < c.right - 20 && y > c.top + 20 && y < c.bottom - 20 && document.elementFromPoint(x, y) === p) return { x, y };
  }
  return null;
});

test('a plane model opens in the front view and each structure is drawn once', async ({ page }) => {
  const errors = watch(page);
  await open(page, 'bench-b05');
  // A beam lies in the X-Z plane, so the view starts square-on.
  await expect(page.locator('.v-toolbar .seg button.on').first()).toHaveText('Front');
  // The benchmark's model and raw result are not drawn under the Result View that shows them.
  await page.locator('.node', { hasText: 'Verification Model' }).locator('.hd').click();
  await expect(page.locator('.inspector')).toContainText('Not drawn on its own');
  await expect(page.locator('.inspector label.check', { hasText: 'Preview in 3D' }).locator('input')).not.toBeChecked();
  // Values are written next to the diagram; the largest is marked.
  await expect(page.locator('.v-label.strong').first()).toHaveText('-24');
  // The quick controls in the 3D view change the Result View.
  await page.locator('.v-results select[aria-label="Member diagram"]').selectOption('Vz');
  await expect(page.locator('.v-info')).toContainText('Shear force Vz');
  await expect(page.locator('.v-label.strong').first()).toHaveText(/^-?24$/);
  expect(errors).toEqual([]);
});

test('formulas are typeset in the benchmark table, the verification panel and expressions', async ({ page }) => {
  const errors = watch(page);
  await open(page, 'bench-b05');
  // The comparison panel is a table with one typeset formula per check.
  await expect(page.locator('.panel-table tbody tr')).toHaveCount(3);
  await expect(page.locator('.panel-table .katex').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.panel-table .katex .mfrac')).toHaveCount(3);
  // An Expression component shows its formula as a fraction.
  const cb = (await page.locator('.canvas').boundingBox())!;
  await page.locator('.canvas').dblclick({ position: { x: 150, y: cb.height - 60 } });
  await page.locator('.popup.search input').fill('expression'); await page.keyboard.press('Enter');
  const box = page.locator('.node.w-text input[type=text]').last();
  await box.fill('w*L^2/8'); await box.press('Enter');
  await expect(page.locator('.expr-tex .katex .mfrac')).toHaveCount(1);
  await box.fill('w*L^'); await box.press('Enter');
  await expect(page.locator('.expr-tex')).toContainText('not a valid formula');
  // The verification dialog has a formula column.
  await page.locator('.rb-tabs button[role="tab"]', { hasText: 'Verification' }).click();
  await page.locator('.rb-body button', { hasText: 'Run all checks' }).click();
  await expect(page.locator('.bench').first().locator('td.fx .katex').first()).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

test('templates and components come from the ribbon, by click and by dragging', async ({ page }) => {
  const errors = watch(page);
  await open(page, 'quick-truss');
  await newProject(page);
  await page.locator('.empty-state button', { hasText: 'Insert a simply supported beam' }).click();
  await ready(page);
  await expect(page.locator('.node')).toHaveCount(18);
  // wL^2/8 = 10 x 6^2 / 8 = 45 kN m
  await expect(page.locator('.node', { hasText: 'Largest moment' }).locator('pre')).toContainText('45');
  await expect(page.locator('.node.error')).toHaveCount(0);
  // A second template is added below the first from the Templates tab.
  await page.locator('.rb-tabs button[role="tab"]', { hasText: 'Templates' }).click();
  await expect(page.locator('.rb-card svg.thumb').first()).toBeVisible();          // every template has a thumbnail
  await page.locator('.rb-card', { hasText: 'Cantilever beam' }).click();
  await ready(page);
  await expect(page.locator('.node')).toHaveCount(18 + 16);
  await expect(page.locator('.node', { hasText: 'Fixed-end moment' }).locator('pre')).toContainText('-30');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.node')).toHaveCount(18);
  // A template is dragged from the ribbon to a chosen place; its thumbnail follows the pointer.
  const card = page.locator('.rb-card', { hasText: 'Portal frame' }), kb = (await card.boundingBox())!, cb = (await page.locator('.canvas').boundingBox())!;
  await page.mouse.move(kb.x + 30, kb.y + 20); await page.mouse.down();
  await page.mouse.move(cb.x + 200, cb.y + cb.height - 150, { steps: 8 });
  await expect(page.locator('.drag-tag.with-thumb svg')).toBeVisible();
  await page.mouse.up();
  await ready(page);
  await expect(page.locator('.node')).toHaveCount(18 + 26);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.node')).toHaveCount(18);
  // A single component is dragged from its icon in the ribbon.
  await page.locator('.rb-tabs button[role="tab"]', { hasText: 'Params' }).click();
  const item = page.locator('.rb-btn[aria-label="Number Slider"]'), ib = (await item.boundingBox())!;
  await page.mouse.move(ib.x + 12, ib.y + 12); await page.mouse.down();
  await page.mouse.move(cb.x + 120, cb.y + cb.height - 120, { steps: 8 });
  await expect(page.locator('.drag-tag')).toHaveText('Number Slider');
  await page.mouse.up();
  await expect(page.locator('.node')).toHaveCount(19);
  await expect(page.locator('.drag-tag')).toHaveCount(0);
  // A click on an icon adds the component too, and every node shows its icon.
  await page.locator('.rb-btn[aria-label="Panel"]').click();
  await expect(page.locator('.node')).toHaveCount(20);
  await expect(page.locator('.node .hd svg.ico')).toHaveCount(20);
  expect(errors).toEqual([]);
});

test('a wire can be deleted from its right-click menu, and a wire dropped on empty canvas offers what fits', async ({ page }) => {
  const errors = watch(page);
  await open(page, 'quick-truss');
  await page.locator('.canvas').click({ position: { x: 6, y: 6 } });
  await page.keyboard.press('f');                       // see the whole graph
  const before = await page.locator('.wire-hit').count();
  const pt = (await wirePoint(page))!;
  expect(pt).not.toBeNull();
  await page.mouse.click(pt.x, pt.y, { button: 'right' });
  await page.locator('.popup.menu button', { hasText: 'Delete wire' }).click();
  await expect(page.locator('.wire-hit')).toHaveCount(before - 1);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.wire-hit')).toHaveCount(before);
  // Drag from the result output of the analysis and let go on empty canvas.
  const port = page.locator('.node', { hasText: 'Linear Static' }).locator('.port.out').first(), pb = (await port.boundingBox())!, cb = (await page.locator('.canvas').boundingBox())!;
  await page.mouse.move(pb.x + pb.width - 3, pb.y + pb.height / 2); await page.mouse.down();
  await page.mouse.move(cb.x + 80, cb.y + cb.height - 60, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('.popup.search input')).toHaveAttribute('placeholder', /Connect result data/);
  await expect(page.locator('.popup.search .result').first()).toContainText('Result View');
  await page.locator('.popup.search input').fill('reactions'); await page.keyboard.press('Enter');
  await expect(page.locator('.wire-hit')).toHaveCount(before + 1);
  await ready(page);
  await expect(page.locator('.node', { hasText: 'Reactions' })).toHaveClass(/ok/);
  expect(errors).toEqual([]);
});

test('the text size can be changed and is remembered', async ({ page }) => {
  const errors = watch(page);
  await open(page, 'quick-truss');
  const size = () => page.evaluate(() => ({ ui: parseFloat(getComputedStyle(document.querySelector('.menu-btn')!).fontSize), ts: getComputedStyle(document.documentElement).getPropertyValue('--ts').trim(), node: document.querySelector('.node .hd .nm')!.getBoundingClientRect().height }));
  const a = await size();
  await page.locator('button[aria-label="Larger text"]').click();
  await page.locator('button[aria-label="Larger text"]').click();
  const b = await size();
  expect(b.ts).toBe('1.3');
  expect(b.ui).toBeCloseTo(a.ui * 1.3, 1);
  expect(b.node).toBeGreaterThan(a.node * 1.2);          // canvas components grow as well
  await page.reload();
  await ready(page);
  expect((await size()).ts).toBe('1.3');
  await page.locator('.menu-btn', { hasText: 'View' }).click();
  await page.locator('.menu-drop button', { hasText: 'Normal' }).click();
  expect((await size()).ts).toBe('1');
  expect(errors).toEqual([]);
});

test('the ribbon has every component under its tab, can be searched and can be hidden', async ({ page }) => {
  const errors = watch(page);
  await open(page, 'quick-truss');
  const tab = (name: string) => page.locator('.rb-tabs button[role="tab"]', { hasText: name });
  let total = 0;
  for (const name of ['Params', 'Math', 'Lists', 'Trees', 'Vector', 'Curve', 'Surface', 'Mesh', 'Transform', 'Display', 'Structure', 'Tools']) {
    await tab(name).click();
    const n = await page.locator('.rb-body .rb-btn').count();
    expect(n, name).toBeGreaterThan(3);
    expect(await page.locator('.rb-body .rb-btn svg.ico').count()).toBe(n);
    total += n;
  }
  expect(total).toBe(254);                               // 255 components, less the Cluster itself (made from a selection)
  // Hovering explains a component.
  await tab('Structure').click();
  await page.locator('.rb-btn[aria-label="Beam"]').hover();
  await expect(page.locator('.rb-tip')).toContainText('Beam');
  // Search across all tabs.
  await page.locator('.rb-search').fill('buckl');
  await expect(page.locator('.rb-body .rb-btn.wide').first()).toContainText('Buckling Analysis');
  await page.locator('.rb-search').fill('');
  // Hide and show.
  await page.locator('.rb-toggle').click();
  await expect(page.locator('.rb-body')).toHaveCount(0);
  await page.reload(); await ready(page);
  await expect(page.locator('.rb-body')).toHaveCount(0);  // remembered
  await tab('Curve').click();
  await expect(page.locator('.rb-btn[aria-label="Line"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a verification model opens built from ordinary components and still passes its checks', async ({ page }) => {
  const errors = watch(page);
  await open(page, 'quick-truss');
  await page.locator('.rb-tabs button[role="tab"]', { hasText: 'Verification' }).click();
  await page.locator('.rb-body button', { hasText: 'As components' }).click();
  await page.locator('.rb-card[aria-label^="B05"]').click();
  await ready(page);
  await expect(page.locator('.node', { hasText: 'Verification Model' })).toHaveCount(0);
  for (const name of ['Member axes', 'Beam', 'Section: Test section', 'Custom Material', 'Support: fixed', 'Line Load', 'Assemble Model', 'Linear Static', 'Verification Check']) await expect(page.locator('.node .hd', { hasText: name }).first()).toBeVisible();
  await expect(page.locator('.panel-table tbody tr')).toHaveCount(3);
  await expect(page.locator('.panel-table b').first()).toContainText('pass');
  await expect(page.locator('.node.error')).toHaveCount(0);
  // The other way of opening is still there.
  await page.locator('.rb-body button', { hasText: 'One component' }).click();
  await page.locator('.rb-card[aria-label^="B01"]').click();
  await ready(page);
  await expect(page.locator('.node', { hasText: 'Verification Model' })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('the 3D view fits on request and offers the display styles', async ({ page }) => {
  const errors = watch(page);
  await open(page, 'portal-building');
  await expect(page.locator('.v-toolbar select[aria-label="Display mode"]')).toHaveValue('shaded');
  for (const mode of ['lines', 'wireframe', 'ghosted', 'shaded']) await page.locator('.v-toolbar select[aria-label="Display mode"]').selectOption(mode);
  await page.locator('.v-toolbar button.fit').click();
  await page.locator('.viewport').press('f');
  const auto = page.locator('.v-toolbar button', { hasText: 'Auto' });
  await expect(auto).toHaveAttribute('aria-pressed', 'true');
  await auto.click();
  await expect(auto).toHaveAttribute('aria-pressed', 'false');
  await auto.click();
  expect(errors).toEqual([]);
});
