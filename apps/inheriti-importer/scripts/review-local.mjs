#!/usr/bin/env node
// Drive the served renderer through the real Electron main/preload and import lifecycle.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const workspace = resolve(appRoot, '../../../..');
const businessUi = resolve(workspace, 'business/inheriti-business-ui');
const { _electron: electron, chromium } = createRequire(resolve(businessUi, 'package.json'))(
  'playwright',
);
const fixture = resolve(appRoot, 'tests/fixtures/sample-imports/keepass-demo-vault.kdbx');
const rendererUrl = 'http://127.0.0.1:5173';
const apiOrigin = 'http://business.localhost:3400';

function options(argv) {
  const result = {
    manual: false,
    keepOpen: false,
    output: resolve(
      workspace,
      'tasks/importer-improvements/evidence/real-electron',
      new Date().toISOString().replace(/[:.]/g, '-'),
    ),
  };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === '--') continue;
    if (value === '--manual') result.manual = true;
    else if (value === '--keep-open') result.keepOpen = true;
    else if (value === '--output' && argv[index + 1]) result.output = resolve(argv[++index]);
    else throw Error(`Unknown or incomplete option: ${value}`);
  }
  return result;
}

async function available(url) {
  const host = new URL(url).host;
  const hint =
    host === '127.0.0.1:5173'
      ? 'Start Importer dev:web at 127.0.0.1:5173.'
      : 'Start the Business harness API at business.localhost:3400.';
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  } catch {
    throw Error(hint);
  }
  assert(response.ok, hint);
}

