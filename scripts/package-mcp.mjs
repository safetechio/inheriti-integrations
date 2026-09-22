import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { matchingBuildDeployment } from './build-deployment.mjs';

const root = process.cwd();
await matchingBuildDeployment(root);
const artifacts = resolve(root, process.argv.find((value) => value.startsWith('--artifacts-dir='))?.slice(16) ?? 'artifacts');
const stage = resolve(artifacts, 'stage');
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(resolve(root, 'dist'), resolve(stage, 'dist'), { recursive: true });
await writeFile(resolve(stage, 'package.json'), `${JSON.stringify({
  name: manifest.name,
  version: manifest.version,
  type: 'module',
  bin: manifest.bin,
  files: ['dist'],
  engines: { node: '>=22' },
  private: false,
}, null, 2)}\n`);
const packed = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['pack', '--pack-destination', artifacts],
  { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' });
if (packed.status !== 0) process.exit(packed.status ?? 1);
await rm(stage, { recursive: true, force: true });
