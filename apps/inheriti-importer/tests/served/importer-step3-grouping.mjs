// Start pnpm exec ladle serve --port 6117 in the Importer app, then run this file.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function exerciseStep3(page, { reset, output, summary }) {
  const left = page.locator('.plan-grouping-unassigned');
  const right = page.getByRole('tree', { name: 'Organisation folders' });
  const btn = (name, scope = page) => scope.getByRole('button', { name, exact: typeof name === 'string' });
  const box = (name, scope = page) => scope.getByRole('checkbox', { name: `Select ${name}`, exact: true });
  const input = (name, scope = page) => scope.getByRole('textbox', { name, exact: true });
  const txt = (name, scope = page) => scope.getByText(name, { exact: typeof name === 'string' });
  const dialog = (name) => page.getByRole('dialog', { name, exact: true });
  const plan = (name) => right.locator('[data-plan-row-id]').filter({ has: btn(name) });
  const folder = (name) => right.getByRole('treeitem').filter({ has: btn(`Actions for ${name}`) });
  const asset = (name) => left.locator('[data-marquee-asset-id]').filter({ has: box(name) });
  const assigned = (name) => right.locator('[data-assigned-asset-id]').filter({ has: box(name) });
  const search = input('Search unassigned assets', left);
  const folderSearch = input('Search folders or plans');
  const planName = input('Plan name');
  const source = left.getByRole('combobox', { name: 'Filter unassigned assets by source' });
  const status = (label) => btn(new RegExp(`^${label} · \\d+$`), left);
  const key = (command) => right.press(command);
  const service = (n) => `Service ${n} credential`;
  const selected = (scope) => scope.locator('input[type=checkbox]:checked');
  const step3 = txt('Step 3 of 4');
  const next = btn('Continue');
  let total;

  async function progress(expected) {
    const read = async (label) => Number((await status(label).innerText()).split('·')[1]);
    const meter = page.getByRole('progressbar', { name: 'Asset assignment progress' });
    const unassigned = await read('Unassigned');
    const assignedCount = await read('Assigned');
    assert.equal(assignedCount + unassigned, total, 'Asset totals after mutation');
    assert.equal(await read('All'), total);
    await txt(new RegExp(`^${assignedCount} of ${total} ${total === 1 ? 'asset' : 'assets'} assigned`)).waitFor();
    const fill = await meter.locator(':scope > *').evaluate((element) => Number.parseFloat(element.style.width));
    assert.ok(Math.abs(fill - 100 * assignedCount / total) < 0.01, 'Progress bar fill');
    if (expected !== undefined) assert.equal(assignedCount, expected, 'Assigned count after mutation');
    if (unassigned) assert.equal(await next.isEnabled(), false, 'Continue with unassigned assets');
    assert.equal(await step3.isVisible(), true, 'Still at STEP3');
    summary.progressChecks++;
  }
  async function check(label, body) {
    try {
      await reset();
      await step3.waitFor();
      total = Number((await status('All').innerText()).split('·')[1]);
      await progress(0);
      assert.equal(await right.locator('[data-plan-row-id]').count(), 0, 'Step 3 starts without draft plans');
      await body();
      summary.passed.push(label);
      console.log(`PASS ${label}`);
    } catch (error) {
      // Error output is safe here because the story contains only synthetic data.
      const failure = { label, kind: error.name, detail: error.message.split('\n').slice(0, 9).join('\n') };
      summary.failures.push(failure);
      console.error(`FAIL ${label}: ${failure.detail}`);
      await page.screenshot({ path: join(output, `failure-${summary.failures.length}.png`) }).catch(() => {});
    }
  }
  async function nameDraft(name, commit = 'Enter') {
    await planName.fill(name);
    if (commit === 'blur') await folderSearch.click();
    else await planName.press(commit);
    await planName.waitFor({ state: 'hidden' });
  }
  async function menu(subject, action, scope = right) {
    await btn(`Actions for ${subject}`, scope).click();
    await btn(action, page.locator('.folder-menu-popover')).click();
  }
  async function selectAssets(names) {
    for (const name of names) await box(name, left).click();
  }
  async function createPlan(name, names, commit) {
    await selectAssets(names);
    await btn('New plan', left).click();
    await nameDraft(name, commit);
    await plan(name).waitFor();
  }
  async function createEmptyPlan() {
    await menu('Finance', 'New plan');
    await nameDraft('Plan 1');
    await plan('Plan 1').waitFor();
  }
  async function expandPlan(name) {
    const expand = btn(`Expand ${name}`, plan(name));
    if (await expand.count()) await expand.click();
  }
  async function expandFolder(name) {
    const expand = btn('Expand', folder(name));
    if (await expand.count()) await expand.click();
  }
  async function drag(from, to) {
    await from.dragTo(to, { sourcePosition: { x: 15, y: 12 } });
  }
  async function assignTo(name, selectedAssets) {
    await selectAssets(selectedAssets);
    await btn(/Assign to plan|Move to plan/i, left).click();
    await btn(new RegExp(name), page.locator('.asset-selection-popover')).click();
  }

  await check('source search, list, tree, filtered select-all, Shift and marquee', async () => {
    await source.selectOption({ label: 'second.1pux' });
    await btn('Select all', left).click();
    assert.equal(await selected(left).count(), 2);
    await search.fill('credential 11');
    await btn('Select all', left).click();
    assert.equal(await selected(left).count(), 1);
    await search.clear();
    await source.selectOption('all');
    await left.locator('.plan-source-scroll').press('Escape');
    await box(service(1), left).click();
    await box(service(3), left).click({ modifiers: ['Shift'] });
    assert.equal(await selected(left).count(), 3);
    await box(service(2), left).click({ modifiers: ['Control'] });
    assert.equal(await selected(left).count(), 2);
    await btn('Clear', left).click();
    const first = await asset(service(1)).boundingBox();
    const third = await asset(service(3)).boundingBox();
    await page.mouse.move(first.x - 4, first.y + 3);
    await page.mouse.down();
    await page.mouse.move(third.x + 12, third.y + third.height - 4, { steps: 12 });
    await page.mouse.up();
    assert.equal(await selected(left).count(), 3);
    await btn('Tree', left).click();
    await box('source synthetic-vault.1pux', left).waitFor();
    await btn('List', left).click();
    await box(service(1), left).waitFor();
    await status('Assigned').click();
    await txt('No assets have been assigned yet.', left).waitFor();
    await status('All').click();
    await box(service(1), left).waitFor();
  });

  await check('single and multi-asset drag to draft and folder, then between drafts', async () => {
    await createEmptyPlan();
    await drag(asset(service(1)), plan('Plan 1'));
    await progress(1);
    await selectAssets([service(2), service(3)]);
    assert.equal(await selected(left).count(), 2, 'Two rows selected before folder drag');
    await drag(asset(service(2)), folder('Finance'));
    await nameDraft('Finance drag draft');
    await progress(3);
    await expandPlan('Finance drag draft');
    await drag(assigned(service(2)), plan('Plan 1'));
    await progress(3);
    await expandPlan('Plan 1');
    await assigned(service(2)).waitFor();
    assert.equal(await plan('Plan 1').locator('.folder-plan-count').innerText(), '2 assets');
    assert.equal(await plan('Finance drag draft').locator('.folder-plan-count').innerText(), '1 asset');
  });

  await check('source group drag creates a draft in the target folder', async () => {
    await source.selectOption({ label: 'second.1pux' });
    await btn('Tree', left).click();
    for (const label of ['Expand source second.1pux', 'Expand folder Infrastructure']) {
      const expand = btn(label, left);
      if (await expand.count()) await expand.click();
    }
    const group = left.locator('.plan-source-group').filter({ has: box('folder Database') });
    await drag(group, folder('Finance'));
    await nameDraft('Imported branch');
    await progress(2);
    await plan('Imported branch').waitFor();
  });

  await check('create from selected assets, inline blur and Escape, modal name and description', async () => {
    await createPlan('Blur draft', [service(1)], 'blur');
    await progress(1);
    await selectAssets([service(2)]);
    await btn('New plan', left).click();
    const original = await planName.inputValue();
    await nameDraft('Discarded draft name', 'Escape');
    await plan(original).waitFor();
    assert.equal(await plan('Discarded draft name').count(), 0);
    await progress(2);
    await menu('Blur draft', 'Edit details');
    const details = dialog('Blur draft');
    await details.getByPlaceholder('Plan name').fill('Edited draft');
    await input('Plan description', details).fill('Synthetic plan description');
    await btn('Save details', details).click();
    await progress(2);
    await btn('Edited draft', right).click();
    assert.equal(await input('Plan description', dialog('Edited draft')).inputValue(), 'Synthetic plan description');
    await btn('Close', dialog('Edited draft')).click();
  });

  await check('assigned row menu moves and unassigns, draft delete and history buttons/keyboard', async () => {
    await createEmptyPlan();
    await assignTo('Plan 1', [service(3)]);
    await progress(1);
    await createPlan('Menu draft', [service(1), service(2)]);
    await progress(3);
    await expandPlan('Menu draft');
    await menu(service(1), 'Move to plan');
    await btn(/Plan 1.*spaces available/, page.locator('.asset-selection-popover')).click();
    await progress(3);
    await expandPlan('Plan 1');
    await menu(service(1), 'Unassign');
    await progress(2);
    await menu('Menu draft', 'Delete plan');
    await btn('Delete plan', dialog('Delete plan?')).click();
    await progress(1);
    await btn('Undo').click();
    await progress(2);
    await btn('Redo').click();
    await progress(1);
    await key('Control+z');
    await progress(2);
    await key('Control+Shift+z');
    await progress(1);
  });

  await check('bulk draft delete returns assets and can be undone', async () => {
    await createPlan('Bulk Alpha', [service(1)]);
    await progress(1);
    await createPlan('Bulk Beta', [service(2)]);
    await progress(2);
    await box('Bulk Alpha', right).click();
    await box('Bulk Beta', right).click();
    await btn(/^Delete (2|selected)/).click();
    await btn('Delete selected', dialog('Delete plans?')).click();
    await progress(0);
    await btn('Undo').click();
    await progress(2);
    await plan('Bulk Alpha').waitFor();
    await plan('Bulk Beta').waitFor();
  });

  await check('near-capacity drag cannot partially assign an oversized selection', async () => {
    await createEmptyPlan();
    await search.fill('Service');
    await box(service(1), left).click();
    await box(service(9), left).click({ modifiers: ['Shift'] });
    await drag(asset(service(1)), plan('Plan 1'));
    await progress(9);
    await search.clear();
    await selectAssets([service(10), 'Partner API']);
    await drag(asset(service(10)), plan('Plan 1'));
    await progress(9);
    await left.locator('.plan-source-scroll').press('Escape');
    await selectAssets([service(10)]);
    await drag(asset(service(10)), plan('Plan 1'));
    await progress(10);
  });

  async function newFolder(name, parent) {
    if (parent) await menu(parent, 'New subfolder');
    else await btn('New folder').click();
    const field = input('New folder name');
    await field.fill(name);
    await field.press('Enter');
    await folder(name).waitFor();
  }
  async function destination(modal, name) {
    await modal.getByRole('combobox', { name: 'Destination' }).click();
    await modal.getByRole('option', { name, exact: true }).click();
  }
  async function deleteFolder(name) {
    await menu(name, 'Delete');
    await btn('Delete folder', dialog('Delete folder?')).click();
    await folder(name).waitFor({ state: 'hidden' });
  }

  await check('fixture folders can be created, renamed, granted access, moved and deleted', async () => {
    await newFolder('STEP3 Lab');
    await progress(0);
    await menu('STEP3 Lab', 'Rename');
    const rename = input('Rename STEP3 Lab');
    await rename.fill('STEP3 Workshop');
    await rename.press('Enter');
    await folder('STEP3 Workshop').waitFor();
    await progress(0);
    await menu('STEP3 Workshop', 'Permissions');
    const permissions = dialog('Permissions for STEP3 Workshop');
    await input('Search teams', permissions).fill('Operations');
    await permissions.getByRole('checkbox', { name: 'Operations' }).click();
    await txt('Teams gaining access: 1 · losing access: 0', permissions).waitFor();
    await btn('Save permissions', permissions).click();
    await permissions.waitFor({ state: 'hidden' });
    await progress(0);
    assert.equal(await txt('Permissions needed', folder('STEP3 Workshop')).count(), 0);
    await newFolder('STEP3 Subfolder', 'STEP3 Workshop');
    await progress(0);
    await menu('STEP3 Subfolder', 'Move to');
    const move = dialog('Move STEP3 Subfolder');
    await destination(move, 'Organisation root');
    await btn('Move folder', move).click();
    await move.waitFor({ state: 'hidden' });
    await progress(0);
    await deleteFolder('STEP3 Workshop');
    await progress(0);
    await folder('STEP3 Subfolder').waitFor();
    await deleteFolder('STEP3 Subfolder');
    await progress(0);
  });

  await check('folder and plan search keep ancestors, With plans hides empty branches and root remains selectable', async () => {
    await expandFolder('Engineering');
    await txt('Infrastructure', right).click();
    await createPlan('Searchable nested plan', [service(1)]);
    await progress(1);
    await folderSearch.fill('Searchable nested plan');
    await plan('Searchable nested plan').waitFor();
    await folder('Engineering').waitFor();
    await folder('Infrastructure').waitFor();
    assert.equal(await folder('Finance').count(), 0);
    await folderSearch.fill('Infrastructure');
    await plan('Searchable nested plan').waitFor();
    await folder('Engineering').waitFor();
    await folderSearch.clear();
    await btn('With plans').click();
    assert.equal(await folder('Finance').count(), 0);
    await btn('Use organisation root').click();
    await createPlan('Searchable root plan', [service(2)]);
    await progress(2);
    await btn('Searchable root plan', right).click();
    await txt('Location in your organisation: Organisation root', dialog('Searchable root plan')).waitFor();
    await btn('Close', dialog('Searchable root plan')).click();
  });

  await check('dragging a filtered left assigned asset cannot carry hidden right-pane selection', async () => {
    await createPlan('Left drag origin', [service(1), service(2)]);
    await progress(2);
    await createPlan('Left drag destination', [service(3)]);
    await progress(3);
    await expandPlan('Left drag origin');
    await status('Assigned').click();
    await search.fill(service(1));
    await box(service(1), right).click();
    await box(service(2), right).click();
    assert.equal(await selected(right).count(), 2);
    assert.equal(await asset(service(2)).count(), 0);
    await drag(asset(service(1)), plan('Left drag destination'));
    await progress(3);
    assert.equal(await plan('Left drag origin').locator('.folder-plan-count').innerText(), '1 asset');
    assert.equal(await plan('Left drag destination').locator('.folder-plan-count').innerText(), '2 assets');
  });

  await check('Ctrl+A follows the focused pane and row kind', async () => {
    await createPlan('Selection origin', [service(1)]);
    await progress(1);
    await createPlan('Selection other', [service(3)]);
    await progress(2);
    await btn('Collapse Selection other', right).click();
    await box(service(2), left).click();
    await key('Control+a');
    assert.equal(await selected(left).count(), 0, 'Tree hotkey must clear left-pane selection');
    assert.equal(await selected(right).count(), 2, 'Tree hotkey selects visible plans');
    await expandPlan('Selection origin');
    const assetBox = box(service(1), right);
    await assetBox.click();
    await assetBox.press('Control+a');
    assert.equal(await selected(right).count(), 1, 'Assigned row hotkey selects assigned assets');
    assert.equal(await assetBox.isChecked(), true);
    const planBox = box('Selection origin', right);
    await planBox.click();
    await planBox.press('Control+a');
    assert.equal(await selected(right).count(), 2, 'Plan hotkey selects visible plans');
    assert.equal(await assetBox.isChecked(), false);
    await left.locator('.plan-source-scroll').press('Control+a');
    assert.equal(await selected(left).count(), total - 2, 'Source hotkey selects visible source assets');
    assert.equal(await selected(right).count(), 0, 'Source hotkey clears right-pane plan selection');
    assert.equal(await btn('Delete selected').count(), 0, 'No stale plan deletion action');
  });

  await check('draft history cannot restore a deleted fixture folder reference', async () => {
    await newFolder('STEP3 History Folder', 'Engineering');
    await progress(0);
    await txt('STEP3 History Folder', right).click();
    await createPlan('History destination', [service(1)]);
    await progress(1);
    await box('History destination', right).click();
    await btn('Move to folder').click();
    const move = dialog('Move plan');
    await destination(move, 'Organisation root');
    await btn('Move plan', move).click();
    await progress(1);
    await deleteFolder('STEP3 History Folder');
    await progress(1);
    // The story and native flow may prune or block the affected history entry.
    if (await btn('Undo').isEnabled()) {
      await btn('Undo').click();
      await progress();
    }
    if (await plan('History destination').count()) {
      await btn('History destination', right).click();
      await txt('Location in your organisation: Organisation root', dialog('History destination')).waitFor();
      await btn('Close', dialog('History destination')).click();
    } else {
      assert.equal(await status('Assigned').innerText(), 'Assigned · 0');
    }
  });

  await check('dragging a draft moves it to a folder and Undo and Redo keep its destination', async () => {
    await createPlan('Draft drag destination', [service(1)]);
    await progress(1);
    await drag(plan('Draft drag destination'), folder('Finance'));
    await progress(1);
    await expandFolder('Finance');
    async function location(name) {
      await btn('Draft drag destination', right).click();
      const details = dialog('Draft drag destination');
      await txt(`Location in your organisation: ${name}`, details).waitFor();
      await btn('Close', details).click();
    }
    await location('Finance');
    await btn('Undo').click();
    await progress(1);
    await location('Organisation root');
    await btn('Redo').click();
    await progress(1);
    await location('Finance');
  });

  await check('Move drafts out uses the parent or root, keeps assets and can be undone in one step', async () => {
    await newFolder('Draft intake', 'Finance');
    for (const [index, name] of ['Intake draft A', 'Intake draft B'].entries()) {
      await drag(asset(service(index + 1)), folder('Draft intake'));
      await nameDraft(name);
    }
    const move = dialog('Move drafts out?');
    const action = 'Move drafts out…';
    const first = 'Intake draft A';
    const second = 'Intake draft B';
    async function location(draft, destinationName) {
      await btn(draft, right).click();
      const details = dialog(draft);
      await txt(`Location in your organisation: ${destinationName}`, details).waitFor();
      await btn('Close', details).click();
    }

    await folderSearch.fill(first);
    await plan(second).waitFor({ state: 'hidden' });
    await menu('Draft intake', action);
    await txt('Move 2 drafts to Finance.', move).waitFor();
    await btn('Cancel', move).click();
    await location(first, 'Draft intake');
    await menu('Draft intake', action);
    await btn('Move', move).click();
    await folderSearch.clear();
    await progress(2);
    await location(first, 'Finance');
    await location(second, 'Finance');
    await btn('Undo').click();
    await expandFolder('Draft intake');
    await location(first, 'Draft intake');
    await location(second, 'Draft intake');
    await btn('Redo').click();
    await drag(asset(service(3)), folder('Draft intake'));
    await nameDraft('Stays in subfolder');

    await menu('Finance', action);
    await txt('Move 2 drafts to Organisation root.', move).waitFor();
    await btn('Move', move).click();
    await location(first, 'Organisation root');
    await location(second, 'Organisation root');
    await location('Stays in subfolder', 'Draft intake');
    await progress(3);
  });

  await check('redo cannot recreate a draft inside a deleted fixture folder', async () => {
    await newFolder('STEP3 Redo Folder', 'Engineering');
    await progress(0);
    await txt('STEP3 Redo Folder', right).click();
    await createPlan('Redo destination', [service(1)]);
    await progress(1);
    await btn('Undo').click();
    await progress(1);
    await btn('Undo').click();
    await progress(0);
    await deleteFolder('STEP3 Redo Folder');
    await progress(0);
    if (await btn('Redo').isEnabled()) await btn('Redo').click();
    await progress(0);
    assert.equal(await plan('Redo destination').count(), 0);
  });

  await check('auto-group preserves source folders and capacity, then enables Continue', async () => {
    await btn(/^Group unassigned assets/).click();
    await progress(total);
    await status('Assigned').click();
    const assignedIds = await left.locator('[data-marquee-asset-id]').evaluateAll(
      (rows) => rows.map((row) => row.dataset.marqueeAssetId),
    );
    assert.equal(new Set(assignedIds).size, total, 'Unique assigned assets after grouping');
    await status('Unassigned').click();
    const planNames = await right.locator('.folder-plan-name-button').allTextContents();
    assert.ok(planNames.includes('Database 1') && planNames.includes('Database 2') && planNames.includes('Database'));
    const counts = await right.locator('.folder-plan-count').allTextContents();
    assert.equal(counts.reduce((sum, count) => sum + Number.parseInt(count, 10), 0), total);
    assert.ok(counts.every((count) => Number.parseInt(count, 10) <= 10));
    await btn('Undo').click();
    await progress(0);
    await btn('Redo').click();
    await progress(total);
    assert.equal(await next.isEnabled(), true);
    await page.screenshot({ path: join(output, 'ready-step3.png') });
  });
}