function secret(name) {
  for (const nameOfFile of ['.env.e2e.local', '.env.e2e']) {
    let contents;
    try {
      contents = readFileSync(join(businessUi, nameOfFile), 'utf8');
    } catch {
      continue;
    }
    const line = contents
      .split(/\r?\n/)
      .find((part) => part.match(new RegExp(`^\\s*${name}\\s*=`)));
    if (line)
      return line
        .slice(line.indexOf('=') + 1)
        .trim()
        .replace(/^(['"])(.*)\1$/, '$2');
  }
  return undefined;
}

async function authenticate(app, window, output) {
  await app.evaluate(({ shell }) => {
    const openExternal = shell.openExternal;
    shell.openExternal = async (url) => {
      globalThis.__reviewAuthUrl = url;
    };
    globalThis.__restoreReviewOpener = () => {
      shell.openExternal = openExternal;
      delete globalThis.__reviewAuthUrl;
      delete globalThis.__restoreReviewOpener;
    };
  });
  await window.getByRole('button', { name: 'Sign in with SafeID' }).click();
  let authUrl;
  for (let attempt = 0; attempt < 100; attempt++) {
    authUrl = await app.evaluate(() => globalThis.__reviewAuthUrl);
    if (authUrl) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert(authUrl, 'Real OIDC browser URL was not opened');
  let browser;
  let page;
  try {
    browser = await chromium.launch({ headless: true });
    const storagePath = resolve(businessUi, '.playwright/auth/owner.json');
    let storageState;
    try {
      await readFile(storagePath);
      storageState = storagePath;
    } catch {
      /* Login form is handled below. */
    }
    const context = await browser.newContext(storageState ? { storageState } : {});
    page = await context.newPage();
    await page.goto(authUrl, { waitUntil: 'domcontentloaded' });
    const login = page
      .locator('input[name="email"], input[name="username"], input#username')
      .first();
    const landing = window.getByRole('button', { name: 'Choose files' });
    let loginForm = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await landing.isVisible().catch(() => false)) break;
      loginForm = await login.isVisible().catch(() => false);
      if (loginForm) break;
      await new Promise((done) => setTimeout(done, 200));
    }
    if (loginForm) {
      const email = secret('E2E_OWNER_EMAIL');
      const password = secret('E2E_OWNER_PASSWORD');
      assert(email && password, 'Real OIDC login needs the ignored Business E2E owner credentials');
      await login.fill(email);
      await page.locator('input[name="password"], input#password').first().fill(password);
      await page.locator('input[type="submit"], button[type="submit"]').first().click();
    }
    await window.getByRole('button', { name: 'Choose files' }).waitFor({ timeout: 45000 });
  } catch (error) {
    if (page) {
      const details = await page
        .evaluate(() => ({
          origin: location.origin,
          loginForm: Boolean(
            document.querySelector('input[name="email"], input[name="username"], input#username'),
          ),
          passwordInput: Boolean(document.querySelector('input[name="password"], input#password')),
          otpInput: Boolean(
            document.querySelector('input[autocomplete="one-time-code"], input[name="otp"]'),
          ),
          error: /invalid credentials/i.test(document.body.innerText)
            ? 'invalid-credentials'
            : /required action/i.test(document.body.innerText)
              ? 'required-action'
              : 'none',
        }))
        .catch(() => null);
      await writeFile(join(output, 'auth-browser-failure.json'), JSON.stringify(details, null, 2), {
        mode: 0o600,
      }).catch(() => {});
      await page.screenshot({ path: join(output, 'auth-browser-failure.png') }).catch(() => {});
    }
    throw error;
  } finally {
    await app.evaluate(() => globalThis.__restoreReviewOpener?.());
    await browser?.close();
  }
}

async function capture(window, output, name) {
  await window.screenshot({ path: join(output, name), fullPage: false });
}

async function measureUnlock(app, window, row, panel, output, prefix = '02c-unlock') {
  const original = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getContentSize(),
  );
  const results = [];
  for (const [width, height] of [
    [1440, 1000],
    [1280, 800],
    [980, 680],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size),
      [width, height],
    );
    await window.waitForTimeout(150);
    const bounds = async (locator) => locator.boundingBox();
    const input = await bounds(panel.getByLabel('Master password', { exact: true }));
    const eye = await bounds(panel.getByRole('button', { name: 'Show password' }));
    const choose = await bounds(panel.getByRole('button', { name: 'Choose file' }));
    const cancel = await bounds(panel.getByRole('button', { name: 'Cancel' }));
    const submit = await bounds(panel.getByRole('button', { name: 'Unlock' }));
    const card = await bounds(row);
    const trigger = await bounds(row.getByRole('button', { name: 'Unlock' }).first());
    const popup = await bounds(panel);
    const viewport = await window.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    const right = (box) => box.x + box.width;
    const bottom = (box) => box.y + box.height;
    const checks = {
      noHorizontalOverflow: viewport.scrollWidth <= viewport.width,
      popupInsideViewport:
        popup.x >= 0 && right(popup) <= viewport.width && bottom(popup) <= viewport.height,
      popupInsideCard: bottom(popup) <= bottom(card) + 2,
      popupRightAlignedToTrigger: Math.abs(right(popup) - right(trigger)) <= 2,
      eyeInsideInput:
        eye.x >= input.x &&
        right(eye) <= right(input) &&
        eye.y >= input.y &&
        bottom(eye) <= bottom(input),
      eyeVerticallyCentered: Math.abs(eye.y + eye.height / 2 - (input.y + input.height / 2)) <= 3,
    };
    results.push({
      contentSize: [width, height],
      viewport,
      bounds: { input, eye, choose, cancel, submit, card, trigger, panel: popup },
      checks,
    });
    await capture(window, output, `${prefix}-${width}x${height}.png`);
  }
  await app.evaluate(
    ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size),
    original,
  );
  await writeFile(
    join(output, prefix === '02c-unlock' ? 'unlock-geometry.json' : 'wrong-password-geometry.json'),
    JSON.stringify({ originalContentSize: original, results }, null, 2),
    { mode: 0o600 },
  );
  assert(
    results.every((result) => Object.values(result.checks).every(Boolean)),
    'Real unlock geometry check failed; see unlock-geometry.json',
  );
  return original;
}

