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
const harnessRoot = resolve(appRoot, '../../../bussiness/feature-e2e');
const requireFromHarness = createRequire(join(harnessRoot, 'package.json'));
const requireFromApi = createRequire(join(harnessRoot, '../api/package.json'));
const { chromium, _electron: electron } = requireFromHarness('playwright');
const { accounts, ports } = await import(pathToFileURL(join(harnessRoot, 'lib/env.mjs')));
const { startStack } = await import(pathToFileURL(join(harnessRoot, 'config/services.mjs')));
const { createEvidenceRun, finalizeManifest, recordOracleResult } = await import(
  pathToFileURL(join(harnessRoot, 'lib/evidence.mjs'))
);
const { revisionInfo } = await import(pathToFileURL(join(harnessRoot, 'lib/git.mjs')));
const { Id } = await import(
  pathToFileURL(
    join(
      harnessRoot,
      '../api/node_modules/@safetechio/api-utils/packages/core/dist/domain/index.js',
    ),
  )
);

const apiOrigin = `http://localhost:${ports.api}`;
let appApiOrigin = apiOrigin;
const safeIdUrl = `http://localhost:${ports.keycloak}`;
const organizationName = 'Importer E2E Accounts';
const sharedOrganizationName = 'Importer E2E Shared';
const evidenceDir = createEvidenceRun({
  scenarioId: 'e2e-importer-multi-account',
  actorRoles: ['owner', 'manager'],
});

