import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const fixtureRoot = resolve(appRoot, 'tests/fixtures/sample-imports/realistic');
const fixture = JSON.parse(await readFile(join(fixtureRoot, 'manifest.json'), 'utf8'));
assert.equal(fixture.synthetic, true);
const localRequire = createRequire(import.meta.url);
const playwrightRoot =
  process.env.PLAYWRIGHT_PACKAGE_ROOT ??
  resolve(appRoot, '../../../../business/inheriti-business-ui/node_modules/playwright');
let playwright;
try {
  playwright = localRequire(playwrightRoot);
} catch {
  throw new Error('Set PLAYWRIGHT_PACKAGE_ROOT to an installed Playwright package directory.');
}

const browserMode = process.argv.includes('--browser');
const output = await mkdtemp(join(tmpdir(), 'importer-context-preservation-'));
const profile = await mkdtemp(join(tmpdir(), 'importer-context-electron-'));
const port = Number(process.env.IMPORTER_CONTEXT_PORT ?? '6114');
const base = process.env.IMPORTER_CONTEXT_URL ?? `http://127.0.0.1:${port}/`;
const story = new URL(base);
assert.ok(['localhost', '127.0.0.1'].includes(story.hostname), 'Use a local test server.');
story.search = '?story=import-preservation-context--encrypted-staging&mode=preview';

let server;
let app;
let browser;
let page;
let step = 'start';
const results = [];
const button = (name) => page.getByRole('button', { name, exact: typeof name === 'string' });
const result = async () => JSON.parse(await page.getByTestId('fixture-stage-result').textContent());
const dispatch = 'Dispatch console — São Paulo / 出荷';

async function waitResult(predicate) {
  const deadline = Date.now() + 120000;
  for (;;) {
    const value = await result();
    if (predicate(value)) return value;
    assert.ok(
      Date.now() < deadline,
      `Timed out waiting for staging result (${value.writes}/${value.entries} written, ${value.attempts} attempts, ${value.failed} incomplete, running: ${value.running})`,
    );
    await delay(100);
  }
}

async function loadFixtures(names) {
  step = 'import fixtures';
  const paths = await Promise.all(
    names.map(async (name) => {
      const path = join(fixtureRoot, name);
      const hash = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
      assert.equal(hash, fixture.files[name].sha256, `Unexpected fixture contents for ${name}`);
      return path;
    }),
  );
  await page.getByLabel('Import fixture files').setInputFiles(paths);
  const count = names.reduce((sum, name) => sum + fixture.files[name].expectedEntries, 0);
  await page.waitForFunction(
    (expected) =>
      Number(document.querySelector('[data-testid="fixture-import-count"]')?.textContent) ===
      expected,
    count,
  );
  for (const name of names) {
    const warning = page
      .locator('.source-file-card')
      .filter({ hasText: name })
      .getByRole('button', { name: 'View warnings', exact: true });
    if (name === 'onepassword-rich.1pux') await warning.waitFor();
    if (!(await warning.count())) continue;
    await warning.click();
    const modal = page.getByRole('dialog');
    if (name === 'onepassword-rich.1pux')
      await modal
        .getByText(/attachment|file-only|document/i)
        .first()
        .waitFor();
    await modal.getByRole('button', { name: 'Understood' }).click();
    await modal.waitFor({ state: 'hidden' });
  }
  await button('Continue').click();
  return count;
}

