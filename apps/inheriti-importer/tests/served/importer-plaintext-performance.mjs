import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(
  resolve(root, '../../../../business/inheriti-business-ui/node_modules/playwright'),
);
const url = new URL(process.env.IMPORTER_TYPING_URL ?? 'http://127.0.0.1:6132/');
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Use a local Importer story server.');
url.search = '?story=import-preservation-context--encrypted-staging&mode=preview';
const fixtureRoot = resolve(root, 'tests/fixtures/sample-imports/realistic');
const manifest = JSON.parse(await readFile(join(fixtureRoot, 'manifest.json'), 'utf8'));
assert.equal(manifest.synthetic, true);
const output =
  process.env.IMPORTER_TYPING_OUTPUT ??
  join(tmpdir(), `importer-plaintext-performance-${Date.now()}.json`);
const scenarios = [
  {
    name: 'realistic-113',
    files: ['onepassword-rich.1pux', 'passbolt-compatible.json', 'passbolt-export.csv'],
  },
  ...(process.argv.includes('--bulk')
    ? [
        {
          name: 'bulk-1121',
          files: ['onepassword-rich.1pux', 'onepassword-bulk.1pux', 'vault-kv-v2.json'],
        },
      ]
    : []),
];
const text = 'SYNTHETIC-TYPING-PERFORMANCE-1234567890';
const results = [];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(30000);
  for (const scenario of scenarios) {
    await page.goto(url.href);
    const paths = await Promise.all(
      scenario.files.map(async (name) => {
        const path = join(fixtureRoot, name);
        assert.equal(
          createHash('sha256')
            .update(await readFile(path))
            .digest('hex'),
          manifest.files[name].sha256,
          'Fixture hash changed.',
        );
        return path;
      }),
    );
    await page.getByLabel('Import fixture files').setInputFiles(paths);
    const entries = scenario.files.reduce(
      (sum, name) => sum + manifest.files[name].expectedEntries,
      0,
    );
    await page.waitForFunction(
      (count) =>
        Number(document.querySelector('[data-testid="fixture-import-count"]')?.textContent) ===
        count,
      entries,
    );
    const next = page.getByRole('button', { name: 'Continue', exact: true });
    assert.equal(await next.isEnabled(), true, 'Warnings must not require per-source visits.');
    await next.click();
    await page
      .getByRole('dialog', { name: 'Some source content won’t be imported', exact: true })
      .getByRole('button', { name: 'Continue import', exact: true })
      .click();
    await page.getByRole('button', { name: 'Inspect Inventory handheld PIN', exact: true }).click();
    await page.getByRole('button', { name: 'Reveal plain text', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Plain text value', exact: true });
    await input.fill('');
    await page.evaluate(() => {
      globalThis.__typingPaintSamples = [];
      document
        .querySelector('textarea[aria-label="Plain text value"]')
        .addEventListener('input', () => {
          const start = performance.now();
          requestAnimationFrame(() =>
            globalThis.__typingPaintSamples.push(performance.now() - start),
          );
        });
    });
    const start = Date.now();
    await input.pressSequentially(text);
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const elapsedMs = Date.now() - start;
    assert.ok((await input.inputValue()) === text, 'Typing lost characters.');
    const samples = await page.evaluate(() => globalThis.__typingPaintSamples);
    assert.equal(samples.length, text.length);
    const sorted = samples.slice().sort((a, b) => a - b);
    const cdp = await page.context().newCDPSession(page);
    const heap = await cdp.send('Runtime.getHeapUsage');
    await cdp.detach();
    const result = {
      scenario: scenario.name,
      entries,
      characters: text.length,
      elapsedMs,
      medianPaintMs: sorted[Math.floor(sorted.length / 2)],
      p95PaintMs: sorted[Math.ceil(sorted.length * 0.95) - 1],
      maxPaintMs: sorted.at(-1),
      usedHeapMB: heap.usedSize / 1024 / 1024,
    };
    // Verify that edits reached the backing workspace, beyond the local textarea state.
    await page.getByRole('button', { name: 'Hide plain text', exact: true }).click();
    assert.ok(
      !(await input.inputValue()) || (await input.inputValue()) !== text,
      'Hide left the value visible.',
    );
    await page.getByRole('button', { name: 'Reveal plain text', exact: true }).click();
    assert.ok(
      (await input.inputValue()) === text,
      'Reveal did not restore the latest committed edit.',
    );
    await page.getByRole('button', { name: 'Reset to all imported fields', exact: true }).click();
    await page.getByRole('button', { name: 'Reveal plain text', exact: true }).click();
    assert.ok((await input.inputValue()) !== text, 'Reset retained the edited value.');
    results.push(result);
    await writeFile(output, JSON.stringify({ surface: 'browser', results }, null, 2));
    if (process.env.IMPORTER_TYPING_MAX_P95_MS)
      assert.ok(
        result.p95PaintMs <= Number(process.env.IMPORTER_TYPING_MAX_P95_MS),
        'Typing paint latency exceeded the configured budget.',
      );
    console.log(result);
  }
  console.log(`Typing performance evidence: ${output}`);
} finally {
  await browser.close();
}
