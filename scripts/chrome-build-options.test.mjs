import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromeBuildOptions } from './chrome-build-options.mjs';
import { matchingBuildDeployment } from './build-deployment.mjs';

test('only explicit local harness builds remove the deployment lock', () => {
  assert.deepEqual(chromeBuildOptions(['--deployment=local', '--harness'], {}), {
    harness: true, defines: { __INHERITI_PRODUCTION_BUILD__: 'false' },
  });
  assert.equal(chromeBuildOptions(['--deployment=local'], {}).defines.__INHERITI_DEPLOYMENT__, '"local"');
  for (const deployment of ['dev', 'stg', 'prod']) {
    assert.throws(() => chromeBuildOptions([`--deployment=${deployment}`, '--harness'], {}), /requires --deployment=local/);
  }
  assert.throws(() => chromeBuildOptions(['--harness'], {}), /requires INHERITI_BUILD_DEPLOYMENT/);
});

test('packaging rejects the unlocked harness marker', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'guard-harness-'));
  try {
    await mkdir(resolve(root, 'dist'));
    await writeFile(resolve(root, 'dist/build-deployment.json'), JSON.stringify({ deployment: null, harness: true }));
    await assert.rejects(matchingBuildDeployment(root, ['--deployment=local'], {}), /locked to null/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
