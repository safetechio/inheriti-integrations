import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const localRequire = createRequire(import.meta.url);
const playwrightRoot =
  process.env.PLAYWRIGHT_PACKAGE_ROOT ??
  resolve(appRoot, '../../../../business/inheriti-business-ui/node_modules/playwright');
const playwright = localRequire(playwrightRoot);
const base = process.env.IMPORTER_PERF_URL ?? 'http://127.0.0.1:6128/';
const samples = Number(process.env.IMPORTER_PERF_SAMPLES ?? 6);
const outputPath =
  process.env.IMPORTER_PERF_OUTPUT ?? join(tmpdir(), 'importer-list-performance.json');
const urls = {
  review: `${base}?story=review-bulk-interactions--large-synthetic-set&mode=preview`,
  grouping: `${base}?story=folder-grouping-interactions--full-flow-large-create-plans&mode=preview`,
  organization: `${base}?story=organisation-tree-performance--large-organisation-tree&mode=preview`,
};

const sleepToPaint = (page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
const median = (values) => {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const percentile = (values, p) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
};
const stats = (samplesMs) => ({
  medianMs: median(samplesMs),
  p95Ms: percentile(samplesMs, 0.95),
  samplesMs,
});

async function measured(page, action) {
  const start = await page.evaluate(() => performance.now());
  await action();
  await sleepToPaint(page);
  const end = await page.evaluate(() => performance.now());
  assert.ok(end >= start, 'performance.now() moved backwards');
  return end - start;
}

async function reload(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('body').waitFor();
  await page.locator('.asset-review-row, .plan-asset-row').first().waitFor();
  await sleepToPaint(page);
}

async function reviewLane(page) {
  const url = urls.review;
  const visibleRows = () => page.locator('.asset-review-row');
  const counts = {};
  await reload(page, url);
  const initial = await visibleRows().count();
  assert.equal(initial, 100, `review page should initially show 100 rows, got ${initial}`);
  const searchToggle = page.getByRole('button', { name: 'Search assets', exact: true });
  const searchInput = page.getByRole('textbox', { name: 'Search assets', exact: true });
  const tailName = 'Synthetic service 1499';
  const searchSamples = [];
  await searchToggle.click();
  await searchInput.waitFor();
  for (let index = 0; index < samples + 1; index++) {
    const elapsed = await measured(page, () => searchInput.pressSequentially('Synthetic'));
    assert.ok((await visibleRows().count()) > 0);
    if (index > 0) searchSamples.push(elapsed);
    await page.getByRole('button', { name: 'Clear asset search', exact: true }).click();
    await sleepToPaint(page);
    assert.equal(
      await visibleRows().count(),
      100,
      'clearing search did not restore the page limit',
    );
  }
  await searchInput.pressSequentially(tailName);
  await sleepToPaint(page);
  assert.equal(await visibleRows().filter({ hasText: tailName }).count(), 1);
  assert.equal(await visibleRows().count(), 1);
  await page.getByRole('button', { name: 'Clear asset search', exact: true }).click();
  await sleepToPaint(page);
  counts.search = stats(searchSamples);

  const checkboxSamples = [];
  const first = page.getByRole('checkbox', { name: 'Select Synthetic service 0', exact: true });
  for (let index = 0; index < samples + 1; index++) {
    const elapsed = await measured(page, () => first.click());
    assert.equal(await first.isChecked(), true);
    if (index > 0) checkboxSamples.push(elapsed);
    await page.getByText('1 selected', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await sleepToPaint(page);
  }
  counts.firstRowCheckbox = stats(checkboxSamples);

  await reload(page, url);
  await searchToggle.click();
  await searchInput.pressSequentially('Synthetic');
  await sleepToPaint(page);
  const matching = page.locator('.asset-review-row');
  assert.equal(await matching.count(), 100, 'review list should render its 100-row page limit');
  await matching.first().locator('xpath=..').getByRole('checkbox').click();
  await page
    .locator('.asset-review-queue')
    .press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await sleepToPaint(page);
  const selected = page.locator('.asset-review-row-frame.is-batch-selected');
  const reviewSelection = page.locator('.asset-review-selection');
  await reviewSelection.getByText(/\d+ selected/, { exact: false }).waitFor();
  const reviewSelectedCount = Number(
    (await reviewSelection.textContent()).match(/(\d+) selected/)[1],
  );
  assert.ok(reviewSelectedCount > 100, `Ctrl+A selected only ${reviewSelectedCount} review assets`);
  assert.equal(await selected.count(), 100, 'Ctrl+A did not select the rendered matching rows');
  await matching
    .nth(10)
    .locator('xpath=..')
    .getByRole('checkbox')
    .click({ modifiers: ['Shift'] });
  await sleepToPaint(page);
  await reviewSelection.getByText(`${reviewSelectedCount} selected`, { exact: true }).waitFor();
  await matching.nth(10).locator('xpath=..').getByRole('checkbox').click();
  await sleepToPaint(page);
  await reviewSelection.getByText(`${reviewSelectedCount - 1} selected`, { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await sleepToPaint(page);
  assert.equal(await selected.count(), 0, 'review clear did not clear selection');
  await page.getByRole('button', { name: 'Clear asset search', exact: true }).click();
  await sleepToPaint(page);
  assert.equal(await visibleRows().count(), 100);
  return { fixtureAssets: 1514, syntheticMatches: 1500, initialVisible: initial, counts };
}

async function groupingLane(page) {
  const url = urls.grouping;
  const visibleRows = () => page.locator('.plan-asset-row');
  await reload(page, url);
  const status = page.getByText(/\d+ assets · \d+ sources/).first();
  await status.waitFor();
  const statusText = await status.textContent();
  const assetCount = Number(statusText.match(/(\d+) assets/)?.[1]);
  assert.ok(assetCount > 2000, `grouping fixture count was not exposed: ${statusText}`);
  assert.equal(await visibleRows().count(), 100);
  const searchInput = page.getByRole('textbox', { name: 'Search unassigned assets', exact: true });
  const tailName = 'Synthetic credential 2099';
  const searchSamples = [];
  await searchInput.waitFor();
  for (let index = 0; index < samples + 1; index++) {
    const elapsed = await measured(page, () => searchInput.pressSequentially('Synthetic'));
    assert.ok((await visibleRows().count()) > 0);
    if (index > 0) searchSamples.push(elapsed);
    await page.getByRole('button', { name: 'Clear unassigned asset search', exact: true }).click();
    await sleepToPaint(page);
    assert.equal(await visibleRows().count(), 100);
  }
  await searchInput.pressSequentially(tailName);
  await sleepToPaint(page);
  assert.equal(await visibleRows().filter({ hasText: tailName }).count(), 1);
  assert.equal(await visibleRows().count(), 1);
  await page.getByRole('button', { name: 'Clear unassigned asset search', exact: true }).click();
  await sleepToPaint(page);
  const first = visibleRows().first().getByRole('checkbox');
  const checkboxSamples = [];
  for (let index = 0; index < samples + 1; index++) {
    const elapsed = await measured(page, () => first.click());
    assert.equal(await first.isChecked(), true);
    if (index > 0) checkboxSamples.push(elapsed);
    await page.getByText('1 selected', { exact: true }).waitFor();
    await page
      .locator('.plan-grouping-unassigned')
      .getByRole('button', { name: 'Clear', exact: true })
      .click();
    await sleepToPaint(page);
  }
  await searchInput.fill('Synthetic credential');
  await sleepToPaint(page);
  const matching = page.locator('.plan-asset-row');
  assert.equal(await matching.count(), 100);
  await matching.first().getByRole('checkbox').click();
  await page
    .locator('.plan-source-scroll')
    .press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await sleepToPaint(page);
  await page.getByText('2,100 selected', { exact: true }).waitFor();
  await matching
    .nth(10)
    .getByRole('checkbox')
    .click({ modifiers: ['Shift'] });
  await sleepToPaint(page);
  await page.getByText('2,100 selected', { exact: true }).waitFor();
  await matching.nth(10).getByRole('checkbox').click();
  await sleepToPaint(page);
  await page.getByText('2,099 selected', { exact: true }).waitFor();
  await page
    .locator('.plan-grouping-unassigned')
    .getByRole('button', { name: 'Clear', exact: true })
    .click();
  await sleepToPaint(page);
  await searchInput.fill('');
  await sleepToPaint(page);
  assert.equal(await visibleRows().count(), 100);
  return {
    fixtureAssets: assetCount,
    initialVisible: 100,
    counts: { search: stats(searchSamples), firstRowCheckbox: stats(checkboxSamples) },
  };
}

async function organizationLane(page) {
  await page.goto(urls.organization, { waitUntil: 'domcontentloaded' });
  const input = page.getByRole('textbox', { name: 'Search folders or plans', exact: true });
  const folders = page.locator('.folder-tree-row[role="treeitem"]:not([data-plan-row-id])');
  const plans = page.locator('[data-plan-row-id]');
  await input.waitFor();
  await sleepToPaint(page);
  assert.equal(await folders.count(), 100);
  const typing = [];
  const clearing = [];
  for (let index = 0; index < samples + 1; index++) {
    const searchMs = await measured(page, async () => {
      await input.pressSequentially('Bulk');
      await plans.nth(199).waitFor({ state: 'attached' });
    });
    assert.equal(await folders.count(), 300);
    assert.equal(await plans.count(), 200, 'matching folders must reveal their plans');
    const clearMs = await measured(page, async () => {
      await input.fill('');
      await plans.first().waitFor({ state: 'detached' });
    });
    assert.equal(await folders.count(), 100);
    assert.equal(await plans.count(), 0, 'clearing search must restore collapsed branches');
    if (index > 0) {
      typing.push(searchMs);
      clearing.push(clearMs);
    }
  }
  await input.fill('Service plan 99-1');
  await page.getByText('Service plan 99-1', { exact: true }).waitFor();
  await sleepToPaint(page);
  assert.equal(await plans.count(), 1);
  assert.equal(await folders.count(), 2, 'a nested plan must retain its ancestor path');
  return {
    fixtureFolders: 300,
    fixturePlans: 200,
    counts: { search: stats(typing), clear: stats(clearing) },
  };
}

const browser = await playwright.chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
page.setDefaultTimeout(20000);
let result;
try {
  result = {
    url: base,
    viewport: { width: 1440, height: 900 },
    review: await reviewLane(page),
    grouping: await groupingLane(page),
    organization: await organizationLane(page),
    generatedAt: new Date().toISOString(),
  };
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await context.close();
  await browser.close();
}
