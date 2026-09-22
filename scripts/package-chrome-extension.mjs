import { mkdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { chromeExtensionId } from './chrome-extension-id.mjs';
import { matchingBuildDeployment } from './build-deployment.mjs';

const root = process.cwd();
const deployment = await matchingBuildDeployment(root);
const artifacts = resolve(root, process.argv.find((value) => value.startsWith('--artifacts-dir='))?.slice(16) ?? 'artifacts');
const packageManifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const builtManifest = JSON.parse(await readFile(resolve(root, 'dist', 'manifest.json'), 'utf8'));
if (builtManifest.version !== packageManifest.version) {
  throw new Error(
    `Refusing to package version drift: package.json=${packageManifest.version}, dist/manifest.json=${builtManifest.version}`,
  );
}

const EXPECTED_PRODUCTION_ID = 'kebghapddpgnfjpkecphjecbffdhodln';
const extensionId = chromeExtensionId(builtManifest.key);
if (deployment === 'prod' && extensionId !== EXPECTED_PRODUCTION_ID) {
  throw new Error(
    `Production identity mismatch: expected ${EXPECTED_PRODUCTION_ID}, manifest key derives ${extensionId}`,
  );
}

const archive = resolve(artifacts, `InheritiGuard-${packageManifest.version}.zip`);
await mkdir(artifacts, { recursive: true });
await rm(archive, { force: true });

const result = spawnSync('zip', ['-q', '-r', archive, '.'], { cwd: resolve(root, 'dist'), stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(archive);
