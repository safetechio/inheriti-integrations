import { cp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { optionalToastPlugin } from './optional-toast-plugin.mjs';
import { packageDirectory } from './package-directory.mjs';
import { buildDefines, writeBuildDeployment } from './build-deployment.mjs';

/**
 * VS Code loads an extension's entrypoint with `require()`, so the entrypoint must be CommonJS — while
 * this workspace, the client SDK and Core are all ESM-only. `tsc` alone therefore produced an
 * extension the editor could not load at all (D030).
 *
 * Bundling settles it: one CommonJS file with the ESM dependencies inlined, and `vscode` left external
 * because the editor injects it.
 */
const root = process.cwd();
const output = resolve(root, 'dist');

await rm(output, { recursive: true, force: true });

// Types are still checked against the real project; the bundle is what ships.
const typecheck = spawnSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json', '--noEmit'], { cwd: root, stdio: 'inherit' });
if (typecheck.status !== 0) process.exit(typecheck.status ?? 1);

await build({
  entryPoints: [resolve(root, 'src/extension.ts')],
  outfile: resolve(output, 'extension.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  external: ['vscode'],
  define: {
    'import.meta.url': 'ELEMENTS_BUNDLE_URL',
    ...buildDefines(),
  },
  logLevel: 'info',
  plugins: [optionalToastPlugin],
  // Core resolves its SSDP worker as `new URL('./workers/…', import.meta.url)`. esbuild's CJS shim
  // leaves `import.meta.url` undefined, so that threw ERR_INVALID_URL the moment the extension built
  // a client — measured inside a real Extension Host (D030). Point it at the bundle instead.
  banner: { js: "const ELEMENTS_BUNDLE_URL = require('node:url').pathToFileURL(__filename).href;" },
});

// …and ship the worker beside the bundle, because that is now where the URL points.
const coreDirectory = await packageDirectory(root, '@safetech/inheriti-elements-core');
const sdkDirectory = await packageDirectory(coreDirectory, '@safetech/inheriti-client-sdk');
const coreSdkDirectory = await packageDirectory(sdkDirectory, '@safetech/inheriti-core-sdk');
await cp(resolve(coreSdkDirectory, 'dist', 'workers'), resolve(output, 'workers'), { recursive: true });

// The live gate imports the extension's own modules outside the editor, so the ESM build stays too.
const modules = spawnSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });
if (modules.status !== 0) process.exit(modules.status ?? 1);
await writeBuildDeployment(output);