async function reviewRich(destination, bulk) {
  step = 'review notes visibility';
  const source = page.getByRole('combobox', { name: 'Filter by source' });
  if (bulk) await source.selectOption({ label: 'onepassword-rich.1pux' });
  await page.locator('.asset-review-row').filter({ hasText: dispatch }).first().click();
  const note = page.getByRole('combobox', { name: 'Notes destination for this asset' });
  await note.waitFor();
  assert.equal(await note.inputValue(), '');
  assert.equal(
    await page.locator('.asset-metadata-preview').count(),
    0,
    'Unset notes appeared as visible metadata',
  );
  await note.selectOption(destination);
  assert.equal(
    await page.locator('.asset-metadata-preview').count(),
    destination === 'asset-notes' ? 1 : 0,
  );
  if (bulk) {
    await page
      .getByRole('combobox', { name: /Notes destination · onepassword-rich/ })
      .selectOption('protected');
    await source.selectOption('all');
  }
  await page
    .getByRole('combobox', { name: /Notes destination · All sources/ })
    .selectOption('protected');
  assert.equal(
    await note.inputValue(),
    destination,
    'Bulk note selection replaced individual choice',
  );

  assert.equal(
    await button('Continue').isEnabled(),
    false,
    'Pending review did not block next stage',
  );
  if (bulk) {
    await source.selectOption({ label: 'onepassword-rich.1pux' });
    const accept = button(/^Accept all eligible/);
    const before = await accept.getAttribute('aria-label');
    assert.match(before, /across all sources and filters/);
    assert.ok(Number(before.match(/\d+/)[0]) > 1000, 'Filtered Accept All lost the other sources');
    await button('Accept').click();
    const after = await accept.getAttribute('aria-label');
    assert.equal(
      Number(after.match(/\d+/)[0]),
      Number(before.match(/\d+/)[0]) - 1,
      'Per-asset acceptance affected another asset',
    );
    return;
  }
  step = 'preserve and exclude reviewed fields';
  await button('View source field details').click();
  await page.getByLabel('Filter source field coverage').selectOption('pending');
  const details = page.getByRole('region', { name: 'Source field details' });
  await details
    .getByRole('checkbox', { name: /Recovery: Code \(3\) from onepassword-rich/ })
    .click();
  await button('Exclude fields').click();
  await button('Confirm exclusion').click();
  await details
    .getByRole('checkbox', { name: /Recovery: Code \(2\) from onepassword-rich/ })
    .click();
  await button('Preserve as protected text').click();
  await page.getByText('1 preserved · 0 skipped', { exact: true }).waitFor();
  await button('Done').click();
}

async function reviewRemaining() {
  step = 'accept eligible assets';
  let accept = button(/^Accept all eligible/);
  await accept.click();
  if (await button('View source field details').count()) {
    await button('View source field details').click();
    if (await button('Preserve as protected text').count()) {
      await button('Preserve as protected text').click();
      if (await accept.isEnabled()) await accept.click();
    }
    await button('Done').click();
  }
  await button('Continue').click();
}

async function group() {
  step = 'Ctrl-select and drag two assets';
  const rows = page
    .locator('.plan-asset-row')
    .filter({ has: page.getByRole('checkbox', { name: /^Select / }) });
  const first = rows.nth(0);
  const second = rows.nth(1);
  await first.getByRole('checkbox').click();
  await second.locator('.plan-asset-row-name').click({ modifiers: ['Control'] });
  await page.getByText('2 selected', { exact: true }).first().waitFor();
  const target = page.locator('.plan-drop-target').first();
  await first
    .locator('.plan-asset-row-name')
    .dragTo(target.locator('.plan-card-header'), { targetPosition: { x: 20, y: 14 } });
  await page.getByText(/^2 of \d+ assets assigned$/).waitFor();
  step = 'group unassigned assets and open staging';
  await button(/^Group unassigned assets/).click();
  await button('Continue').click();
  assert.equal((await result()).ready, true, 'Execution coverage did not resolve');
}

