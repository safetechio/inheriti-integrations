import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const integrationsRoot = resolve(appRoot, '../..');
const harnessRoot = resolve(appRoot, '../../../bussiness/feature-e2e');
const requireFromHarness = createRequire(join(harnessRoot, 'package.json'));
const { chromium, _electron: electron } = requireFromHarness('playwright');
const { accounts, ports } = await import(pathToFileURL(join(harnessRoot, 'lib/env.mjs')));
const { startStack } = await import(pathToFileURL(join(harnessRoot, 'config/services.mjs')));
const { ensureTracerTenant, authenticatedApiRequest } = await import(
  pathToFileURL(join(harnessRoot, 'tests/support/tenant-bootstrap.mjs'))
);
const { claimAndDistributeOrganizationKey } = await import(
  pathToFileURL(join(harnessRoot, 'tests/support/organization-key-claim.mjs'))
);
const { createEvidenceRun, finalizeManifest, recordOracleResult } = await import(
  pathToFileURL(join(harnessRoot, 'lib/evidence.mjs'))
);
const { revisionInfo } = await import(pathToFileURL(join(harnessRoot, 'lib/git.mjs')));

const apiOrigin = `http://localhost:${ports.api}`;
const safeIdUrl = `http://localhost:${ports.keycloak}`;
const evidenceDir = createEvidenceRun({
  scenarioId: 'e2e-importer-staging',
  actorRoles: ['owner', 'manager'],
});
const directory = await mkdtemp(join(tmpdir(), 'importer-staging-'));
const urlFile = join(directory, 'oauth-urls');
const opener = join(directory, 'xdg-open');
const importFile = join(directory, 'small.env');
const marker = 'staging-secret-never-in-api-response-7139';
let stopStack;
let vite;
let app;
let browser;
let proxy;
let fixtureProxy;
let completed = false;
let runError;
let cleanupError;
let stageRequest;
let stageResponse;

