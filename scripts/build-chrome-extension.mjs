import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { build } from 'esbuild';
import { optionalToastPlugin } from './optional-toast-plugin.mjs';
import { packageDirectory } from './package-directory.mjs';
import { buildDefines, packageVersionForDeployment, requiredBuildDeployment, writeBuildDeployment } from './build-deployment.mjs';
import { manifestKeyForBuild } from './chrome-extension-id.mjs';

const root = process.cwd();
const source = resolve(root, 'src');
const output = resolve(root, 'dist');
const deployment = requiredBuildDeployment();

const packageManifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const sourceManifest = JSON.parse(await readFile(resolve(source, 'manifest.json'), 'utf8'));
const chromeVersionPattern = /^\d{1,5}(?:\.\d{1,5}){0,3}$/u;
if (!chromeVersionPattern.test(packageManifest.version)) {
  throw new Error(`Chrome app package version is invalid: ${packageManifest.version}`);
}
if (sourceManifest.version !== packageManifest.version) {
  throw new Error(
    `Chrome version drift: package.json=${packageManifest.version}, src/manifest.json=${sourceManifest.version}`,
  );
}

await rm(output, { recursive: true, force: true });

// Types are checked against the real project; the bundles are what the browser loads.
const typecheck = spawnSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json', '--noEmit'], { cwd: root, stdio: 'inherit' });
if (typecheck.status !== 0) process.exit(typecheck.status ?? 1);

// MV3 resolves no bare specifiers, so the service worker and panel must arrive bundled. ESM, because
// the manifest declares the worker as a module and the CSP allows only self-hosted scripts.
await build({
  entryPoints: {
    'background/service-worker': resolve(source, 'background/service-worker.ts'),
    'side-panel/main': resolve(source, 'side-panel/main.ts'),
    'blocked/main': resolve(source, 'blocked/main.ts'),
  },
  outdir: output,
  bundle: true,
  platform: 'browser',
  format: 'esm',
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  target: 'chrome116',
  // Keep identifiers readable in stack traces while compacting syntax and whitespace. The
  // published Client SDK grew when its browser entry was added; this preserves the worker budget
  // without weakening the boundary or changing runtime behaviour.
  minifySyntax: true,
  minifyWhitespace: true,
  legalComments: 'external',
  sourcemap: true,
  logLevel: 'info',
  plugins: [optionalToastPlugin],
  define: buildDefines(),
});

// Dynamically registered content scripts are classic isolated-world scripts, not extension-page
// modules. They are self-contained and carry metadata only.
await build({
  entryPoints: {
    'content/overlay': resolve(source, 'content/overlay.ts'),
    'content/guard-bridge': resolve(source, 'content/guard-bridge.ts'),
    'content/guard-page': resolve(source, 'content/guard-page.ts'),
  },
  outdir: output,
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome116',
  sourcemap: true,
  logLevel: 'info',
});

// What MV3 refuses, and what a reveal must not have dragged in.
//
// The service worker has no DOM, so a UI framework reaching it is a composition mistake rather than
// weight — and the SDK's `/browser` entry exists precisely to keep the React-flavoured Core SDK out
// of it. The ceiling is generous but real: reveal added the SSDP v2 processor, the SSDP+ protocol and
// Argon2 key derivation, which is roughly 80 kB of the budget below and is the price of reconstructing
// on this thread rather than shipping a worker MV3 cannot start.
const workerPath = resolve(output, sourceManifest.background.service_worker);
const workerBundle = await readFile(workerPath, 'utf8');
const workerBytes = Buffer.byteLength(workerBundle);
const forbidden = ['react-dom', 'react/jsx', '"react"', 'zustand', '@tanstack/react-query'];
const present = forbidden.filter((name) => workerBundle.includes(name));
if (present.length > 0) throw new Error(`service worker bundles a UI framework: ${present.join(', ')}`);
if (/\brequire\s*\(/.test(workerBundle)) throw new Error('service worker contains require(); MV3 loads ESM only');
if (/\bfrom\s*["'][^."'/][^"']*["']/.test(workerBundle)) throw new Error('service worker contains a bare specifier MV3 cannot resolve');
const MAXIMUM_WORKER_BYTES = 200 * 1024;
if (workerBytes > MAXIMUM_WORKER_BYTES) {
  throw new Error(`service worker is ${workerBytes} bytes, over the ${MAXIMUM_WORKER_BYTES} ceiling`);
}
console.log(`service-worker: ${workerBytes} bytes, no UI framework`);

// Every relative ESM import emitted by code splitting must resolve inside dist. This prevents a
// release archive from containing its entry points but omitting a worker dependency.
const importPattern = /(?:from\s*|import\s*)["'](\.[^"']+)["']/gu;
const pendingModules = [workerPath];
const visitedModules = new Set();
while (pendingModules.length > 0) {
  const modulePath = pendingModules.pop();
  if (!modulePath || visitedModules.has(modulePath)) continue;
  visitedModules.add(modulePath);
  const moduleSource = await readFile(modulePath, 'utf8');
  for (const match of moduleSource.matchAll(importPattern)) {
    const dependency = resolve(dirname(modulePath), match[1]);
    await readFile(dependency);
    pendingModules.push(dependency);
  }
}
console.log(`service-worker graph: ${visitedModules.size} module(s): ${[...visitedModules].map((file) => relative(output, file)).join(', ')}`);

// Core resolves its SSDP worker relative to the module URL, which is now the bundle's own location.
const coreDirectory = await packageDirectory(root, '@safetech/inheriti-elements-core');
const sdkDirectory = await packageDirectory(coreDirectory, '@safetech/inheriti-client-sdk');
const coreSdkDirectory = await packageDirectory(sdkDirectory, '@safetech/inheriti-core-sdk');
await cp(resolve(coreSdkDirectory, 'dist', 'workers'), resolve(output, 'background', 'workers'), { recursive: true });
await cp(resolve(source, 'icons'), resolve(output, 'icons'), { recursive: true });

for (const page of ['side-panel', 'blocked']) {
  await mkdir(resolve(output, page), { recursive: true });
  await cp(resolve(source, page, 'index.html'), resolve(output, page, 'index.html'));
  await cp(resolve(source, page, 'styles.css'), resolve(output, page, 'styles.css'));
}
await cp(resolve(source, 'side-panel', 'font-app.ttf'), resolve(output, 'side-panel', 'font-app.ttf'));
const manifest = { ...sourceManifest, version: packageManifest.version,
  version_name: packageVersionForDeployment(packageManifest.version, deployment),
  key: manifestKeyForBuild(deployment, sourceManifest.key) };
await writeFile(
  resolve(output, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
await writeBuildDeployment(output);
