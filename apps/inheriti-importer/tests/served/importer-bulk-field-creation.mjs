import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const base =
  process.env.IMPORTER_BULK_FIELD_CREATION_URL ??
  `http://127.0.0.1:${Number(process.env.IMPORTER_BULK_FIELD_CREATION_PORT ?? '6131')}/`;
const story = new URL(
  '?story=bulk-field-creation--large-two-source-bulk-creation&mode=preview',
  base,
);
const require = createRequire(import.meta.url);
const playwright = require(
  resolve(appRoot, '../../../../business/inheriti-business-ui/node_modules/playwright'),
);
const evidence = await mkdtemp(join(tmpdir(), 'importer-bulk-field-creation-'));
let server;
let browser;
let page;
let step = 'start';
let initialAssets = 0;
let defaultCreated = 0;
const dialog = () => page.getByRole('dialog', { name: 'Create assets', exact: true });
const details = () => page.getByRole('dialog', { name: 'Source field details', exact: true });
const creationSummary = () =>
  dialog().getByText(/^\d+\/\d+ fields assigned · \d+ entries · \d+ assets to create$/, {
    exact: true,
  });
async function readCreationCount() {
  const text = await creationSummary().textContent();
  const match = text.match(/(\d+)\/(\d+) fields assigned · (\d+) entries · (\d+) assets to create/);
  assert.ok(match, `Unexpected creation summary: ${text}`);
  return Number(match[4]);
}
const assetCount = (count) =>
  page
    .locator('.asset-review-list-heading')
    .getByText(`Assets (${count})`, { exact: true })
    .waitFor();

async function openBatch(action = 'Create assets') {
  await page.getByRole('button', { name: 'View source field details', exact: true }).click();
  assert.equal(
    await details()
      .getByRole('button', { name: 'Show Unassigned fields' })
      .getAttribute('aria-pressed'),
    'true',
  );
  await details().getByRole('checkbox', { name: /^Select all \d+ fields in this filter$/ }).click();
  await details().getByRole('button', { name: action, exact: true }).click();
  await creationSummary().waitFor();
  const createdCount = await readCreationCount();
  assert.equal(await dialog().getByRole('textbox', { name: 'Asset name', exact: true }).count(), 0);
  assert.equal(
    await dialog()
      .getByRole('button', { name: /^Edit / })
      .count(),
    20,
  );
  assert.equal(
    await dialog().getByRole('button', { name: /^Create \d+ assets$/, exact: true }).isEnabled(),
    true,
  );
  assert.equal(await page.getByRole('dialog').count(), 1);
  const layout = await dialog().evaluate((node) => ({
    overflow: node.scrollWidth > node.clientWidth,
    scrolls: [...node.querySelectorAll('*')].filter(
      (element) =>
        element.scrollHeight > element.clientHeight + 2 &&
        ['auto', 'scroll'].includes(getComputedStyle(element).overflowY),
    ).length,
    footerVisible: node.getBoundingClientRect().bottom <= innerHeight,
  }));
  assert.deepEqual(layout, { overflow: false, scrolls: 1, footerVisible: true });
  return createdCount;
}

async function undoToOriginal() {
  assert.equal(await page.getByRole('dialog').count(), 0, 'Operation reopened its source modal');
  await page.getByRole('button', { name: 'View source field details', exact: true }).click();
  await details().getByRole('button', { name: 'Undo field changes', exact: true }).click();
  await assetCount(initialAssets);
  await details().getByRole('button', { name: 'Close Source field details', exact: true }).click();
}

async function reviewStatusTab(label) {
  await page.getByRole('button', { name: new RegExp(`^${label}(?:\\s|$)`) }).first().click();
}

async function inspectFirstAsset() {
  const inspect = page.getByRole('button', { name: /^Inspect / }).first();
  const name = (await inspect.getAttribute('aria-label')).slice('Inspect '.length);
  await inspect.click();
  return name;
}

