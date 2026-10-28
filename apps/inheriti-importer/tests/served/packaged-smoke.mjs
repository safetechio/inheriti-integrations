import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const executablePath = process.argv[2];
assert.ok(executablePath, 'Usage: node tests/served/packaged-smoke.mjs <packaged-executable>');

const requireFromHarness = createRequire(
  resolve(appRoot, '../../../bussiness/feature-e2e/package.json'),
);
const { _electron: electron } = requireFromHarness('playwright');
const profile = await mkdtemp(join(tmpdir(), 'inheriti-importer-packaged-smoke-'));
let app;

try {
  app = await electron.launch({
    executablePath: resolve(executablePath),
    args: ['--no-sandbox', '--disable-gpu'],
    cwd: appRoot,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: profile,
    },
  });
  const window = await app.firstWindow();
  await window.getByRole('button', { name: 'Sign in with SafeID' }).waitFor();
  const runtime = await app.evaluate(({ app: electronApp }) => ({
    isPackaged: electronApp.isPackaged,
    environment: process.env.INHERITI_ENV,
    apiOrigin: process.env.INHERITI_API_ORIGIN,
    safeIdUrl: process.env.SAFEID_URL,
    safeIdRealm: process.env.SAFEID_REALM,
    safeIdClientId: process.env.SAFEID_CLIENT_ID,
  }));
  assert.equal(runtime.isPackaged, true);
  assert.ok(runtime.apiOrigin);
  assert.ok(runtime.safeIdUrl);
  assert.ok(runtime.safeIdRealm);
  assert.ok(runtime.safeIdClientId);
  assert.equal(await window.title(), 'Inheriti® Importer');
  console.log(JSON.stringify({ status: 'passed', runtime }, null, 2));
} finally {
  await app?.close();
  await rm(profile, { recursive: true, force: true });
}
