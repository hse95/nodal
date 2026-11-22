import { test, expect, Page } from '@playwright/test';

/** Collects console errors and page errors so every test can assert a clean console. */
function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  return errors;
}
const ready = async (page: Page) => { await expect(page.locator('.status .ok')).toBeVisible({ timeout: 60_000 }); };

test('quick-start truss solves in the browser with a clean console', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/?example=quick-truss');
  await ready(page);
  await expect(page.locator('.node')).toHaveCount(23);
  await expect(page.locator('.node.error')).toHaveCount(0);
  // The panel shows the hand-calculated bar forces.
  const panel = page.locator('.node.w-panel pre');
  await expect(panel).toContainText('-7.07107');
  await expect(panel).toContainText('5');
  await expect(page.locator('.viewport canvas')).toBeVisible();
  // Changing the height slider changes the answer: h = 3 -> 6 gives a tie force of 2.5 kN.
  const height = page.locator('.node', { hasText: 'Height [m]' }).locator('input.num');
  await height.fill('6'); await height.press('Enter');
  await expect(panel).toContainText('2.5');
  expect(errors).toEqual([]);
});

test('components can be added by search, wired, undone and redone', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/?example=quick-truss');
  await ready(page);
  await page.evaluate(() => localStorage.setItem('nodal.noUnloadPrompt', '1'));
  await page.locator('.menu-btn', { hasText: 'File' }).click();
  page.once('dialog', d => d.accept());
  await page.locator('.menu-drop button', { hasText: 'New project' }).click();
  await expect(page.locator('.node')).toHaveCount(0);
  await expect(page.locator('.empty-state')).toBeVisible();
  const canvas = page.locator('.canvas');
  await canvas.dblclick({ position: { x: 200, y: 200 } });
  await page.locator('.popup.search input').fill('slider');
  await page.keyboard.press('Enter');
  await canvas.dblclick({ position: { x: 330, y: 420 } });
  await page.locator('.popup.search input').fill('negative');
  await page.keyboard.press('Enter');
  await expect(page.locator('.node')).toHaveCount(2);
  // Drag a wire from the slider output to the Negative input.
  const out = page.locator('.node', { hasText: 'Number Slider' }).locator('.port.out i'), inp = page.locator('.node', { hasText: 'Negative' }).locator('.port.in i');
  const a = (await out.boundingBox())!, b = (await inp.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, a.y + 30, { steps: 5 }); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('path.wire')).toHaveCount(1);
  await page.locator('.node', { hasText: 'Negative' }).locator('.hd').click();
  await expect(page.locator('.inspector')).toContainText('-5');
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect(page.locator('path.wire')).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(page.locator('path.wire')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('examples gallery opens a shell example and shows a contour legend', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/?example=quick-truss');
  await ready(page);
  await page.locator('.rb-tabs button[role="tab"]', { hasText: 'Examples' }).click();
  await page.locator('.rb-card.more').click();
  await expect(page.locator('.ex-card')).toHaveCount(38);
  await page.locator('.ex-card', { hasText: 'Hypar shell roof' }).click();
  await ready(page);
  await expect(page.locator('.node.error')).toHaveCount(0);
  await expect(page.locator('.v-legend')).toContainText('von Mises');
  expect(errors).toEqual([]);
});

test('verification panel runs every benchmark in the browser and all pass', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/?example=quick-truss');
  await ready(page);
  await page.locator('.rb-tabs button[role="tab"]', { hasText: 'Verification' }).click();
  await page.locator('.rb-body button', { hasText: 'Run all checks' }).click();
  await expect(page.locator('.bench')).toHaveCount(28, { timeout: 110_000 });
  await expect(page.locator('.pill.fail')).toHaveCount(0);
  await expect(page.locator('.dialog')).toContainText('28 of 28 benchmarks pass');
  await expect(page.locator('.conv-plot').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('themes, layouts and the tour work', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/');
  // First visit: the tour starts on an empty project and builds the truss step by step.
  await expect(page.locator('.tour')).toContainText('Welcome to Nodal');
  await page.locator('.tour button.primary').click();
  await expect(page.locator('.node')).toHaveCount(9);
  for (let i = 0; i < 4; i++) await page.locator('.tour button.primary').click();
  await expect(page.locator('.node')).toHaveCount(23);
  await ready(page);
  await page.locator('.tour button.primary').click();
  await expect(page.locator('.tour')).toHaveCount(0);
  await page.locator('button[aria-label="Toggle theme"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', /dark|light/);
  await page.locator('button[aria-label="Maximize 3D view"]').click();
  await expect(page.locator('.canvas')).toBeHidden();
  await page.locator('button[aria-label="Stacked"]').click();
  await expect(page.locator('.canvas')).toBeVisible();
  expect(errors).toEqual([]);
});