try {
  if (!process.env.IMPORTER_BULK_FIELD_CREATION_URL) {
    assert.equal(await fetch(base).catch(() => null), null, 'Local port is already in use.');
    server = spawn(
      process.execPath,
      [
        resolve(appRoot, 'node_modules/@ladle/react/lib/cli/cli.js'),
        'serve',
        '--host',
        '127.0.0.1',
        '--port',
        new URL(base).port,
      ],
      { cwd: appRoot, stdio: ['ignore', 'ignore', 'inherit'] },
    );
    const deadline = Date.now() + 30000;
    while (!(await fetch(base).catch(() => null))?.ok) {
      assert.equal(server.exitCode, null, 'Ladle exited before readiness');
      assert.ok(Date.now() < deadline, 'Ladle did not respond');
      await delay(200);
    }
  }
  browser = await playwright.chromium.launch();
  page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  page.setDefaultTimeout(15000);
  await page.goto(story.href);
  step = 'review by source pattern';
  await page.locator('.asset-review-list-heading').getByText(/^Assets \(\d+\)$/, { exact: true }).waitFor();
  initialAssets = await page.locator('.asset-review-row').count();
  assert.ok(initialAssets > 0, 'Bulk fixture did not create initial assets');
  const listBeforeGroups = await page.locator('.asset-review-queue').boundingBox();
  await page.getByRole('button', { name: 'Group similar entries', exact: true }).click();
  const patterns = page.getByRole('region', { name: 'Group similar entries', exact: true });
  for (const [width, height] of [
    [1024, 768],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(100);
    const geometry = await patterns.evaluate((panel) => {
      const bounds = panel.getBoundingClientRect();
      return {
        fitsViewport:
          bounds.left >= 0 &&
          bounds.right <= innerWidth &&
          bounds.top >= 0 &&
          bounds.bottom <= innerHeight,
        inAssetList: Boolean(panel.closest('.asset-review-queue')),
        background: getComputedStyle(panel).backgroundColor,
        scrolls: [...panel.querySelectorAll('*')].filter(
          (element) =>
            element.scrollHeight > element.clientHeight + 2 &&
            ['auto', 'scroll'].includes(getComputedStyle(element).overflowY),
        ).length,
      };
    });
    assert.equal(geometry.fitsViewport, true);
    assert.equal(geometry.inAssetList, false);
    assert.equal(geometry.background, 'rgb(255, 255, 255)');
    assert.ok(geometry.scrolls <= 1, 'Groups popover has nested scrolling');
    await page.screenshot({ path: join(evidence, `similar-entries-${width}.png`) });
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(100);
  const listAfterGroups = await page.locator('.asset-review-queue').boundingBox();
  assert.ok(
    Math.abs(listAfterGroups.height - listBeforeGroups.height) <= 1,
    'Opening groups shifted the asset list',
  );
  const choices = patterns.getByRole('button', { name: /^Select .* group,/ });
  assert.equal(await choices.count(), 2, 'Patterns must remain separated by source');
  await choices.first().click();
  await page.getByText('22 selected', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.reload();
  step = 'suggest selected pending fields';
  await page.getByRole('button', { name: 'View source field details', exact: true }).click();
  await details().getByRole('checkbox', { name: /^Select all \d+ fields in this filter$/ }).click();
  await details().getByRole('button', { name: 'Create assets', exact: true }).click();
  await dialog().waitFor();
  await creationSummary().waitFor();
  const suggestedCreated = await readCreationCount();
  await dialog().getByRole('button', { name: /^Create \d+ assets$/, exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 1);
  await dialog().getByRole('button', { name: `Create ${suggestedCreated} assets`, exact: true }).click();
  await assetCount(initialAssets + suggestedCreated);
  await undoToOriginal();
  await page.reload();
  step = 'remove generated drafts and undo';
  await openBatch();
  defaultCreated = await readCreationCount();
  await dialog().getByRole('button', { name: `Create ${defaultCreated} assets`, exact: true }).click();
  await assetCount(initialAssets + defaultCreated);
  const generated = page.getByRole('button', { name: /^Inspect .*Additional/ }).first();
  const generatedName = (await generated.getAttribute('aria-label')).slice('Inspect '.length);
  await generated.click();
  assert.equal(
    await page
      .getByText('Fields organized. Review the changed assets before placing them in a plan.', {
        exact: true,
      })
      .count(),
    0,
  );
  await page.getByRole('button', { name: `Actions for ${generatedName}`, exact: true }).click();
  const actions = page.getByRole('menu', { name: `Actions for ${generatedName}`, exact: true });
  await actions.getByRole('menuitem', { name: 'Remove draft asset', exact: true }).waitFor();
  const exclude = actions.getByRole('menuitem', { name: 'Exclude from import', exact: true });
  const icon = exclude.getByTestId('font-awesome-6');
  const title = exclude.getByText('Exclude from import', { exact: true });
  const [iconBox, titleBox] = await Promise.all([icon.boundingBox(), title.boundingBox()]);
  assert.ok(iconBox && titleBox);
  assert.ok(
    Math.abs(iconBox.y + iconBox.height / 2 - titleBox.y - titleBox.height / 2) <= 1,
    'Exclude icon is not aligned with its title',
  );
  assert.equal(
    await icon.evaluate((node) => getComputedStyle(node).color),
    await title.evaluate((node) => getComputedStyle(node).color),
    'Exclude icon must use the title danger color',
  );

  const menuFits = await actions.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
  });
  assert.equal(menuFits, true);
  await page.screenshot({ path: join(evidence, 'draft-actions.png') });
  await actions.getByRole('menuitem', { name: 'Remove draft asset', exact: true }).click();
  await assetCount(initialAssets + defaultCreated - 1);
  await page.getByText(/1 draft removed/).waitFor();
  await page.getByRole('button', { name: 'Undo field changes', exact: true }).click();
  await assetCount(initialAssets + defaultCreated);
  const draftCheckboxes = page.getByRole('checkbox', { name: /^Select .*Additional/ });
  await draftCheckboxes.nth(0).click();
  await draftCheckboxes.nth(1).click();
  await page.getByRole('button', { name: 'Remove draft assets', exact: true }).click();
  await assetCount(initialAssets + defaultCreated - 2);
  await page.getByText(/2 drafts removed/).waitFor();
  await page.getByRole('button', { name: 'Undo field changes', exact: true }).click();
  await assetCount(initialAssets + defaultCreated);
  await page.reload();
  step = 'prepared bulk creation and undo';
  await assetCount(initialAssets);
  await openBatch();
  await page.screenshot({ path: join(evidence, 'prepared.png') });
  defaultCreated = await readCreationCount();
  await dialog().getByRole('button', { name: `Create ${defaultCreated} assets`, exact: true }).click();
  await assetCount(initialAssets + defaultCreated);
  await undoToOriginal();

  step = 'custom split, keyboard and selected-only layout';
  await page.reload();
  await openBatch('Create assets');
  const tabs = dialog().getByRole('group', { name: 'Field operation sources' });
  await tabs.getByRole('button', { name: /bulk-primary-a/ }).click();
  const frames = dialog().locator('[data-field-operation-entry-id]');
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await frames.first().click({ position: { x: 2, y: 2 }, modifiers: [modifier] });
  await dialog().getByText('1 entry selected for layout', { exact: true }).waitFor();
  await frames.first().click({ position: { x: 2, y: 2 }, modifiers: [modifier] });
  const start = await frames.first().boundingBox();
  const end = await frames.nth(2).boundingBox();
  assert.ok(start && end, 'Selection rows are not visible');
  await page.keyboard.down(modifier);
  await page.mouse.move(start.x + 70, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + 180, end.y + end.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up(modifier);
  await dialog().getByText('3 entries selected for layout', { exact: true }).waitFor();
  assert.equal(
    await dialog().getByRole('textbox', { name: 'Asset name', exact: true }).count(),
    0,
    'Dragging opened an editor',
  );
  const typeLabel = dialog().getByText('Plain Text', { exact: true }).first();
  assert.equal(
    await typeLabel.evaluate((node) => getComputedStyle(node).textTransform),
    'uppercase',
  );
  assert.notEqual(
    await dialog()
      .getByText('Ready', { exact: true })
      .first()
      .evaluate((node) => getComputedStyle(node.parentElement).backgroundColor),
    'rgba(0, 0, 0, 0)',
  );
  assert.ok(await frames.first().getByTestId('font-awesome-6').count(), 'Asset icon is missing');
  await dialog().getByRole('button', { name: 'Clear layout selection', exact: true }).click();
  await dialog().getByRole('button', { name: 'Use all matching entries', exact: true }).click();
  const first = dialog().getByRole('button', { name: 'Edit Primary bulk-a 1', exact: true });
  await first.focus();
  await first.press('ArrowDown');
  await page.keyboard.press('Enter');
  await dialog()
    .getByRole('textbox', { name: 'Asset name', exact: true })
    .fill('Keep manual destination');
  await first.click();
  await dialog()
    .getByRole('button', { name: 'Remove region from protected text', exact: true })
    .click();
  await dialog()
    .getByRole('button', {
      name: 'Add asset group for Primary bulk-a 1 · bulk-primary-a.json',
      exact: true,
    })
    .click();
  await dialog().getByRole('button', { name: 'Use remaining fields', exact: true }).last().click();
  const third = dialog().getByRole('button', { name: 'Edit Primary bulk-a 3', exact: true });
  await third.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  await dialog()
    .getByRole('button', { name: 'Edit Primary bulk-a 5', exact: true })
    .click({ modifiers: ['Shift'] });
  await dialog().getByText('3 entries selected for layout', { exact: true }).waitFor();
  assert.equal(
    await dialog()
      .getByRole('button', { name: 'Apply layout to 3 matching entries', exact: true })
      .isEnabled(),
    true,
  );
  await dialog().getByRole('button', { name: 'Clear layout selection', exact: true }).click();
  assert.equal(
    await dialog()
      .getByRole('button', { name: 'Apply layout to 0 matching entries', exact: true })
      .isDisabled(),
    true,
  );
  await dialog().getByRole('button', { name: 'Use all matching entries', exact: true }).click();
  await dialog()
    .getByRole('button', { name: 'Apply layout to 20 matching entries', exact: true })
    .click();
  await dialog()
    .getByRole('status')
    .filter({ hasText: 'Layout applied to 20 entries · 1 kept manual changes.' })
    .waitFor();
  await dialog().getByRole('button', { name: 'Edit Primary bulk-a 2', exact: true }).click();
  assert.equal(
    await dialog().getByRole('textbox', { name: 'Asset name', exact: true }).inputValue(),
    'Keep manual destination',
  );
  await tabs.getByRole('button', { name: /bulk-primary-b/ }).click();
  await dialog().getByRole('button', { name: 'Edit Primary bulk-b 1', exact: true }).click();
  assert.equal(
    await dialog().getByRole('textbox', { name: 'Asset name', exact: true }).count(),
    1,
    'Layout changed another source',
  );
  assert.equal(
  await dialog().getByRole('button', { name: /^Create \d+ assets$/, exact: true }).isEnabled(),
    true,
  );
  await page.screenshot({ path: join(evidence, 'scoped-layout.png') });
  const layoutCreated = await readCreationCount();
  await dialog().getByRole('button', { name: `Create ${layoutCreated} assets`, exact: true }).click();
  await assetCount(initialAssets + layoutCreated);
  await undoToOriginal();
  step = 'status tabs and restore scope';
  const excludedAssetName = await inspectFirstAsset();
  await page.getByRole('button', { name: `Actions for ${excludedAssetName}`, exact: true }).click();
  let statusActions = page.getByRole('menu', { name: `Actions for ${excludedAssetName}`, exact: true });
  await statusActions.getByRole('menuitem', { name: 'Exclude from import', exact: true }).click();
  await reviewStatusTab('Excluded');
  await page.getByText('Assets (1)', { exact: true }).waitFor();
  await page.getByRole('button', { name: `Inspect ${excludedAssetName}`, exact: true }).click();
  await page.getByRole('button', { name: `Actions for ${excludedAssetName}`, exact: true }).click();
  statusActions = page.getByRole('menu', { name: `Actions for ${excludedAssetName}`, exact: true });
  assert.equal(await statusActions.getByRole('menuitem', { name: 'Exclude from import', exact: true }).count(), 0);
  assert.equal(await statusActions.getByRole('menuitem', { name: 'Restore to review', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await page.getByText('1 selected', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Restore selected', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Accept selected', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Restore selected', exact: true }).click();
  await reviewStatusTab('To review');
  await page.getByText(`Assets (${initialAssets})`, { exact: true }).waitFor();
  await page.getByRole('button', { name: `Actions for ${excludedAssetName}`, exact: true }).click();
  statusActions = page.getByRole('menu', { name: `Actions for ${excludedAssetName}`, exact: true });
  await statusActions.getByRole('menuitem', { name: 'Exclude from import', exact: true }).click();
  await reviewStatusTab('Excluded');
  await page.getByText('Assets (1)', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await page.getByRole('button', { name: 'Restore selected', exact: true }).click();
  await reviewStatusTab('To review');
  const acceptedInspect = page.getByRole('button', { name: /^Inspect / }).first();
  await acceptedInspect.locator('..').getByRole('checkbox').click();
  await page.getByRole('button', { name: 'Accept selected', exact: true }).click();
  await reviewStatusTab('Accepted');
  await page.getByText('Assets (1)', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Accept selected', exact: true }).count(), 0);
  const metrics = {
    entries: 44,
    sources: 2,
    fields: 132,
    defaultCreated,
    layoutMatched: 20,
    preservedManual: 1,
    layoutCreated,
    viewport: { width: 1024, height: 768 },
  };
  await writeFile(join(evidence, 'manifest.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`Importer bulk field creation checks passed. Evidence: ${evidence}`);
} catch (error) {
  console.error(`Importer bulk field creation checks failed during ${step}.`);
  throw error;
} finally {
  await browser?.close();
  server?.kill();
}
