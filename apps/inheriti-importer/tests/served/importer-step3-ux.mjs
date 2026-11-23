// Run pnpm exec ladle serve --port 6118 first. This is a read-only UI probe over the synthetic story.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../../../../../business/inheriti-business-ui/package.json', import.meta.url));
const { chromium } = require('playwright');
const url = new URL(process.env.IMPORTER_STEP3_URL ?? 'http://127.0.0.1:6118/');
url.search = '?story=folder-grouping-interactions--full-flow-create-plans&mode=preview';
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));

const output = await mkdtemp(join(tmpdir(), 'importer-step3-ux-'));
const viewports = [
  [1920, 1080],
  [1440, 900],
  [1280, 720],
  [1024, 768],
  [980, 680],
  [960, 640],
];
const longPlan = `Plan-${'unbroken-name-'.repeat(8)}END`;
const longFolder = `Folder-${'unbroken-name-'.repeat(8)}END`;
const summary = { story: url.href, output, viewports: [], diagnostics: [] };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(5000);
page.on('pageerror', (error) => summary.diagnostics.push({ kind: 'pageerror', message: error.message }));

async function measure(label, viewport) {
  return page.evaluate(({ label, viewport }) => {
    const visible = (selector) => [...document.querySelectorAll(selector)].filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const clipped = (selector) => visible(selector).map((node) => ({
      text: node.textContent?.trim().slice(0, 180),
      aria: node.getAttribute('aria-label'),
      title: node.getAttribute('title'),
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      clipped: node.scrollWidth > node.clientWidth + 1,
      rectRight: Math.round(node.getBoundingClientRect().right),
    })).filter((item) => item.clipped);
    const bodyOverflow = document.documentElement.scrollWidth > window.innerWidth || document.body.scrollWidth > window.innerWidth;
    const dialogNode = document.querySelector('[role="dialog"]');
    const dialogRect = dialogNode?.getBoundingClientRect();
    const dialogButtons = [...(dialogNode?.querySelectorAll('button') ?? [])].map((node) => node.getBoundingClientRect());
    const dialogFooterTop = dialogButtons.length ? Math.max(...dialogButtons.map((rect) => rect.top)) : null;
    const dialogOccludedText = dialogFooterTop === null ? [] : [...(dialogNode?.querySelectorAll('input, textarea, [data-testid], p, label') ?? [])].map((node) => {
      const rect = node.getBoundingClientRect();
      return { text: node.textContent?.trim().slice(0, 120), top: Math.round(rect.top), bottom: Math.round(rect.bottom), footerTop: Math.round(dialogFooterTop) };
    }).filter((item) => item.bottom > dialogFooterTop + 1);
    return {
      label,
      viewport,
      compactMedia: matchMedia('(min-width: 980px) and (max-height: 768px)').matches,
      bodyOverflow,
      assetSelectionToolbar: Boolean(document.querySelector('.asset-selection-toolbar')),
      folderSelectionToolbar: Boolean(document.querySelector('.folder-tree-selection')),
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      header: Boolean([...document.querySelectorAll('*')].find((node) => node.textContent?.trim() === 'IMPORT STEPS')),
      footer: Boolean([...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === 'Back')),
      buttons: [...document.querySelectorAll('button')].filter((button) => {
        const rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).map((button) => ({ name: button.getAttribute('aria-label') || button.textContent?.trim(), disabled: button.disabled })),
      clippedAssetText: clipped('[data-marquee-asset-id]'),
      clippedPlanText: clipped('[data-plan-row-id], .folder-plan-name-button'),
      clippedTreeText: clipped('[role="treeitem"]'),
      clippedDialogText: clipped('[role="dialog"] *'),
      geometry: Object.fromEntries(['.organization-folder-tree', '.organization-folder-scroll', '.folder-tree-footer', '.plan-grouping-unassigned', '.plan-grouping-columns'].map((selector) => {
        const node = document.querySelector(selector);
        if (!node) return [selector, null];
        const rect = node.getBoundingClientRect();
        return [selector, { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height), scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }];
      })),
      footerButtons: visible('.folder-tree-footer button, button').filter((node) => /Group unassigned|Continue|Save details|Delete folder|Cancel|Close/.test(node.textContent || '')).map((node) => {
        const rect = node.getBoundingClientRect();
        return { name: node.textContent?.trim(), top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left), right: Math.round(rect.right), inViewport: rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth, title: node.getAttribute('title'), aria: node.getAttribute('aria-label') };
      }),
      hitTargets: visible('button').filter((node) => /Group unassigned|Continue|Save details|Delete folder|Cancel|Close/.test(node.textContent || '')).map((node) => {
        const rect = node.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return { name: node.textContent?.trim(), unobscured: Boolean(hit && (hit === node || node.contains(hit))) };
      }),
      dialogRect: dialogRect ? { top: Math.round(dialogRect.top), bottom: Math.round(dialogRect.bottom), height: Math.round(dialogRect.height) } : null,
      dialogOccludedText,
    };
  }, { label, viewport });
}

async function buttons() {
  return page.getByRole('button').allTextContents();
}