async function checkLongStagingScroll(planCount) {
  step = 'verify long staging scroll';
  assert.equal(planCount, 225, 'Mixed fixture did not produce the expected long staging list');
  assert.equal(
    await page.locator('.staging-batch-embedded [role="progressbar"]').count(),
    planCount,
  );
  const original = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const checked = [];
  for (const [width, height] of [
    [1280, 720],
    [1024, 768],
  ]) {
    await page.setViewportSize({ width, height });
    const geometry = await page.locator('.importer-flow-scroll').evaluate((scroll) => {
      const read = (selector) => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, height: box.height };
      };
      const controls = () => ({
        stageHeader: read('.importer-flow-stage-header'),
        actions: read('.importer-flow-actions'),
      });
      scroll.scrollTop = 0;
      const before = controls();
      scroll.scrollTop = scroll.scrollHeight;
      return {
        before,
        after: controls(),
        documentScrollTop: document.scrollingElement.scrollTop,
        documentOverflow:
          document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight,
        stageScrollTop: scroll.scrollTop,
        stageOverflow: scroll.scrollHeight - scroll.clientHeight,
        height: innerHeight,
      };
    });
    assert.equal(
      geometry.documentOverflow,
      0,
      'The outer document also scrolls on a long staging run',
    );
    assert.equal(geometry.documentScrollTop, 0);
    assert.ok(geometry.stageScrollTop > 0, 'The staging list did not scroll');
    assert.ok(
      Math.abs(geometry.stageScrollTop - geometry.stageOverflow) <= 1,
      'The staging list could not scroll to its end',
    );
    assert.deepEqual(
      geometry.after,
      geometry.before,
      'The stage header or footer moved with the list',
    );
    for (const element of Object.values(geometry.after)) {
      assert.ok(
        element.height > 0 && element.top >= 0 && element.bottom <= geometry.height,
        'The stage header or footer left the viewport',
      );
    }
    await page.screenshot({ path: join(output, `bulk-mixed-scroll-${width}x${height}.png`) });
    checked.push({ width, height, stageScrollTop: geometry.stageScrollTop });
  }
  await page.setViewportSize(original);
  return checked;
}

async function stage({ fail, destination, name }) {
  step = 'encrypt and stage';
  await page.getByText('Planned source field coverage', { exact: true }).waitFor();
  assert.equal((await result()).attempts, 0, 'Writes started before explicit staging');
  await page.screenshot({ path: join(output, `${name}-preflight.png`) });
  await button(/^Encrypt (?:&|and) stage$/)
    .first()
    .click({ timeout: 90000 });
  let scrollChecks;
  if (fail) {
    step = 'retry failed write only';
    const partial = await waitResult((value) => !value.running && value.attempts > 0);
    await page.getByText(/Some Plans were not staged/).waitFor();
    assert.equal(await page.getByRole('dialog', { name: 'Import staged' }).count(), 0);
    assert.equal(partial.failed, 1);
    assert.equal(partial.writes, partial.entries - 1);
    if (name === 'bulk-mixed') scrollChecks = await checkLongStagingScroll(partial.entries);
    await page.screenshot({ path: join(output, `${name}-retry.png`) });
    await page
      .locator('.staging-batch-embedded')
      .getByRole('button', { name: 'Retry staging' })
      .click();
  }
  const verified = await waitResult(
    (value) => value.audit || value.auditError || (!value.running && value.failed),
  );
  assert.equal(
    verified.failed,
    0,
    `Staging stopped with ${verified.writes}/${verified.entries} plans written`,
  );
  assert.equal(verified.auditError, '');
  await page.getByRole('dialog', { name: 'Import staged' }).waitFor();
  assert.equal(verified.audit.writes, verified.entries);
  assert.equal(verified.audit.attempts, verified.entries + Number(fail));
  assert.ok(verified.audit.envelopes > verified.entries);
  const notes = fixture.files['onepassword-rich.1pux'].checks.find(
    (check) => check.field === 'notes',
  );
  const restored = verified.audit.checkedFields.find(({ hash }) => hash === notes.sha256);
  assert.deepEqual(restored?.paths, [destination === 'asset-notes' ? 'meta.notes' : 'secret.text']);
  assert.equal(
    verified.audit.checkedFields.length,
    fixture.files['onepassword-rich.1pux'].checks.length,
  );
  if (name !== 'bulk-mixed') {
    const checks = fixture.files['onepassword-rich.1pux'].checks;
    const authoritativeStatus = (field) =>
      verified.audit.checkedFields.find(
        ({ hash }) => hash === checks.find((check) => check.field === field).sha256,
      );
    assert.deepEqual(authoritativeStatus('Recovery: Code (3)').paths, []);
    assert.equal(authoritativeStatus('Recovery: Code (3)').status, 'excluded');
    assert.deepEqual(authoritativeStatus('Recovery: Code (2)').paths, ['secret.text']);
  }
  await page.screenshot({ path: join(output, `${name}-staged.png`) });
  await button('Start a new import').click();
  await waitResult((value) => value.entries === 0 && value.writes === 0);
  return { ...verified.audit, scrollChecks };
}

