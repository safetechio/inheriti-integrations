// Run with the local Importer renderer and Business harness using real SafeID sign-in.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate } from '../../scripts/review-local.mjs';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../../../../../business/inheriti-business-ui/package.json', import.meta.url));
const { _electron } = require('playwright');
const apiOrigin = 'http://business.localhost:3400';
const localConfig = Object.fromEntries(
  (await readFile(join(appRoot, '.env.local'), 'utf8'))
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(INHERITI_API_ORIGIN|SAFEID_URL|SAFEID_REALM)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]),
);
assert.equal(localConfig.INHERITI_API_ORIGIN, apiOrigin);
assert.ok(localConfig.SAFEID_URL && localConfig.SAFEID_REALM);
for (const url of ['http://127.0.0.1:5173', apiOrigin + '/health-check']) {
  assert.ok((await fetch(url, { signal: AbortSignal.timeout(5000) })).ok, 'Start the local Importer and Business harness.');
}

const output = await mkdtemp(join(tmpdir(), 'importer-step3-native-'));
const profile = await mkdtemp(join(tmpdir(), 'importer-step3-profile-'));
const summary = {
  lane: 'authenticated local Electron',
  sources: [],
  checks: [],
  counts: [],
  diagnostics: [],
  blockedWriteRequests: null,
};
const total = 14;
let app;
let page;
let guarded = false;
let step = 'prepare native sources';
const btn = (name, scope = page) => scope.getByRole('button', { name, exact: typeof name === 'string' });
const txt = (value, scope = page) => scope.getByText(value, { exact: typeof value === 'string' });
const dialog = (name) => page.getByRole('dialog', { name, exact: typeof name === 'string' });
const left = () => page.locator('.plan-grouping-unassigned');
const right = () => page.getByRole('tree', { name: 'Organisation folders' });
const plan = (name) => right().locator('[data-plan-row-id]').filter({ has: btn(name) });
const box = (name, scope = left()) => scope.getByRole('checkbox', { name: `Select ${name}`, exact: true });
const asset = (name) => left().locator('[data-marquee-asset-id]').filter({ has: box(name, page) });
const assigned = (name, planName) => plan(planName)
  .locator('+ .folder-plan-assets')
  .locator('[data-assigned-asset-id]')
  .filter({ has: box(name, page) });
const status = (name) => btn(new RegExp(`^${name} · \\d+$`), left());
const next = () => btn('Continue');

async function check(label, body) {
  step = label;
  await body();
  summary.checks.push(label);
  console.log(`PASS ${label}`);
}

async function progress(expected) {
  const wanted = { All: total, Assigned: expected, Unassigned: total - expected };
  const counts = {};
  for (const [label, count] of Object.entries(wanted)) {
    await btn(`${label} · ${count}`, left()).waitFor();
    counts[label] = Number((await status(label).innerText()).split('·')[1]);
  }
  assert.equal(counts.Assigned + counts.Unassigned, counts.All);
  await txt(new RegExp(`^${expected} of ${total} ${total === 1 ? 'asset' : 'assets'} assigned`)).waitFor();
  const meter = page.getByRole('progressbar', { name: 'Asset assignment progress' });
  const percent = await meter.locator(':scope > *').evaluate((bar) => Number.parseFloat(bar.style.width));
  assert.ok(Math.abs(percent - 100 * expected / total) < 0.01);
  assert.ok(await txt('Step 3 of 4').isVisible());
  assert.ok(await txt('Draft plan creation').isVisible());
  if (counts.Unassigned) assert.equal(await next().isEnabled(), false);
  summary.counts.push({ check: step, ...counts, percent });
}

async function selectAll(count) {
  await btn('Select all', left()).click();
  assert.equal(await left().locator('input[type=checkbox]:checked').count(), count);
  await btn('Clear', left()).click();
}

async function menu(name, action, scope = plan(name)) {
  await btn(`Actions for ${name}`, scope).click();
  await btn(action, page.locator('.folder-menu-popover')).click();
}

async function expand(name) {
  const control = btn(`Expand ${name}`, plan(name));
  if (await control.count()) await control.click();
}

async function newPlan(assetName, name, key) {
  await box(assetName).click();
  await btn('New plan', left()).click();
  const field = page.getByRole('textbox', { name: 'Plan name', exact: true });
  const original = await field.inputValue();
  await field.fill(name);
  await field.press(key);
  await field.waitFor({ state: 'hidden' });
  const finalName = key === 'Escape' ? original : name;
  await plan(finalName).waitFor();
  return finalName;
}

async function drag(from, to, x = 15) {
  await from.dragTo(to, { sourcePosition: { x, y: 12 } });
}

