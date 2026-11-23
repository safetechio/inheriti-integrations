import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const appRoot = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const playwrightRoot =
  process.env.PLAYWRIGHT_PACKAGE_ROOT ??
  resolve(appRoot, '../../../../business/inheriti-business-ui/node_modules/playwright');
const { chromium } = require(playwrightRoot);
const port = Number(process.env.IMPORTER_QUICK_GUIDE_PORT ?? '6140');
const base = process.env.IMPORTER_QUICK_GUIDE_URL ?? `http://127.0.0.1:${port}/`;
const evidence = process.env.IMPORTER_QUICK_GUIDE_EVIDENCE ?? join(tmpdir(), 'importer-quick-guide-evidence');
const browserMode = process.argv.includes('--browser');
const failures = [];
let server;
let browser;
let page;

async function startServer() {
  if (process.env.IMPORTER_QUICK_GUIDE_URL) return;
  assert.equal(await fetch(base).catch(() => null), null, `Port ${port} is already in use.`);
  server = spawn(process.execPath, [resolve(appRoot, 'node_modules/@ladle/react/lib/cli/cli.js'), 'serve', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: appRoot,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const deadline = Date.now() + 30000;
  for (;;) {
    assert.equal(server.exitCode, null, 'Ladle exited before readiness.');
    if ((await fetch(base).catch(() => null))?.ok) return;
    assert.ok(Date.now() < deadline, 'Ladle did not respond.');
    await delay(200);
  }
}

const button = (name) => page.getByRole('button', { name, exact: true });
const dialog = () => page.getByRole('dialog');
const illustration = () => page.locator('.quick-guide-illustration');

async function modalSnapshot() {
  const modal = dialog();
  return {
    title: await modal.getByRole('heading').first().textContent(),
    counter: await modal.getByText(/^[1-5] of [35]$/).textContent(),
    frameCount: await illustration().locator('.quick-guide-frame').count(),
    modalHeight: (await modal.boundingBox())?.height,
  };
}

async function assertAnimation() {
  assert.equal(await illustration().count(), 1, 'Expected one active illustration.');
  assert.equal(await illustration().locator('.quick-guide-frame').count(), 3, 'Expected three layered frames.');
  const cursor = illustration().locator('.quick-guide-demo-cursor');
  const before = await cursor.evaluate((node) => getComputedStyle(node).transform);
  await delay(1400);
  const after = await cursor.evaluate((node) => getComputedStyle(node).transform);
  assert.notEqual(before, after, 'The demonstration cursor did not move.');
}

async function assertKeyboardIsolation(before) {
  for (const key of ['A', 'X', 'Control+A']) {
    await page.keyboard.press(key);
    assert.equal(await dialog().count(), 1, `${key} unexpectedly changed modal state.`);
  }
  const underlying = await page.evaluate(() => {
    const modalText = document.querySelector('[role="dialog"]')?.textContent ?? '';
    return document.body.textContent?.replace(modalText, '') ?? '';
  });
  assert.deepEqual(underlying, before, 'Underlying workspace changed behind guide.');
}

async function verifyRealPlanCreation() {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto(new URL('?story=folder-grouping-interactions--organisation-folder-tree&mode=preview', base).href);
  const direction = page.locator('.plan-grouping-direction');
  await direction.waitFor();
  const left = await page.locator('.plan-grouping-unassigned').boundingBox();
  const right = await page.locator('.plan-draft-column').boundingBox();
  const circle = await direction.boundingBox();
  assert.ok(left && right && circle && circle.x >= left.x + left.width && circle.x + circle.width <= right.x, 'Direction circle overlaps a panel.');
  assert.equal(await direction.evaluate(node => getComputedStyle(node).pointerEvents), 'none');
  await page.getByRole('checkbox', { name: 'Select Database password', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Select Payments API key', exact: true }).check();
  await button('New plan').click();
  const name = page.getByRole('textbox', { name: 'Plan name', exact: true });
  await name.waitFor();
  assert.equal(await page.getByRole('checkbox', { name: 'Select Kubernetes token', exact: true }).count(), 1);
  assert.match(await page.locator('.plan-draft-column').innerText(), /2 assets/);
  await name.fill('Access plan');
  await name.press('Enter');
  await page.getByText('Access plan', { exact: true }).waitFor();
  await page.screenshot({ path: join(evidence, 'real-selected-assets-new-plan.png'), fullPage: true });
  await page.setViewportSize({ width: 640, height: 640 });
  assert.equal(await direction.isVisible(), false, 'Direction circle should be hidden when panels stack.');
  await page.setViewportSize({ width: 1024, height: 800 });
}

async function verifyStage(stage, index) {
  const sceneCount = stage === 'create-plans' ? 5 : 3;
  const url = new URL(base);
  url.search = `?story=quick-guide--${stage}&mode=preview`;
  await page.goto(url.href);
  await page.getByRole('button', { name: 'Quick guide', exact: true }).waitFor();
  const workspaceBefore = await page.locator('body').textContent();
  const trigger = page.getByRole('button', { name: 'Quick guide', exact: true });
  await trigger.focus();
  await trigger.click();
  const modal = dialog();
  await modal.waitFor();
  assert.equal(await modal.getAttribute('aria-label'), `Quick guide · ${stage === 'review-assets' ? 'Review assets' : 'Create plans'}`);
  assert.equal(await button('Previous').isDisabled(), true);
  assert.equal(await button('Next').count(), 1);
  assert.equal(await modal.locator('.quick-guide-frame').count(), 3);
  assert.match(await modal.locator('.quick-guide-scene-shell').evaluate((node) => getComputedStyle(node).transitionProperty), /height/);
  await assertAnimation();
  await assertKeyboardIsolation(workspaceBefore);
  await page.keyboard.press('Escape');
  await modal.waitFor({ state: 'hidden' });
  await trigger.click();
  await modal.waitFor();
  const dots = modal.getByRole('button', { name: /^Show scene / });
  assert.equal(await dots.count(), sceneCount, 'Expected one dot per scene.');
  await dots.last().click();
  assert.equal(await dots.last().getAttribute('aria-current'), 'step');
  assert.equal((await modalSnapshot()).counter, `${sceneCount} of ${sceneCount}`);
  await dots.nth(0).click();
  assert.equal(await dots.nth(0).getAttribute('aria-current'), 'step');

  for (let scene = 0; scene < sceneCount; scene += 1) {
    assert.equal((await modalSnapshot()).counter, `${scene + 1} of ${sceneCount}`);
    await page.evaluate(() => document.getSelection()?.removeAllRanges());
    // Inspect the gestures themselves, not just a before/after state change.
    const seek = async (time) => illustration().evaluate((node, value) => {
      for (const animation of node.getAnimations({ subtree: true })) {
        animation.pause();
        animation.currentTime = value;
      }
    }, time);
    await seek(1900);
    const firstPoint = await illustration().locator('.quick-guide-demo-cursor').boundingBox();
    await seek(4200);
    await page.screenshot({ path: join(evidence, `${stage}-scene-${scene + 1}-action.png`), fullPage: true });
    if (await illustration().evaluate(node => node.classList.contains('gesture-folders'))) {
      await seek(5400);
      await page.screenshot({ path: join(evidence, `${stage}-scene-${scene + 1}-subfolder.png`), fullPage: true });
    }
    if (await illustration().evaluate(node => node.classList.contains('gesture-create'))) {
      await seek(6900);
      const preview = illustration().locator('.quick-guide-create-preview');
      assert.equal(await preview.evaluate(node => getComputedStyle(node).opacity), '1', 'Create assets skipped the confirmation preview.');
      await page.screenshot({ path: join(evidence, `${stage}-scene-${scene + 1}-confirm.png`), fullPage: true });
    }
    const menu = illustration().locator('.quick-guide-demo-menu');
    if (await menu.count()) assert.equal(await menu.evaluate((node) => getComputedStyle(node).opacity), '1', 'Action menu did not open.');
    const ghost = illustration().locator('.quick-guide-drag-card');
    if (await ghost.count()) {
      await seek(5100);
      const source = await ghost.boundingBox();
      await seek(6000);
      const moving = await ghost.boundingBox();
      assert.ok(source && moving && moving.x > source.x + 20, 'Dragged cards did not travel towards the plan.');
      assert.equal(await ghost.evaluate((node) => getComputedStyle(node).opacity), '1');
      await page.screenshot({ path: join(evidence, `${stage}-scene-${scene + 1}-drag.png`), fullPage: true });
    }
    await seek(7200);
    const lastPoint = await illustration().locator('.quick-guide-demo-cursor').boundingBox();
    assert.ok(firstPoint && lastPoint && Number.isFinite(lastPoint.x) && lastPoint.x > 0, 'Cursor has invalid coordinates.');
    if (await illustration().evaluate(node => node.classList.contains('gesture-new-plan'))) {
      await seek(7200);
      const trigger = illustration().locator('.quick-guide-frame:nth-child(2) .quick-guide-demo-control');
      assert.equal(await trigger.textContent(), 'New plan');
      const cursor = await illustration().locator('.quick-guide-demo-cursor').boundingBox();
      const control = await trigger.boundingBox();
      assert.ok(cursor && control && Math.abs(cursor.x - (control.x + control.width / 2)) < 3, 'Cursor missed the real New plan action.');
      await seek(9000);
      assert.equal(await illustration().locator('.quick-guide-plan-name-editor').evaluate(node => getComputedStyle(node).opacity), '1');
      await page.screenshot({ path: join(evidence, `${stage}-new-plan-name.png`), fullPage: true });
    }
    await seek(10800);
    assert.equal(await illustration().locator('.quick-guide-frame').last().evaluate((node) => getComputedStyle(node).opacity), '1', 'Result was not shown after the gesture.');
    await page.screenshot({ path: join(evidence, `${stage}-scene-${scene + 1}.png`), fullPage: true });
    if (scene < sceneCount - 1) await button('Next').click();
  }
  assert.equal(await button('Done').count(), 1);
  assert.equal(await button('Previous').isDisabled(), false);
  await button('Previous').click();
  assert.equal((await modalSnapshot()).counter, `${sceneCount - 1} of ${sceneCount}`);

  await button('Next').click();
  await button('Replay').click();
  const animation = illustration();
  await button('Pause').click();
  assert.equal(await animation.evaluate((node) => node.classList.contains('is-paused')), true);
  const paused = await animation.locator('.quick-guide-frame').first().evaluate((node) => getComputedStyle(node).animationPlayState);
  assert.equal(paused, 'paused');
  await delay(250);
  const pausedTransform = await animation.locator('.quick-guide-demo-cursor').evaluate((node) => getComputedStyle(node).transform);
  await delay(250);
  assert.equal(await animation.locator('.quick-guide-demo-cursor').evaluate((node) => getComputedStyle(node).transform), pausedTransform);
  await button('Play').click();
  assert.equal(await animation.locator('.quick-guide-frame').first().evaluate((node) => getComputedStyle(node).animationPlayState), 'running');
  await button('Replay').click();
  assert.equal(await animation.evaluate((node) => node.classList.contains('is-paused')), false);

  await page.setViewportSize({ width: 1024, height: 800 });
  const desktopHeight = (await modal.boundingBox())?.height;
  for (const [width, height] of [[980, 680], [640, 640]]) {
    await page.setViewportSize({ width, height });
    const box = await modal.boundingBox();
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height, `${stage} modal overflows ${width}x${height}: ${JSON.stringify(box)}`);
    assert.ok((await page.locator('.quick-guide-footer').boundingBox())?.y < height, `${stage} footer is unreachable at ${width}x${height}`);
    await delay(300);
    const responsiveHeight = (await modal.boundingBox())?.height;
    assert.ok(responsiveHeight && responsiveHeight > 0, `${stage} modal has no settled height at ${width}x${height}`);
  }
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.keyboard.press('Escape');
  await modal.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: 'Quick guide', exact: true }).evaluate((node) => document.activeElement === node), true, `${stage} did not restore focus.`);
  assert.deepEqual(await page.locator('body').textContent(), workspaceBefore, `${stage} workspace changed after close.`);

  await page.getByRole('button', { name: 'Quick guide', exact: true }).click();
  await button('Replay').focus();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('.quick-guide-illustration')?.classList.contains('is-static'));
  const staticMode = await illustration().evaluate((node) => node.classList.contains('is-static'));
  if (!staticMode) failures.push(`${stage} did not respond to reduced-motion media change`);
  if (staticMode) {
    assert.equal(await button('Pause').count(), 0);
    assert.equal(await modal.getByText('Reduced motion is on', { exact: true }).count(), 1);
    assert.equal(await modal.locator('[aria-current="step"]').evaluate((node) => document.activeElement === node), true, 'Reduced-motion transition did not restore focus to the current scene.');
    await page.keyboard.press('Tab');
    assert.equal(await modal.evaluate((node) => node.contains(document.activeElement)), true, 'Tab escaped the guide dialog.');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await modal.evaluate((node) => node.contains(document.activeElement)), true, 'Shift+Tab escaped the guide dialog.');
  }
  const staticFrame = illustration().locator('.quick-guide-frame').last();
  assert.equal(await staticFrame.evaluate((node) => getComputedStyle(node).opacity), '1');
  await page.screenshot({ path: join(evidence, `${stage}-reduced-motion.png`), fullPage: true });
  await page.keyboard.press('Escape');
  await modal.waitFor({ state: 'hidden' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await illustration().count(), 0, `${stage} animation remained mounted after close.`);
  index += 1;
  return index;
}