try {
  if (!process.env.IMPORTER_CONTEXT_URL) {
    assert.equal(
      await fetch(base).catch(() => null),
      null,
      'Local port is in use. Set IMPORTER_CONTEXT_URL to reuse Ladle, or choose IMPORTER_CONTEXT_PORT.',
    );
    const cli = resolve(appRoot, 'node_modules/@ladle/react/lib/cli/cli.js');
    server = spawn(
      process.execPath,
      [cli, 'serve', '--host', '127.0.0.1', '--port', String(port)],
      {
        cwd: appRoot,
        stdio: ['ignore', 'ignore', 'inherit'],
      },
    );
    const stopAt = Date.now() + 20000;
    for (;;) {
      assert.equal(server.exitCode, null, 'The local test server exited');
      if ((await fetch(base).catch(() => null))?.ok) break;
      assert.ok(Date.now() < stopAt, 'The local test server did not respond');
      await delay(200);
    }
  }
  if (browserMode) {
    browser = await playwright.chromium.launch();
    page = await browser.newPage({ viewport: { width: 1580, height: 1000 } });
  } else {
    const electronPath = localRequire('electron');
    const main = join(profile, 'electron.cjs');
    await writeFile(
      main,
      `const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(join(profile, 'user-data'))});
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 1580, height: 1000, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: true,
  } });
  window.loadURL(${JSON.stringify(story.href)});
});
app.on('window-all-closed', () => app.quit());
`,
    );
    app = await playwright._electron.launch({
      executablePath: electronPath,
      chromiumSandbox: true,
      args: [main],
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
    });
    page = await app.firstWindow();
  }
  page.setDefaultTimeout(20000);
  await page.goto(story.href);

  for (const scenario of [
    {
      name: 'rich-protected',
      destination: 'protected',
      fail: true,
      files: ['onepassword-rich.1pux'],
    },
    {
      name: 'rich-visible',
      destination: 'asset-notes',
      fail: false,
      files: ['onepassword-rich.1pux'],
    },
    {
      name: 'bulk-mixed',
      destination: 'protected',
      fail: true,
      files: ['onepassword-rich.1pux', 'onepassword-bulk.1pux', 'vault-kv-v2.json'],
    },
  ]) {
    console.log(`Running ${scenario.name}`);
    if (!scenario.fail)
      await page.getByLabel('Fail the second staged write once').evaluate((input) => {
        if (input.checked) input.click();
      });
    const entries = await loadFixtures(scenario.files);
    await reviewRich(scenario.destination, scenario.files.length > 1);
    await reviewRemaining();
    await group();
    const audit = await stage(scenario);
    results.push({ name: scenario.name, sourceFiles: scenario.files, entries, ...audit });
    await writeFile(
      join(output, 'manifest.json'),
      JSON.stringify({ surface: browserMode ? 'chromium' : 'electron', results }, null, 2),
    );
  }
  console.log(`Importer-context preservation checks passed. Evidence: ${output}`);
} catch (error) {
  console.error(
    `Importer-context preservation failed during ${step}. Evidence directory: ${output}`,
  );
  throw error;
} finally {
  await app?.close();
  await browser?.close();
  server?.kill();
  await rm(profile, { recursive: true, force: true });
}