async function screenshot(name) {
  await page.screenshot({
    path: join(output, `${name}.png`),
    mask: [
      page.locator('.asset-review-inspector, .folder-tree-row:not(.folder-plan-row):not(.folder-plan-asset-row)'),
      page.getByRole('dialog'),
      btn(/^Open account menu/),
      btn(/^Change organisation/),
    ],
    maskColor: '#d1d5db',
  });
}

try {
  for (const group of ['A', 'B']) {
    const name = `passbolt-native-${group.toLowerCase()}.json`;
    const contents = JSON.stringify({
      resources: Array.from({ length: 7 }, (_, index) => ({
        name: `Native ${group} ${index + 1}`,
        username: `synthetic-user-${group}-${index + 1}`,
        secret: `synthetic-secret-${group}-${index + 1}`,
      })),
    });
    await writeFile(join(profile, name), contents, { mode: 0o600 });
    summary.sources.push({ name, sha256: createHash('sha256').update(contents).digest('hex'), expectedEntries: 7 });
  }
  step = 'launch Electron';
  app = await _electron.launch({
    executablePath: join(appRoot, 'node_modules/.bin/electron'),
    args: [appRoot, '--no-sandbox', '--disable-gpu'],
    cwd: appRoot,
    env: { ...process.env, ...localConfig, XDG_CONFIG_HOME: profile, INHERITI_ENV: 'local' },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (error) => summary.diagnostics.push({ kind: 'pageerror', name: error.name }));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      summary.diagnostics.push({ kind: message.type(), line: message.location().lineNumber });
    }
  });

  await check('authenticate and block Business writes', async () => {
    await authenticate(app, page, output, { captureFailure: false, useStorageState: false });
    await app.evaluate(({ net }, origin) => {
      const request = net.request;
      globalThis.step3WriteAttempts = 0;
      net.request = function (options, ...args) {
        const url = typeof options === 'string' ? options : options.url;
        const method = typeof options === 'string' ? 'GET' : (options.method ?? 'GET');
        if (url && new URL(url).origin === origin && !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
          globalThis.step3WriteAttempts++;
          throw new Error('Business writes are blocked in the Step 3 lane.');
        }
        return request.call(this, options, ...args);
      };
    }, apiOrigin);
    guarded = true;
  });

  async function skipGuide() {
    const guide = dialog(/^Quick guide/);
    if (await guide.isVisible()) {
      await btn('Skip', guide).click();
      await guide.waitFor({ state: 'hidden' });
    }
  }

  await check('parse two native picker inputs and enter draft plan creation', async () => {
    await app.evaluate(({ dialog }, filePaths) => {
      const showOpenDialog = dialog.showOpenDialog;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
      globalThis.restoreStep3Picker = () => {
        dialog.showOpenDialog = showOpenDialog;
        delete globalThis.restoreStep3Picker;
      };
    }, summary.sources.map(({ name }) => join(profile, name)));
    await btn('Choose files').click();
    for (const { name } of summary.sources) await txt(name).waitFor();
    assert.equal(await txt('7 entries').count(), 2);
    await app.evaluate(() => globalThis.restoreStep3Picker());
    await next().click();
    const warning = dialog('Some source content won’t be imported');
    if (await warning.isVisible()) await btn('Continue import', warning).click();
    await txt('Review detected assets').waitFor();
    await skipGuide();
    await btn(/^Accept all eligible \(/).click();
    if (!(await next().isEnabled())) {
      await btn('View source field details').click();
      const coverage = dialog('Source field details');
      await btn('Show Unassigned fields', coverage).click();
      await coverage.getByRole('checkbox', { name: /^Select all \d+ fields in this filter$/ }).click();
      await btn('Exclude fields', coverage).click();
      await btn('Confirm exclusion', dialog(/^Exclude \d+ unresolved fields?\?$/)).click();
      await coverage.waitFor({ state: 'hidden' });
    }
    await next().click();
    await txt('Draft plan creation').waitFor();
    await skipGuide();
    await right().waitFor();
    assert.equal(await right().locator('[data-plan-row-id]').count(), 0, 'Step 3 starts without draft plans');
    await btn('Use organisation root').click();
    await progress(0);
  });

  const source = () => left().getByRole('combobox', { name: 'Filter unassigned assets by source' });
  const search = () => left().getByRole('textbox', { name: 'Search unassigned assets' });
  await check('select all respects source, search and assignment status', async () => {
    await status('All').click();
    await selectAll(total);
    await source().selectOption({ label: summary.sources[1].name });
    await selectAll(7);
    await search().fill('Native B 3');
    await selectAll(1);
    await search().clear();
    await source().selectOption('all');
    await status('Assigned').click();
    await txt('No assets have been assigned yet.', left()).waitFor();
    await status('Unassigned').click();
    await selectAll(total);
    await progress(0);
  });

  const first = 'Native Alpha draft';
  let second;
  const edited = 'Native Beta draft';
  await check('create root drafts and save their names and metadata', async () => {
    await newPlan('Native A 1', first, 'Enter');
    await progress(1);
    second = await newPlan('Native B 1', 'Discarded draft name', 'Escape');
    assert.equal(await plan('Discarded draft name').count(), 0);
    await progress(2);
    await menu(second, 'Edit details');
    const details = dialog(second);
    await details.getByPlaceholder('Plan name').fill(edited);
    await details.getByRole('textbox', { name: 'Plan description' }).fill('Synthetic plan description');
    await btn('Save details', details).click();
    await progress(2);
    await btn(edited, right()).click();
    const saved = dialog(edited);
    assert.equal(await saved.getByRole('textbox', { name: 'Plan description' }).inputValue(), 'Synthetic plan description');
    await txt('Location in your organisation: Organisation root', saved).waitFor();
    await btn('Close', saved).click();
  });

  await check('drag single and multiple source assets and move an assigned asset between plans', async () => {
    await btn('With plans').click();
    await drag(asset('Native A 2'), plan(first));
    await progress(3);
    await box('Native A 3').click();
    await box('Native A 4').click();
    assert.equal(await left().locator('input[type=checkbox]:checked').count(), 2);
    await drag(asset('Native A 3'), plan(edited));
    await progress(5);
    await expand(edited);
    await drag(assigned('Native A 3', edited), plan(first), 100);
    await progress(5);
    await expand(first);
    await assigned('Native A 3', first).waitFor();
    assert.equal(await plan(first).locator('.folder-plan-count').innerText(), '3 assets');
    assert.equal(await plan(edited).locator('.folder-plan-count').innerText(), '2 assets');
    await status('Assigned').click();
    await selectAll(5);
    await source().selectOption({ label: summary.sources[0].name });
    await selectAll(4);
    await source().selectOption('all');
    await status('Unassigned').click();
    await selectAll(9);
    await progress(5);
  });

  await check('unassign individually and in bulk, then delete only the owning draft and replay history', async () => {
    await menu('Native A 2', 'Unassign', assigned('Native A 2', first));
    await progress(4);
    await asset('Native A 2').waitFor();
    await status('Assigned').click();
    await box('Native B 1').click();
    await box('Native A 4').click();
    await btn('Unassign selected', left()).click();
    await progress(2);
    await status('Unassigned').click();
    await asset('Native B 1').waitFor();
    await asset('Native A 4').waitFor();
    await btn('Undo').click();
    await progress(4);
    await menu(edited, 'Delete plan');
    await btn('Delete plan', dialog('Delete plan?')).click();
    await progress(2);
    await asset('Native B 1').waitFor();
    await asset('Native A 4').waitFor();
    await expand(first);
    await assigned('Native A 1', first).waitFor();
    await assigned('Native A 3', first).waitFor();
    await btn('Undo').click();
    await progress(4);
    await plan(edited).waitFor();
    await btn('Redo').click();
    await progress(2);
    await plan(edited).waitFor({ state: 'hidden' });
  });

  await check('group every remaining asset within plan capacity and stop before staging', async () => {
    await btn('Group unassigned assets (12)').click();
    await progress(total);
    await status('Assigned').click();
    const ids = await left().locator('[data-marquee-asset-id]').evaluateAll(
      (rows) => rows.map((row) => row.dataset.marqueeAssetId),
    );
    assert.equal(ids.length, total);
    assert.equal(new Set(ids).size, total);
    const counts = (await right().locator('.folder-plan-count').allTextContents()).map((count) => Number.parseInt(count, 10));
    assert.ok(counts.length >= 3);
    assert.ok(counts.every((count) => count > 0 && count <= 10));
    assert.equal(counts.reduce((sum, count) => sum + count, 0), total);
    await status('Unassigned').click();
    assert.equal(await next().isEnabled(), true);
    summary.finalStage = 3;
    summary.continueEnabled = true;
    summary.finalPlanSizes = counts;
    await screenshot('ready-step3');
  });
  assert.ok(!summary.diagnostics.some(({ kind }) => kind === 'pageerror'), 'Renderer page errors');
} catch (error) {
  summary.failure = { check: step, kind: error.name, location: error.stack?.match(/importer-step3-local\.mjs:\d+:\d+/)?.[0] };
  console.error(`FAIL ${step} (${error.name}) ${summary.failure.location ?? ''}`);
  if (guarded) await screenshot('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  try {
    try {
      if (guarded) {
        summary.blockedWriteRequests = await app.evaluate(() => globalThis.step3WriteAttempts);
        assert.equal(summary.blockedWriteRequests, 0);
      }
    } finally {
      await app?.close();
    }
  } catch (error) {
    summary.cleanupFailure = error.name;
    process.exitCode = 1;
  } finally {
    try {
      await rm(profile, { recursive: true, force: true });
    } finally {
      await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
      console.log(`Step 3 native evidence at ${output}`);
    }
  }
}
