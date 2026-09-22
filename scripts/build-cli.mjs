import { chmod, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { optionalToastPlugin } from './optional-toast-plugin.mjs';
import { optionalDevtoolsPlugin } from './optional-devtools-plugin.mjs';
import { packageDirectory } from './package-directory.mjs';
import { buildDefines, writeBuildDeployment } from './build-deployment.mjs';

/**
 * Builds the CLI as one self-contained ESM file.
 *
 * `tsc` alone emitted a `dist` whose imports still resolved through the workspace's `node_modules`,
 * so the packed tarball only ran on a machine that already had this checkout — the two SDKs were
 * `link:` dependencies and nothing else could resolve them. Bundling makes `npm i -g` the tarball
 * work anywhere.
 */
const root = process.cwd();
const output = resolve(root, 'dist');

await rm(output, { recursive: true, force: true });

// Types are still checked against the real project; the bundle is what ships.
const typecheck = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'tsc', '-p', 'tsconfig.build.json', '--noEmit'],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (typecheck.status !== 0) process.exit(typecheck.status ?? 1);

// `src/main.ts` carries the shebang; esbuild hoists it to the top of the bundle.
const entry = resolve(output, 'main.js');
await build({
  entryPoints: [resolve(root, 'src/main.ts')],
  outfile: entry,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  plugins: [optionalToastPlugin, optionalDevtoolsPlugin],
  define: buildDefines(),
  // Some transitive dependencies are still CommonJS, and esbuild's ESM output has no `require` to
  // hand them — without this shim the bundle dies on its first `require('fs')`.
  banner: {
    js: "import { createRequire as __nodeCreateRequire } from 'node:module';\nconst require = __nodeCreateRequire(import.meta.url);",
  },
});
await chmod(entry, 0o755);

// Core resolves its SSDP worker as `new URL('./workers/…', import.meta.url)`, which now points at the
// bundle's own directory — so the worker has to sit beside it.
const coreSdk = await packageDirectory(root, '@safetech/inheriti-core-sdk');
const workers = resolve(coreSdk, 'dist', 'workers');
if (existsSync(workers)) await cp(workers, resolve(output, 'workers'), { recursive: true });

// The bundled clipboard adapter resolves its Linux helper one directory above `dist`. Keep local
// builds shaped like the installed package so live CLI/E2E runs exercise the same secure path.
const clipboardy = await packageDirectory(root, 'clipboardy');
const fallbacks = resolve(root, 'fallbacks');
await rm(fallbacks, { recursive: true, force: true });
await cp(resolve(clipboardy, 'fallbacks'), fallbacks, { recursive: true });
await writeBuildDeployment(output);