async function recordImporterRevision() {
  const integrationsRoot = resolve(appRoot, '../..');
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
let stopStack;
let vite;
let app;
let browser;
let proxy;
let heldApiResponse;
const apiRequests = [];
const directory = await mkdtemp(join(tmpdir(), 'importer-e2e-'));
const urlFile = join(directory, 'oauth-urls');
const opener = join(directory, 'xdg-open');
let openedUrls = 0;

async function poll(read, expected, timeout = 45_000) {
  const until = Date.now() + timeout;
  let actual;
  while (Date.now() < until) {
    actual = await read();
    if (actual === expected) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  assert.equal(actual, expected);
}

async function waitForHttp(url) {
  await poll(
    async () => {
      try {
        return (await fetch(url)).ok;
      } catch {
        return false;
      }
    },
    true,
    30_000,
  );
}

async function authorize(page, account) {
  let url;
  await poll(
    async () => {
      const lines = (await readFile(urlFile, 'utf8')).trim().split('\n').filter(Boolean);
      url = lines[openedUrls];
      return Boolean(url);
    },
    true,
    30_000,
  );
  openedUrls++;
  await page.context().clearCookies();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="username"], input[name="email"]').first().fill(account.email);
  await page.locator('input[name="password"]').fill(account.password);
  await page.locator('input[type="submit"], button[type="submit"]').first().click();
}

async function profileEmail(window) {
  try {
    const response = await window.evaluate(() =>
      window.inheriti.api.request({ method: 'GET', path: '/user/profile' }),
    );
    return response.status === 200 ? response.body?.result?.email : undefined;
  } catch {
    return undefined;
  }
}

async function savedAccounts(window) {
  return window.evaluate(() => window.inheriti.auth.accounts());
}

async function selectedOrganizationId(window, accountKey) {
  return window.evaluate(
    (key) => localStorage.getItem(`selectedOrganizationId:${key}`),
    accountKey,
  );
}

async function revokeSavedSession(accountKey) {
  return app.evaluate(async ({ app: electronApp }, key) => {
    const requireFromApp = process
      .getBuiltinModule('node:module')
      .createRequire(`${electronApp.getAppPath()}/package.json`);
    const { contextForKey } = requireFromApp(
      `${electronApp.getAppPath()}/electron/lib/api-session.cjs`,
    );
    const { revokeSession } = requireFromApp(
      `${electronApp.getAppPath()}/electron/lib/api-transport.cjs`,
    );
    const context = contextForKey(key);
    const cookieNames = (
      await context.session.cookies.get({ url: process.env.INHERITI_API_ORIGIN })
    ).map((cookie) => cookie.name);
    const failed = await revokeSession(context);
    await context.session.cookies.remove(process.env.INHERITI_API_ORIGIN, 'token');
    return { cookieNames, failed };
  }, accountKey);
}

async function seedOrganization(account, shared = false) {
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
  const cookies = new Map();
  const request = async (path, options = {}) => {
    const response = await fetch(`${apiOrigin}${path}`, {
      method: options.body ? 'POST' : 'GET',
      signal: AbortSignal.timeout(15_000),
      headers: {
        ...(cookies.size
          ? { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') }
          : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    for (const header of response.headers.getSetCookie()) {
      const [name, value] = header.split(';', 1)[0].split('=');
      if (!value || /max-age=0/i.test(header)) cookies.delete(name);
      else cookies.set(name, value);
    }
    const payload = await response.json();
    assert.equal(response.ok, true, `Fixture API ${path} failed: ${response.status}`);
    return payload.result ?? payload;
  };
  const csrf = await request('/csrf');
  await request('/user/browser-sessions/login', {
    headers: { 'x-csrf-token': csrf.token },
    body: { externalIdentifier: subject, externalToken: token },
  });
  const session = await request('/user/browser-sessions/session');
  const headers = {
    'x-csrf-token': csrf.token,
    'x-browser-session-slot-id': session.activeSlotId,
    'x-browser-session-generation': String(session.generation),
  };
  let organizationId;
  if (shared) {
    const result = await request('/test/panel/tenant-bootstrap', {
      headers,
      body: {
        key: 'business-e2e-importer-multi-account',
        mode: 'create-only',
        bootstrap: {
          organization: { name: sharedOrganizationName },
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
        },
      },
    });
    organizationId = result.organization.id;
  } else {
    organizationId = new Id().value;
    await request('/organizations/trial', {
      headers,
      body: {
        acceptedBusinessTerms: true,
        organizationId,
        companyName: organizationName,
        orgName: organizationName,
        billingPeriod: 'MONTHLY',
        plan: 'STARTUP',
      },
    });
  }
  const { createConnection } = requireFromApi('mysql2/promise');
  const connection = await createConnection({
    host: '127.0.0.1',
    port: ports.mysql,
    user: 'root',
    password: 'business_e2e_root',
    database: 'inheriti_business',
  });
  try {
    const [result] = await connection.execute(
      'UPDATE organization SET activation_required = 0 WHERE id = ?',
      [organizationId],
    );
    assert.equal(result.affectedRows, 1);
  } finally {
    await connection.end();
  }
  return organizationId;
}

async function enterWorkspace(window) {
  await poll(async () => {
    const body = await window.locator('body').innerText();
    if (body.includes('Import your secrets, then review them.')) return true;
    const select = window.getByRole('button', { name: 'Select', exact: true }).first();
    if (await select.isVisible()) await select.click();
    return false;
  }, true);
}

async function launch() {
  const packagedExecutable = process.env.E2E_IMPORTER_EXECUTABLE;
  return electron.launch({
    executablePath: packagedExecutable || join(appRoot, 'node_modules/.bin/electron'),
    args: packagedExecutable
      ? ['--no-sandbox', '--disable-gpu']
      : [appRoot, '--no-sandbox', '--disable-gpu'],
    cwd: appRoot,
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      XDG_CONFIG_HOME: join(directory, 'config'),
      INHERITI_ENV: 'local',
      INHERITI_API_ORIGIN: appApiOrigin,
      SAFEID_URL: safeIdUrl,
      SAFEID_REALM: 'inheriti-business-e2e',
      SAFEID_CLIENT_ID: 'inheriti-business-integrations-interactive',
      E2E_IMPORTER_URL_FILE: urlFile,
    },
  });
}

let runError;
let cleanupError;
let completed = false;
try {
  await recordImporterRevision();
  await writeFile(urlFile, '', { mode: 0o600 });
  await writeFile(
    opener,
    '#!/bin/sh\numask 077\nprintf \'%s\\n\' "$1" >> "$E2E_IMPORTER_URL_FILE"\n',
    { mode: 0o700 },
  );
  await chmod(opener, 0o700);
  ({ stop: stopStack } = await startStack('manual', { evidenceDir }));
  proxy = createServer((incoming, outgoing) => {
    const cookieNames = String(incoming.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim().split('=')[0])
      .filter(Boolean);
    const entry = { path: incoming.url, cookieNames };
    apiRequests.push(entry);
    const upstream = httpRequest(
      `${apiOrigin}${incoming.url}`,
      { method: incoming.method, headers: incoming.headers },
      (response) => {
        entry.status = response.statusCode;
        entry.setCookieNames = (response.headers['set-cookie'] ?? []).map(
          (header) => header.split('=')[0],
        );
        const deliver = () => {
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
          response.resume();
        };
        if (heldApiResponse && incoming.url === '/user/profile?e2e_stale=1') {
          response.pause();
          heldApiResponse.arrived = true;
          heldApiResponse.release = deliver;
          return;
        }
        deliver();
      },
    );
    upstream.on('error', () => {
      outgoing.writeHead(502);
      outgoing.end();
    });
    incoming.pipe(upstream);
  });
  await new Promise((resolveListen) => proxy.listen(0, '127.0.0.1', resolveListen));
  appApiOrigin = `http://127.0.0.1:${proxy.address().port}`;
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
      stdio: 'ignore',
    },
  );
  await waitForHttp('http://127.0.0.1:5173');
  browser = await chromium.launch({ headless: true });
  const managerOrganizationId = await seedOrganization(accounts.manager);
  const ownerOrganizationId = await seedOrganization(accounts.owner, true);
  assert.notEqual(ownerOrganizationId, managerOrganizationId);
  const oauthContext = await browser.newContext();
  const oauthPage = await oauthContext.newPage();
  app = await launch();
  let window = await app.firstWindow();
  await window.getByRole('button', { name: 'Sign in with SafeID' }).click();
  await authorize(oauthPage, accounts.owner);
  try {
    await enterWorkspace(window);
  } catch (error) {
    const summary = apiRequests
      .filter((request) =>
        ['/csrf', '/user/login', '/integrations/tester-access'].includes(request.path),
      )
      .slice(-8);
    await writeFile(
      join(evidenceDir, 'request-summary.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    console.error(
      'Importer sign-in state:',
      (await window.locator('body').innerText()).slice(0, 500),
    );
    console.error(
      'SafeID page state:',
      (await oauthPage.locator('body').innerText()).slice(0, 500),
    );
    console.error('API request summary:', summary);
    console.error(
      'Organization requests:',
      apiRequests.filter((request) => request.path?.startsWith('/organizations/')),
    );
    throw error;
  }
  assert.equal(await profileEmail(window), accounts.owner.email);
  recordOracleResult(evidenceDir, { id: 'owner-server-identity', passed: true });

  await window.getByRole('button', { name: /Open account menu/ }).click();
  await window.getByRole('menuitem', { name: 'Add account' }).click();
  await authorize(oauthPage, accounts.manager);
  await poll(async () => (await savedAccounts(window)).length, 2);
  const saved = await savedAccounts(window);
  const owner = saved.find((account) => account.active);
  const manager = saved.find((account) => !account.active);
  assert.ok(owner && manager && owner.key !== manager.key);
  assert.equal(await profileEmail(window), accounts.owner.email);
  recordOracleResult(evidenceDir, { id: 'add-account-retains-owner', passed: true });

  await window.getByRole('button', { name: /Open account menu/ }).click();
  await window.getByRole('menuitem', { name: `Switch to account ${manager.subject}` }).click();
  await window.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await profileEmail(window), accounts.owner.email);
  await window.getByRole('button', { name: /Open account menu/ }).click();
  await window.getByRole('menuitem', { name: `Switch to account ${manager.subject}` }).click();
  await window.getByRole('button', { name: 'Switch account', exact: true }).click();
  await enterWorkspace(window);
  await poll(() => profileEmail(window), accounts.manager.email);
  await poll(() => selectedOrganizationId(window, manager.key), managerOrganizationId);
  recordOracleResult(evidenceDir, { id: 'manager-server-identity-after-switch', passed: true });

  await app.close();
  app = await launch();
  window = await app.firstWindow();
  try {
    await enterWorkspace(window);
  } catch (error) {
    console.error('Restart state:', (await window.locator('body').innerText()).slice(0, 500));
    console.error('Restart saved account count:', (await savedAccounts(window)).length);
    throw error;
  }
  await poll(() => profileEmail(window), accounts.manager.email);
  assert.equal((await savedAccounts(window)).length, 2);
  recordOracleResult(evidenceDir, { id: 'restart-restores-manager', passed: true });

  await window.getByRole('button', { name: /Open account menu/ }).click();
  await window.getByRole('menuitem', { name: `Switch to account ${owner.subject}` }).click();
  await window.getByRole('button', { name: 'Switch account', exact: true }).click();
  await enterWorkspace(window);
  await poll(() => profileEmail(window), accounts.owner.email);
  recordOracleResult(evidenceDir, { id: 'owner-server-identity-restored', passed: true });

  heldApiResponse = { arrived: false, release: null };
  const staleRequest = window.evaluate(async () => {
    try {
      await window.inheriti.api.request({
        method: 'GET',
        path: '/user/profile',
        query: { e2e_stale: '1' },
      });
      return 'resolved';
    } catch (error) {
      return String(error.message);
    }
  });
  await poll(() => heldApiResponse.arrived, true);
  await window.getByRole('button', { name: /Open account menu/ }).click();
  await window.getByRole('menuitem', { name: `Switch to account ${manager.subject}` }).click();
  await window.getByRole('button', { name: 'Switch account', exact: true }).click();
  await poll(() => profileEmail(window), accounts.manager.email);
  heldApiResponse.release();
  heldApiResponse = null;
  assert.match(await staleRequest, /AUTH_CONTEXT_CHANGED/);
  recordOracleResult(evidenceDir, { id: 'stale-api-response-rejected', passed: true });
  await window.getByRole('button', { name: /Open account menu/ }).click();
  await window.getByRole('menuitem', { name: `Switch to account ${owner.subject}` }).click();
  await window.getByRole('button', { name: 'Switch account', exact: true }).click();
  await enterWorkspace(window);
  await poll(() => profileEmail(window), accounts.owner.email);

  const managerDestination = `Switch to ${manager.subject} and open ${sharedOrganizationName}`;
  await window.getByRole('button', { name: /Open account menu/ }).click();
  await window.getByRole('menuitem', { name: managerDestination }).click();
  const confirmation = await window.getByRole('dialog').innerText();
  assert.ok(confirmation.includes(manager.subject));
  assert.ok(confirmation.includes(sharedOrganizationName));
  await window.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await profileEmail(window), accounts.owner.email);
  assert.equal(await selectedOrganizationId(window, owner.key), ownerOrganizationId);
  assert.equal(await selectedOrganizationId(window, manager.key), managerOrganizationId);
  await window.getByRole('button', { name: /Open account menu/ }).click();
  await window.getByRole('menuitem', { name: managerDestination }).click();
  await window.getByRole('button', { name: 'Switch account', exact: true }).click();
  await poll(() => profileEmail(window), accounts.manager.email);
  await poll(() => selectedOrganizationId(window, manager.key), ownerOrganizationId);
  await poll(
    async () =>
      (await window.locator('body').innerText()).includes('Import your secrets, then review them.'),
    true,
  );
  recordOracleResult(evidenceDir, { id: 'cross-account-organization-destination', passed: true });

  await window.getByRole('button', { name: /Open account menu/ }).click();
  await window.getByRole('menuitem', { name: `Switch to account ${owner.subject}` }).click();
  await window.getByRole('button', { name: 'Switch account', exact: true }).click();
  await enterWorkspace(window);
  await poll(() => profileEmail(window), accounts.owner.email);

  await app.evaluate(
    ({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
    },
    join(appRoot, 'tests/fixtures/sample-imports/passbolt-export.json'),
  );
  await window.getByRole('button', { name: 'Choose files' }).click();
  await window.getByRole('button', { name: 'Cancel import' }).waitFor();
  assert.equal(await window.getByRole('button', { name: /Open account menu/ }).count(), 0);
  assert.equal(await profileEmail(window), accounts.owner.email);
  await window.getByRole('button', { name: 'Cancel import' }).click();
  await window
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel import', exact: true })
    .click();
  await window.getByRole('button', { name: /Open account menu/ }).waitFor();
  recordOracleResult(evidenceDir, { id: 'import-workspace-blocks-account-menu', passed: true });

  await window.getByRole('button', { name: /Open account menu/ }).click();
  await window.getByRole('menuitem', { name: managerDestination }).click();
  const membersResponse = await window.evaluate(
    (organizationId) =>
      window.inheriti.api.request({
        method: 'GET',
        path: `/organizations/${organizationId}/members`,
      }),
    ownerOrganizationId,
  );
  assert.equal(membersResponse.status, 200);
  const managerMember = membersResponse.body?.result?.items?.find(
    (member) => member.email === accounts.manager.email,
  );
  assert.ok(managerMember?.id);
  const removal = await window.evaluate(
    (memberId) =>
      window.inheriti.api.request({ method: 'DELETE', path: `/organizations/members/${memberId}` }),
    managerMember.id,
  );
  assert.ok(removal.status >= 200 && removal.status < 300);
  await window.getByRole('button', { name: 'Switch account', exact: true }).click();
  await window.getByText(/no longer available for this account/i).waitFor();
  assert.equal(await profileEmail(window), accounts.owner.email);
  assert.equal(await selectedOrganizationId(window, owner.key), ownerOrganizationId);
  recordOracleResult(evidenceDir, { id: 'removed-membership-rejects-destination', passed: true });

  const revocation = await revokeSavedSession(manager.key);
  assert.equal(
    revocation.failed,
    false,
    `Manager revocation failed; cookie names: ${revocation.cookieNames.join(', ')}; requests: ${JSON.stringify(apiRequests.filter((entry) => ['/csrf', '/user/logout'].includes(entry.path)).slice(-4))}`,
  );
  assert.equal((await savedAccounts(window)).length, 2);
  await window.getByRole('button', { name: /Open account menu/ }).click();
  await window.getByRole('menuitem', { name: `Switch to account ${manager.subject}` }).click();
  await window.getByRole('button', { name: 'Switch account', exact: true }).click();
  await window
    .getByText(/AUTH_SESSION_EXPIRED|sign in again|could not switch/i)
    .first()
    .waitFor();
  const destinations = await window.evaluate(() => window.inheriti.auth.destinations());
  assert.equal(
    destinations.find((destination) => destination.accountKey === manager.key)?.status,
    'sign_in_required',
  );
  assert.equal(await profileEmail(window), accounts.owner.email);
  assert.equal(await selectedOrganizationId(window, owner.key), ownerOrganizationId);
  assert.equal((await savedAccounts(window)).length, 2);
  recordOracleResult(evidenceDir, { id: 'revoked-saved-account-retains-owner', passed: true });

  await window.getByRole('button', { name: /Open account menu/ }).click();
  await window.getByRole('menuitem', { name: `Remove saved account ${manager.subject}` }).click();
  await poll(async () => (await savedAccounts(window)).length, 1);
  assert.equal(await profileEmail(window), accounts.owner.email);
  await window.getByRole('button', { name: /Open account menu/ }).click();
  await window.getByRole('menuitem', { name: 'Sign out all accounts' }).click();
  await window.getByRole('button', { name: 'Sign out all', exact: true }).click();
  await poll(async () => (await savedAccounts(window)).length, 0);
  await window.getByRole('button', { name: 'Sign in with SafeID' }).waitFor();
  recordOracleResult(evidenceDir, { id: 'signout-one-and-all', passed: true });
  completed = true;
} catch (error) {
  runError = error;
} finally {
  heldApiResponse?.release?.();
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
  } catch (error) {
    cleanupError ??= error;
  }
  try {
    await stopStack?.();
  } catch (error) {
    cleanupError ??= error;
  } finally {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      cleanupError ??= error;
    }
  }
  finalizeManifest(evidenceDir, { outcome: completed && !cleanupError ? 'pass' : 'fail' });
}
if (runError) throw runError;
if (cleanupError) throw cleanupError;
console.info(`Importer served account gate passed; evidence: ${evidenceDir}`);
