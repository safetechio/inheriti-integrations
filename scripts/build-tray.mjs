import { cp, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { packageDirectory } from './package-directory.mjs';
import { optionalToastPlugin } from './optional-toast-plugin.mjs';
import { buildDefines, writeBuildDeployment } from './build-deployment.mjs';

const root = process.cwd();
const output = resolve(root, 'dist');
const checked = spawnSync(process.platform === 'win32' ? 'corepack.cmd' : 'corepack',
  ['pnpm', 'exec', 'tsc', '-p', 'tsconfig.build.json', '--noEmit'],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (checked.status !== 0) process.exit(checked.status ?? 1);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
  entryPoints: [resolve(root, 'src/main.ts')],
  outfile: resolve(output, 'main.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['electron'],
  plugins: [optionalToastPlugin],
  define: buildDefines(),
  banner: { js: "import { createRequire as __nodeCreateRequire } from 'node:module';\nconst require = __nodeCreateRequire(import.meta.url);" },
});
await build({
  entryPoints: [resolve(root, 'src/preload.cts')],
  outfile: resolve(output, 'preload.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
});
await build({
  entryPoints: [resolve(root, 'src/launcher.jsx')],
  outfile: resolve(output, 'launcher.js'),
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});
for (const file of ['launcher.html', 'launcher.css', 'tray.png']) {
  await cp(resolve(root, 'src', file), resolve(output, file));
}
const integrationCore = await packageDirectory(root, '@safetech/inheriti-elements-core');
const clientSdk = await packageDirectory(integrationCore, '@safetech/inheriti-client-sdk');
const coreSdk = await packageDirectory(clientSdk, '@safetech/inheriti-core-sdk');
await cp(resolve(coreSdk, 'dist/workers'), resolve(output, 'workers'), { recursive: true });
await writeBuildDeployment(output);
