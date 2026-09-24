import { chmod, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { packageDirectory } from './package-directory.mjs';
import { buildDefines, writeBuildDeployment } from './build-deployment.mjs';

const root = process.cwd();
const output = resolve(root, 'dist');
const checked = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'tsc', '-p', 'tsconfig.build.json', '--noEmit'],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (checked.status !== 0) process.exit(checked.status ?? 1);
await rm(output, { recursive: true, force: true });
await build({
  entryPoints: [resolve(root, 'src/main.ts')],
  outfile: resolve(output, 'main.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  define: buildDefines(),
  banner: { js: "import { createRequire as __nodeCreateRequire } from 'node:module';\nconst require = __nodeCreateRequire(import.meta.url);" },
});
await chmod(resolve(output, 'main.js'), 0o755);
await cp(resolve(root, 'src', 'assets'), resolve(output, 'assets'), { recursive: true });
await cp(resolve(root, 'src', 'templates'), resolve(output, 'templates'), { recursive: true });
const coreSdk = await packageDirectory(root, '@safetech/inheriti-core-sdk');
const workers = resolve(coreSdk, 'dist', 'workers');
if (existsSync(workers)) await cp(workers, resolve(output, 'workers'), { recursive: true });
await writeBuildDeployment(output);