async function poll(read, expected, timeout = 60_000) {
  const end = Date.now() + timeout;
  let actual;
  while (Date.now() < end) {
    actual = await read();
    if (actual === expected) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  assert.equal(actual, expected);
}

async function recordImporterRevision() {
  const files = execFileSync(
    'git',
    [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      'apps/inheriti-importer',
    ],
    { cwd: integrationsRoot, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean)
    .sort();
  const fingerprint = createHash('sha256');
  for (const file of files) {
    fingerprint.update(file).update('\0');
    try {
      fingerprint.update(await readFile(join(integrationsRoot, file)));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      fingerprint.update('<deleted>');
    }
    fingerprint.update('\0');
  }
  const manifestPath = join(evidenceDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.revisions.integrations = revisionInfo(integrationsRoot);
  manifest.revisions.importerTree = {
    scope: 'apps/inheriti-importer tracked and non-ignored untracked paths',
    algorithm: 'sha256 path-and-content, with deleted-path marker',
    sha256: fingerprint.digest('hex'),
    fileCount: files.length,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function loginBusiness(context, account) {
  const tokenResponse = await fetch(
    `${safeIdUrl}/realms/inheriti-business-e2e/protocol/openid-connect/token`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'business-ui-e2e',
        username: account.email,
        password: account.password,
        scope: 'openid',
      }),
    },
  );
  assert.equal(tokenResponse.status, 200);
  const { access_token: token } = await tokenResponse.json();
  const subject = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
  const csrfResponse = await context.request.get(`${apiOrigin}/csrf`);
  const csrf = (await csrfResponse.json()).result?.token;
  const loginResponse = await context.request.post(`${apiOrigin}/user/browser-sessions/login`, {
    headers: { 'x-csrf-token': csrf, 'Content-Type': 'application/json' },
    data: { externalIdentifier: subject, externalToken: token },
  });
  assert.equal(
    loginResponse.ok(),
    true,
    `Business browser login failed (${loginResponse.status()})`,
  );
  const sessionResponse = await context.request.get(`${apiOrigin}/user/browser-sessions/session`);
  assert.equal(
    sessionResponse.ok(),
    true,
    `Business browser session failed (${sessionResponse.status()})`,
  );
  const session = (await sessionResponse.json()).result;
  assert.ok(session?.activeSlotId && Number.isInteger(session.generation));
  const cookie = (await context.cookies()).find((entry) => entry.name === 'browserSession');
  assert.ok(cookie);
  const headers = {
    'x-browser-session-slot-id': session.activeSlotId,
    'x-browser-session-generation': String(session.generation),
  };
  const profileResponse = await context.request.get(`${apiOrigin}/user/profile`, { headers });
  assert.equal(profileResponse.ok(), true, `Business profile failed (${profileResponse.status()})`);
  const profile = (await profileResponse.json()).result;
  assert.ok(profile?.id);
  const page = await context.newPage();
  return { page, userId: profile.id, headers };
}

async function routeFixtureRequests(headers) {
  fixtureProxy = createServer((incoming, outgoing) => {
    const upstream = httpRequest(
      `${apiOrigin}${incoming.url}`,
      { method: incoming.method, headers: { ...incoming.headers, ...headers } },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on('error', () => {
      outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.pipe(upstream);
  });
  await new Promise((resolveListen) => fixtureProxy.listen(0, '127.0.0.1', resolveListen));
  process.env.PLAYWRIGHT_API_URL = `http://127.0.0.1:${fixtureProxy.address().port}`;
}

async function authorizeImporter(page) {
  let url;
  await poll(
    async () => {
      url = (await readFile(urlFile, 'utf8')).trim().split('\n').find(Boolean);
      return Boolean(url);
    },
    true,
    30_000,
  );
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page
    .locator('input[name="username"], input[name="email"]')
    .first()
    .fill(accounts.owner.email);
  await page.locator('input[name="password"]').fill(accounts.owner.password);
  await page.locator('input[type="submit"], button[type="submit"]').first().click();
}

async function startImporter() {
  await writeFile(urlFile, '', { mode: 0o600 });
  await writeFile(
    opener,
    '#!/bin/sh\numask 077\nprintf \'%s\\n\' "$1" >> "$E2E_IMPORTER_URL_FILE"\n',
    { mode: 0o700 },
  );
  await chmod(opener, 0o700);
  await writeFile(importFile, `API_TOKEN=${marker}\n`, { mode: 0o600 });
  proxy = createServer((incoming, outgoing) => {
    const isStage =
      incoming.method === 'POST' &&
      /^\/integrations\/v1\/organizations\/[^/]+\/importer-tool\/staged-items$/.test(incoming.url ?? '');
    const chunks = [];
    if (isStage) incoming.on('data', (chunk) => chunks.push(chunk));
    const upstream = httpRequest(
      `${apiOrigin}${incoming.url}`,
      { method: incoming.method, headers: incoming.headers },
      (response) => {
        if (isStage) stageResponse = { status: response.statusCode, chunks: [] };
        if (isStage) response.on('data', (chunk) => stageResponse.chunks.push(chunk));
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on('error', () => {
      outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.on('end', () => {
      if (isStage) stageRequest = Buffer.concat(chunks).toString();
    });
    incoming.pipe(upstream);
  });
  await new Promise((resolveListen) => proxy.listen(0, '127.0.0.1', resolveListen));
  const appApiOrigin = `http://127.0.0.1:${proxy.address().port}`;
  vite = spawn(
    join(appRoot, 'node_modules/.bin/vite'),
    ['--host', '127.0.0.1', '--port', '5173', '--strictPort', '--mode', 'dev'],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        INHERITI_API_ORIGIN: appApiOrigin,
        WEB_APP_URL: `http://localhost:${ports.ui}`,
      },
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  await new Promise((resolveReady, rejectReady) => {
    const done = (error) => {
      clearTimeout(timeout);
      if (error) rejectReady(error);
      else resolveReady();
    };
    const timeout = setTimeout(() => done(new Error('Vite did not start')), 30_000);
    let output = '';
    vite.once('error', done);
    vite.once('exit', (code) => done(new Error(`Vite exited before readiness (${code})`)));
    vite.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (!output.includes('Local:')) return;
      done();
    });
  });
  await poll(
    async () => {
      try {
        return (await fetch('http://127.0.0.1:5173')).ok;
      } catch {
        return false;
      }
    },
    true,
    30_000,
  );
  assert.equal(vite.exitCode, null);
  assert.equal(vite.signalCode, null);
  app = await electron.launch({
    executablePath: join(appRoot, 'node_modules/.bin/electron'),
    args: [appRoot, '--no-sandbox', '--disable-gpu'],
    cwd: appRoot,
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      XDG_CONFIG_HOME: join(directory, 'config'),
      INHERITI_ENV: 'local',
      INHERITI_API_ORIGIN: appApiOrigin,
      SAFEID_URL: safeIdUrl,
      SAFEID_REALM: 'inheriti-business-e2e',
      E2E_IMPORTER_URL_FILE: urlFile,
    },
  });
  return app.firstWindow();
}

try {
  await recordImporterRevision();
  ({ stop: stopStack } = await startStack('manual-mobile', { evidenceDir }));
  browser = await chromium.launch({ headless: true });
  const ownerContext = await browser.newContext();
  const managerContext = await browser.newContext();
  const owner = await loginBusiness(ownerContext, accounts.owner);
  const manager = await loginBusiness(managerContext, accounts.manager);
  await routeFixtureRequests(owner.headers);
  const tenant = await ensureTracerTenant(owner.page, {
    key: 'business-e2e-importer-staging',
    organizationName: 'Importer Staging E2E',
    members: [
      {
        firstName: 'E2E',
        lastName: 'Manager',
        email: accounts.manager.email,
        role: 'MANAGER',
        invitationStatus: 'ACCEPTED',
      },
    ],
    teams: [],
    plans: [],
  });
  const organizationId = tenant.organization.id;
  const ownerMember = tenant.members.find((member) => member.email === accounts.owner.email);
  const managerMember = tenant.members.find((member) => member.email === accounts.manager.email);
  assert.ok(ownerMember && managerMember);
  ownerMember.userId = owner.userId;
  managerMember.userId = manager.userId;
  const { pin } = await claimAndDistributeOrganizationKey({
    ownerPage: owner.page,
    organizationId,
    owner: ownerMember,
    manager: managerMember,
  });
  await authenticatedApiRequest(
    owner.page,
    'post',
    `/organizations/${organizationId}/complete-onboarding`,
    {},
  );
  await poll(
    async () =>
      (await authenticatedApiRequest(owner.page, 'get', `/organizations/${organizationId}`)).result
        ?.isActivationPending,
    false,
    60_000,
  );
  recordOracleResult(evidenceDir, {
    id: 'security-faithful-key-claim-and-activation',
    passed: true,
  });

  const oauthContext = await browser.newContext();
  const oauthPage = await oauthContext.newPage();
  const window = await startImporter();
  await window.getByRole('button', { name: 'Sign in with SafeID' }).click();
  await authorizeImporter(oauthPage);
  try {
    await poll(
      async () => {
        const body = await window.locator('body').innerText();
        if (body.includes('Import your secrets, then review them.')) return true;
        const select = window.getByRole('button', { name: 'Select', exact: true }).first();
        if (await select.isVisible()) await select.click();
        return false;
      },
      true,
      60_000,
    );
  } catch (error) {
    console.error(
      'Importer workspace state:',
      (await window.locator('body').innerText()).slice(0, 500),
    );
    throw error;
  }
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, importFile);
  await window.getByRole('button', { name: 'Choose files' }).click();
  await window.getByRole('button', { name: 'Continue' }).click();
  await window.getByRole('button', { name: /^Accept as / }).click();
  await window.getByRole('button', { name: 'Continue' }).click();
  await window.getByRole('button', { name: 'New plan' }).click();
  await window.getByRole('button', { name: 'Assign', exact: true }).click();
  await window.getByRole('button', { name: 'Continue' }).click();
  await window.getByRole('button', { name: 'Request via SafeKey Mobile' }).click();
  await window.getByRole('button', { name: 'Simulate locally' }).click();
  await window.getByRole('textbox', { name: 'Recovery code' }).fill(pin);
  await window.getByRole('button', { name: 'Release locally' }).click();
  await window.getByRole('button', { name: 'Encrypt and stage' }).click();
  await window.getByText('Import staged successfully').waitFor({ timeout: 90_000 });
  assert.equal(stageResponse?.status, 201);
  assert.ok(stageRequest);
  const requestBody = JSON.parse(stageRequest);
  const responseBody = JSON.parse(Buffer.concat(stageResponse.chunks).toString());
  assert.equal(Object.hasOwn(requestBody.planDraft, 'assets'), false);
  assert.equal(requestBody.assetDrafts.length, 1);
  assert.ok(requestBody.assetDrafts[0].fields.length > 0);
  for (const field of requestBody.assetDrafts[0].fields) {
    assert.equal(Object.hasOwn(field, 'value'), false);
    assert.equal(field.envelope?.algorithm, 'AES-GCM-256');
    assert.ok(field.envelope?.ciphertext && field.envelope?.iv);
  }
  assert.equal(JSON.stringify(requestBody).includes(marker), false);
  assert.equal(JSON.stringify(responseBody).includes(marker), false);
  assert.equal(JSON.stringify(responseBody).includes('ciphertext'), false);
  assert.equal(JSON.stringify(responseBody).includes('assetDrafts'), false);
  assert.deepEqual(Object.keys(responseBody.result).sort(), ['expiresAt', 'id']);
  const stagedId = responseBody.result?.id;
  assert.ok(stagedId);
  recordOracleResult(evidenceDir, { id: 'post-201-envelope-only-response', passed: true });
  const stagedResponse = await window.evaluate(
    (id) => window.inheriti.api.request({
      method: 'GET',
      path: `/integrations/v1/organizations/${id}/importer-tool/staged-items`,
      organizationId: id,
    }),
    organizationId,
  );
  assert.equal(stagedResponse.status, 200);
  const staged = stagedResponse.body;
  const items = Array.isArray(staged.result)
    ? staged.result
    : (staged.result?.items ?? staged.result?.data);
  assert.ok(Array.isArray(items));
  assert.equal(items.find((item) => item.id === stagedId)?.planState, 'NOT_CREATED');
  assert.equal(JSON.stringify(staged).includes(marker), false);
  recordOracleResult(evidenceDir, { id: 'staged-list-not-created-and-redacted', passed: true });
  const plans = await authenticatedApiRequest(
    owner.page,
    'get',
    `/shared-plans?tenantId=${organizationId}`,
  );
  assert.equal(plans.result?.total, 0);
  recordOracleResult(evidenceDir, { id: 'normal-plan-absent', passed: true });
  completed = true;
} catch (error) {
  runError = error;
} finally {
  for (const close of [() => app?.close(), () => browser?.close()]) {
    try {
      await close();
    } catch (error) {
      cleanupError ??= error;
    }
  }
  try {
    if (vite) vite.kill('SIGTERM');
    if (proxy) await new Promise((resolveClose) => proxy.close(resolveClose));
    if (fixtureProxy) await new Promise((resolveClose) => fixtureProxy.close(resolveClose));
  } catch (error) {
    cleanupError ??= error;
  }
  try {
    await stopStack?.();
  } catch (error) {
    cleanupError ??= error;
  }
  try {
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    cleanupError ??= error;
  }
  finalizeManifest(evidenceDir, { outcome: completed && !cleanupError ? 'pass' : 'fail' });
}
if (runError) throw runError;
if (cleanupError) throw cleanupError;
console.info(`Importer served staging gate passed; evidence: ${evidenceDir}`);