try {
  await mkdir(evidence, { recursive: true });
  await startServer();
  browser = await chromium.launch({ headless: !browserMode });
  page = await browser.newPage({ viewport: { width: 1024, height: 800 } });
  page.setDefaultTimeout(20000);
  await verifyRealPlanCreation();
  let count = 0;
  count = await verifyStage('review-assets', count);
  count = await verifyStage('create-plans', count);
  await page.evaluate(() => localStorage.removeItem('importer.quick-guide.dismissed.assets.v1'));
  await page.goto(new URL('?story=quick-guide--first-visit&mode=preview', base).href);
  await dialog().waitFor();
  await button('Skip').click();
  await dialog().waitFor({ state: 'hidden' });
  await page.reload();
  await button('Quick guide').waitFor();
  assert.equal(await dialog().count(), 0, 'A dismissed guide reopened automatically.');
  await button('Quick guide').click();
  await dialog().waitFor();
  await button('Skip').click();
  await dialog().waitFor({ state: 'hidden' });
  if (failures.length) throw new Error(`Quick guide verification failures:\n${failures.join('\n')}`);
  console.log(JSON.stringify({ pass: true, stages: count, evidence }, null, 2));
} finally {
  await browser?.close();
  if (server && server.exitCode === null) server.kill('SIGTERM');
  await delay(100);
}
