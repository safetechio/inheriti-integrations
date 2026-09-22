import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { packageDirectory } from './package-directory.mjs';
import { matchingBuildDeployment, packageVersionForDeployment } from './build-deployment.mjs';

/**
 * Packs the CLI as an installable tarball.
 *
 * The published manifest is staged rather than reused: the workspace manifest names the two SDKs as
 * `link:` dependencies, which `npm i -g` cannot resolve anywhere but this checkout. The bundle
 * already contains them, so the staged manifest declares no dependencies at all.
 */
const root = process.cwd();
const deployment = await matchingBuildDeployment(root);
const artifacts = resolve(root, process.argv.find((value) => value.startsWith('--artifacts-dir='))?.slice(16) ?? 'artifacts');
const stage = resolve(artifacts, 'stage');

const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const packageVersion = packageVersionForDeployment(manifest.version, deployment);
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(resolve(root, 'dist'), resolve(stage, 'dist'), { recursive: true });
// clipboardy normally ships an xsel fallback beside its package. The CLI is bundled into dist,
// so that native helper must be copied explicitly or Linux reveal succeeds and clipboard delivery
// fails afterwards with a generic Error.
const clipboardy = await packageDirectory(root, 'clipboardy');
await mkdir(resolve(stage, 'fallbacks', 'linux'), { recursive: true });
await cp(
  resolve(clipboardy, 'fallbacks', 'linux', 'xsel'),
  resolve(stage, 'fallbacks', 'linux', 'xsel'),
);

await writeFile(resolve(stage, 'package.json'), `${JSON.stringify({
  name: manifest.name,
  version: packageVersion,
  description: deployment === 'prod' ? 'Inheriti CLI.' : 'Inheriti CLI (TEST builds only).',
  type: manifest.type,
  bin: manifest.bin,
  files: ['dist', 'fallbacks'],
  engines: { node: '>=22' },
  private: false,
}, null, 2)}\n`);

const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['pack', '--pack-destination', artifacts],
  { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' });
if (result.status !== 0) process.exit(result.status ?? 1);
await rm(stage, { recursive: true, force: true });