async function verifyImport(app, window, output, checkpoint) {
  checkpoint.stage = 'authorized landing';
  await capture(window, output, '01-authorized-landing.png');
  checkpoint.stage = 'native file selection';
  await app.evaluate(({ dialog }, path) => {
    const showOpenDialog = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    globalThis.__restoreReviewPicker = () => {
      dialog.showOpenDialog = showOpenDialog;
      delete globalThis.__restoreReviewPicker;
    };
  }, fixture);
  try {
    await window.getByRole('button', { name: 'Choose files' }).click();
  } finally {
    await app.evaluate(() => globalThis.__restoreReviewPicker?.());
  }
  const row = window.locator('.source-file-card').filter({ hasText: 'keepass-demo-vault.kdbx' });
  await row.getByText('Locked database').waitFor({ timeout: 30000 });
  await capture(window, output, '02-locked-database.png');
  checkpoint.stage = 'empty unlock form';
  await row.getByRole('button', { name: 'Unlock' }).first().click();
  const panel = row.locator('.source-unlock-panel');
  const password = panel.getByLabel('Master password', { exact: true });
  await password.waitFor();
  assert(
    await password.evaluate((element) => element === document.activeElement),
    'Unlock did not focus the master password',
  );
  await capture(window, output, '02b-unlock-empty.png');
  checkpoint.stage = 'responsive unlock geometry';
  const contentSize = await measureUnlock(app, window, row, panel, output);
  checkpoint.stage = 'wrong password';
  await password.fill('incorrect-review-password');
  await panel.getByRole('button', { name: 'Unlock' }).click();
  await row
    .getByText('Could not open this KeePass database. Check the master password or key file.')
    .waitFor({ timeout: 30000 });
  await row.getByText('Locked database').waitFor();
  assert(await password.isVisible(), 'Wrong password closed the unlock form');
  assert.equal(
    await password.inputValue(),
    'incorrect-review-password',
    'Wrong password cleared the retry input',
  );
  await capture(window, output, '03-wrong-password.png');
  await measureUnlock(app, window, row, panel, output, '03b-wrong-password');
  checkpoint.stage = 'cancel and focus return';
  await panel.getByRole('button', { name: 'Cancel' }).click();
  await panel.waitFor({ state: 'hidden' });
  const trigger = row.getByRole('button', { name: 'Unlock' }).first();
  assert(
    await trigger.evaluate((element) => element === document.activeElement),
    'Cancel did not return focus to Unlock',
  );
  checkpoint.stage = 'real KDBX unlock';
  await trigger.click();
  await panel.getByLabel('Master password', { exact: true }).fill('demo-password');
  await panel.getByRole('button', { name: 'Unlock' }).click();
  await row.getByText('4 entries').waitFor({ timeout: 30000 });
  await capture(window, output, '04-real-kdbx-entries.png');
  checkpoint.stage = 'real Step 2';
  await window.getByRole('button', { name: 'Continue' }).click();
  await window.getByText('Review detected assets').waitFor({ timeout: 30000 });
  await capture(window, output, '05-real-step-2.png');
  return { entries: 4, contentSize };
}