try {
  for (const [width, height] of viewports) {
    try {
      await page.setViewportSize({ width, height });
      await page.goto(url.href);
      await page.getByText('Step 3 of 4', { exact: true }).waitFor();
      const baseline = await measure('baseline', [width, height]);
      await page.screenshot({ path: join(output, `step3-${width}x${height}-baseline.png`), fullPage: true });

    const longAssetRow = page.locator('[data-marquee-asset-id]').first();
    const longAssetText = (await longAssetRow.innerText()).trim();
    assert.ok(longAssetText.length >= 60, `fixture long asset is only ${longAssetText.length} chars`);
    await longAssetRow.getByRole('checkbox').click();
    await page.getByRole('button', { name: 'New plan', exact: true }).click();
    const planInput = page.getByRole('textbox', { name: 'Plan name', exact: true });
    await planInput.fill(longPlan);
    await planInput.press('Enter');
    await page.getByRole('button', { name: longPlan, exact: true }).waitFor();
    const planActions = page.getByRole('button', { name: `Actions for ${longPlan}`, exact: true });
    await planActions.scrollIntoViewIfNeeded();
    await planActions.click();
    await page.getByRole('button', { name: 'Edit details', exact: true }).click();
    const details = page.getByRole('dialog', { name: longPlan, exact: true });
    await details.waitFor();
    const detailsMeasure = await measure('long-plan-edit-dialog', [width, height]);
    await page.screenshot({ path: join(output, `step3-${width}x${height}-plan-dialog.png`), fullPage: true });
    await page.getByRole('button', { name: 'Save details', exact: true }).click();

    await page.getByRole('button', { name: 'New folder', exact: true }).click();
    const folderInput = page.getByRole('textbox', { name: 'New folder name', exact: true });
    await folderInput.fill(longFolder);
    await folderInput.press('Enter');
    const folderRow = page.getByRole('treeitem').filter({ has: page.getByRole('button', { name: `Actions for ${longFolder}`, exact: true }) });
    await folderRow.waitFor();
    const folderActions = page.getByRole('button', { name: `Actions for ${longFolder}`, exact: true });
    await folderActions.scrollIntoViewIfNeeded();
    await folderActions.click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const deleteDialog = page.getByRole('dialog', { name: 'Delete folder?', exact: true });
    await deleteDialog.waitFor();
    const deleteMeasure = await measure('long-folder-delete-dialog', [width, height]);
    await page.screenshot({ path: join(output, `step3-${width}x${height}-delete-dialog.png`), fullPage: true });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await folderRow.click({ modifiers: ['Control'] });
    const selectionToolbar = await measure('long-folder-selection-toolbar', [width, height]);
    await page.screenshot({ path: join(output, `step3-${width}x${height}-folder-selection.png`), fullPage: true });
    await page.locator('[data-marquee-asset-id]').nth(1).getByRole('checkbox').click();
    const assignButton = page.getByRole('button', { name: /Assign to plan|Move to plan/i }).first();
    await assignButton.waitFor();
    await assignButton.click();
    const assignPopover = await measure('asset-assignment-popover', [width, height]);
    await page.screenshot({ path: join(output, `step3-${width}x${height}-assign-popover.png`), fullPage: true });
    await page.keyboard.press('Escape');
    await page.screenshot({ path: join(output, `step3-${width}x${height}-dialogs.png`), fullPage: true });
      if (width >= 980) {
        assert.equal(baseline.compactMedia, width >= 980 && height <= 768, 'compact media query mismatch');
        assert.ok(baseline.geometry['.organization-folder-scroll']?.height >= 100, `folder tree viewport too short: ${baseline.geometry['.organization-folder-scroll']?.height}`);
        const baseActions = baseline.footerButtons.filter((button) => /Group unassigned|Continue/.test(button.name));
        assert.ok(baseActions.length >= 2 && baseActions.every((button) => button.inViewport), 'baseline footer action outside viewport');
        const baseHits = baseline.hitTargets.filter((button) => /Group unassigned|Continue/.test(button.name));
        assert.ok(baseHits.some((button) => /Group unassigned/.test(button.name) && button.unobscured), 'group action obscured');
        const detailHits = detailsMeasure.hitTargets.filter((button) => /Save details|Close/.test(button.name));
        assert.ok(detailHits.length >= 2 && detailHits.every((button) => button.unobscured), 'details action obscured');
        const deleteActions = deleteMeasure.footerButtons.filter((button) => /^(Delete folder|Cancel)$/.test(button.name));
        assert.equal(deleteActions.length, 2, 'delete dialog actions missing');
        assert.ok(deleteActions.every((button) => button.inViewport), 'delete action outside viewport');
        assert.equal(selectionToolbar.folderSelectionToolbar, true, 'folder selection toolbar not exercised');
        assert.equal(assignPopover.assetSelectionToolbar, true, 'asset selection toolbar not exercised');
      }
      summary.viewports.push({ viewport: [width, height], status: 'pass', longAssetText, baseline, detailsMeasure, deleteMeasure, selectionToolbar, assignPopover, visibleButtons: await buttons() });
    } catch (error) {
      summary.viewports.push({ viewport: [width, height], status: 'error', error: error.message.split('\n').slice(0, 8).join('\n') });
      await page.screenshot({ path: join(output, `step3-${width}x${height}-failure.png`), fullPage: true }).catch(() => {});
    }
  }
} finally {
  await browser.close();
  await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`STEP3 UX evidence at ${output}`);
}
if (summary.diagnostics.some(({ kind }) => kind === 'pageerror') || summary.viewports.some(({ status, viewport }) => status === 'error' && viewport[0] >= 980)) process.exitCode = 1;
