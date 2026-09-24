import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { matchingBuildDeployment, packageVersionForDeployment } from './build-deployment.mjs';
import { packageDirectory } from './package-directory.mjs';

const root = process.cwd();
const deployment = await matchingBuildDeployment(root);
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const electron = JSON.parse(await readFile(resolve(await packageDirectory(root, 'electron'), 'package.json'), 'utf8'));
const version = packageVersionForDeployment(manifest.version, deployment);
const artifactsDirectory = process.argv.find((argument) => argument.startsWith('--artifacts-dir='))?.slice(16);
const stage = await mkdtemp(join(tmpdir(), 'inheriti-tray-'));
await cp(resolve(root, 'dist'), resolve(stage, 'dist'), { recursive: true });
await writeFile(resolve(stage, 'package.json'), `${JSON.stringify({
  name: 'inheriti-tray', version, type: 'module', main: 'dist/main.js', desktopName: 'inheriti-tray',
}, null, 2)}\n`);
const platform = process.argv.find((argument) => /^--(?:linux|mac|win)$/u.test(argument)) ??
  ({ linux: '--linux', darwin: '--mac', win32: '--win' })[process.platform];
if (!platform) throw new Error(`Unsupported packaging platform: ${process.platform}`);
const result = spawnSync(process.platform === 'win32' ? 'corepack.cmd' : 'corepack', [
  'pnpm', 'exec', 'electron-builder', platform, '--projectDir', stage,
  '--config', resolve(root, 'electron-builder.config.cjs'),
  `--config.electronVersion=${electron.version}`,
], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    INHERITI_BUILD_DEPLOYMENT: deployment,
    INHERITI_ARTIFACTS_DIR: resolve(root, artifactsDirectory ?? `artifacts/${deployment}`),
  },
});
await rm(stage, { recursive: true, force: true });
if (result.status !== 0) process.exit(result.status ?? 1);
