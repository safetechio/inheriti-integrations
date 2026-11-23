import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Synthetic Ladle story lane: this exercises the real workspace hook and review controls
// without signing in or sending a Business request.
const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const localRequire = createRequire(import.meta.url);
const playwrightRoot =
  process.env.PLAYWRIGHT_PACKAGE_ROOT ??
  resolve(appRoot, '../../../../business/inheriti-business-ui/node_modules/playwright');
const playwright = localRequire(playwrightRoot);
const browserMode = process.argv.includes('--browser');
const port = Number(process.env.IMPORTER_FIELD_OPERATIONS_PORT ?? '6115');
const base = process.env.IMPORTER_FIELD_OPERATIONS_URL ?? `http://127.0.0.1:${port}/`;
const story = new URL(base);
story.search = '?story=asset-review-improvements--source-field-destinations&mode=preview';
const profile = await mkdtemp(join(tmpdir(), 'importer-field-operations-'));
let server;
let app;
let browser;
let page;
let step = 'start';
const metrics = { startedAt: Date.now(), actions: 0 };
const button = (name) => page.getByRole('button', { name, exact: typeof name === 'string' });

try {
  if (!process.env.IMPORTER_FIELD_OPERATIONS_URL) {
    assert.equal(await fetch(base).catch(() => null), null, 'Local port is already in use.');
    const cli = resolve(appRoot, 'node_modules/@ladle/react/lib/cli/cli.js');
    server = spawn(
      process.execPath,
      [cli, 'serve', '--host', '127.0.0.1', '--port', String(port)],
      {
        cwd: appRoot,
        stdio: ['ignore', 'ignore', 'inherit'],
      },
    );
    const deadline = Date.now() + 20000;
    for (;;) {
      assert.equal(server.exitCode, null, 'Ladle exited before readiness.');
      if ((await fetch(base).catch(() => null))?.ok) break;
      assert.ok(Date.now() < deadline, 'Ladle did not respond.');
      await delay(200);
    }
  }

  if (browserMode) {
    browser = await playwright.chromium.launch();
    page = await browser.newPage({ viewport: { width: 1024, height: 800 } });
  } else {
    const electronPath = localRequire('electron');
    const main = join(profile, 'electron.cjs');
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(
        main,
        `
      const { app, BrowserWindow } = require('electron');
      app.setPath('userData', ${JSON.stringify(join(profile, 'user-data'))});
      app.whenReady().then(() => {
        const window = new BrowserWindow({ width: 1024, height: 800, webPreferences: {
          contextIsolation: true, nodeIntegration: false, sandbox: true,
        }});
        window.loadURL(${JSON.stringify(story.href)});
      });
      app.on('window-all-closed', () => app.quit());
    `,
      ),
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

  step = 'verify pending fields stay on typed asset';
  assert.equal(
    await page.getByText(/— additional fields/i).count(),
    0,
    'Fresh typed suggestions should not create an automatic additional-fields asset',
  );

  step = 'open asset issues';
  // Pending source fields are resolved from one asset Issues modal.
  const initialAssetCount = await page.locator('[data-review-asset-id]').count();
  await page.getByRole('button', { name: 'View asset issues' }).first().waitFor();
  await page
    .locator('[data-review-asset-id="vault-database:USER-PSWD"] [data-marquee-row-control]')
    .click();
  await page.getByRole('button', { name: 'View asset issues' }).first().click();
  const popover = page.getByRole('dialog', { name: / — Issues$/ });
  await popover.waitFor();
  await page.screenshot({ path: '/tmp/importer-field-operations-popover.png' });
  const selectable = popover.getByRole('checkbox', { name: /^Select (?!all )/ });
  assert.ok(
    (await selectable.count()) >= 2,
    'Fixture did not expose two selectable source fields.',
  );

  step = 'Ctrl/Meta and select-all selection';
  await selectable.nth(0).click();
  await popover
    .locator('.asset-source-field-label')
    .nth(1)
    .click({
      modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'],
    });
  assert.match(await popover.getByRole('status').textContent(), /selected/);
  await popover.getByRole('checkbox', { name: /^Select all / }).click();
  const selectedText = await popover.getByRole('status').textContent();
  assert.match(selectedText, /selected/);
  metrics.actions += 3;

  step = 'create-asset preview and confirm';
  // A structured destination accepts one compatible field; keep the multi-select
  // assertion above separate from the create-preview assertion.
  await popover.getByRole('checkbox', { name: /^Select all / }).click();
  await selectable.nth(0).click();
  await popover.getByRole('button', { name: 'Create asset' }).click();
  const createDialog = page.getByRole('dialog', { name: 'Create asset' });
  await createDialog.waitFor();
  await page.screenshot({ path: '/tmp/importer-field-operations-preview.png' });
  assert.ok(await createDialog.getByRole('status').count(), 'Create preview is missing status.');
  await createDialog.getByRole('button', { name: 'Confirm' }).click();
  await createDialog.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('dialog').count(), 0, 'Confirm left a field-operation dialog open');
  assert.ok(
    (await page.locator('[data-review-asset-id]').count()) > initialAssetCount,
    'Create asset did not add the resulting asset to the review list',
  );

  step = 'undo field organization';
  await page.getByRole('button', { name: 'Undo field changes' }).click();
  await page.getByText('Field operation undone.', { exact: false }).waitFor();
  await popover.waitFor({ state: 'hidden' });

  step = 'create grouped preview and cancel';
  await page.getByRole('button', { name: 'View asset issues' }).first().click();
  await popover.getByRole('checkbox', { name: /^Select all / }).click();
  await popover.getByRole('button', { name: /^Create asset/ }).click();
  const suggestDialog = page.getByRole('dialog', { name: 'Create assets' });
  await suggestDialog.waitFor();
  assert.ok(await suggestDialog.getByRole('button', { name: 'Add asset group' }).count());
  assert.equal(
    await suggestDialog.getByRole('button', { name: 'Confirm', exact: true }).isEnabled(),
    true,
  );
  await suggestDialog.getByRole('button', { name: 'Add asset group', exact: true }).click();
  assert.equal(
    await suggestDialog.getByRole('button', { name: 'Confirm', exact: true }).isEnabled(),
    false,
  );
  await suggestDialog.getByRole('button', { name: 'Group as Plain Text', exact: true }).click();
  assert.equal(
    await suggestDialog.getByRole('button', { name: 'Confirm', exact: true }).isEnabled(),
    true,
  );
  await page.screenshot({ path: '/tmp/importer-compact-split-preview.png' });
  await suggestDialog.getByRole('button', { name: 'Cancel' }).click();
  await suggestDialog.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('dialog').count(), 0, 'Cancelling reopened Issues');

  step = 'viewport reachability';
  await page.getByRole('button', { name: 'View asset issues' }).first().click();
  const actions = popover.locator('button');
  const box = await actions.last().boundingBox();
  assert.ok(
    box && box.y + box.height <= 800 && box.x >= 0,
    `Popover action escaped the 1024x800 viewport: ${JSON.stringify(box)}`,
  );
  step = 'general multi-source actions and atomic undo';
  await page.reload();
  await button('View source field details').click();
  const coverage = page.getByRole('dialog', { name: 'Source field details', exact: true });
  const assetCount = await page.locator('.asset-review-row').count();
  await coverage.getByRole('button', { name: 'Show All fields', exact: true }).click();
  for (const name of ['Create assets', 'Assign to asset', 'Exclude fields']) {
    assert.equal(await coverage.getByRole('button', { name, exact: true }).isDisabled(), true);
  }
  await coverage
    .locator('[data-coverage-field-id="vault-database:extra:region"]')
    .getByRole('checkbox')
    .click();
  await coverage.getByRole('button', { name: 'More fields', exact: true }).click();
  await coverage
    .locator('[data-coverage-field-id="env-key:extra:description"]')
    .getByRole('checkbox')
    .click();
  await coverage.getByRole('button', { name: 'Create assets', exact: true }).click();
  const batch = page.getByRole('dialog', { name: 'Create assets', exact: true });
  await batch
    .getByText('2/2 fields assigned · 2 entries · 2 assets to create', { exact: true })
    .waitFor();
  assert.equal(await batch.getByRole('combobox', { name: 'Asset type', exact: true }).count(), 0);
  assert.equal(await page.getByRole('dialog').count(), 1, 'General action opened nested modals');
  await batch.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await page.getByRole('dialog').count(), 0, 'Cancelling reopened Details');
  await button('View source field details').click();
  await coverage.getByText('0 selected', { exact: true }).waitFor();
  await coverage.getByRole('button', { name: 'Show All fields', exact: true }).click();
  await coverage
    .locator('[data-coverage-field-id="vault-database:extra:region"]')
    .getByRole('checkbox')
    .click();
  await coverage.getByRole('button', { name: 'More fields', exact: true }).click();
  await coverage
    .locator('[data-coverage-field-id="env-key:extra:description"]')
    .getByRole('checkbox')
    .click();
  await coverage.getByRole('button', { name: 'Create assets', exact: true }).click();
  await batch.getByRole('button', { name: 'Create 2 assets', exact: true }).click();
  assert.equal(await page.getByRole('dialog').count(), 0, 'Confirm reopened Details');
  await button('View source field details').click();
  await coverage.getByRole('button', { name: 'Undo field changes', exact: true }).waitFor();
  assert.equal(await page.locator('.asset-review-row').count(), assetCount + 2);
  await coverage.getByRole('button', { name: 'Undo field changes', exact: true }).click();
  assert.equal(await page.locator('.asset-review-row').count(), assetCount);
  await coverage.getByRole('button', { name: 'synthetic-vault.1pux', exact: true }).click();
  assert.equal(
    await coverage
      .getByRole('button', { name: 'synthetic-vault.1pux', exact: true })
      .getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(await coverage.locator('[data-coverage-field-id^="env-"]').count(), 0);
  metrics.actions += 7;
  metrics.viewport = { width: 1024, height: 800 };
  metrics.elapsedMs = Date.now() - metrics.startedAt;
  console.log(`Importer field-operation UI checks passed: ${JSON.stringify(metrics)}`);
} catch (error) {
  console.error(`Importer field-operation UI checks failed during ${step}.`);
  throw error;
} finally {
  await app?.close();
  await browser?.close();
  server?.kill();
  await rm(profile, { recursive: true, force: true });
}