async function exerciseGroupingSetting(page, url, summary) {
  const label = 'auto-group configuration switches between source folders and source files';
  try {
    const settingsStory = new URL(url);
    settingsStory.searchParams.set('story', 'folder-grouping-interactions--ready-to-group-nested-sources');
    await page.goto(settingsStory.href);
    const toggle = page.getByRole('checkbox', { name: 'Group by source folders' });
    const group = page.getByRole('button', { name: 'Group unassigned assets (27)', exact: true });
    await group.waitFor();
    assert.equal(await toggle.isChecked(), true);
    await group.click();
    const cards = page.locator('.plan-grouping-plan');
    const names = () => cards.getByRole('button', { name: /^Select / }).evaluateAll(
      (buttons) => buttons.map((button) => button.getAttribute('aria-label')),
    );
    async function assertCapacity() {
      const capacities = await cards.getByText(/^\d+ of 10 assets$/).allTextContents();
      assert.equal(capacities.length, await cards.count());
      const counts = capacities.map((text) => Number.parseInt(text, 10));
      assert.equal(counts.reduce((sum, count) => sum + count, 0), 27);
      assert.ok(counts.every((count) => count > 0 && count <= 10));
    }
    assert.ok((await names()).includes('Select Database 1'));
    await assertCapacity();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await group.waitFor();
    await toggle.uncheck();
    await group.click();
    const bySource = await names();
    assert.ok(bySource.includes('Select synthetic-vault.1pux 1'));
    assert.ok(bySource.includes('Select second.1pux'));
    assert.ok(bySource.every((name) => !name.includes('Database')));
    await assertCapacity();
    summary.passed.push(label);
    console.log(`PASS ${label}`);
  } catch (error) {
    const detail = error.message.split('\n').slice(0, 9).join('\n');
    summary.failures.push({ label, kind: error.name, detail });
    console.error(`FAIL ${label}: ${detail}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const require = createRequire(new URL('../../../../../../business/inheriti-business-ui/package.json', import.meta.url));
  const { chromium } = require('playwright');
  const url = new URL(process.env.IMPORTER_STEP3_URL ?? 'http://127.0.0.1:6117/');
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Use a local synthetic Ladle fixture.');
  url.search = '?story=folder-grouping-interactions--full-flow-create-plans&mode=preview';
  const output = await mkdtemp(join(tmpdir(), 'importer-step3-grouping-'));
  const summary = { story: url.searchParams.get('story'), passed: [], failures: [], progressChecks: 0, diagnostics: [] };
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.setDefaultTimeout(3500);
    page.on('pageerror', (error) => summary.diagnostics.push({ kind: 'pageerror', name: error.name }));
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning')
        summary.diagnostics.push({ kind: message.type(), source: message.location().url.split('/').pop().split('?')[0] });
    });
    await exerciseStep3(page, { reset: () => page.goto(url.href), output, summary });
    await exerciseGroupingSetting(page, url, summary);
  } finally {
    await browser.close();
    await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    console.log(`STEP3 evidence at ${output}`);
  }
  if (summary.failures.length || summary.diagnostics.some(({ kind }) => kind === 'pageerror')) process.exitCode = 1;
}
