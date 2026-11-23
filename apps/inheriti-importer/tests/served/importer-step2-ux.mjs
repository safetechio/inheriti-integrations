// Synthetic Step 2 desktop viewport audit. Start Ladle on port 6119 first.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(new URL('../../../../../../business/inheriti-business-ui/package.json', import.meta.url));
const { chromium } = require('playwright');
const base = new URL(process.env.IMPORTER_STEP2_URL ?? 'http://127.0.0.1:6119/');
assert.ok(
  ['http:', 'https:'].includes(base.protocol) && ['127.0.0.1', 'localhost'].includes(base.hostname),
  'IMPORTER_STEP2_URL must point to the local Ladle server',
);
const viewports = [[1920, 1080], [1440, 900], [1280, 720], [1024, 768], [980, 680]];
const evidence = await mkdtemp(join(tmpdir(), 'importer-step2-ux-'));
const summary = { evidence, viewports: [], failures: [] };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(5000);
page.on('pageerror', (error) => summary.failures.push(`pageerror: ${error.message}`));

async function load(story, width, height) {
  await page.setViewportSize({ width, height });
  const url = new URL(base);
  url.search = `?story=${story}&mode=preview`;
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
}

async function geometry(label) {
  return page.evaluate((label) => {
    const rect = (node) => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const visible = (node) => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(node).visibility !== 'hidden'; };
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(visible);
    const dialog = dialogs.at(-1);
    const root = dialog ?? document;
    const candidates = [...root.querySelectorAll('button,[role="button"],[role="dialog"] input,[role="dialog"] textarea,[role="dialog"] [role="option"],h1,h2,h3')].filter(visible);
    const clipped = candidates.map((node) => ({ text: (node.textContent || node.getAttribute('aria-label') || '').trim().slice(0, 140), rect: rect(node), clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, title: node.getAttribute('title'), aria: node.getAttribute('aria-label') }))
      .filter((item) => item.text.length >= 20 && item.scrollWidth > item.clientWidth + 1);
    const overflow = [...root.querySelectorAll('*')].filter(visible).map((node) => ({ selector: node.className || node.tagName, rect: rect(node), scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, overflowX: getComputedStyle(node).overflowX })).filter((x) => x.scrollWidth > x.clientWidth + 1 && x.overflowX !== 'visible').slice(0, 40);
    const bodyOverflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth + 1;
    const buttons = [...(dialog?.querySelectorAll('.mw-panel-footer button, .mw-panel-footer [role="button"]') ?? [])]
      .map((node) => {
        const r = rect(node);
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          text: (node.getAttribute('aria-label') || node.textContent || '').trim(),
          rect: r,
          inViewport: visible(node) && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
          unobscured: Boolean(hit && node.contains(hit)),
          disabled: node.matches(':disabled, [aria-disabled="true"]'),
        };
      });
    return { label, viewport: [innerWidth, innerHeight], bodyOverflow, clipped, overflow, buttons, dialogs: dialogs.map(rect) };
  }, label);
}

const story = {
  shell: 'asset-flow-interactions--synthetic-controlled-asset-flow',
  coverage: 'asset-review-improvements--many-source-field-destinations',
  bulk: 'bulk-field-creation--large-two-source-bulk-creation',
  warning: 'source-review-improvements--source-review',
};
const details = () => page.getByRole('dialog', { name: 'Source field details', exact: true });
const inspector = () => page.locator('.asset-inspector-card');

async function openDetails() {
  await page.getByText('Details', { exact: true }).click();
  await details().waitFor();
  await details().getByRole('checkbox', { name: /^Select all \d+ fields in this filter$/ }).click();
}

async function checkInspector(width) {
  const title = inspector().locator('.asset-inspector-title');
  await title.waitFor();
  await inspector().locator('.asset-inspector-heading-actions').waitFor();
  const header = await title.evaluate((node) => {
    const row = node.parentElement;
    const actions = row.querySelector('.asset-inspector-heading-actions');
    return {
      title: node.getBoundingClientRect().toJSON(),
      actions: actions.getBoundingClientRect().toJSON(),
      lastAction: actions.lastElementChild.getBoundingClientRect().toJSON(),
      row: row.getBoundingClientRect().toJSON(),
    };
  });
  if (width <= 1180) {
    assert.ok(header.title.top >= header.actions.bottom - 1, 'Compact inspector title must be below actions');
    assert.ok(Math.abs(header.title.width - header.row.width) <= 1, 'Compact title must span the row');
    assert.ok(Math.abs(header.lastAction.right - header.row.right) <= 1, 'Compact actions must align right');
  } else {
    assert.ok(header.title.top < header.actions.bottom && header.actions.top < header.title.bottom, 'Desktop title and actions must share a row');
    assert.ok(header.title.right <= header.actions.left + 1, 'Desktop title must be left of actions');
  }
  return header;
}

async function checkLayout(storyId, width, height, label, exercise, expectDialog = true) {
  try {
    await load(storyId, width, height);
    const inspectorHeader = await exercise();
    const result = await geometry(label);
    await page.screenshot({ path: join(evidence, `${label}-${width}x${height}.png`), fullPage: true });
    assert.equal(result.bodyOverflow, false, `${label}: document overflows viewport`);
    assert.equal(result.clipped.length, 0, `${label}: clipped text ${JSON.stringify(result.clipped)}`);
    assert.equal(result.dialogs.length > 0, expectDialog, `${label}: unexpected dialog state`);
    if (expectDialog) {
      const enabled = result.buttons.filter((button) => !button.disabled);
      assert.ok(enabled.length, `${label}: no enabled footer actions in the active dialog`);
      const inaccessible = enabled.filter((button) => !button.inViewport || !button.unobscured);
      assert.equal(inaccessible.length, 0, `${label}: footer actions out of bounds or obscured ${JSON.stringify(inaccessible)}`);
    }
    summary.viewports.push(inspectorHeader ? { ...result, inspectorHeader } : result);
  } catch (error) {
    summary.failures.push({ label, viewport: [width, height], message: error.message });
    await page.screenshot({ path: join(evidence, `failure-${label}-${width}x${height}.png`), fullPage: true }).catch(() => {});
  }
}

try {
  for (const [width, height] of viewports) {
    await checkLayout(story.shell, width, height, 'review-shell', () => checkInspector(width), false);
    await checkLayout(story.coverage, width, height, 'source-details', openDetails);
    await checkLayout(story.coverage, width, height, 'needs-review-issues', async () => {
      await inspector().getByRole('button', { name: 'View asset issues', exact: true }).click();
      const issues = page.getByRole('dialog', { name: / — Issues$/ });
      await issues.getByRole('checkbox', { name: /^(Select field|Select all \d+ fields)$/ }).click();
    });
    await checkLayout(story.bulk, width, height, 'bulk-create', async () => {
      await openDetails();
      await details().getByRole('button', { name: 'Create assets', exact: true }).click();
      await page.getByRole('dialog', { name: 'Create assets', exact: true }).waitFor();
    });
  }
  for (const [width, height] of viewports) {
    await checkLayout(story.warning, width, height, 'source-warning-dialog', async () => {
      await page.getByRole('button', { name: /View warnings/ }).click();
      await page.getByRole('dialog').waitFor();
    });
  }
} finally {
  await writeFile(join(evidence, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  await browser.close();
  console.log(`STEP2 UX evidence at ${evidence}`);
}
if (summary.failures.length) process.exitCode = 1;