async function main() {
  const flags = options(process.argv.slice(2));
  await available(rendererUrl);
  await available(`${apiOrigin}/health-check`);
  const fixtureHash = createHash('sha256')
    .update(await readFile(fixture))
    .digest('hex');
  await mkdir(flags.output, { recursive: true, mode: 0o700 });
  const profile = await mkdtemp(join(tmpdir(), 'importer-real-review-'));
  let app;
  let window;
  const checkpoint = { stage: 'launch' };
  try {
    const integrationsRoot = resolve(appRoot, '../..');
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: integrationsRoot,
      encoding: 'utf8',
    }).trim();
    const dirty =
      execFileSync('git', ['status', '--porcelain'], {
        cwd: integrationsRoot,
        encoding: 'utf8',
      }).trim().length > 0;
    const localConfig = Object.fromEntries(
      (await readFile(join(appRoot, '.env.local'), 'utf8'))
        .split(/\r?\n/)
        .map((line) =>
          line.match(/^\s*(INHERITI_API_ORIGIN|SAFEID_URL|SAFEID_REALM)\s*=\s*(.*?)\s*$/),
        )
        .filter(Boolean)
        .map((match) => [match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]),
    );
    assert.equal(
      localConfig.INHERITI_API_ORIGIN,
      apiOrigin,
      '.env.local must target the running local Business API',
    );
    assert(
      localConfig.SAFEID_URL && localConfig.SAFEID_REALM,
      '.env.local needs the real SafeID issuer and realm',
    );
    app = await electron.launch({
      executablePath: join(appRoot, 'node_modules/.bin/electron'),
      args: [appRoot, '--no-sandbox', '--disable-gpu'],
      cwd: appRoot,
      env: { ...process.env, ...localConfig, XDG_CONFIG_HOME: profile, INHERITI_ENV: 'local' },
    });
    window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    let imported = null;
    if (flags.manual) {
      checkpoint.stage = 'manual';
      await capture(window, flags.output, '01-real-electron.png');
    } else {
      checkpoint.stage = 'authentication';
      await authenticate(app, window, flags.output);
      imported = await verifyImport(app, window, flags.output, checkpoint);
    }
    const sourceFiles = [
      'src/App.tsx',
      'src/modules/importer-preview/SourceImportStatus/components/FileRow.tsx',
      'src/modules/importer-preview/SourceImportStatus/styles.css',
      'scripts/review-local.mjs',
    ];
    const sourceSha256 = Object.fromEntries(
      await Promise.all(
        sourceFiles.map(async (path) => [
          path,
          createHash('sha256')
            .update(await readFile(join(appRoot, path)))
            .digest('hex'),
        ]),
      ),
    );
    const runtime = await app.evaluate(() => ({
      electron: process.versions.electron,
      chromium: process.versions.chrome,
    }));
    await writeFile(
      join(flags.output, 'provenance.json'),
      JSON.stringify(
        {
          sourceCommit,
          dirty,
          sourceSha256,
          rendererUrl,
          apiOrigin,
          fixtureSha256: fixtureHash,
          runtime,
          contentSize: imported?.contentSize ?? null,
          authentication: flags.manual ? 'manual, unverified' : 'real OIDC and Business API',
          parsing: flags.manual ? 'unverified' : 'real IPC, lifecycle and kdbxweb',
          importedEntries: imported?.entries ?? null,
          hostAutomation: flags.manual
            ? []
            : [
                'shell.openExternal forwarded real OIDC URL to Playwright Chromium',
                'dialog.showOpenDialog selected the existing public KDBX fixture',
              ],
          screenshots: flags.manual
            ? ['01-real-electron.png']
            : [
                '01-authorized-landing.png',
                '02-locked-database.png',
                '02b-unlock-empty.png',
                '02c-unlock-1440x1000.png',
                '02c-unlock-1280x800.png',
                '02c-unlock-980x680.png',
                '03-wrong-password.png',
                '03b-wrong-password-1440x1000.png',
                '03b-wrong-password-1280x800.png',
                '03b-wrong-password-980x680.png',
                '04-real-kdbx-entries.png',
                '05-real-step-2.png',
              ],
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    process.stdout.write(`Real Electron review saved to ${flags.output}\n`);
    if (flags.manual || flags.keepOpen) {
      process.stdout.write(
        'Electron remains open for manual review; close its window to finish.\n',
      );
      await new Promise((done) => app.once('close', done));
      app = undefined;
    }
  } catch (error) {
    await writeFile(
      join(flags.output, 'failure.json'),
      JSON.stringify({ stage: checkpoint.stage, kind: error?.name ?? 'Error' }, null, 2),
      { mode: 0o600 },
    ).catch(() => {});
    if (window) await capture(window, flags.output, 'failure-real-electron.png').catch(() => {});
    process.stderr.write(
      `Real Electron review stopped during ${checkpoint.stage}; no simulated screen or auth fallback was used.\n`,
    );
    process.exitCode = 1;
  } finally {
    await app?.close().catch(() => {});
    await rm(profile, { recursive: true, force: true });
  }
}

await main();
