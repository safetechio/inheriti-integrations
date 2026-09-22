import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

const target = resolve(process.argv[2] ?? 'apps/inheriti-guard');
const sourceRoot = resolve(target, 'src');
const manifest = JSON.parse(await readFile(resolve(sourceRoot, 'manifest.json'), 'utf8'));
const errors = [];

// `identity` mints the extension's own chromiumapp.org redirect and runs the PKCE window Chrome owns;
// `storage` is needed for `chrome.storage.session`. Both are the narrowest way to sign an operator in.
// `alarms` closes a reveal whose service worker was evicted before its own deadline; without it an
// abandoned reveal would stay open on the server until the session expired. `webNavigation` restores
// the legacy browser-owned boundary for top-frame data/blob document traps.
const expectedPermissions = ['activeTab', 'scripting', 'sidePanel', 'identity', 'storage', 'alarms',
  'declarativeNetRequestWithHostAccess', 'downloads', 'idle', 'notifications', 'browsingData', 'cookies',
  'webNavigation'];
if (JSON.stringify([...manifest.permissions].sort()) !== JSON.stringify(expectedPermissions.sort())) {
  errors.push(`permissions must be exactly ${expectedPermissions.join(', ')}`);
}
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(['<all_urls>'])) {
  errors.push('Guard host_permissions must be exactly <all_urls>');
}
const scripts = manifest.content_scripts ?? [];
if (!scripts.some((entry) => entry.world === 'MAIN' && entry.js?.includes('content/guard-page.js'))
  || !scripts.some((entry) => entry.world === 'ISOLATED' && entry.js?.includes('content/guard-bridge.js'))) {
  errors.push('Guard MAIN and ISOLATED content boundaries are required');
}
if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3');
if (manifest.background?.type !== 'module') errors.push('service worker must be an ES module');
if (manifest.side_panel?.default_path !== 'side-panel/index.html') errors.push('side panel entrypoint is missing');
// A fixed id: the OAuth redirect is registered against it, so it must not move with the dist path.
if (typeof manifest.key !== 'string' || manifest.key.length < 300) errors.push('manifest key is missing');
if (manifest.options_ui && manifest.options_ui.page !== 'options/index.html') {
  errors.push('options page entrypoint is invalid');
}

const policy = manifest.content_security_policy?.extension_pages ?? '';
// `'wasm-unsafe-eval'` is not `'unsafe-eval'` and must not be caught by a substring match. It permits
// WebAssembly compilation and nothing else — no JS eval, no new Function — and the extension needs it
// because Argon2 master-key derivation is WASM. Without it Chrome blocks the compile and a DERIVED
// reveal fails at runtime while every Node test still passes, which is exactly how it was found.
const cspTokens = policy.split(/[\s;]+/u).filter(Boolean);
if (cspTokens.includes("'unsafe-eval'") || cspTokens.includes("'unsafe-inline'")) {
  errors.push('unsafe CSP policy is forbidden');
}

for (const file of await sourceFiles(sourceRoot)) {
  const source = await readFile(file, 'utf8');
  const name = relative(target, file);
  if (/\beval\s*\(|new\s+Function\s*\(/.test(source)) errors.push(`${name}: eval-like execution is forbidden`);
  if (/\.innerHTML\s*=/.test(source)) errors.push(`${name}: direct HTML injection is forbidden`);
  if (/<(?:iframe|object|embed)\b/i.test(source)) errors.push(`${name}: preview/embed markup is forbidden`);
  if (/<script[^>]+src=["']https?:/i.test(source)) errors.push(`${name}: remote script is forbidden`);
}

// The operator's tokens must live only in the session area, which a content script cannot read.
const sessionStore = await readFile(resolve(sourceRoot, 'background/session-store.ts'), 'utf8');
if (!sessionStore.includes('chrome.storage.session') && !/StorageArea/.test(sessionStore)) {
  errors.push('background/session-store.ts: the session must be held in chrome.storage.session');
}
for (const file of await sourceFiles(sourceRoot)) {
  // Comments describe the rules; only real code can break them.
  const source = withoutComments(await readFile(file, 'utf8'));
  const name = relative(target, file);
  // Configuration — an API origin, an issuer, a public client id — survives a browser restart in the
  // local area, or an installed extension would have to be reconfigured on every start. Session
  // material must not: it stays in the session area, which is what `session-store.ts` is checked for.
  const configurationOnly = name.includes('options/') || name.endsWith('background/service-worker.ts');
  if (!configurationOnly && /chrome\.storage\.local/.test(source)) {
    errors.push(`${name}: chrome.storage.local must not hold session material`);
  }
  if (configurationOnly && /chrome\.storage\.local\.(?:get|set)\s*\(/.test(source)) {
    errors.push(`${name}: reach the local area through shared/stored-configuration.ts, which fixes the keys`);
  }
  if (/chrome\.identity\.getAuthToken/.test(source)) errors.push(`${name}: getAuthToken ties the extension to a Google account`);
  // The side panel is sent view state; a token reaching it would put credentials in a renderer.
  if (name.includes('side-panel') && /accessToken|refreshToken|idToken/.test(source)) {
    errors.push(`${name}: the side panel must never handle tokens`);
  }
}

const authSource = await readFile(resolve(sourceRoot, 'background/auth.ts'), 'utf8');
if (!authSource.includes('launchWebAuthFlow')) errors.push('background/auth.ts: sign-in must use launchWebAuthFlow');

const worker = await readFile(resolve(sourceRoot, 'background/service-worker.ts'), 'utf8');
if (!worker.includes('chrome.action.onClicked')) errors.push('side panel must open from explicit action click');
if (!worker.includes('chrome.sidePanel.open')) errors.push('side panel open call is missing');
if (!worker.includes('chrome.tabs.onUpdated') || !worker.includes('chrome.tabs.onActivated')) {
  errors.push('tab navigation/change invalidation listeners are required');
}
if (!worker.includes('chrome.webNavigation?.onBeforeNavigate')) {
  errors.push('top-frame inline-document navigation trap is required');
}

if (errors.length > 0) throw new Error(`Chrome extension security violations:\n${errors.join('\n')}`);
console.log('chrome-mv3-security-boundaries-ok');

function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/.*$/gmu, '$1');
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : Promise.resolve(/\.(?:ts|html)$/.test(entry.name) ? [path] : []);
  }));
  return nested.flat();
}
