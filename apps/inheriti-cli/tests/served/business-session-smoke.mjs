import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ecosystem = resolve(here, '../../../../../');
const harness = resolve(ecosystem, 'bussiness/feature-e2e');
const cli = resolve(here, '../../dist/main.js');
const { accounts, ports } = await import(resolve(harness, 'lib/env.mjs'));
const { chromium } = createRequire(resolve(harness, 'package.json'))('@playwright/test');
const issuer = `http://localhost:${ports.keycloak}/realms/inheriti-business-e2e`;
const api = `http://localhost:${ports.api}`;

function cliFailure(output) {
  const match = output.match(/\b(?:Unauthorized|Forbidden|business_[a-z_0-9]+|invalid_[a-z_0-9]+|operator_[a-z_0-9]+|session_[a-z_0-9]+|integration_[a-z_0-9]+|token_[a-z_0-9]+)\b/gu);
  return match?.at(-1) ?? 'unrecognized_cli_error';
}

async function preflightBundle() {
  const bundle = await readFile(cli, 'utf8');
  assert.ok(bundle.includes('businessApiUrl') && bundle.includes('business_revoke_timeout'),
    'CLI bundle lacks the local Business SDK revision');
  assert.equal(bundle.includes('node_modules/.pnpm/@safetech+inheriti-client-sdk@'), false,
    'CLI bundle still contains the registry SDK');
}

async function mapOperator() {
  const token = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password', client_id: 'business-ui-e2e',
      username: accounts.owner.email, password: accounts.owner.password, scope: 'openid',
    }),
  });
  assert.equal(token.status, 200, 'SafeID Web login failed');
  const access = (await token.json()).access_token;
  const subject = JSON.parse(Buffer.from(access.split('.')[1], 'base64url').toString()).sub;
  const csrf = await fetch(`${api}/csrf`);
  assert.equal(csrf.status, 200, 'Business CSRF handshake failed');
  const csrfToken = (await csrf.json()).result.token;
  const cookies = csrf.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
  const login = await fetch(`${api}/user/browser-sessions/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookies, 'x-csrf-token': csrfToken },
    body: JSON.stringify({ externalIdentifier: subject, externalToken: access }),
  });
  assert.ok(login.ok, `Business user mapping failed with HTTP ${login.status}`);
}

function command(args, environment, timeoutMs = 60_000) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += String(chunk); });
    child.once('error', reject);
    child.once('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`CLI ${args[0]} exited ${code}: ${cliFailure(output)}`));
      resolveCommand(output);
    });
  });
}

async function interactiveLogin(environment, browser) {
  const child = spawn('script', ['-qefc', `${process.execPath} ${cli} login`, '/dev/null'], {
    env: environment, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let resolveUrl;
  const authorizationUrl = new Promise(resolve => { resolveUrl = resolve; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
  const capture = chunk => {
    output += String(chunk);
    const url = output.match(/https?:\/\/[^\s\x1b]+\/protocol\/openid-connect\/auth\?[^\s\x1b]+/u)?.[0];
    if (url && resolveUrl) { resolveUrl(url); resolveUrl = undefined; }
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`CLI login exited ${code}: ${cliFailure(output)}`));
      else resolve();
    });
  });
  try {
    const url = await Promise.race([
      authorizationUrl,
      new Promise((_, reject) => setTimeout(() => reject(new Error('CLI did not print a SafeID authorization URL')), 30_000)),
    ]);
    const page = await browser.newPage();
    try {
      await page.goto(url);
      await page.locator('input[name="username"], input[name="email"]').first().fill(accounts.owner.email);
      await page.locator('input[name="password"]').fill(accounts.owner.password);
      await page.locator('input[type="submit"], button[type="submit"]').first().click();
      await completed;
    } finally { await page.close(); }
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
  assert.match(output, /Signed in\./u, 'CLI did not finish Business sign-in');
}

async function main() {
  await preflightBundle();
  const directory = await mkdtemp(resolve(tmpdir(), 'inheriti-cli-business-'));
  const browser = await chromium.launch({ headless: true });
  try {
    const configHome = resolve(directory, 'config');
    const stateHome = resolve(directory, 'state');
    const configPath = resolve(configHome, 'inheriti/config.json');
    const sessionPath = resolve(stateHome, 'inheriti/session.json');
    await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
    await writeFile(configPath, JSON.stringify({
      business: true,
      apiUrl: `${api}/integrations/`, issuer,
      clientId: 'inheriti-business-integrations-interactive',
      interactiveClientId: 'inheriti-business-integrations-interactive',
      environment: 'TEST',
      redirectUri: 'http://127.0.0.1/oauth/callback',
    }), { mode: 0o600 });
    const environment = Object.assign({}, process.env, {
      XDG_CONFIG_HOME: configHome,
      XDG_STATE_HOME: stateHome,
      INHERITI_ELEMENTS_NO_BROWSER: '1',
    });
    await mapOperator();
    await interactiveLogin(environment, browser);
    const session = JSON.parse(await readFile(sessionPath, 'utf8'));
    assert.equal(session.kind, 'business');
    assert.ok(session.familyId && session.accessToken && session.refreshToken);
    assert.equal('idToken' in session, false, 'CLI retained a SafeID ID token');
    assert.equal('refreshExpiresAt' in session, false, 'CLI retained SafeID refresh metadata');
    session.expiresAt = Date.now() - 1_000;
    await writeFile(sessionPath, JSON.stringify(session), { mode: 0o600 });
    const organizations = JSON.parse(await command(['organizations', 'list'], environment));
    assert.ok(Array.isArray(organizations.items), 'CLI protected organization read failed');
    const rotated = JSON.parse(await readFile(sessionPath, 'utf8'));
    assert.notEqual(rotated.refreshToken, session.refreshToken, 'CLI did not refresh through Business');
    await command(['logout'], environment);
    await assert.rejects(readFile(sessionPath), 'CLI logout retained the session file');
    const denied = await fetch(`${api}/integrations/v1/organizations`, {
      headers: { authorization: `Bearer ${rotated.accessToken}`, 'x-elements-environment': 'TEST' },
    });
    assert.equal(denied.status, 401, 'CLI logout did not revoke the Business family');
    console.log('CLI Business served smoke passed: PKCE exchange, protected read, refresh, logout, revocation');
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`CLI Business served smoke failed: ${error.message}`);
  process.exitCode = 1;
});
